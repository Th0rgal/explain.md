import { createHash } from "node:crypto";
import {
  computeConfigHash,
  planRegeneration,
  type ExplanationConfig,
  type RegenerationPlan,
} from "./config-contract.js";
import type { ExplanationTree, ExplanationTreeNode } from "./tree-builder.js";

export type ProgressiveDisclosureDiagnosticCode =
  | "missing_root"
  | "missing_node"
  | "cycle_detected"
  | "expanded_node_missing"
  | "expanded_node_not_reachable"
  | "expanded_node_not_parent";

export interface ProgressiveDisclosureDiagnostic {
  code: ProgressiveDisclosureDiagnosticCode;
  severity: "error" | "warning";
  message: string;
  details?: Record<string, unknown>;
}

export interface ProgressiveDisclosureRequest {
  expandedNodeIds?: string[];
  maxChildrenPerExpandedNode?: number;
}

export interface ProgressiveDisclosureNodeView {
  id: string;
  kind: ExplanationTreeNode["kind"];
  depthFromRoot: number;
  parentId?: string;
  statement: string;
  evidenceRefs: string[];
  isExpanded: boolean;
  isExpandable: boolean;
  childCount: number;
  visibleChildIds: string[];
  hiddenChildCount: number;
}

export interface ProgressiveDisclosureView {
  rootId: string;
  treeConfigHash: string;
  expandedNodeIds: string[];
  maxChildrenPerExpandedNode?: number;
  visibleNodes: ProgressiveDisclosureNodeView[];
  diagnostics: ProgressiveDisclosureDiagnostic[];
}

export type ExplanationDiffChangeType = "added" | "removed" | "changed";

export interface ExplanationDiffChange {
  key: string;
  type: ExplanationDiffChangeType;
  kind: ExplanationTreeNode["kind"];
  supportLeafIds: string[];
  baselineNodeId?: string;
  candidateNodeId?: string;
  baselineStatement?: string;
  candidateStatement?: string;
  baselineDepth?: number;
  candidateDepth?: number;
}

export interface ExplanationDiffReport {
  regenerationPlan: RegenerationPlan;
  baselineConfigHash: string;
  candidateConfigHash: string;
  baselineTreeConfigHash: string;
  candidateTreeConfigHash: string;
  changes: ExplanationDiffChange[];
  summary: {
    total: number;
    added: number;
    removed: number;
    changed: number;
  };
}

interface ReachabilityResult {
  reachable: Set<string>;
  diagnostics: ProgressiveDisclosureDiagnostic[];
}

interface DiffComparableNode {
  key: string;
  kind: ExplanationTreeNode["kind"];
  nodeId: string;
  statement: string;
  depth: number;
  supportLeafIds: string[];
}

export function buildProgressiveDisclosureView(
  tree: ExplanationTree,
  request: ProgressiveDisclosureRequest = {},
): ProgressiveDisclosureView {
  const maxChildren = normalizeMaxChildren(request.maxChildrenPerExpandedNode);
  const expandedNodeIds = normalizeIdList(request.expandedNodeIds ?? []);
  const expandedSet = new Set(expandedNodeIds);

  const reachability = collectReachableNodes(tree);
  const diagnostics = reachability.diagnostics.slice();

  for (const expandedId of expandedNodeIds) {
    const node = tree.nodes[expandedId];
    if (!node) {
      diagnostics.push({
        code: "expanded_node_missing",
        severity: "warning",
        message: `Expanded node '${expandedId}' does not exist in tree nodes.`,
        details: { nodeId: expandedId },
      });
      continue;
    }

    if (!reachability.reachable.has(expandedId)) {
      diagnostics.push({
        code: "expanded_node_not_reachable",
        severity: "warning",
        message: `Expanded node '${expandedId}' is not reachable from root '${tree.rootId}'.`,
        details: { nodeId: expandedId, rootId: tree.rootId },
      });
      continue;
    }

    if (node.kind !== "parent") {
      diagnostics.push({
        code: "expanded_node_not_parent",
        severity: "warning",
        message: `Expanded node '${expandedId}' is a leaf and cannot be expanded.`,
        details: { nodeId: expandedId, kind: node.kind },
      });
    }
  }

  const visibleNodes: ProgressiveDisclosureNodeView[] = [];
  const root = tree.nodes[tree.rootId];
  if (!root) {
    diagnostics.push({
      code: "missing_root",
      severity: "error",
      message: `Root node '${tree.rootId}' does not exist in tree nodes.`,
      details: { rootId: tree.rootId },
    });

    return {
      rootId: tree.rootId,
      treeConfigHash: tree.configHash,
      expandedNodeIds,
      maxChildrenPerExpandedNode: maxChildren,
      visibleNodes,
      diagnostics: sortDiagnostics(diagnostics),
    };
  }

  const activeStack = new Set<string>();
  const walk = (nodeId: string, parentId: string | undefined, depthFromRoot: number): void => {
    const node = tree.nodes[nodeId];
    if (!node) {
      diagnostics.push({
        code: "missing_node",
        severity: "error",
        message: `Visible traversal referenced missing node '${nodeId}'.`,
        details: { nodeId, parentId },
      });
      return;
    }

    if (activeStack.has(nodeId)) {
      diagnostics.push({
        code: "cycle_detected",
        severity: "error",
        message: `Cycle detected while traversing '${nodeId}' from root '${tree.rootId}'.`,
        details: { nodeId, parentId },
      });
      return;
    }

    activeStack.add(nodeId);

    const isExpandable = node.kind === "parent" && node.childIds.length > 0;
    const isExpanded = isExpandable && expandedSet.has(nodeId);
    const fullChildIds = isExpanded ? node.childIds.slice() : [];
    const visibleChildIds =
      maxChildren === undefined ? fullChildIds : fullChildIds.slice(0, Math.min(maxChildren, fullChildIds.length));

    visibleNodes.push({
      id: node.id,
      kind: node.kind,
      depthFromRoot,
      parentId,
      statement: node.statement,
      evidenceRefs: node.evidenceRefs.slice(),
      isExpanded,
      isExpandable,
      childCount: node.childIds.length,
      visibleChildIds,
      hiddenChildCount: node.childIds.length - visibleChildIds.length,
    });

    for (const childId of visibleChildIds) {
      walk(childId, node.id, depthFromRoot + 1);
    }

    activeStack.delete(nodeId);
  };

  walk(tree.rootId, undefined, 0);

  return {
    rootId: tree.rootId,
    treeConfigHash: tree.configHash,
    expandedNodeIds,
    maxChildrenPerExpandedNode: maxChildren,
    visibleNodes,
    diagnostics: sortDiagnostics(diagnostics),
  };
}

export function renderProgressiveDisclosureCanonical(view: ProgressiveDisclosureView): string {
  const lines = [
    "schema=progressive-disclosure-v1",
    `root_id=${view.rootId}`,
    `tree_config_hash=${view.treeConfigHash}`,
    `expanded=${view.expandedNodeIds.join(",") || "none"}`,
    `max_children=${view.maxChildrenPerExpandedNode ?? "none"}`,
    `visible_count=${view.visibleNodes.length}`,
    ...view.visibleNodes.map((node, index) =>
      [
        `visible[${index}].id=${node.id}`,
        `visible[${index}].kind=${node.kind}`,
        `visible[${index}].depth=${node.depthFromRoot}`,
        `visible[${index}].parent=${node.parentId ?? "none"}`,
        `visible[${index}].expanded=${node.isExpanded}`,
        `visible[${index}].expandable=${node.isExpandable}`,
        `visible[${index}].child_count=${node.childCount}`,
        `visible[${index}].visible_child_ids=${node.visibleChildIds.join(",") || "none"}`,
        `visible[${index}].hidden_child_count=${node.hiddenChildCount}`,
        `visible[${index}].evidence_refs=${node.evidenceRefs.join(",") || "none"}`,
        `visible[${index}].statement=${JSON.stringify(node.statement)}`,
      ].join("\n"),
    ),
    `diagnostics_count=${view.diagnostics.length}`,
    ...view.diagnostics.map((diagnostic, index) =>
      [
        `diagnostics[${index}].code=${diagnostic.code}`,
        `diagnostics[${index}].severity=${diagnostic.severity}`,
        `diagnostics[${index}].message=${JSON.stringify(diagnostic.message)}`,
        `diagnostics[${index}].details=${JSON.stringify(diagnostic.details ?? {})}`,
      ].join("\n"),
    ),
  ];

  return lines.join("\n");
}

export function computeProgressiveDisclosureHash(view: ProgressiveDisclosureView): string {
  return createHash("sha256").update(renderProgressiveDisclosureCanonical(view)).digest("hex");
}

export function buildExplanationDiffReport(
  baselineTree: ExplanationTree,
  candidateTree: ExplanationTree,
  baselineConfig: ExplanationConfig,
  candidateConfig: ExplanationConfig,
): ExplanationDiffReport {
  const regenerationPlan = planRegeneration(baselineConfig, candidateConfig);
  const baselineConfigHash = computeConfigHash(baselineConfig);
  const candidateConfigHash = computeConfigHash(candidateConfig);

  const baselineNodes = buildComparableNodeMap(baselineTree);
  const candidateNodes = buildComparableNodeMap(candidateTree);
  const signatureKeys = new Set<string>([...Object.keys(baselineNodes), ...Object.keys(candidateNodes)]);

  const changes: ExplanationDiffChange[] = [];

  for (const signatureKey of [...signatureKeys].sort((left, right) => left.localeCompare(right))) {
    const baselineEntries = baselineNodes[signatureKey] ?? [];
    const candidateEntries = candidateNodes[signatureKey] ?? [];
    const maxCount = Math.max(baselineEntries.length, candidateEntries.length);

    for (let index = 0; index < maxCount; index += 1) {
      const baselineEntry = baselineEntries[index];
      const candidateEntry = candidateEntries[index];
      const key = `${signatureKey}#${index}`;

      if (!baselineEntry && candidateEntry) {
        changes.push({
          key,
          type: "added",
          kind: candidateEntry.kind,
          supportLeafIds: candidateEntry.supportLeafIds,
          candidateNodeId: candidateEntry.nodeId,
          candidateStatement: candidateEntry.statement,
          candidateDepth: candidateEntry.depth,
        });
        continue;
      }

      if (baselineEntry && !candidateEntry) {
        changes.push({
          key,
          type: "removed",
          kind: baselineEntry.kind,
          supportLeafIds: baselineEntry.supportLeafIds,
          baselineNodeId: baselineEntry.nodeId,
          baselineStatement: baselineEntry.statement,
          baselineDepth: baselineEntry.depth,
        });
        continue;
      }

      if (!baselineEntry || !candidateEntry) {
        continue;
      }

      if (baselineEntry.statement !== candidateEntry.statement || baselineEntry.depth !== candidateEntry.depth) {
        changes.push({
          key,
          type: "changed",
          kind: baselineEntry.kind,
          supportLeafIds: baselineEntry.supportLeafIds,
          baselineNodeId: baselineEntry.nodeId,
          candidateNodeId: candidateEntry.nodeId,
          baselineStatement: baselineEntry.statement,
          candidateStatement: candidateEntry.statement,
          baselineDepth: baselineEntry.depth,
          candidateDepth: candidateEntry.depth,
        });
      }
    }
  }

  const summary = {
    total: changes.length,
    added: changes.filter((change) => change.type === "added").length,
    removed: changes.filter((change) => change.type === "removed").length,
    changed: changes.filter((change) => change.type === "changed").length,
  };

  return {
    regenerationPlan,
    baselineConfigHash,
    candidateConfigHash,
    baselineTreeConfigHash: baselineTree.configHash,
    candidateTreeConfigHash: candidateTree.configHash,
    changes: sortDiffChanges(changes),
    summary,
  };
}

export function renderExplanationDiffCanonical(report: ExplanationDiffReport): string {
  return JSON.stringify({
    regenerationPlan: report.regenerationPlan,
    baselineConfigHash: report.baselineConfigHash,
    candidateConfigHash: report.candidateConfigHash,
    baselineTreeConfigHash: report.baselineTreeConfigHash,
    candidateTreeConfigHash: report.candidateTreeConfigHash,
    summary: report.summary,
    changes: sortDiffChanges(report.changes),
  });
}

export function computeExplanationDiffHash(report: ExplanationDiffReport): string {
  return createHash("sha256").update(renderExplanationDiffCanonical(report)).digest("hex");
}

function collectReachableNodes(tree: ExplanationTree): ReachabilityResult {
  const diagnostics: ProgressiveDisclosureDiagnostic[] = [];
  const reachable = new Set<string>();
  const visiting = new Set<string>();

  const walk = (nodeId: string, parentId?: string): void => {
    const node = tree.nodes[nodeId];
    if (!node) {
      diagnostics.push({
        code: parentId ? "missing_node" : "missing_root",
        severity: "error",
        message: parentId
          ? `Parent '${parentId}' references missing child '${nodeId}'.`
          : `Root node '${nodeId}' does not exist in tree nodes.`,
        details: { nodeId, parentId },
      });
      return;
    }

    if (visiting.has(nodeId)) {
      diagnostics.push({
        code: "cycle_detected",
        severity: "error",
        message: `Cycle detected at node '${nodeId}'.`,
        details: { nodeId, parentId },
      });
      return;
    }

    if (reachable.has(nodeId)) {
      return;
    }

    visiting.add(nodeId);
    reachable.add(nodeId);

    for (const childId of node.childIds) {
      walk(childId, nodeId);
    }

    visiting.delete(nodeId);
  };

  walk(tree.rootId);
  return { reachable, diagnostics };
}

function normalizeMaxChildren(value: number | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Number.isInteger(value) || value < 1) {
    throw new Error("maxChildrenPerExpandedNode must be an integer >= 1 when provided.");
  }
  return value;
}

function normalizeIdList(values: string[]): string[] {
  const cleaned = values
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .sort((left, right) => left.localeCompare(right));

  const unique: string[] = [];
  for (let index = 0; index < cleaned.length; index += 1) {
    if (index === 0 || cleaned[index - 1] !== cleaned[index]) {
      unique.push(cleaned[index]);
    }
  }

  return unique;
}

function buildComparableNodeMap(tree: ExplanationTree): Record<string, DiffComparableNode[]> {
  const reachable = collectReachableNodes(tree).reachable;
  const leafCache = new Map<string, string[]>();
  const entries: DiffComparableNode[] = [];

  for (const nodeId of [...reachable].sort((left, right) => left.localeCompare(right))) {
    const node = tree.nodes[nodeId];
    if (!node) {
      continue;
    }

    const supportLeafIds = collectSupportLeafIds(tree, node.id, leafCache);
    const signaturePrefix = node.kind === "leaf" ? `leaf:${node.id}` : `parent:${supportLeafIds.join(",")}`;

    entries.push({
      key: signaturePrefix,
      kind: node.kind,
      nodeId: node.id,
      statement: node.statement,
      depth: node.depth,
      supportLeafIds,
    });
  }

  const grouped: Record<string, DiffComparableNode[]> = {};
  for (const entry of entries) {
    if (!grouped[entry.key]) {
      grouped[entry.key] = [];
    }
    grouped[entry.key].push(entry);
  }

  for (const key of Object.keys(grouped)) {
    grouped[key] = grouped[key].slice().sort((left, right) => left.nodeId.localeCompare(right.nodeId));
  }

  return grouped;
}

function collectSupportLeafIds(tree: ExplanationTree, nodeId: string, memo: Map<string, string[]>): string[] {
  const cached = memo.get(nodeId);
  if (cached) {
    return cached.slice();
  }

  const node = tree.nodes[nodeId];
  if (!node) {
    return [];
  }

  if (node.kind === "leaf") {
    const support = [node.id];
    memo.set(nodeId, support);
    return support.slice();
  }

  const support = new Set<string>();
  for (const childId of node.childIds) {
    const childSupport = collectSupportLeafIds(tree, childId, memo);
    for (const leafId of childSupport) {
      support.add(leafId);
    }
  }

  const ordered = [...support].sort((left, right) => left.localeCompare(right));
  memo.set(nodeId, ordered);
  return ordered.slice();
}

function sortDiagnostics(diagnostics: ProgressiveDisclosureDiagnostic[]): ProgressiveDisclosureDiagnostic[] {
  return diagnostics
    .slice()
    .sort((left, right) => left.code.localeCompare(right.code) || left.message.localeCompare(right.message));
}

function sortDiffChanges(changes: ExplanationDiffChange[]): ExplanationDiffChange[] {
  return changes
    .slice()
    .sort(
      (left, right) =>
        left.key.localeCompare(right.key) ||
        left.type.localeCompare(right.type) ||
        (left.baselineNodeId ?? "").localeCompare(right.baselineNodeId ?? "") ||
        (left.candidateNodeId ?? "").localeCompare(right.candidateNodeId ?? ""),
    );
}
