import { createHash } from "node:crypto";
import { computeConfigHash, type ExplanationConfig } from "./config-contract.js";
import {
  canonicalizeTheoremLeafRecord,
  renderTheoremLeafCanonical,
  type TheoremLeafRecord,
} from "./leaf-schema.js";
import type { ParentPolicyDiagnostics } from "./pedagogical-policy.js";
import type { ExplanationTree, ExplanationTreeNode } from "./tree-builder.js";

export const TREE_STORAGE_SCHEMA_VERSION = "1.0.0";

export type TreeStorageDiagnosticCode =
  | "unsupported_schema_version"
  | "missing_root"
  | "missing_node"
  | "node_not_found"
  | "not_a_parent"
  | "unknown_edge_parent"
  | "unknown_edge_child"
  | "duplicate_edge"
  | "leaf_not_found"
  | "leaf_not_reachable"
  | "cycle_detected"
  | "invalid_config_hash";

export interface TreeStorageDiagnostic {
  code: TreeStorageDiagnosticCode;
  severity: "error" | "warning";
  message: string;
  details?: Record<string, unknown>;
}

export interface TreeStorageNodeRecord {
  id: string;
  kind: ExplanationTreeNode["kind"];
  statement: string;
  depth: number;
  childIds: string[];
  evidenceRefs: string[];
  complexityScore?: number;
  abstractionScore?: number;
  confidence?: number;
  whyTrueFromChildren?: string;
  newTermsIntroduced: string[];
  policyDiagnostics?: ParentPolicyDiagnostics;
}

export interface TreeStorageEdgeRecord {
  parentId: string;
  childId: string;
  order: number;
}

export interface TreeStorageProvenanceRecord {
  nodeId: string;
  leafId: string;
  declarationId: string;
  modulePath: string;
  declarationName: string;
  theoremKind: TheoremLeafRecord["theoremKind"];
  sourceSpan: TheoremLeafRecord["sourceSpan"];
  sourceUrl?: string;
}

export interface TreeStorageConfigSnapshot {
  configHash: string;
  config?: ExplanationConfig;
}

export interface TreeStorageSnapshot {
  schemaVersion: string;
  proofId: string;
  rootId: string;
  leafIds: string[];
  maxDepth: number;
  configSnapshot: TreeStorageConfigSnapshot;
  nodes: TreeStorageNodeRecord[];
  edges: TreeStorageEdgeRecord[];
  provenance: TreeStorageProvenanceRecord[];
  leafRecords: TheoremLeafRecord[];
}

export interface ExportTreeStorageOptions {
  proofId: string;
  leaves: TheoremLeafRecord[];
  config?: ExplanationConfig;
}

export interface TreeStorageSnapshotValidationResult {
  ok: boolean;
  diagnostics: TreeStorageDiagnostic[];
}

export interface TreeStorageChildrenQuery {
  offset?: number;
  limit?: number;
}

export interface TreeStorageChildrenPage {
  parent: TreeStorageNodeRecord;
  totalChildren: number;
  offset: number;
  limit: number;
  hasMore: boolean;
  children: TreeStorageNodeRecord[];
  diagnostics: TreeStorageDiagnostic[];
}

export interface TreeStoragePathResult {
  ok: boolean;
  nodeId: string;
  path: TreeStorageNodeRecord[];
  diagnostics: TreeStorageDiagnostic[];
}

export interface TreeStorageLeafDetailResult {
  ok: boolean;
  leafId: string;
  leaf?: TheoremLeafRecord;
  provenancePath: TreeStorageNodeRecord[];
  provenanceRecords: TreeStorageProvenanceRecord[];
  diagnostics: TreeStorageDiagnostic[];
}

export interface TreeQueryApi {
  snapshot: TreeStorageSnapshot;
  getRoot(): { node?: TreeStorageNodeRecord; diagnostics: TreeStorageDiagnostic[] };
  getChildren(nodeId: string, query?: TreeStorageChildrenQuery): TreeStorageChildrenPage;
  getAncestryPath(nodeId: string): TreeStoragePathResult;
  getLeafDetail(leafId: string): TreeStorageLeafDetailResult;
}

interface SnapshotIndexes {
  nodeById: Map<string, TreeStorageNodeRecord>;
  childrenByParentId: Map<string, TreeStorageNodeRecord[]>;
  parentByChildId: Map<string, string>;
  leafById: Map<string, TheoremLeafRecord>;
  provenanceByLeafId: Map<string, TreeStorageProvenanceRecord[]>;
}

export function exportTreeStorageSnapshot(tree: ExplanationTree, options: ExportTreeStorageOptions): TreeStorageSnapshot {
  const proofId = normalizeNonEmpty(options.proofId, "proofId");
  const canonicalLeaves = options.leaves.map((leaf) => canonicalizeTheoremLeafRecord(leaf));
  const leafById = new Map(canonicalLeaves.map((leaf) => [leaf.id, leaf]));

  const nodes = Object.values(tree.nodes)
    .map((node) => canonicalizeNodeRecord(node))
    .sort(compareNodeRecords);

  const edges = nodes.flatMap((node) =>
    node.childIds.map((childId, order) => ({
      parentId: node.id,
      childId,
      order,
    })),
  );
  edges.sort(compareEdgeRecords);

  const provenance = buildProvenanceRecords(nodes, leafById);
  const configHash = options.config ? computeConfigHash(options.config) : tree.configHash;

  return {
    schemaVersion: TREE_STORAGE_SCHEMA_VERSION,
    proofId,
    rootId: tree.rootId,
    leafIds: canonicalLeafIds(tree.leafIds),
    maxDepth: tree.maxDepth,
    configSnapshot: options.config
      ? {
          configHash,
          config: options.config,
        }
      : {
          configHash,
        },
    nodes,
    edges,
    provenance,
    leafRecords: canonicalLeaves.sort((left, right) => left.id.localeCompare(right.id)),
  };
}

export function importTreeStorageSnapshot(snapshot: TreeStorageSnapshot): {
  tree?: ExplanationTree;
  leaves: TheoremLeafRecord[];
  diagnostics: TreeStorageDiagnostic[];
} {
  const normalized = canonicalizeSnapshot(snapshot);
  const validation = validateTreeStorageSnapshot(normalized);

  if (!validation.ok) {
    return {
      leaves: normalized.leafRecords,
      diagnostics: validation.diagnostics,
    };
  }

  const nodes: Record<string, ExplanationTreeNode> = {};
  const policyDiagnosticsByParent: Record<string, ParentPolicyDiagnostics> = {};
  for (const record of normalized.nodes) {
    const policyDiagnostics = record.policyDiagnostics ? clonePolicyDiagnostics(record.policyDiagnostics) : undefined;
    nodes[record.id] = {
      id: record.id,
      kind: record.kind,
      statement: record.statement,
      childIds: record.childIds.slice(),
      depth: record.depth,
      complexityScore: record.complexityScore,
      abstractionScore: record.abstractionScore,
      confidence: record.confidence,
      whyTrueFromChildren: record.whyTrueFromChildren,
      newTermsIntroduced: record.newTermsIntroduced.slice(),
      evidenceRefs: record.evidenceRefs.slice(),
      policyDiagnostics,
    };

    if (policyDiagnostics) {
      policyDiagnosticsByParent[record.id] = policyDiagnostics;
    }
  }

  const tree: ExplanationTree = {
    rootId: normalized.rootId,
    leafIds: normalized.leafIds.slice(),
    nodes,
    configHash: normalized.configSnapshot.configHash,
    groupPlan: [],
    groupingDiagnostics: [],
    policyDiagnosticsByParent,
    maxDepth: normalized.maxDepth,
  };

  return {
    tree,
    leaves: normalized.leafRecords,
    diagnostics: validation.diagnostics,
  };
}

export function createTreeQueryApi(input: TreeStorageSnapshot): TreeQueryApi {
  const snapshot = canonicalizeSnapshot(input);
  const validation = validateTreeStorageSnapshot(snapshot);
  const indexes = buildSnapshotIndexes(snapshot);

  const getRoot = (): { node?: TreeStorageNodeRecord; diagnostics: TreeStorageDiagnostic[] } => {
    const node = indexes.nodeById.get(snapshot.rootId);
    const diagnostics = validation.diagnostics.slice();
    if (!node) {
      diagnostics.push({
        code: "missing_root",
        severity: "error",
        message: `Root node '${snapshot.rootId}' is missing from snapshot nodes.`,
        details: { rootId: snapshot.rootId },
      });
    }
    return { node, diagnostics: sortDiagnostics(diagnostics) };
  };

  const getChildren = (nodeId: string, query: TreeStorageChildrenQuery = {}): TreeStorageChildrenPage => {
    const diagnostics: TreeStorageDiagnostic[] = validation.diagnostics.slice();
    const parentId = normalizeNonEmpty(nodeId, "nodeId");
    const parent = indexes.nodeById.get(parentId);

    if (!parent) {
      diagnostics.push({
        code: "node_not_found",
        severity: "error",
        message: `Node '${parentId}' was not found in snapshot.`,
        details: { nodeId: parentId },
      });
      return {
        parent: fallbackNode(parentId),
        totalChildren: 0,
        offset: 0,
        limit: 0,
        hasMore: false,
        children: [],
        diagnostics: sortDiagnostics(diagnostics),
      };
    }

    if (parent.kind !== "parent") {
      diagnostics.push({
        code: "not_a_parent",
        severity: "warning",
        message: `Node '${parentId}' is a leaf and has no expandable children.`,
        details: { nodeId: parentId, kind: parent.kind },
      });
    }

    const orderedChildren = indexes.childrenByParentId.get(parentId) ?? [];
    const offset = normalizeNonNegativeInt(query.offset, "offset", 0);
    const limit = normalizePositiveInt(query.limit, "limit", orderedChildren.length || 1);
    const safeOffset = Math.min(offset, orderedChildren.length);
    const pageChildren = orderedChildren.slice(safeOffset, safeOffset + limit);

    return {
      parent,
      totalChildren: orderedChildren.length,
      offset: safeOffset,
      limit,
      hasMore: safeOffset + pageChildren.length < orderedChildren.length,
      children: pageChildren,
      diagnostics: sortDiagnostics(diagnostics),
    };
  };

  const getAncestryPath = (nodeId: string): TreeStoragePathResult => {
    const diagnostics: TreeStorageDiagnostic[] = validation.diagnostics.slice();
    const targetId = normalizeNonEmpty(nodeId, "nodeId");

    if (!indexes.nodeById.has(targetId)) {
      diagnostics.push({
        code: "node_not_found",
        severity: "error",
        message: `Node '${targetId}' was not found in snapshot.`,
        details: { nodeId: targetId },
      });
      return {
        ok: false,
        nodeId: targetId,
        path: [],
        diagnostics: sortDiagnostics(diagnostics),
      };
    }

    const path: TreeStorageNodeRecord[] = [];
    const visited = new Set<string>();
    let cursor: string | undefined = targetId;

    while (cursor) {
      if (visited.has(cursor)) {
        diagnostics.push({
          code: "cycle_detected",
          severity: "error",
          message: `Cycle detected while resolving ancestry for '${targetId}'.`,
          details: { nodeId: targetId, repeatedNodeId: cursor },
        });
        break;
      }
      visited.add(cursor);

      const node = indexes.nodeById.get(cursor);
      if (!node) {
        diagnostics.push({
          code: "missing_node",
          severity: "error",
          message: `Ancestry traversal referenced missing node '${cursor}'.`,
          details: { nodeId: cursor },
        });
        break;
      }

      path.push(node);
      cursor = indexes.parentByChildId.get(cursor);
    }

    path.reverse();
    const ok =
      diagnostics.every((diagnostic) => diagnostic.severity !== "error") &&
      path.length > 0 &&
      path[0]?.id === snapshot.rootId;

    if (path.length === 0 || path[0]?.id !== snapshot.rootId) {
      diagnostics.push({
        code: "leaf_not_reachable",
        severity: "error",
        message: `Node '${targetId}' is not reachable from root '${snapshot.rootId}'.`,
        details: { nodeId: targetId, rootId: snapshot.rootId },
      });
    }

    return {
      ok,
      nodeId: targetId,
      path,
      diagnostics: sortDiagnostics(diagnostics),
    };
  };

  const getLeafDetail = (leafId: string): TreeStorageLeafDetailResult => {
    const normalizedLeafId = normalizeNonEmpty(leafId, "leafId");
    const leaf = indexes.leafById.get(normalizedLeafId);

    if (!leaf) {
      const diagnostics: TreeStorageDiagnostic[] = validation.diagnostics.slice();
      diagnostics.push({
        code: "leaf_not_found",
        severity: "error",
        message: `Leaf '${normalizedLeafId}' was not found in snapshot leaf records.`,
        details: { leafId: normalizedLeafId },
      });
      return {
        ok: false,
        leafId: normalizedLeafId,
        provenancePath: [],
        provenanceRecords: [],
        diagnostics: sortDiagnostics(diagnostics),
      };
    }

    const pathResult = getAncestryPath(normalizedLeafId);
    const diagnostics = pathResult.diagnostics.slice();

    const pathStartsAtRoot = pathResult.path[0]?.id === snapshot.rootId;
    if (!pathStartsAtRoot && !hasDiagnostic(pathResult.diagnostics, "leaf_not_reachable", "error")) {
      diagnostics.push({
        code: "leaf_not_reachable",
        severity: "error",
        message: `Leaf '${normalizedLeafId}' is not reachable from root '${snapshot.rootId}'.`,
        details: { leafId: normalizedLeafId, rootId: snapshot.rootId },
      });
    }

    return {
      ok: diagnostics.every((diagnostic) => diagnostic.severity !== "error"),
      leafId: normalizedLeafId,
      leaf,
      provenancePath: pathResult.path,
      provenanceRecords: (indexes.provenanceByLeafId.get(normalizedLeafId) ?? []).slice(),
      diagnostics: sortDiagnostics(diagnostics),
    };
  };

  return {
    snapshot,
    getRoot,
    getChildren,
    getAncestryPath,
    getLeafDetail,
  };
}

export function validateTreeStorageSnapshot(input: TreeStorageSnapshot): TreeStorageSnapshotValidationResult {
  const snapshot = canonicalizeSnapshot(input);
  const diagnostics: TreeStorageDiagnostic[] = [];

  if (snapshot.schemaVersion !== TREE_STORAGE_SCHEMA_VERSION) {
    diagnostics.push({
      code: "unsupported_schema_version",
      severity: "error",
      message: `Unsupported schemaVersion '${snapshot.schemaVersion}'. Expected '${TREE_STORAGE_SCHEMA_VERSION}'.`,
      details: { schemaVersion: snapshot.schemaVersion },
    });
  }

  const nodeById = new Map(snapshot.nodes.map((node) => [node.id, node]));
  if (!nodeById.has(snapshot.rootId)) {
    diagnostics.push({
      code: "missing_root",
      severity: "error",
      message: `Root node '${snapshot.rootId}' is missing from snapshot nodes.`,
      details: { rootId: snapshot.rootId },
    });
  }

  const edgeKeySet = new Set<string>();
  for (const edge of snapshot.edges) {
    if (!nodeById.has(edge.parentId)) {
      diagnostics.push({
        code: "unknown_edge_parent",
        severity: "error",
        message: `Edge parent '${edge.parentId}' does not exist in nodes.`,
        details: { edge },
      });
    }
    if (!nodeById.has(edge.childId)) {
      diagnostics.push({
        code: "unknown_edge_child",
        severity: "error",
        message: `Edge child '${edge.childId}' does not exist in nodes.`,
        details: { edge },
      });
    }

    const edgeKey = `${edge.parentId}::${edge.childId}::${edge.order}`;
    if (edgeKeySet.has(edgeKey)) {
      diagnostics.push({
        code: "duplicate_edge",
        severity: "error",
        message: `Duplicate edge '${edgeKey}' found in snapshot edges.`,
        details: { edge },
      });
    }
    edgeKeySet.add(edgeKey);
  }

  if (snapshot.configSnapshot.config) {
    const configHash = computeConfigHash(snapshot.configSnapshot.config);
    if (configHash !== snapshot.configSnapshot.configHash) {
      diagnostics.push({
        code: "invalid_config_hash",
        severity: "error",
        message: `configSnapshot.configHash does not match computed hash from provided config snapshot.`,
        details: {
          expected: configHash,
          actual: snapshot.configSnapshot.configHash,
        },
      });
    }
  }

  return {
    ok: diagnostics.every((diagnostic) => diagnostic.severity !== "error"),
    diagnostics: sortDiagnostics(diagnostics),
  };
}

export function renderTreeStorageSnapshotCanonical(input: TreeStorageSnapshot): string {
  const snapshot = canonicalizeSnapshot(input);

  const lines = [
    `schema=tree-storage-v${snapshot.schemaVersion}`,
    `proof_id=${snapshot.proofId}`,
    `root_id=${snapshot.rootId}`,
    `leaf_ids=${snapshot.leafIds.join(",") || "none"}`,
    `max_depth=${snapshot.maxDepth}`,
    `config_hash=${snapshot.configSnapshot.configHash}`,
    `config_snapshot=${snapshot.configSnapshot.config ? JSON.stringify(snapshot.configSnapshot.config) : "none"}`,
    `nodes_count=${snapshot.nodes.length}`,
    ...snapshot.nodes.map((node, index) =>
      [
        `nodes[${index}].id=${node.id}`,
        `nodes[${index}].kind=${node.kind}`,
        `nodes[${index}].depth=${node.depth}`,
        `nodes[${index}].statement=${JSON.stringify(node.statement)}`,
        `nodes[${index}].child_ids=${node.childIds.join(",") || "none"}`,
        `nodes[${index}].evidence_refs=${node.evidenceRefs.join(",") || "none"}`,
        `nodes[${index}].complexity=${node.complexityScore ?? "none"}`,
        `nodes[${index}].abstraction=${node.abstractionScore ?? "none"}`,
        `nodes[${index}].confidence=${node.confidence ?? "none"}`,
        `nodes[${index}].why_true=${JSON.stringify(node.whyTrueFromChildren ?? "")}`,
        `nodes[${index}].new_terms=${node.newTermsIntroduced.join(",") || "none"}`,
        `nodes[${index}].policy_diagnostics=${renderStableJson(node.policyDiagnostics) ?? "none"}`,
      ].join("\n"),
    ),
    `edges_count=${snapshot.edges.length}`,
    ...snapshot.edges.map((edge, index) =>
      [
        `edges[${index}].parent_id=${edge.parentId}`,
        `edges[${index}].child_id=${edge.childId}`,
        `edges[${index}].order=${edge.order}`,
      ].join("\n"),
    ),
    `provenance_count=${snapshot.provenance.length}`,
    ...snapshot.provenance.map((record, index) =>
      [
        `provenance[${index}].node_id=${record.nodeId}`,
        `provenance[${index}].leaf_id=${record.leafId}`,
        `provenance[${index}].declaration_id=${record.declarationId}`,
        `provenance[${index}].module_path=${record.modulePath}`,
        `provenance[${index}].declaration_name=${record.declarationName}`,
        `provenance[${index}].theorem_kind=${record.theoremKind}`,
        `provenance[${index}].source_file=${record.sourceSpan.filePath}`,
        `provenance[${index}].source_start=${record.sourceSpan.startLine}:${record.sourceSpan.startColumn}`,
        `provenance[${index}].source_end=${record.sourceSpan.endLine}:${record.sourceSpan.endColumn}`,
        `provenance[${index}].source_url=${record.sourceUrl ?? "none"}`,
      ].join("\n"),
    ),
    `leaf_records_count=${snapshot.leafRecords.length}`,
    ...snapshot.leafRecords.map((leaf, index) =>
      [
        `leaf_records[${index}].id=${leaf.id}`,
        "leaf_records.canonical_start",
        renderTheoremLeafCanonical(leaf),
        "leaf_records.canonical_end",
      ].join("\n"),
    ),
  ];

  return lines.join("\n");
}

export function computeTreeStorageSnapshotHash(snapshot: TreeStorageSnapshot): string {
  return createHash("sha256").update(renderTreeStorageSnapshotCanonical(snapshot)).digest("hex");
}

function canonicalizeSnapshot(snapshot: TreeStorageSnapshot): TreeStorageSnapshot {
  const nodes = snapshot.nodes.map((node) => canonicalizeNodeRecord(node)).sort(compareNodeRecords);
  const edges = snapshot.edges
    .map((edge) => ({
      parentId: normalizeNonEmpty(edge.parentId, "parentId"),
      childId: normalizeNonEmpty(edge.childId, "childId"),
      order: normalizeNonNegativeInt(edge.order, "order"),
    }))
    .sort(compareEdgeRecords);
  const leafRecords = snapshot.leafRecords
    .map((leaf) => canonicalizeTheoremLeafRecord(leaf))
    .sort((left, right) => left.id.localeCompare(right.id));
  const provenance = snapshot.provenance
    .map((record) => canonicalizeProvenanceRecord(record))
    .sort(compareProvenanceRecords);

  return {
    schemaVersion: normalizeNonEmpty(snapshot.schemaVersion, "schemaVersion"),
    proofId: normalizeNonEmpty(snapshot.proofId, "proofId"),
    rootId: normalizeNonEmpty(snapshot.rootId, "rootId"),
    leafIds: canonicalLeafIds(snapshot.leafIds),
    maxDepth: normalizeNonNegativeInt(snapshot.maxDepth, "maxDepth"),
    configSnapshot: {
      configHash: normalizeNonEmpty(snapshot.configSnapshot.configHash, "configSnapshot.configHash"),
      config: snapshot.configSnapshot.config,
    },
    nodes,
    edges,
    provenance,
    leafRecords,
  };
}

function canonicalizeNodeRecord(node: TreeStorageNodeRecord | ExplanationTreeNode): TreeStorageNodeRecord {
  return {
    id: normalizeNonEmpty(node.id, "node.id"),
    kind: node.kind,
    statement: normalizeNonEmpty(node.statement, "node.statement"),
    depth: normalizeNonNegativeInt(node.depth, "node.depth"),
    childIds: canonicalOrderedStringList(node.childIds, "node.childIds"),
    evidenceRefs: canonicalOrderedStringList(node.evidenceRefs, "node.evidenceRefs"),
    complexityScore: normalizeOptionalNumber(node.complexityScore, "node.complexityScore"),
    abstractionScore: normalizeOptionalNumber(node.abstractionScore, "node.abstractionScore"),
    confidence: normalizeOptionalNumber(node.confidence, "node.confidence"),
    whyTrueFromChildren: normalizeOptionalString(node.whyTrueFromChildren),
    newTermsIntroduced: canonicalOrderedStringList(node.newTermsIntroduced, "node.newTermsIntroduced"),
    policyDiagnostics: canonicalizePolicyDiagnostics(node.policyDiagnostics),
  };
}

function canonicalizeProvenanceRecord(record: TreeStorageProvenanceRecord): TreeStorageProvenanceRecord {
  return {
    nodeId: normalizeNonEmpty(record.nodeId, "provenance.nodeId"),
    leafId: normalizeNonEmpty(record.leafId, "provenance.leafId"),
    declarationId: normalizeNonEmpty(record.declarationId, "provenance.declarationId"),
    modulePath: normalizeNonEmpty(record.modulePath, "provenance.modulePath"),
    declarationName: normalizeNonEmpty(record.declarationName, "provenance.declarationName"),
    theoremKind: record.theoremKind,
    sourceSpan: {
      filePath: normalizeNonEmpty(record.sourceSpan.filePath, "provenance.sourceSpan.filePath"),
      startLine: normalizePositiveInt(record.sourceSpan.startLine, "provenance.sourceSpan.startLine"),
      startColumn: normalizePositiveInt(record.sourceSpan.startColumn, "provenance.sourceSpan.startColumn"),
      endLine: normalizePositiveInt(record.sourceSpan.endLine, "provenance.sourceSpan.endLine"),
      endColumn: normalizePositiveInt(record.sourceSpan.endColumn, "provenance.sourceSpan.endColumn"),
    },
    sourceUrl: normalizeOptionalString(record.sourceUrl),
  };
}

function buildSnapshotIndexes(snapshot: TreeStorageSnapshot): SnapshotIndexes {
  const nodeById = new Map(snapshot.nodes.map((node) => [node.id, node]));
  const childrenByParentId = new Map<string, TreeStorageNodeRecord[]>();
  const parentByChildId = new Map<string, string>();
  const leafById = new Map(snapshot.leafRecords.map((leaf) => [leaf.id, leaf]));
  const provenanceByLeafId = new Map<string, TreeStorageProvenanceRecord[]>();

  for (const edge of snapshot.edges) {
    const child = nodeById.get(edge.childId);
    if (!child) {
      continue;
    }
    const existing = childrenByParentId.get(edge.parentId) ?? [];
    existing.push(child);
    childrenByParentId.set(edge.parentId, existing);

    if (!parentByChildId.has(edge.childId)) {
      parentByChildId.set(edge.childId, edge.parentId);
    }
  }

  for (const record of snapshot.provenance) {
    const existing = provenanceByLeafId.get(record.leafId) ?? [];
    existing.push(record);
    provenanceByLeafId.set(record.leafId, existing);
  }

  for (const records of provenanceByLeafId.values()) {
    records.sort(compareProvenanceRecords);
  }

  return {
    nodeById,
    childrenByParentId,
    parentByChildId,
    leafById,
    provenanceByLeafId,
  };
}

function buildProvenanceRecords(
  nodes: TreeStorageNodeRecord[],
  leafById: Map<string, TheoremLeafRecord>,
): TreeStorageProvenanceRecord[] {
  const records: TreeStorageProvenanceRecord[] = [];

  for (const node of nodes) {
    for (const leafId of node.evidenceRefs) {
      const leaf = leafById.get(leafId);
      if (!leaf) {
        continue;
      }
      records.push({
        nodeId: node.id,
        leafId,
        declarationId: leaf.declarationId,
        modulePath: leaf.modulePath,
        declarationName: leaf.declarationName,
        theoremKind: leaf.theoremKind,
        sourceSpan: {
          filePath: leaf.sourceSpan.filePath,
          startLine: leaf.sourceSpan.startLine,
          startColumn: leaf.sourceSpan.startColumn,
          endLine: leaf.sourceSpan.endLine,
          endColumn: leaf.sourceSpan.endColumn,
        },
        sourceUrl: leaf.sourceUrl,
      });
    }
  }

  return records.sort(compareProvenanceRecords);
}

function compareNodeRecords(left: TreeStorageNodeRecord, right: TreeStorageNodeRecord): number {
  return left.id.localeCompare(right.id);
}

function compareEdgeRecords(left: TreeStorageEdgeRecord, right: TreeStorageEdgeRecord): number {
  if (left.parentId !== right.parentId) {
    return left.parentId.localeCompare(right.parentId);
  }
  if (left.order !== right.order) {
    return left.order - right.order;
  }
  return left.childId.localeCompare(right.childId);
}

function compareProvenanceRecords(left: TreeStorageProvenanceRecord, right: TreeStorageProvenanceRecord): number {
  if (left.nodeId !== right.nodeId) {
    return left.nodeId.localeCompare(right.nodeId);
  }
  if (left.leafId !== right.leafId) {
    return left.leafId.localeCompare(right.leafId);
  }
  if (left.modulePath !== right.modulePath) {
    return left.modulePath.localeCompare(right.modulePath);
  }
  return left.declarationName.localeCompare(right.declarationName);
}

function sortDiagnostics(diagnostics: TreeStorageDiagnostic[]): TreeStorageDiagnostic[] {
  return diagnostics
    .slice()
    .sort((left, right) => {
      if (left.severity !== right.severity) {
        return left.severity.localeCompare(right.severity);
      }
      if (left.code !== right.code) {
        return left.code.localeCompare(right.code);
      }
      return left.message.localeCompare(right.message);
    });
}

function fallbackNode(nodeId: string): TreeStorageNodeRecord {
  return {
    id: nodeId,
    kind: "leaf",
    statement: "",
    depth: 0,
    childIds: [],
    evidenceRefs: [],
    newTermsIntroduced: [],
  };
}

function canonicalLeafIds(values: string[]): string[] {
  return canonicalStringList(values, "leafIds");
}

function canonicalOrderedStringList(values: string[] | undefined, fieldName: string): string[] {
  if (!Array.isArray(values)) {
    return [];
  }

  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const normalized = normalizeNonEmpty(value, fieldName);
    if (!seen.has(normalized)) {
      seen.add(normalized);
      output.push(normalized);
    }
  }
  return output;
}

function canonicalStringList(values: string[] | undefined, fieldName: string): string[] {
  if (!Array.isArray(values)) {
    return [];
  }

  return values
    .map((value) => normalizeNonEmpty(value, fieldName))
    .sort((left, right) => left.localeCompare(right))
    .filter((value, index, list) => index === 0 || list[index - 1] !== value);
}

function normalizeNonEmpty(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(`${fieldName} must be a non-empty string.`);
  }
  return normalized;
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length === 0 ? undefined : normalized;
}

function hasDiagnostic(
  diagnostics: TreeStorageDiagnostic[],
  code: TreeStorageDiagnosticCode,
  severity: TreeStorageDiagnostic["severity"],
): boolean {
  return diagnostics.some((diagnostic) => diagnostic.code === code && diagnostic.severity === severity);
}

function canonicalizePolicyDiagnostics(value: ParentPolicyDiagnostics | undefined): ParentPolicyDiagnostics | undefined {
  if (!value) {
    return undefined;
  }

  const normalizeDecision = (decision: ParentPolicyDiagnostics["preSummary"]): ParentPolicyDiagnostics["preSummary"] => ({
    ok: decision.ok,
    metrics: {
      ...decision.metrics,
    },
    violations: decision.violations
      .map((violation) => ({
        code: violation.code,
        message: normalizeNonEmpty(violation.message, "node.policyDiagnostics.violation.message"),
        details: normalizeRecord(violation.details),
      }))
      .sort((left, right) => {
        if (left.code !== right.code) {
          return left.code.localeCompare(right.code);
        }
        return left.message.localeCompare(right.message);
      }),
  });

  return {
    depth: normalizeNonNegativeInt(value.depth, "node.policyDiagnostics.depth"),
    groupIndex: normalizeNonNegativeInt(value.groupIndex, "node.policyDiagnostics.groupIndex"),
    retriesUsed: normalizeNonNegativeInt(value.retriesUsed, "node.policyDiagnostics.retriesUsed"),
    preSummary: normalizeDecision(value.preSummary),
    postSummary: normalizeDecision(value.postSummary),
  };
}

function normalizeRecord(value: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!value) {
    return undefined;
  }
  return sortObjectKeys(value) as Record<string, unknown>;
}

function clonePolicyDiagnostics(value: ParentPolicyDiagnostics): ParentPolicyDiagnostics {
  return canonicalizePolicyDiagnostics(value) as ParentPolicyDiagnostics;
}

function renderStableJson(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return JSON.stringify(sortObjectKeys(value));
}

function sortObjectKeys(value: unknown): unknown {
  if (!value || typeof value !== "object") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sortObjectKeys(entry));
  }

  const record = value as Record<string, unknown>;
  return Object.keys(record)
    .sort((left, right) => left.localeCompare(right))
    .reduce<Record<string, unknown>>((accumulator, key) => {
      accumulator[key] = sortObjectKeys(record[key]);
      return accumulator;
    }, {});
}

function normalizeNonNegativeInt(value: number | undefined, fieldName: string, fallback = 0): number {
  const candidate = value ?? fallback;
  if (!Number.isInteger(candidate) || candidate < 0) {
    throw new Error(`${fieldName} must be an integer >= 0.`);
  }
  return candidate;
}

function normalizePositiveInt(value: number | undefined, fieldName: string, fallback = 1): number {
  const candidate = value ?? fallback;
  if (!Number.isInteger(candidate) || candidate < 1) {
    throw new Error(`${fieldName} must be an integer >= 1.`);
  }
  return candidate;
}

function normalizeOptionalNumber(value: number | undefined, fieldName: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Number.isFinite(value)) {
    throw new Error(`${fieldName} must be finite when provided.`);
  }
  return value;
}
