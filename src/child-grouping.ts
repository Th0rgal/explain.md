import { createHash } from "node:crypto";

export interface GroupingNodeInput {
  id: string;
  statement: string;
  complexity?: number;
  prerequisiteIds?: string[];
}

export interface GroupingRequest {
  nodes: GroupingNodeInput[];
  maxChildrenPerParent: number;
  targetComplexity: number;
  complexityBandWidth: number;
}

export interface GroupingWarning {
  code: "cycle_detected" | "missing_complexity";
  message: string;
  details?: Record<string, unknown>;
}

export interface GroupingDiagnostics {
  orderedNodeIds: string[];
  complexitySpreadByGroup: number[];
  warnings: GroupingWarning[];
}

export interface GroupingResult {
  groups: string[][];
  diagnostics: GroupingDiagnostics;
}

const TOKEN_STOP_WORDS = new Set<string>([
  "a",
  "an",
  "and",
  "are",
  "as",
  "be",
  "by",
  "for",
  "from",
  "in",
  "is",
  "of",
  "on",
  "or",
  "that",
  "the",
  "to",
  "with",
]);

export function groupChildrenDeterministically(request: GroupingRequest): GroupingResult {
  const nodes = normalizeNodes(request.nodes);
  if (!Number.isInteger(request.maxChildrenPerParent) || request.maxChildrenPerParent < 2) {
    throw new Error("maxChildrenPerParent must be an integer >= 2.");
  }
  if (!Number.isFinite(request.targetComplexity) || request.targetComplexity < 1 || request.targetComplexity > 5) {
    throw new Error("targetComplexity must be in [1, 5].");
  }
  if (!Number.isInteger(request.complexityBandWidth) || request.complexityBandWidth < 0 || request.complexityBandWidth > 3) {
    throw new Error("complexityBandWidth must be an integer in [0, 3].");
  }

  const warnings: GroupingWarning[] = [];
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const tokenMap = new Map(nodes.map((node) => [node.id, tokenize(node.statement)]));

  const missingComplexityIds = nodes.filter((node) => node.complexity === undefined).map((node) => node.id);
  if (missingComplexityIds.length > 0) {
    warnings.push({
      code: "missing_complexity",
      message: "Missing complexities were replaced with targetComplexity for deterministic grouping.",
      details: { nodeIds: missingComplexityIds, fallbackComplexity: request.targetComplexity },
    });
  }

  const topoResult = stableTopologicalOrder(nodes);
  warnings.push(...topoResult.warnings);

  const groups: string[][] = [];
  const assigned = new Set<string>();

  for (const seedId of topoResult.orderedIds) {
    if (assigned.has(seedId)) {
      continue;
    }

    const group: string[] = [seedId];
    assigned.add(seedId);

    while (group.length < request.maxChildrenPerParent) {
      const candidates = topoResult.orderedIds.filter((candidateId) => {
        if (assigned.has(candidateId)) {
          return false;
        }

        const node = nodeMap.get(candidateId) as GroupingNodeInput;
        const prerequisites = (node.prerequisiteIds ?? []).filter((prereqId) => nodeMap.has(prereqId));
        return prerequisites.every((prereqId) => assigned.has(prereqId) || group.includes(prereqId));
      });

      if (candidates.length === 0) {
        break;
      }

      const viableCandidates = candidates.filter((candidateId) => {
        const complexities = [...group, candidateId].map((nodeId) => resolveComplexity(nodeMap.get(nodeId), request.targetComplexity));
        return computeComplexitySpread(complexities) <= request.complexityBandWidth;
      });

      if (viableCandidates.length === 0) {
        break;
      }

      const chosenCandidate = chooseCandidate(viableCandidates, group, nodeMap, tokenMap, topoResult.orderIndex, request.targetComplexity);
      group.push(chosenCandidate);
      assigned.add(chosenCandidate);
    }

    groups.push(group);
  }

  const complexitySpreadByGroup = groups.map((group) => {
    const complexities = group.map((nodeId) => resolveComplexity(nodeMap.get(nodeId), request.targetComplexity));
    return computeComplexitySpread(complexities);
  });

  return {
    groups,
    diagnostics: {
      orderedNodeIds: topoResult.orderedIds,
      complexitySpreadByGroup,
      warnings,
    },
  };
}

interface TopologicalResult {
  orderedIds: string[];
  orderIndex: Map<string, number>;
  warnings: GroupingWarning[];
}

function stableTopologicalOrder(nodes: GroupingNodeInput[]): TopologicalResult {
  const nodeIds = nodes.map((node) => node.id);
  const nodeSet = new Set(nodeIds);
  const inDegree = new Map<string, number>(nodeIds.map((id) => [id, 0]));
  const outgoing = new Map<string, string[]>(nodeIds.map((id) => [id, []]));

  for (const node of nodes) {
    const prerequisites = (node.prerequisiteIds ?? []).filter((prereqId) => nodeSet.has(prereqId));
    for (const prerequisiteId of prerequisites) {
      inDegree.set(node.id, (inDegree.get(node.id) as number) + 1);
      (outgoing.get(prerequisiteId) as string[]).push(node.id);
    }
  }

  const ready = nodeIds.filter((id) => (inDegree.get(id) as number) === 0).sort((a, b) => a.localeCompare(b));
  const orderedIds: string[] = [];

  while (ready.length > 0) {
    const id = ready.shift() as string;
    orderedIds.push(id);

    const dependents = (outgoing.get(id) as string[]).slice().sort((a, b) => a.localeCompare(b));
    for (const dependentId of dependents) {
      inDegree.set(dependentId, (inDegree.get(dependentId) as number) - 1);
      if (inDegree.get(dependentId) === 0) {
        insertSorted(ready, dependentId);
      }
    }
  }

  const warnings: GroupingWarning[] = [];
  if (orderedIds.length !== nodeIds.length) {
    const unresolved = nodeIds.filter((id) => !orderedIds.includes(id)).sort((a, b) => a.localeCompare(b));
    warnings.push({
      code: "cycle_detected",
      message: "Prerequisite cycle detected. Falling back to lexical order for unresolved nodes.",
      details: { unresolvedNodeIds: unresolved },
    });
    orderedIds.push(...unresolved);
  }

  const orderIndex = new Map<string, number>();
  for (let index = 0; index < orderedIds.length; index += 1) {
    orderIndex.set(orderedIds[index], index);
  }

  return { orderedIds, orderIndex, warnings };
}

function chooseCandidate(
  candidateIds: string[],
  group: string[],
  nodeMap: Map<string, GroupingNodeInput>,
  tokenMap: Map<string, Set<string>>,
  orderIndex: Map<string, number>,
  targetComplexity: number,
): string {
  const groupComplexities = group.map((id) => resolveComplexity(nodeMap.get(id), targetComplexity));
  const groupAverageComplexity = average(groupComplexities);

  const scored = candidateIds.map((candidateId) => {
    const candidateTokens = tokenMap.get(candidateId) as Set<string>;
    const complexity = resolveComplexity(nodeMap.get(candidateId), targetComplexity);

    let bestSemantic = 0;
    for (const groupId of group) {
      const similarity = jaccardSimilarity(candidateTokens, tokenMap.get(groupId) as Set<string>);
      if (similarity > bestSemantic) {
        bestSemantic = similarity;
      }
    }

    return {
      id: candidateId,
      semanticScore: bestSemantic,
      complexityDelta: Math.abs(complexity - groupAverageComplexity),
      targetDelta: Math.abs(complexity - targetComplexity),
      order: orderIndex.get(candidateId) as number,
      tieBreakHash: stableHash(candidateId),
    };
  });

  scored.sort((a, b) => {
    if (b.semanticScore !== a.semanticScore) {
      return b.semanticScore - a.semanticScore;
    }
    if (a.complexityDelta !== b.complexityDelta) {
      return a.complexityDelta - b.complexityDelta;
    }
    if (a.targetDelta !== b.targetDelta) {
      return a.targetDelta - b.targetDelta;
    }
    if (a.order !== b.order) {
      return a.order - b.order;
    }
    return a.tieBreakHash.localeCompare(b.tieBreakHash);
  });

  return scored[0].id;
}

function normalizeNodes(nodes: GroupingNodeInput[]): GroupingNodeInput[] {
  if (!Array.isArray(nodes) || nodes.length === 0) {
    throw new Error("nodes must contain at least one item.");
  }

  const normalized = nodes.map((node) => {
    const id = node.id.trim();
    const statement = node.statement.trim();
    if (!id) {
      throw new Error("node id must be non-empty.");
    }
    if (!statement) {
      throw new Error(`node statement must be non-empty for id '${id}'.`);
    }

    if (node.complexity !== undefined && (!Number.isFinite(node.complexity) || node.complexity < 1 || node.complexity > 5)) {
      throw new Error(`node complexity must be in [1, 5] for id '${id}'.`);
    }
    if (node.prerequisiteIds !== undefined && !Array.isArray(node.prerequisiteIds)) {
      throw new Error(`node prerequisiteIds must be an array of strings for id '${id}'.`);
    }

    return {
      id,
      statement,
      complexity: node.complexity,
      prerequisiteIds: unique((node.prerequisiteIds ?? []).map((value) => value.trim()).filter((value) => value.length > 0)),
    } satisfies GroupingNodeInput;
  });

  normalized.sort((a, b) => a.id.localeCompare(b.id));

  for (let index = 1; index < normalized.length; index += 1) {
    if (normalized[index - 1].id === normalized[index].id) {
      throw new Error(`node id must be unique: '${normalized[index].id}'.`);
    }
  }

  return normalized;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function tokenize(statement: string): Set<string> {
  const tokens = statement
    .toLowerCase()
    .split(/[^a-z0-9_]+/g)
    .map((value) => value.trim())
    .filter((value) => value.length >= 3)
    .filter((value) => !TOKEN_STOP_WORDS.has(value));
  return new Set(tokens);
}

function jaccardSimilarity(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) {
    return 0;
  }

  let intersection = 0;
  for (const token of left) {
    if (right.has(token)) {
      intersection += 1;
    }
  }

  const union = left.size + right.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function resolveComplexity(node: GroupingNodeInput | undefined, fallback: number): number {
  return node?.complexity ?? fallback;
}

function computeComplexitySpread(values: number[]): number {
  if (values.length <= 1) {
    return 0;
  }
  return Math.max(...values) - Math.min(...values);
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sum = values.reduce((total, value) => total + value, 0);
  return sum / values.length;
}

function insertSorted(values: string[], value: string): void {
  let index = 0;
  while (index < values.length && values[index].localeCompare(value) < 0) {
    index += 1;
  }
  values.splice(index, 0, value);
}

function stableHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
