import { createHash } from "node:crypto";
import type { TheoremLeafRecord } from "./leaf-schema.js";

export const DEPENDENCY_GRAPH_SCHEMA_VERSION = "1.0.0";

export type DependencyNodeCategory = "indexed" | "external";

export interface DependencyDeclarationRecord {
  id: string;
  dependencyIds?: string[];
}

export interface MissingDependencyRef {
  declarationId: string;
  dependencyId: string;
}

export interface DependencyGraphNode {
  id: string;
  category: DependencyNodeCategory;
  dependencyIds: string[];
  dependentIds: string[];
}

export interface DependencyGraph {
  schemaVersion: string;
  nodeIds: string[];
  nodes: Record<string, DependencyGraphNode>;
  edgeCount: number;
  indexedNodeCount: number;
  externalNodeCount: number;
  missingDependencyRefs: MissingDependencyRef[];
  sccs: string[][];
  cyclicSccs: string[][];
}

export interface DependencyGraphBuildOptions {
  includeExternalNodes?: boolean;
}

export interface SupportQueryOptions {
  includeExternal?: boolean;
}

interface NormalizedDeclarationRecord {
  id: string;
  dependencyIds: string[];
}

export function buildDependencyGraphFromTheoremLeaves(
  leaves: TheoremLeafRecord[],
  options: DependencyGraphBuildOptions = {},
): DependencyGraph {
  return buildDeclarationDependencyGraph(
    leaves.map((leaf) => ({
      id: leaf.id,
      dependencyIds: leaf.dependencyIds,
    })),
    options,
  );
}

export function buildDeclarationDependencyGraph(
  declarations: DependencyDeclarationRecord[],
  options: DependencyGraphBuildOptions = {},
): DependencyGraph {
  const includeExternalNodes = options.includeExternalNodes ?? true;
  const normalized = normalizeDeclarationRecords(declarations);

  const indexedIds = normalized.map((record) => record.id);
  const indexedIdSet = new Set(indexedIds);
  const nodes = new Map<string, DependencyGraphNode>();

  for (const record of normalized) {
    nodes.set(record.id, {
      id: record.id,
      category: "indexed",
      dependencyIds: [],
      dependentIds: [],
    });
  }

  const missingDependencyRefs: MissingDependencyRef[] = [];
  let edgeCount = 0;

  for (const record of normalized) {
    const fromNode = nodes.get(record.id) as DependencyGraphNode;

    for (const dependencyId of record.dependencyIds) {
      const dependencyIsIndexed = indexedIdSet.has(dependencyId);
      if (!dependencyIsIndexed) {
        missingDependencyRefs.push({ declarationId: record.id, dependencyId });
        if (!includeExternalNodes) {
          continue;
        }
        if (!nodes.has(dependencyId)) {
          nodes.set(dependencyId, {
            id: dependencyId,
            category: "external",
            dependencyIds: [],
            dependentIds: [],
          });
        }
      }

      fromNode.dependencyIds.push(dependencyId);
      const dependencyNode = nodes.get(dependencyId) as DependencyGraphNode;
      dependencyNode.dependentIds.push(record.id);
      edgeCount += 1;
    }
  }

  const nodeIds = [...nodes.keys()].sort((left, right) => left.localeCompare(right));
  for (const nodeId of nodeIds) {
    const node = nodes.get(nodeId) as DependencyGraphNode;
    node.dependencyIds = uniqueSorted(node.dependencyIds);
    node.dependentIds = uniqueSorted(node.dependentIds);
  }

  const graphNodes: Record<string, DependencyGraphNode> = {};
  for (const nodeId of nodeIds) {
    graphNodes[nodeId] = nodes.get(nodeId) as DependencyGraphNode;
  }

  const sccs = computeStronglyConnectedComponents(graphNodes, nodeIds);
  const cyclicSccs = sccs.filter((component) => {
    if (component.length > 1) {
      return true;
    }
    const single = component[0];
    return graphNodes[single].dependencyIds.includes(single);
  });

  return {
    schemaVersion: DEPENDENCY_GRAPH_SCHEMA_VERSION,
    nodeIds,
    nodes: graphNodes,
    edgeCount,
    indexedNodeCount: nodeIds.filter((nodeId) => graphNodes[nodeId].category === "indexed").length,
    externalNodeCount: nodeIds.filter((nodeId) => graphNodes[nodeId].category === "external").length,
    missingDependencyRefs: missingDependencyRefs
      .map((ref) => ({ declarationId: ref.declarationId, dependencyId: ref.dependencyId }))
      .sort((left, right) => {
        if (left.declarationId !== right.declarationId) {
          return left.declarationId.localeCompare(right.declarationId);
        }
        return left.dependencyId.localeCompare(right.dependencyId);
      }),
    sccs,
    cyclicSccs,
  };
}

export function getDirectDependencies(graph: DependencyGraph, declarationId: string): string[] {
  const node = graph.nodes[declarationId];
  if (!node) {
    throw new Error(`Declaration '${declarationId}' is not present in dependency graph.`);
  }
  return node.dependencyIds.slice();
}

export function getDirectDependents(graph: DependencyGraph, declarationId: string): string[] {
  const node = graph.nodes[declarationId];
  if (!node) {
    throw new Error(`Declaration '${declarationId}' is not present in dependency graph.`);
  }
  return node.dependentIds.slice();
}

export function getSupportingDeclarations(
  graph: DependencyGraph,
  declarationId: string,
  options: SupportQueryOptions = {},
): string[] {
  const includeExternal = options.includeExternal ?? true;
  const root = graph.nodes[declarationId];
  if (!root) {
    throw new Error(`Declaration '${declarationId}' is not present in dependency graph.`);
  }

  const state = new Map<string, "visiting" | "done">();
  const ordered: string[] = [];

  const visit = (nodeId: string): void => {
    const node = graph.nodes[nodeId];
    if (!node) {
      return;
    }

    const current = state.get(nodeId);
    if (current === "done" || current === "visiting") {
      return;
    }

    state.set(nodeId, "visiting");

    for (const dependencyId of node.dependencyIds) {
      const dependency = graph.nodes[dependencyId];
      if (!dependency) {
        continue;
      }
      if (!includeExternal && dependency.category === "external") {
        continue;
      }
      visit(dependencyId);
    }

    state.set(nodeId, "done");

    if (nodeId !== declarationId) {
      if (includeExternal || node.category === "indexed") {
        ordered.push(nodeId);
      }
    }
  };

  visit(declarationId);
  return ordered;
}

export function renderDependencyGraphCanonical(graph: DependencyGraph): string {
  const lines: string[] = [
    `schema=${graph.schemaVersion}`,
    `nodes=${graph.nodeIds.length}`,
    `edges=${graph.edgeCount}`,
    `indexed=${graph.indexedNodeCount}`,
    `external=${graph.externalNodeCount}`,
    `missing_refs=${graph.missingDependencyRefs.length}`,
  ];

  for (const nodeId of graph.nodeIds) {
    const node = graph.nodes[nodeId];
    const dependencies = node.dependencyIds.length > 0 ? node.dependencyIds.join(",") : "none";
    const dependents = node.dependentIds.length > 0 ? node.dependentIds.join(",") : "none";
    lines.push(`node=${node.id}|category=${node.category}|deps=${dependencies}|dependents=${dependents}`);
  }

  for (let index = 0; index < graph.sccs.length; index += 1) {
    lines.push(`scc[${index}]=${graph.sccs[index].join(",")}`);
  }

  for (let index = 0; index < graph.cyclicSccs.length; index += 1) {
    lines.push(`cyclic_scc[${index}]=${graph.cyclicSccs[index].join(",")}`);
  }

  return lines.join("\n");
}

export function computeDependencyGraphHash(graph: DependencyGraph): string {
  const canonical = renderDependencyGraphCanonical(graph);
  return createHash("sha256").update(canonical).digest("hex");
}

function normalizeDeclarationRecords(declarations: DependencyDeclarationRecord[]): NormalizedDeclarationRecord[] {
  if (!Array.isArray(declarations) || declarations.length === 0) {
    throw new Error("declarations must contain at least one item.");
  }

  const seen = new Set<string>();

  const normalized = declarations.map((declaration) => {
    const id = normalizeRequired(declaration.id, "id");
    if (seen.has(id)) {
      throw new Error(`Duplicate declaration id '${id}'.`);
    }
    seen.add(id);

    const dependencyIds = uniqueSorted(
      (declaration.dependencyIds ?? []).map((dependencyId) => normalizeRequired(dependencyId, `dependencyId(${id})`)),
    );

    return {
      id,
      dependencyIds,
    };
  });

  return normalized.sort((left, right) => left.id.localeCompare(right.id));
}

function computeStronglyConnectedComponents(
  nodes: Record<string, DependencyGraphNode>,
  orderedNodeIds: string[],
): string[][] {
  let index = 0;
  const stack: string[] = [];
  const inStack = new Set<string>();
  const indexByNode = new Map<string, number>();
  const lowLinkByNode = new Map<string, number>();
  const components: string[][] = [];

  const strongConnect = (nodeId: string): void => {
    indexByNode.set(nodeId, index);
    lowLinkByNode.set(nodeId, index);
    index += 1;

    stack.push(nodeId);
    inStack.add(nodeId);

    const dependencies = nodes[nodeId].dependencyIds.slice().sort((left, right) => left.localeCompare(right));
    for (const dependencyId of dependencies) {
      if (!(dependencyId in nodes)) {
        continue;
      }

      if (!indexByNode.has(dependencyId)) {
        strongConnect(dependencyId);
        lowLinkByNode.set(
          nodeId,
          Math.min(lowLinkByNode.get(nodeId) as number, lowLinkByNode.get(dependencyId) as number),
        );
      } else if (inStack.has(dependencyId)) {
        lowLinkByNode.set(
          nodeId,
          Math.min(lowLinkByNode.get(nodeId) as number, indexByNode.get(dependencyId) as number),
        );
      }
    }

    if (lowLinkByNode.get(nodeId) === indexByNode.get(nodeId)) {
      const component: string[] = [];
      while (stack.length > 0) {
        const current = stack.pop() as string;
        inStack.delete(current);
        component.push(current);
        if (current === nodeId) {
          break;
        }
      }
      component.sort((left, right) => left.localeCompare(right));
      components.push(component);
    }
  };

  for (const nodeId of orderedNodeIds) {
    if (!indexByNode.has(nodeId)) {
      strongConnect(nodeId);
    }
  }

  return components.sort(compareStringArrays);
}

function compareStringArrays(left: string[], right: string[]): number {
  const leftKey = left.join("\u0000");
  const rightKey = right.join("\u0000");
  return leftKey.localeCompare(rightKey);
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function normalizeRequired(value: string, field: string): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error(`${field} must be non-empty.`);
  }
  return normalized;
}
