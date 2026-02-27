import { createHash } from "node:crypto";
import { computeConfigHash, type ExplanationConfig } from "./config-contract.js";
import { groupChildrenDeterministically, type GroupingWarning } from "./child-grouping.js";
import {
  evaluatePostSummaryPolicy,
  evaluatePreSummaryPolicy,
  type PolicyViolationCode,
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
  repartitionEvents?: RepartitionEvent[];
}

export interface RepartitionEvent {
  depth: number;
  groupIndex: number;
  round: number;
  reason: "pre_summary_policy" | "post_summary_policy";
  inputNodeIds: string[];
  outputGroups: string[][];
  violationCodes: PolicyViolationCode[];
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
    const nextLayerIds: string[] = [];
    const complexitySpreadByGroup: number[] = [];
    const repartitionEvents: RepartitionEvent[] = [];
    let nextGroupIndex = groups.length;

    for (let index = 0; index < groups.length; index += 1) {
      const result = await buildGroupWithDeterministicRepartition({
        provider,
        depth,
        initialGroupIndex: index,
        nodeIds: groups[index],
        round: 0,
        maxChildrenPerParent: request.config.maxChildrenPerParent,
        leafById,
        nodes,
        config: request.config,
        getNextGroupIndex: () => {
          const value = nextGroupIndex;
          nextGroupIndex += 1;
          return value;
        },
      });

      for (const parent of result.createdParents) {
        nodes[parent.parentId] = parent.node;
        policyDiagnosticsByParent[parent.parentId] = parent.node.policyDiagnostics as ParentPolicyDiagnostics;
        nextLayerIds.push(parent.parentId);
        groupPlan.push({
          depth,
          index: parent.groupIndex,
          inputNodeIds: parent.inputNodeIds.slice(),
          outputNodeId: parent.parentId,
          complexitySpread: parent.complexitySpread,
        });
        complexitySpreadByGroup.push(parent.complexitySpread);
      }

      for (const passthroughLeafId of result.passthroughLeafIds) {
        nextLayerIds.push(passthroughLeafId);
      }

      repartitionEvents.push(...result.repartitionEvents);
    }

    groupingDiagnostics.push({
      depth,
      orderedNodeIds: groupingResult.diagnostics.orderedNodeIds,
      complexitySpreadByGroup,
      warnings: groupingResult.diagnostics.warnings,
      repartitionEvents,
    });

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

interface BuildGroupWithRepartitionRequest {
  provider: ProviderClient;
  depth: number;
  initialGroupIndex: number;
  nodeIds: string[];
  round: number;
  maxChildrenPerParent: number;
  leafById: Map<string, LeafNodeInput>;
  nodes: Record<string, ExplanationTreeNode>;
  config: ExplanationConfig;
  getNextGroupIndex: () => number;
}

interface CreatedParentRecord {
  parentId: string;
  node: ExplanationTreeNode;
  inputNodeIds: string[];
  groupIndex: number;
  complexitySpread: number;
}

interface BuildGroupWithRepartitionResult {
  createdParents: CreatedParentRecord[];
  passthroughLeafIds: string[];
  repartitionEvents: RepartitionEvent[];
}

async function buildGroupWithDeterministicRepartition(
  request: BuildGroupWithRepartitionRequest,
): Promise<BuildGroupWithRepartitionResult> {
  if (request.nodeIds.length === 1) {
    return {
      createdParents: [],
      passthroughLeafIds: [request.nodeIds[0]],
      repartitionEvents: [],
    };
  }

  const orderedGroupNodeIds = reorderGroupNodeIdsByPrerequisites(request.nodeIds, request.nodes, request.leafById);
  const children = orderedGroupNodeIds.map((nodeId) => {
    const node = request.nodes[nodeId];
    const leafInput = request.leafById.get(node.id);
    return {
      id: node.id,
      statement: node.statement,
      complexity: node.complexityScore,
      prerequisiteIds: leafInput?.prerequisiteIds,
    };
  });

  const preSummaryDecision = evaluatePreSummaryPolicy(children, request.config);
  if (!preSummaryDecision.ok) {
    const splitGroups = splitGroupDeterministically(orderedGroupNodeIds, request.maxChildrenPerParent);
    if (!splitGroups) {
      throw new TreePolicyError("Pre-summary pedagogical policy failed.", {
        depth: request.depth,
        groupIndex: request.initialGroupIndex,
        retriesUsed: request.round,
        preSummary: preSummaryDecision,
        postSummary: buildDefaultPassingPostSummary(request.config),
      });
    }

    const repartitionEvent = buildRepartitionEvent(
      request.depth,
      request.initialGroupIndex,
      request.round,
      "pre_summary_policy",
      orderedGroupNodeIds,
      splitGroups,
      preSummaryDecision.violations.map((violation) => violation.code),
    );

    const nestedResults: BuildGroupWithRepartitionResult[] = [];
    for (const groupNodeIds of splitGroups) {
      nestedResults.push(
        await buildGroupWithDeterministicRepartition({
          ...request,
          nodeIds: groupNodeIds,
          round: request.round + 1,
        }),
      );
    }

    return mergeRepartitionResults(repartitionEvent, nestedResults);
  }

  let parentSummary:
    | {
        summary: Awaited<ReturnType<typeof generateParentSummary>>["summary"];
        policyDiagnostics: ParentPolicyDiagnostics;
      }
    | undefined;
  try {
    parentSummary = await generatePolicyCompliantParentSummary(
      request.provider,
      children,
      request.config,
      request.depth,
      request.initialGroupIndex,
      preSummaryDecision,
    );
  } catch (error) {
    if (!(error instanceof TreePolicyError)) {
      throw error;
    }

    const splitGroups = splitGroupDeterministically(orderedGroupNodeIds, request.maxChildrenPerParent);
    if (!splitGroups) {
      throw error;
    }

    const repartitionEvent = buildRepartitionEvent(
      request.depth,
      request.initialGroupIndex,
      request.round,
      "post_summary_policy",
      orderedGroupNodeIds,
      splitGroups,
      [
        ...error.diagnostics.preSummary.violations.map((violation) => violation.code),
        ...error.diagnostics.postSummary.violations.map((violation) => violation.code),
      ],
    );

    const nestedResults: BuildGroupWithRepartitionResult[] = [];
    for (const groupNodeIds of splitGroups) {
      nestedResults.push(
        await buildGroupWithDeterministicRepartition({
          ...request,
          nodeIds: groupNodeIds,
          round: request.round + 1,
        }),
      );
    }

    return mergeRepartitionResults(repartitionEvent, nestedResults);
  }

  const groupIndex = request.round === 0 ? request.initialGroupIndex : request.getNextGroupIndex();
  const parentId = buildParentNodeId(request.depth, groupIndex, orderedGroupNodeIds);
  const parentNode: ExplanationTreeNode = {
    id: parentId,
    kind: "parent",
    statement: parentSummary.summary.parent_statement,
    childIds: orderedGroupNodeIds.slice(),
    depth: request.depth,
    complexityScore: parentSummary.summary.complexity_score,
    abstractionScore: parentSummary.summary.abstraction_score,
    confidence: parentSummary.summary.confidence,
    whyTrueFromChildren: parentSummary.summary.why_true_from_children,
    newTermsIntroduced: parentSummary.summary.new_terms_introduced,
    evidenceRefs: parentSummary.summary.evidence_refs,
    policyDiagnostics: parentSummary.policyDiagnostics,
  };

  return {
    createdParents: [
      {
        parentId,
        node: parentNode,
        inputNodeIds: orderedGroupNodeIds,
        groupIndex,
        complexitySpread: preSummaryDecision.metrics.complexitySpread,
      },
    ],
    passthroughLeafIds: [],
    repartitionEvents: [],
  };
}

function splitGroupDeterministically(nodeIds: string[], maxChildrenPerParent: number): string[][] | undefined {
  if (nodeIds.length <= 2) {
    return undefined;
  }

  const pivot = Math.ceil(nodeIds.length / 2);
  const left = nodeIds.slice(0, pivot);
  const right = nodeIds.slice(pivot);

  if (left.length === 0 || right.length === 0) {
    return undefined;
  }

  if (left.length > maxChildrenPerParent || right.length > maxChildrenPerParent) {
    return undefined;
  }

  return [left, right];
}

function buildDefaultPassingPostSummary(config: ExplanationConfig): ParentPolicyDiagnostics["postSummary"] {
  void config;
  return {
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
  };
}

function buildRepartitionEvent(
  depth: number,
  groupIndex: number,
  round: number,
  reason: RepartitionEvent["reason"],
  inputNodeIds: string[],
  outputGroups: string[][],
  violationCodes: PolicyViolationCode[],
): RepartitionEvent {
  return {
    depth,
    groupIndex,
    round,
    reason,
    inputNodeIds: inputNodeIds.slice(),
    outputGroups: outputGroups.map((group) => group.slice()),
    violationCodes: Array.from(new Set(violationCodes)).sort((left, right) => left.localeCompare(right)),
  };
}

function mergeRepartitionResults(
  repartitionEvent: RepartitionEvent,
  nestedResults: BuildGroupWithRepartitionResult[],
): BuildGroupWithRepartitionResult {
  const createdParents: CreatedParentRecord[] = [];
  const passthroughLeafIds: string[] = [];
  const repartitionEvents: RepartitionEvent[] = [repartitionEvent];

  for (const nested of nestedResults) {
    createdParents.push(...nested.createdParents);
    passthroughLeafIds.push(...nested.passthroughLeafIds);
    repartitionEvents.push(...nested.repartitionEvents);
  }

  return {
    createdParents,
    passthroughLeafIds,
    repartitionEvents,
  };
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
