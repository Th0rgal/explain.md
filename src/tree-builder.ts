import { createHash } from "node:crypto";
import { computeConfigHash, type ExplanationConfig } from "./config-contract.js";
import { groupChildrenDeterministically, type GroupingWarning } from "./child-grouping.js";
import {
  evaluatePostSummaryPolicy,
  evaluatePreSummaryPolicy,
  type ParentPolicyDiagnostics,
} from "./pedagogical-policy.js";
import type { ProviderClient } from "./openai-provider.js";
import { generateParentSummary, SummaryValidationError } from "./summary-pipeline.js";

export interface LeafNodeInput {
  id: string;
  statement: string;
  complexity?: number;
  prerequisiteIds?: string[];
}

export type ExplanationTreeNodeKind = "leaf" | "parent";

export interface ExplanationTreeNode {
  id: string;
  kind: ExplanationTreeNodeKind;
  statement: string;
  childIds: string[];
  depth: number;
  complexityScore?: number;
  abstractionScore?: number;
  confidence?: number;
  whyTrueFromChildren?: string;
  newTermsIntroduced?: string[];
  evidenceRefs: string[];
  policyDiagnostics?: ParentPolicyDiagnostics;
}

export interface GroupPlan {
  depth: number;
  index: number;
  inputNodeIds: string[];
  outputNodeId: string;
  complexitySpread: number;
}

export interface GroupingLayerDiagnostics {
  depth: number;
  orderedNodeIds: string[];
  complexitySpreadByGroup: number[];
  warnings: GroupingWarning[];
  repartitionEvents: RepartitionEvent[];
}

export interface ExplanationTree {
  rootId: string;
  leafIds: string[];
  nodes: Record<string, ExplanationTreeNode>;
  configHash: string;
  groupPlan: GroupPlan[];
  groupingDiagnostics: GroupingLayerDiagnostics[];
  policyDiagnosticsByParent: Record<string, ParentPolicyDiagnostics>;
  maxDepth: number;
}

export interface RepartitionEvent {
  depth: number;
  originalGroupIndex: number;
  repartitionRound: number;
  reason: "pre_summary_policy" | "post_summary_policy";
  inputNodeIds: string[];
  outputGroups: string[][];
  violationCodes: string[];
}

export interface TreeBuildRequest {
  leaves: LeafNodeInput[];
  config: ExplanationConfig;
  maxDepth?: number;
}

export interface TreeValidationIssue {
  code:
    | "missing_root"
    | "missing_node"
    | "not_connected"
    | "leaf_not_preserved"
    | "branching_factor"
    | "policy_missing"
    | "policy_violation";
  message: string;
  details?: Record<string, unknown>;
}

export interface TreeValidationResult {
  ok: boolean;
  issues: TreeValidationIssue[];
}

export class TreePolicyError extends Error {
  public readonly diagnostics: ParentPolicyDiagnostics;

  public constructor(message: string, diagnostics: ParentPolicyDiagnostics) {
    super(message);
    this.name = "TreePolicyError";
    this.diagnostics = diagnostics;
  }
}

export async function buildRecursiveExplanationTree(
  provider: ProviderClient,
  request: TreeBuildRequest,
): Promise<ExplanationTree> {
  if (!Number.isInteger(request.config.maxChildrenPerParent) || request.config.maxChildrenPerParent < 2) {
    throw new Error("config.maxChildrenPerParent must be an integer >= 2.");
  }

  const leaves = normalizeLeaves(request.leaves);
  const nodes: Record<string, ExplanationTreeNode> = {};
  const leafIds = leaves.map((leaf) => leaf.id);
  const leafById = new Map(leaves.map((leaf) => [leaf.id, leaf]));
  const groupPlan: GroupPlan[] = [];
  const groupingDiagnostics: GroupingLayerDiagnostics[] = [];
  const policyDiagnosticsByParent: Record<string, ParentPolicyDiagnostics> = {};

  for (const leaf of leaves) {
    nodes[leaf.id] = {
      id: leaf.id,
      kind: "leaf",
      statement: leaf.statement,
      childIds: [],
      depth: 0,
      complexityScore: leaf.complexity,
      evidenceRefs: [leaf.id],
    };
  }

  if (leaves.length === 1) {
    const tree: ExplanationTree = {
      rootId: leaves[0].id,
      leafIds,
      nodes,
      configHash: computeConfigHash(request.config),
      groupPlan,
      groupingDiagnostics,
      policyDiagnosticsByParent,
      maxDepth: 0,
    };

    const validation = validateExplanationTree(tree, request.config.maxChildrenPerParent);
    if (!validation.ok) {
      throw new Error(`Tree validation failed: ${validation.issues.map((issue) => issue.code).join(", ")}`);
    }

    return tree;
  }

  const hardDepthLimit = request.maxDepth ?? computeDepthLimit(leaves.length, request.config.maxChildrenPerParent);

  let depth = 0;
  let activeNodeIds = leafIds.slice();

  while (activeNodeIds.length > 1) {
    depth += 1;
    if (depth > hardDepthLimit) {
      throw new Error(`Tree construction exceeded max depth ${hardDepthLimit}.`);
    }

    const groupingResult = groupChildrenDeterministically({
      nodes: activeNodeIds.map((nodeId) => {
        const node = nodes[nodeId];
        return {
          id: node.id,
          statement: node.statement,
          complexity: node.complexityScore,
          prerequisiteIds: node.kind === "leaf" ? leafById.get(node.id)?.prerequisiteIds : [],
        };
      }),
      maxChildrenPerParent: request.config.maxChildrenPerParent,
      targetComplexity: request.config.complexityLevel,
      complexityBandWidth: request.config.complexityBandWidth,
    });
    const groups = groupingResult.groups;
    const repartitionEvents: RepartitionEvent[] = [];
    groupingDiagnostics.push({
      depth,
      orderedNodeIds: groupingResult.diagnostics.orderedNodeIds,
      complexitySpreadByGroup: groupingResult.diagnostics.complexitySpreadByGroup,
      warnings: groupingResult.diagnostics.warnings,
      repartitionEvents,
    });
    const nextLayerIds: string[] = [];
    const queue: GroupBuildWorkItem[] = groups.map((groupNodeIds, index) => ({
      nodeIds: groupNodeIds.slice(),
      originalGroupIndex: index,
      repartitionRound: 0,
    }));
    let planIndex = 0;

    while (queue.length > 0) {
      const workItem = queue.shift() as GroupBuildWorkItem;
      if (workItem.nodeIds.length === 1) {
        nextLayerIds.push(workItem.nodeIds[0]);
        continue;
      }

      const orderedGroupNodeIds = reorderGroupNodeIdsByPrerequisites(workItem.nodeIds, nodes, leafById);
      const children = orderedGroupNodeIds.map((nodeId) => {
        const node = nodes[nodeId];
        const leafInput = leafById.get(node.id);
        return {
          id: node.id,
          statement: node.statement,
          complexity: node.complexityScore,
          prerequisiteIds: leafInput?.prerequisiteIds,
        };
      });

      const preSummaryDecision = evaluatePreSummaryPolicy(children, request.config);
      if (!preSummaryDecision.ok) {
        const repartitionGroups = repartitionGroupDeterministically(
          orderedGroupNodeIds,
          workItem.repartitionRound,
          request.config.maxChildrenPerParent,
        );
        if (repartitionGroups) {
          recordRepartitionEvent(
            repartitionEvents,
            depth,
            workItem,
            "pre_summary_policy",
            orderedGroupNodeIds,
            repartitionGroups,
            preSummaryDecision.violations.map((violation) => violation.code),
          );
          enqueueRepartitionGroups(queue, workItem, repartitionGroups);
          continue;
        }

        throw new TreePolicyError("Pre-summary pedagogical policy failed.", {
          depth,
          groupIndex: workItem.originalGroupIndex,
          retriesUsed: 0,
          preSummary: preSummaryDecision,
          postSummary: {
            ok: true,
            violations: [],
            metrics: {
              complexitySpread: 0,
              prerequisiteOrderViolations: 0,
              introducedTermCount: 0,
              evidenceCoverageRatio: 1,
              vocabularyContinuityRatio: 1,
              vocabularyContinuityFloor: 1,
            },
          },
        });
      }

      let parentSummary: Awaited<ReturnType<typeof generatePolicyCompliantParentSummary>>;
      try {
        parentSummary = await generatePolicyCompliantParentSummary(
          provider,
          children,
          request.config,
          depth,
          workItem.originalGroupIndex,
          preSummaryDecision,
        );
      } catch (error) {
        if (!(error instanceof TreePolicyError)) {
          throw error;
        }

        const repartitionGroups = repartitionGroupDeterministically(
          orderedGroupNodeIds,
          workItem.repartitionRound,
          request.config.maxChildrenPerParent,
        );
        if (repartitionGroups) {
          recordRepartitionEvent(
            repartitionEvents,
            depth,
            workItem,
            "post_summary_policy",
            orderedGroupNodeIds,
            repartitionGroups,
            error.diagnostics.postSummary.violations.map((violation) => violation.code),
          );
          enqueueRepartitionGroups(queue, workItem, repartitionGroups);
          continue;
        }
        throw error;
      }

      const parentId = buildParentNodeId(depth, planIndex, orderedGroupNodeIds);
      planIndex += 1;
      const parentNode: ExplanationTreeNode = {
        id: parentId,
        kind: "parent",
        statement: parentSummary.summary.parent_statement,
        childIds: orderedGroupNodeIds.slice(),
        depth,
        complexityScore: parentSummary.summary.complexity_score,
        abstractionScore: parentSummary.summary.abstraction_score,
        confidence: parentSummary.summary.confidence,
        whyTrueFromChildren: parentSummary.summary.why_true_from_children,
        newTermsIntroduced: parentSummary.summary.new_terms_introduced,
        evidenceRefs: parentSummary.summary.evidence_refs,
        policyDiagnostics: parentSummary.policyDiagnostics,
      };

      nodes[parentId] = parentNode;
      policyDiagnosticsByParent[parentId] = parentSummary.policyDiagnostics;
      nextLayerIds.push(parentId);
      groupPlan.push({
        depth,
        index: workItem.originalGroupIndex,
        inputNodeIds: orderedGroupNodeIds.slice(),
        outputNodeId: parentId,
        complexitySpread: computeGroupComplexitySpread(orderedGroupNodeIds, nodes, request.config.complexityLevel),
      });
    }

    if (nextLayerIds.length >= activeNodeIds.length) {
      throw new Error(
        `Tree construction made no progress at depth ${depth} (active=${activeNodeIds.length}, next=${nextLayerIds.length}).`,
      );
    }

    activeNodeIds = nextLayerIds;
  }

  const tree: ExplanationTree = {
    rootId: activeNodeIds[0],
    leafIds,
    nodes,
    configHash: computeConfigHash(request.config),
    groupPlan,
    groupingDiagnostics,
    policyDiagnosticsByParent,
    maxDepth: depth,
  };

  const validation = validateExplanationTree(tree, request.config.maxChildrenPerParent);
  if (!validation.ok) {
    throw new Error(`Tree validation failed: ${validation.issues.map((issue) => issue.code).join(", ")}`);
  }

  return tree;
}

interface GroupBuildWorkItem {
  nodeIds: string[];
  originalGroupIndex: number;
  repartitionRound: number;
}

const MAX_REPARTITION_ROUNDS = 2;

function repartitionGroupDeterministically(
  groupNodeIds: string[],
  repartitionRound: number,
  maxChildrenPerParent: number,
): string[][] | undefined {
  if (groupNodeIds.length <= 2 || repartitionRound >= MAX_REPARTITION_ROUNDS) {
    return undefined;
  }

  const boundedSize = Math.min(maxChildrenPerParent, Math.ceil(groupNodeIds.length / 2));
  const leftSize = Math.max(1, boundedSize);
  const left = groupNodeIds.slice(0, leftSize);
  const right = groupNodeIds.slice(leftSize);
  return right.length > 0 ? [left, right] : [left];
}

function enqueueRepartitionGroups(
  queue: GroupBuildWorkItem[],
  source: GroupBuildWorkItem,
  repartitionGroups: string[][],
): void {
  const nextItems = repartitionGroups.map((nodeIds) => ({
    nodeIds,
    originalGroupIndex: source.originalGroupIndex,
    repartitionRound: source.repartitionRound + 1,
  }));

  for (let index = nextItems.length - 1; index >= 0; index -= 1) {
    queue.unshift(nextItems[index]);
  }
}

function recordRepartitionEvent(
  events: RepartitionEvent[],
  depth: number,
  workItem: GroupBuildWorkItem,
  reason: RepartitionEvent["reason"],
  inputNodeIds: string[],
  outputGroups: string[][],
  violationCodes: string[],
): void {
  events.push({
    depth,
    originalGroupIndex: workItem.originalGroupIndex,
    repartitionRound: workItem.repartitionRound + 1,
    reason,
    inputNodeIds: inputNodeIds.slice(),
    outputGroups: outputGroups.map((group) => group.slice()),
    violationCodes: violationCodes.slice().sort((a, b) => a.localeCompare(b)),
  });
}

function computeGroupComplexitySpread(groupNodeIds: string[], nodes: Record<string, ExplanationTreeNode>, fallback: number): number {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const nodeId of groupNodeIds) {
    const node = nodes[nodeId];
    const value = typeof node?.complexityScore === "number" ? node.complexityScore : fallback;
    min = Math.min(min, value);
    max = Math.max(max, value);
  }

  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return 0;
  }
  return max - min;
}

export function validateExplanationTree(tree: ExplanationTree, maxChildrenPerParent: number): TreeValidationResult {
  const issues: TreeValidationIssue[] = [];
  const root = tree.nodes[tree.rootId];

  if (!root) {
    issues.push({ code: "missing_root", message: "Root node is missing from node map." });
    return { ok: false, issues };
  }

  const reachable = new Set<string>();
  const stack = [tree.rootId];

  while (stack.length > 0) {
    const nodeId = stack.pop() as string;
    if (reachable.has(nodeId)) {
      continue;
    }

    reachable.add(nodeId);
    const node = tree.nodes[nodeId];
    if (!node) {
      issues.push({
        code: "missing_node",
        message: "Tree references a node ID that does not exist.",
        details: { nodeId },
      });
      continue;
    }

    if (node.kind === "parent" && node.childIds.length > maxChildrenPerParent) {
      issues.push({
        code: "branching_factor",
        message: "Parent node exceeds maxChildrenPerParent.",
        details: { nodeId, childCount: node.childIds.length, maxChildrenPerParent },
      });
    }

    if (node.kind === "parent") {
      if (!node.policyDiagnostics) {
        issues.push({
          code: "policy_missing",
          message: "Parent node is missing pedagogy policy diagnostics.",
          details: { nodeId },
        });
      } else if (!node.policyDiagnostics.preSummary.ok || !node.policyDiagnostics.postSummary.ok) {
        issues.push({
          code: "policy_violation",
          message: "Parent node contains failed pedagogical policy decisions.",
          details: {
            nodeId,
            preSummaryViolations: node.policyDiagnostics.preSummary.violations.map((violation) => violation.code),
            postSummaryViolations: node.policyDiagnostics.postSummary.violations.map((violation) => violation.code),
          },
        });
      }
    }

    for (const childId of node.childIds) {
      stack.push(childId);
    }
  }

  for (const nodeId of Object.keys(tree.nodes)) {
    if (!reachable.has(nodeId)) {
      issues.push({
        code: "not_connected",
        message: "Node is not reachable from root.",
        details: { nodeId },
      });
    }
  }

  for (const leafId of tree.leafIds) {
    if (!reachable.has(leafId)) {
      issues.push({
        code: "leaf_not_preserved",
        message: "Leaf is not reachable from root.",
        details: { leafId },
      });
    }
  }

  return {
    ok: issues.length === 0,
    issues,
  };
}

function normalizeLeaves(leaves: LeafNodeInput[]): LeafNodeInput[] {
  if (!Array.isArray(leaves) || leaves.length === 0) {
    throw new Error("leaves must contain at least one item.");
  }

  const normalized = leaves.map((leaf) => {
    const id = leaf.id.trim();
    const statement = leaf.statement.trim();
    if (!id) {
      throw new Error("leaf id must be non-empty.");
    }
    if (!statement) {
      throw new Error(`leaf statement must be non-empty for id '${id}'.`);
    }

    if (leaf.complexity !== undefined && (!Number.isFinite(leaf.complexity) || leaf.complexity < 1 || leaf.complexity > 5)) {
      throw new Error(`leaf complexity must be in [1, 5] for id '${id}'.`);
    }

    return {
      id,
      statement,
      complexity: leaf.complexity,
      prerequisiteIds: leaf.prerequisiteIds,
    };
  });

  normalized.sort((a, b) => a.id.localeCompare(b.id));

  for (let i = 1; i < normalized.length; i += 1) {
    if (normalized[i - 1].id === normalized[i].id) {
      throw new Error(`leaf id must be unique: '${normalized[i].id}'.`);
    }
  }

  return normalized;
}

function buildParentNodeId(depth: number, index: number, childIds: string[]): string {
  const digest = createHash("sha256")
    .update(`${depth}:${index}:${childIds.join(",")}`)
    .digest("hex")
    .slice(0, 16);
  return `p_${depth}_${index}_${digest}`;
}

function reorderGroupNodeIdsByPrerequisites(
  groupNodeIds: string[],
  nodes: Record<string, ExplanationTreeNode>,
  leafById: Map<string, LeafNodeInput>,
): string[] {
  const nodeSet = new Set(groupNodeIds);
  const inDegree = new Map<string, number>(groupNodeIds.map((nodeId) => [nodeId, 0]));
  const outgoing = new Map<string, string[]>(groupNodeIds.map((nodeId) => [nodeId, []]));

  for (const nodeId of groupNodeIds) {
    const leaf = leafById.get(nodeId);
    const prerequisites = (leaf?.prerequisiteIds ?? []).filter((prerequisiteId) => nodeSet.has(prerequisiteId));
    for (const prerequisiteId of prerequisites) {
      inDegree.set(nodeId, (inDegree.get(nodeId) as number) + 1);
      (outgoing.get(prerequisiteId) as string[]).push(nodeId);
    }
  }

  const ready = groupNodeIds.filter((nodeId) => (inDegree.get(nodeId) as number) === 0).sort((a, b) => a.localeCompare(b));
  const ordered: string[] = [];

  const remaining = new Set(groupNodeIds);
  while (remaining.size > 0) {
    const nodeId =
      ready.length > 0
        ? (ready.shift() as string)
        : [...remaining].sort((left, right) => left.localeCompare(right))[0];

    if (!remaining.has(nodeId)) {
      continue;
    }

    remaining.delete(nodeId);
    ordered.push(nodeId);

    const dependents = (outgoing.get(nodeId) ?? []).slice().sort((a, b) => a.localeCompare(b));
    for (const dependentId of dependents) {
      inDegree.set(dependentId, (inDegree.get(dependentId) as number) - 1);
      if (remaining.has(dependentId) && inDegree.get(dependentId) === 0) {
        insertSorted(ready, dependentId);
      }
    }
  }

  return ordered.filter((nodeId) => Boolean(nodes[nodeId]));
}

function computeDepthLimit(leafCount: number, maxChildrenPerParent: number): number {
  if (leafCount <= 1) {
    return 0;
  }

  const base = Math.max(2, maxChildrenPerParent);
  const optimistic = Math.ceil(Math.log(leafCount) / Math.log(base)) + 2;
  const safeUpperBound = Math.min(2048, leafCount);
  return Math.max(optimistic, safeUpperBound);
}

function insertSorted(values: string[], value: string): void {
  let index = 0;
  while (index < values.length && values[index].localeCompare(value) < 0) {
    index += 1;
  }
  values.splice(index, 0, value);
}

async function generatePolicyCompliantParentSummary(
  provider: ProviderClient,
  children: Array<{ id: string; statement: string; complexity?: number; prerequisiteIds?: string[] }>,
  config: ExplanationConfig,
  depth: number,
  groupIndex: number,
  preSummaryDecision: ParentPolicyDiagnostics["preSummary"],
): Promise<{ summary: Awaited<ReturnType<typeof generateParentSummary>>["summary"]; policyDiagnostics: ParentPolicyDiagnostics }> {
  const maxAttempts = 2;
  let retriesUsed = 0;
  let lastPostSummary = evaluatePostSummaryPolicy(children, emptySummary(children), config);

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const result = await generateParentSummary(provider, {
        children,
        config,
        systemPrompt:
          attempt === 0
            ? undefined
            : [
                "You are a proof-grounded summarizer.",
                "Use only child-grounded vocabulary except declared new_terms_introduced.",
                "Cite every child ID in evidence_refs.",
                "Keep parent claims explicitly entailed by child statements.",
                "Output strict JSON only.",
              ].join(" "),
      });

      const postSummaryDecision = evaluatePostSummaryPolicy(children, result.summary, config);
      lastPostSummary = postSummaryDecision;
      if (postSummaryDecision.ok) {
        retriesUsed = attempt;
        return {
          summary: result.summary,
          policyDiagnostics: {
            depth,
            groupIndex,
            retriesUsed,
            preSummary: preSummaryDecision,
            postSummary: postSummaryDecision,
          },
        };
      }
    } catch (error) {
      if (error instanceof SummaryValidationError) {
        lastPostSummary = {
          ok: false,
          violations: error.diagnostics.violations.map((violation) => mapCriticViolationToPolicyViolation(violation)),
          metrics: {
            complexitySpread: 0,
            prerequisiteOrderViolations: 0,
            introducedTermCount: 0,
            evidenceCoverageRatio: 0,
            vocabularyContinuityRatio: 0,
            vocabularyContinuityFloor: 1,
          },
        };
      } else {
        throw error;
      }
    }
  }

  throw new TreePolicyError("Failed to produce a policy-compliant parent summary after deterministic retries.", {
    depth,
    groupIndex,
    retriesUsed: maxAttempts - 1,
    preSummary: preSummaryDecision,
    postSummary: lastPostSummary,
  });
}

function mapCriticViolationToPolicyViolation(
  violation: SummaryValidationError["diagnostics"]["violations"][number],
): ParentPolicyDiagnostics["postSummary"]["violations"][number] {
  switch (violation.code) {
    case "term_budget":
      return { code: "term_budget", message: violation.message, details: violation.details };
    case "evidence_refs":
      return { code: "evidence_coverage", message: violation.message, details: violation.details };
    case "schema":
    case "complexity_band":
    case "unsupported_terms":
      return { code: "vocabulary_continuity", message: violation.message, details: violation.details };
    default: {
      const exhaustiveCheck: never = violation.code;
      throw new Error(`Unhandled critic violation code: ${String(exhaustiveCheck)}`);
    }
  }
}

function emptySummary(children: Array<{ id: string }>): {
  parent_statement: string;
  why_true_from_children: string;
  new_terms_introduced: string[];
  complexity_score: number;
  abstraction_score: number;
  evidence_refs: string[];
  confidence: number;
} {
  return {
    parent_statement: "",
    why_true_from_children: "",
    new_terms_introduced: [],
    complexity_score: 0,
    abstraction_score: 0,
    evidence_refs: children.map((child) => child.id),
    confidence: 0,
  };
}
