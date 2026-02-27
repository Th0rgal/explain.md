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
  summaryBatches?: SummaryBatchDiagnostics[];
  summaryReuse?: SummaryReuseDiagnostics;
}

export interface SummaryBatchDiagnostics {
  batchIndex: number;
  groupIndexes: number[];
  groupCount: number;
  inputNodeCount: number;
}

export interface SummaryReuseDiagnostics {
  reusedGroupIndexes: number[];
  generatedGroupIndexes: number[];
  reusedByParentIdGroupIndexes?: number[];
  reusedByChildHashGroupIndexes?: number[];
  reusedByChildStatementHashGroupIndexes?: number[];
  reusedByFrontierChildHashGroupIndexes?: number[];
  reusedByFrontierChildStatementHashGroupIndexes?: number[];
  skippedAmbiguousChildHashGroupIndexes?: number[];
  skippedAmbiguousChildStatementHashGroupIndexes?: number[];
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
  summaryBatchSize?: number;
  reusableParentSummaries?: Record<string, ReusableParentSummary>;
  generationFrontierLeafIds?: string[];
}

export interface ReusableParentSummary {
  childStatementHash: string;
  childStatementTextHash?: string;
  frontierLeafIdHash?: string;
  frontierLeafStatementHash?: string;
  summary: {
    parent_statement: string;
    why_true_from_children: string;
    new_terms_introduced: string[];
    complexity_score: number;
    abstraction_score: number;
    evidence_refs: string[];
    confidence: number;
  };
  policyDiagnostics?: ParentPolicyDiagnostics;
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

export interface FrontierGenerationBlockedGroup {
  depth: number;
  groupIndex: number;
  parentId: string;
  frontierLeafIds: string[];
}

export class TreeFrontierPartitionError extends Error {
  public readonly blockedGroups: FrontierGenerationBlockedGroup[];

  public constructor(message: string, blockedGroups: FrontierGenerationBlockedGroup[]) {
    super(message);
    this.name = "TreeFrontierPartitionError";
    this.blockedGroups = blockedGroups;
  }
}

interface PendingSummaryTask {
  groupIndex: number;
  parentId: string;
  orderedGroupNodeIds: string[];
  children: Array<{ id: string; statement: string; complexity?: number; prerequisiteIds?: string[] }>;
  preSummaryDecision: ParentPolicyDiagnostics["preSummary"];
  complexitySpread: number;
}

interface ReusableSummaryCandidate {
  key: string;
  summary: ReusableParentSummary;
}

interface ReusableSummarySelection {
  candidate?: ReusableSummaryCandidate;
  ambiguous: boolean;
  resolvedByFrontier: boolean;
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
  const summaryBatchSize = normalizeSummaryBatchSize(request.summaryBatchSize);
  const reusableParentSummaries = request.reusableParentSummaries ?? {};
  const generationFrontierLeafIdSet = normalizeGenerationFrontierLeafIdSet(request.generationFrontierLeafIds);
  const reusableSummaryPools = buildReusableSummaryPools(reusableParentSummaries);
  const consumedReusableSummaryKeys = new Set<string>();
  const frontierSignatureMemo = new Map<string, { leafIds: string[]; leafStatements: string[] }>();

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
    const summaryTasks: PendingSummaryTask[] = [];
    const nextLayerByGroupIndex: Array<string | undefined> = new Array(groups.length);
    const reusedGroupIndexes: number[] = [];
    const generatedGroupIndexes: number[] = [];
    const reusedByParentIdGroupIndexes: number[] = [];
    const reusedByChildHashGroupIndexes: number[] = [];
    const reusedByChildStatementHashGroupIndexes: number[] = [];
    const reusedByFrontierChildHashGroupIndexes: number[] = [];
    const reusedByFrontierChildStatementHashGroupIndexes: number[] = [];
    const skippedAmbiguousChildHashGroupIndexes: number[] = [];
    const skippedAmbiguousChildStatementHashGroupIndexes: number[] = [];
    const blockedGenerationGroups: FrontierGenerationBlockedGroup[] = [];

    for (let index = 0; index < groups.length; index += 1) {
      const groupNodeIds = groups[index];
      if (groupNodeIds.length === 1) {
        nextLayerByGroupIndex[index] = groupNodeIds[0];
        continue;
      }

      const orderedGroupNodeIds = reorderGroupNodeIdsByPrerequisites(groupNodeIds, nodes, leafById);

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
      const parentId = buildParentNodeId(depth, index, orderedGroupNodeIds);

      const preSummaryDecision = evaluatePreSummaryPolicy(children, request.config);
      if (!preSummaryDecision.ok) {
        throw new TreePolicyError("Pre-summary pedagogical policy failed.", {
          depth,
          groupIndex: index,
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

      const childStatementHash = computeChildStatementHash(children);
      const childStatementTextHash = computeChildStatementTextHash(children);
      const frontierHashes = computeFrontierHashesForGroup(orderedGroupNodeIds, nodes, frontierSignatureMemo);
      const canGenerateSummary =
        generationFrontierLeafIdSet === undefined ||
        groupIntersectsGenerationFrontier(orderedGroupNodeIds, nodes, frontierSignatureMemo, generationFrontierLeafIdSet);
      let reusableParent = reusableParentSummaries[parentId];
      let reusableParentKey = parentId;
      let reuseMatchKind: "parent_id" | "child_hash" | "child_statement_hash" = "parent_id";
      let reusedByFrontier = false;
      if (
        !reusableParent || reusableParent.childStatementHash !== childStatementHash
      ) {
        const poolKey = buildReusableSummaryPoolKey(depth, childStatementHash);
        if (reusableSummaryPools.byDepthAndChildHash.has(poolKey)) {
          const selection = selectReusableSummaryCandidate(
            reusableSummaryPools.byDepthAndChildHash.get(poolKey) as ReusableSummaryCandidate[],
            consumedReusableSummaryKeys,
            frontierHashes,
          );
          if (selection.candidate) {
            reusableParent = selection.candidate.summary;
            reusableParentKey = selection.candidate.key;
            reuseMatchKind = "child_hash";
            reusedByFrontier = selection.resolvedByFrontier;
          } else if (selection.ambiguous) {
            skippedAmbiguousChildHashGroupIndexes.push(index);
          }
        }
      }
      if (
        (!reusableParent || reusableParent.childStatementHash !== childStatementHash) &&
        reuseMatchKind !== "child_hash"
      ) {
        const statementPoolKey = buildReusableSummaryPoolKey(depth, childStatementTextHash);
        if (reusableSummaryPools.byDepthAndChildStatementHash.has(statementPoolKey)) {
          const selection = selectReusableSummaryCandidate(
            reusableSummaryPools.byDepthAndChildStatementHash.get(statementPoolKey) as ReusableSummaryCandidate[],
            consumedReusableSummaryKeys,
            frontierHashes,
          );
          if (selection.candidate) {
            reusableParent = selection.candidate.summary;
            reusableParentKey = selection.candidate.key;
            reuseMatchKind = "child_statement_hash";
            reusedByFrontier = selection.resolvedByFrontier;
          } else if (selection.ambiguous) {
            skippedAmbiguousChildStatementHashGroupIndexes.push(index);
          }
        }
      }

      const matchesByChildHash = reusableParent?.childStatementHash === childStatementHash;
      const matchesByChildStatementHash =
        reusableParent?.childStatementTextHash !== undefined && reusableParent.childStatementTextHash === childStatementTextHash;
      if (reusableParent && (matchesByChildHash || matchesByChildStatementHash)) {
        const summaryForPolicy =
          matchesByChildHash || !matchesByChildStatementHash
            ? reusableParent.summary
            : {
                ...reusableParent.summary,
                evidence_refs: children.map((child) => child.id),
              };
        const postSummaryDecision = evaluatePostSummaryPolicy(children, summaryForPolicy, request.config);
        if (postSummaryDecision.ok) {
          const policyDiagnostics = reusableParent.policyDiagnostics
            ? cloneParentPolicyDiagnostics(reusableParent.policyDiagnostics, depth, index)
            : {
                depth,
                groupIndex: index,
                retriesUsed: 0,
                preSummary: preSummaryDecision,
                postSummary: postSummaryDecision,
              };
          const parentNode: ExplanationTreeNode = {
            id: parentId,
            kind: "parent",
            statement: summaryForPolicy.parent_statement,
            childIds: orderedGroupNodeIds.slice(),
            depth,
            complexityScore: summaryForPolicy.complexity_score,
            abstractionScore: summaryForPolicy.abstraction_score,
            confidence: summaryForPolicy.confidence,
            whyTrueFromChildren: summaryForPolicy.why_true_from_children,
            newTermsIntroduced: summaryForPolicy.new_terms_introduced.slice(),
            evidenceRefs: summaryForPolicy.evidence_refs.slice(),
            policyDiagnostics,
          };

          nodes[parentId] = parentNode;
          policyDiagnosticsByParent[parentId] = policyDiagnostics;
          nextLayerByGroupIndex[index] = parentId;
          groupPlan.push({
            depth,
            index,
            inputNodeIds: orderedGroupNodeIds.slice(),
            outputNodeId: parentId,
            complexitySpread: groupingResult.diagnostics.complexitySpreadByGroup[index] ?? 0,
          });
          consumedReusableSummaryKeys.add(reusableParentKey);
          reusedGroupIndexes.push(index);
          if (reuseMatchKind === "parent_id") {
            reusedByParentIdGroupIndexes.push(index);
          } else if (reuseMatchKind === "child_hash") {
            reusedByChildHashGroupIndexes.push(index);
            if (reusedByFrontier) {
              reusedByFrontierChildHashGroupIndexes.push(index);
            }
          } else {
            reusedByChildStatementHashGroupIndexes.push(index);
            if (reusedByFrontier) {
              reusedByFrontierChildStatementHashGroupIndexes.push(index);
            }
          }
          continue;
        }
      }

      if (!canGenerateSummary) {
        blockedGenerationGroups.push({
          depth,
          groupIndex: index,
          parentId,
          frontierLeafIds: collectGroupFrontierLeafIds(orderedGroupNodeIds, nodes, frontierSignatureMemo),
        });
        continue;
      }

      summaryTasks.push({
        groupIndex: index,
        parentId,
        orderedGroupNodeIds,
        children,
        preSummaryDecision,
        complexitySpread: groupingResult.diagnostics.complexitySpreadByGroup[index] ?? 0,
      });
      generatedGroupIndexes.push(index);
    }

    if (blockedGenerationGroups.length > 0) {
      throw new TreeFrontierPartitionError(
        "Deterministic frontier-partition mode blocked summary generation outside changed frontier.",
        blockedGenerationGroups,
      );
    }

    const summaryBatches: SummaryBatchDiagnostics[] = [];
    for (let start = 0, batchIndex = 0; start < summaryTasks.length; start += summaryBatchSize, batchIndex += 1) {
      const batchTasks = summaryTasks.slice(start, start + summaryBatchSize);
      const parentSummaries = await Promise.all(
        batchTasks.map((task) =>
          generatePolicyCompliantParentSummary(
            provider,
            task.children,
            request.config,
            depth,
            task.groupIndex,
            task.preSummaryDecision,
          ),
        ),
      );

      summaryBatches.push({
        batchIndex,
        groupIndexes: batchTasks.map((task) => task.groupIndex),
        groupCount: batchTasks.length,
        inputNodeCount: batchTasks.reduce((sum, task) => sum + task.orderedGroupNodeIds.length, 0),
      });

      for (let taskIndex = 0; taskIndex < batchTasks.length; taskIndex += 1) {
        const task = batchTasks[taskIndex];
        const parentSummary = parentSummaries[taskIndex];
        const parentId = task.parentId;
        const parentNode: ExplanationTreeNode = {
          id: parentId,
          kind: "parent",
          statement: parentSummary.summary.parent_statement,
          childIds: task.orderedGroupNodeIds.slice(),
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
        nextLayerByGroupIndex[task.groupIndex] = parentId;
        groupPlan.push({
          depth,
          index: task.groupIndex,
          inputNodeIds: task.orderedGroupNodeIds.slice(),
          outputNodeId: parentId,
          complexitySpread: task.complexitySpread,
        });
      }
    }

    const nextLayerIds = nextLayerByGroupIndex.filter((nodeId): nodeId is string => typeof nodeId === "string");
    groupingDiagnostics.push({
      depth,
      orderedNodeIds: groupingResult.diagnostics.orderedNodeIds,
      complexitySpreadByGroup: groupingResult.diagnostics.complexitySpreadByGroup,
      warnings: groupingResult.diagnostics.warnings,
      summaryBatches,
      summaryReuse:
        reusedGroupIndexes.length > 0 || generatedGroupIndexes.length > 0
          ? {
              reusedGroupIndexes,
              generatedGroupIndexes,
              reusedByParentIdGroupIndexes,
              reusedByChildHashGroupIndexes,
              reusedByChildStatementHashGroupIndexes,
              reusedByFrontierChildHashGroupIndexes,
              reusedByFrontierChildStatementHashGroupIndexes,
              skippedAmbiguousChildHashGroupIndexes,
              skippedAmbiguousChildStatementHashGroupIndexes,
            }
          : undefined,
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

function normalizeGenerationFrontierLeafIdSet(leafIds: string[] | undefined): Set<string> | undefined {
  if (!leafIds) {
    return undefined;
  }
  const normalized = leafIds.map((leafId) => leafId.trim()).filter((leafId) => leafId.length > 0);
  if (normalized.length === 0) {
    return undefined;
  }
  return new Set(normalized);
}

function groupIntersectsGenerationFrontier(
  orderedGroupNodeIds: string[],
  nodes: Record<string, ExplanationTreeNode>,
  memo: Map<string, { leafIds: string[]; leafStatements: string[] }>,
  frontierLeafIdSet: Set<string>,
): boolean {
  for (const nodeId of orderedGroupNodeIds) {
    const frontier = collectLeafFrontier(nodeId, nodes, memo);
    for (const leafId of frontier.leafIds) {
      if (frontierLeafIdSet.has(leafId)) {
        return true;
      }
    }
  }
  return false;
}

function collectGroupFrontierLeafIds(
  orderedGroupNodeIds: string[],
  nodes: Record<string, ExplanationTreeNode>,
  memo: Map<string, { leafIds: string[]; leafStatements: string[] }>,
): string[] {
  const leafIds = new Set<string>();
  for (const nodeId of orderedGroupNodeIds) {
    const frontier = collectLeafFrontier(nodeId, nodes, memo);
    for (const leafId of frontier.leafIds) {
      leafIds.add(leafId);
    }
  }
  return [...leafIds].sort((left, right) => left.localeCompare(right));
}

function buildReusableSummaryPools(
  reusableParentSummaries: Record<string, ReusableParentSummary>,
): {
  byDepthAndChildHash: Map<string, ReusableSummaryCandidate[]>;
  byDepthAndChildStatementHash: Map<string, ReusableSummaryCandidate[]>;
} {
  const byDepthAndChildHash = new Map<string, ReusableSummaryCandidate[]>();
  const byDepthAndChildStatementHash = new Map<string, ReusableSummaryCandidate[]>();
  const orderedParentIds = Object.keys(reusableParentSummaries).sort((left, right) => left.localeCompare(right));
  for (const parentId of orderedParentIds) {
    const summary = reusableParentSummaries[parentId];
    const depth = resolveReusableSummaryDepth(parentId, summary);
    if (depth === undefined) {
      continue;
    }
    const childHashPoolKey = buildReusableSummaryPoolKey(depth, summary.childStatementHash);
    const existingByChildHash = byDepthAndChildHash.get(childHashPoolKey);
    const candidate: ReusableSummaryCandidate = { key: parentId, summary };
    if (existingByChildHash) {
      existingByChildHash.push(candidate);
    } else {
      byDepthAndChildHash.set(childHashPoolKey, [candidate]);
    }

    if (summary.childStatementTextHash !== undefined) {
      const childStatementHashPoolKey = buildReusableSummaryPoolKey(depth, summary.childStatementTextHash);
      const existingByChildStatementHash = byDepthAndChildStatementHash.get(childStatementHashPoolKey);
      if (existingByChildStatementHash) {
        existingByChildStatementHash.push(candidate);
      } else {
        byDepthAndChildStatementHash.set(childStatementHashPoolKey, [candidate]);
      }
    }
  }
  return {
    byDepthAndChildHash,
    byDepthAndChildStatementHash,
  };
}

function selectReusableSummaryCandidate(
  candidates: ReusableSummaryCandidate[],
  consumedKeys: Set<string>,
  frontierHashes?: { leafIdHash: string; leafStatementHash: string },
): ReusableSummarySelection {
  const available: ReusableSummaryCandidate[] = [];
  for (const candidate of candidates) {
    if (!consumedKeys.has(candidate.key)) {
      available.push(candidate);
    }
  }
  if (available.length === 1) {
    return { candidate: available[0], ambiguous: false, resolvedByFrontier: false };
  }
  if (available.length <= 1 || !frontierHashes) {
    return { ambiguous: available.length > 1, resolvedByFrontier: false };
  }

  const byLeafIdHash = available.filter((candidate) => candidate.summary.frontierLeafIdHash === frontierHashes.leafIdHash);
  if (byLeafIdHash.length === 1) {
    return { candidate: byLeafIdHash[0], ambiguous: false, resolvedByFrontier: true };
  }
  if (byLeafIdHash.length > 1) {
    const byLeafStatementHash = byLeafIdHash.filter(
      (candidate) => candidate.summary.frontierLeafStatementHash === frontierHashes.leafStatementHash,
    );
    if (byLeafStatementHash.length === 1) {
      return { candidate: byLeafStatementHash[0], ambiguous: false, resolvedByFrontier: true };
    }
    return { ambiguous: true, resolvedByFrontier: false };
  }

  const byLeafStatementHash = available.filter(
    (candidate) => candidate.summary.frontierLeafStatementHash === frontierHashes.leafStatementHash,
  );
  if (byLeafStatementHash.length === 1) {
    return { candidate: byLeafStatementHash[0], ambiguous: false, resolvedByFrontier: true };
  }
  return { ambiguous: available.length > 1, resolvedByFrontier: false };
}

function resolveReusableSummaryDepth(parentId: string, summary: ReusableParentSummary): number | undefined {
  const diagnosticDepth = summary.policyDiagnostics?.depth;
  if (typeof diagnosticDepth === "number" && Number.isInteger(diagnosticDepth) && diagnosticDepth >= 0) {
    return diagnosticDepth;
  }
  const match = parentId.match(/^p_(\d+)_\d+_/);
  if (!match) {
    return undefined;
  }
  const parsed = Number(match[1]);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return undefined;
  }
  return parsed;
}

function buildReusableSummaryPoolKey(depth: number, childStatementHash: string): string {
  return `${depth}:${childStatementHash}`;
}

function computeFrontierHashesForGroup(
  orderedGroupNodeIds: string[],
  nodes: Record<string, ExplanationTreeNode>,
  memo: Map<string, { leafIds: string[]; leafStatements: string[] }>,
): { leafIdHash: string; leafStatementHash: string } {
  const leafIds: string[] = [];
  const leafStatements: string[] = [];
  for (const nodeId of orderedGroupNodeIds) {
    const frontier = collectLeafFrontier(nodeId, nodes, memo);
    leafIds.push(...frontier.leafIds);
    leafStatements.push(...frontier.leafStatements);
  }

  return {
    leafIdHash: createHash("sha256")
      .update(leafIds.map((leafId, index) => `${index}:${leafId}`).join("\n"))
      .digest("hex"),
    leafStatementHash: createHash("sha256")
      .update(leafStatements.map((statement, index) => `${index}:${statement}`).join("\n"))
      .digest("hex"),
  };
}

function collectLeafFrontier(
  nodeId: string,
  nodes: Record<string, ExplanationTreeNode>,
  memo: Map<string, { leafIds: string[]; leafStatements: string[] }>,
): { leafIds: string[]; leafStatements: string[] } {
  const existing = memo.get(nodeId);
  if (existing) {
    return existing;
  }

  const node = nodes[nodeId];
  if (!node) {
    throw new Error(`Missing node '${nodeId}' while collecting frontier leaves.`);
  }
  if (node.kind === "leaf") {
    const signature = { leafIds: [node.id], leafStatements: [node.statement] };
    memo.set(nodeId, signature);
    return signature;
  }

  const leafIds: string[] = [];
  const leafStatements: string[] = [];
  for (const childId of node.childIds) {
    const childSignature = collectLeafFrontier(childId, nodes, memo);
    leafIds.push(...childSignature.leafIds);
    leafStatements.push(...childSignature.leafStatements);
  }

  const signature = { leafIds, leafStatements };
  memo.set(nodeId, signature);
  return signature;
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

function computeChildStatementHash(children: Array<{ id: string; statement: string }>): string {
  return createHash("sha256")
    .update(
      children
        .map((child) => `${child.id}:${child.statement}`)
        .join("\n"),
    )
    .digest("hex");
}

function computeChildStatementTextHash(children: Array<{ statement: string }>): string {
  return createHash("sha256")
    .update(
      children
        .map((child, index) => `${index}:${child.statement}`)
        .join("\n"),
    )
    .digest("hex");
}

function cloneParentPolicyDiagnostics(
  diagnostics: ParentPolicyDiagnostics,
  depth: number,
  groupIndex: number,
): ParentPolicyDiagnostics {
  return {
    depth,
    groupIndex,
    retriesUsed: diagnostics.retriesUsed,
    preSummary: {
      ok: diagnostics.preSummary.ok,
      violations: diagnostics.preSummary.violations.map((violation) => ({ ...violation })),
      metrics: { ...diagnostics.preSummary.metrics },
    },
    postSummary: {
      ok: diagnostics.postSummary.ok,
      violations: diagnostics.postSummary.violations.map((violation) => ({ ...violation })),
      metrics: { ...diagnostics.postSummary.metrics },
    },
  };
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

function normalizeSummaryBatchSize(summaryBatchSize: number | undefined): number {
  if (summaryBatchSize === undefined) {
    return 4;
  }

  if (!Number.isInteger(summaryBatchSize) || summaryBatchSize < 1 || summaryBatchSize > 32) {
    throw new Error("summaryBatchSize must be an integer in [1, 32] when provided.");
  }

  return summaryBatchSize;
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
