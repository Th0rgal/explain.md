import { createHash } from "node:crypto";
import { computeConfigHash, type ExplanationConfig } from "./config-contract.js";
import type { ProviderClient } from "./openai-provider.js";
import { generateParentSummary } from "./summary-pipeline.js";

export interface LeafNodeInput {
  id: string;
  statement: string;
  complexity?: number;
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
}

export interface GroupPlan {
  depth: number;
  index: number;
  inputNodeIds: string[];
  outputNodeId: string;
}

export interface ExplanationTree {
  rootId: string;
  leafIds: string[];
  nodes: Record<string, ExplanationTreeNode>;
  configHash: string;
  groupPlan: GroupPlan[];
  maxDepth: number;
}

export interface TreeBuildRequest {
  leaves: LeafNodeInput[];
  config: ExplanationConfig;
  maxDepth?: number;
}

export interface TreeValidationIssue {
  code: "missing_root" | "missing_node" | "not_connected" | "leaf_not_preserved" | "branching_factor";
  message: string;
  details?: Record<string, unknown>;
}

export interface TreeValidationResult {
  ok: boolean;
  issues: TreeValidationIssue[];
}

export async function buildRecursiveExplanationTree(
  provider: ProviderClient,
  request: TreeBuildRequest,
): Promise<ExplanationTree> {
  const leaves = normalizeLeaves(request.leaves);
  const nodes: Record<string, ExplanationTreeNode> = {};
  const leafIds = leaves.map((leaf) => leaf.id);
  const groupPlan: GroupPlan[] = [];

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

    const groups = partitionNodeIds(activeNodeIds, request.config.maxChildrenPerParent);
    const nextLayerIds: string[] = [];

    for (let index = 0; index < groups.length; index += 1) {
      const groupNodeIds = groups[index];
      if (groupNodeIds.length === 1) {
        nextLayerIds.push(groupNodeIds[0]);
        continue;
      }

      const children = groupNodeIds.map((nodeId) => {
        const node = nodes[nodeId];
        return {
          id: node.id,
          statement: node.statement,
          complexity: node.complexityScore,
        };
      });

      const summaryResult = await generateParentSummary(provider, {
        children,
        config: request.config,
      });

      const parentId = buildParentNodeId(depth, index, groupNodeIds);
      const parentNode: ExplanationTreeNode = {
        id: parentId,
        kind: "parent",
        statement: summaryResult.summary.parent_statement,
        childIds: groupNodeIds.slice(),
        depth,
        complexityScore: summaryResult.summary.complexity_score,
        abstractionScore: summaryResult.summary.abstraction_score,
        confidence: summaryResult.summary.confidence,
        whyTrueFromChildren: summaryResult.summary.why_true_from_children,
        newTermsIntroduced: summaryResult.summary.new_terms_introduced,
        evidenceRefs: summaryResult.summary.evidence_refs,
      };

      nodes[parentId] = parentNode;
      nextLayerIds.push(parentId);
      groupPlan.push({ depth, index, inputNodeIds: groupNodeIds.slice(), outputNodeId: parentId });
    }

    activeNodeIds = nextLayerIds;
  }

  const tree: ExplanationTree = {
    rootId: activeNodeIds[0],
    leafIds,
    nodes,
    configHash: computeConfigHash(request.config),
    groupPlan,
    maxDepth: depth,
  };

  const validation = validateExplanationTree(tree, request.config.maxChildrenPerParent);
  if (!validation.ok) {
    throw new Error(`Tree validation failed: ${validation.issues.map((issue) => issue.code).join(", ")}`);
  }

  return tree;
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

function partitionNodeIds(nodeIds: string[], maxChildrenPerParent: number): string[][] {
  const groups: string[][] = [];
  for (let i = 0; i < nodeIds.length; i += maxChildrenPerParent) {
    groups.push(nodeIds.slice(i, i + maxChildrenPerParent));
  }
  return groups;
}

function buildParentNodeId(depth: number, index: number, childIds: string[]): string {
  const digest = createHash("sha256")
    .update(`${depth}:${index}:${childIds.join(",")}`)
    .digest("hex")
    .slice(0, 16);
  return `p_${depth}_${index}_${digest}`;
}

function computeDepthLimit(leafCount: number, maxChildrenPerParent: number): number {
  if (leafCount <= 1) {
    return 0;
  }

  const base = Math.max(2, maxChildrenPerParent);
  return Math.ceil(Math.log(leafCount) / Math.log(base)) + 2;
}
