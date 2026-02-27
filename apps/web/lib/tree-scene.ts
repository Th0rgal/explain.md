import type { PolicyReportResponse, TreeNodeRecord } from "./api-client";

export interface SceneTransformInput {
  rootId: string;
  nodesById: Record<string, TreeNodeRecord>;
  childrenByParentId: Record<
    string,
    {
      childIds: string[];
      totalChildren: number;
      hasMore: boolean;
    }
  >;
  selectedNodeId?: string | null;
  selectedLeafId?: string | null;
  pathNodeIds?: string[];
  configHash: string;
  snapshotHash: string;
  policyReport?: PolicyReportResponse | null;
}

export type SceneNodeStatus =
  | "root"
  | "parent_ok"
  | "unsupported_parent"
  | "prerequisite_violation"
  | "policy_violation"
  | "leaf"
  | "selected"
  | "path";

export interface SceneNodeRecord {
  id: string;
  label: string;
  kind: "leaf" | "parent";
  depth: number;
  parentId?: string;
  childCount: number;
  evidenceCount: number;
  position: { x: number; y: number; z: number };
  status: SceneNodeStatus;
}

export interface SceneEdgeRecord {
  id: string;
  from: string;
  to: string;
  status: "normal" | "policy_violation" | "prerequisite_violation" | "unsupported_parent";
}

export interface SceneTransformOutput {
  sceneHash: string;
  rootId: string;
  nodeCount: number;
  edgeCount: number;
  maxDepth: number;
  diagnostics: Array<{ code: string; message: string }>;
  nodes: SceneNodeRecord[];
  edges: SceneEdgeRecord[];
}

interface TraversalRecord {
  id: string;
  parentId?: string;
  depth: number;
}

export function buildTreeScene(input: SceneTransformInput): SceneTransformOutput {
  const rootNode = input.nodesById[input.rootId];
  if (!rootNode) {
    const emptyHash = hashStable({
      rootId: input.rootId,
      configHash: input.configHash,
      snapshotHash: input.snapshotHash,
      reason: "missing_root",
    });
    return {
      sceneHash: emptyHash,
      rootId: input.rootId,
      nodeCount: 0,
      edgeCount: 0,
      maxDepth: 0,
      diagnostics: [{ code: "missing_root", message: `Root node '${input.rootId}' is not loaded.` }],
      nodes: [],
      edges: [],
    };
  }

  const parentSampleById = new Map(
    (input.policyReport?.report.parentSamples ?? []).map((sample) => [sample.parentId, sample] as const),
  );
  const pathSet = new Set(input.pathNodeIds ?? []);
  const visited = new Set<string>();
  const traversal: TraversalRecord[] = [];
  const edges: SceneEdgeRecord[] = [];
  const depthOrder = new Map<number, string[]>();
  const queue: TraversalRecord[] = [{ id: rootNode.id, depth: 0 }];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || visited.has(current.id)) {
      continue;
    }
    visited.add(current.id);
    traversal.push(current);

    const level = depthOrder.get(current.depth) ?? [];
    level.push(current.id);
    depthOrder.set(current.depth, level);

    const node = input.nodesById[current.id];
    if (!node || node.kind !== "parent") {
      continue;
    }

    const childrenState = input.childrenByParentId[current.id];
    const childIds = childrenState ? [...childrenState.childIds] : [...node.childIds];

    for (const childId of childIds) {
      const child = input.nodesById[childId];
      if (!child) {
        continue;
      }

      const childStatus = inferNodeStatus({
        node: child,
        isRoot: false,
        isSelected: child.id === input.selectedNodeId || child.id === input.selectedLeafId,
        inPath: pathSet.has(child.id),
        parentSampleById,
      });

      edges.push({
        id: `${current.id}->${child.id}`,
        from: current.id,
        to: child.id,
        status: mapEdgeStatus(childStatus),
      });

      queue.push({
        id: child.id,
        parentId: current.id,
        depth: current.depth + 1,
      });
    }
  }

  const maxDepth = traversal.reduce((max, current) => Math.max(max, current.depth), 0);
  const nodes = traversal.map((record) => {
    const node = input.nodesById[record.id] as TreeNodeRecord;
    const layerIds = depthOrder.get(record.depth) ?? [record.id];
    const indexAtDepth = layerIds.indexOf(record.id);
    const x = (indexAtDepth - (layerIds.length - 1) / 2) * 7.2;
    const y = -record.depth * 5.6;
    const z = deterministicJitter(record.id, input.snapshotHash) * 1.8;
    return {
      id: node.id,
      label: node.statement,
      kind: node.kind,
      depth: record.depth,
      parentId: record.parentId,
      childCount: node.childIds.length,
      evidenceCount: node.evidenceRefs.length,
      position: { x: round3(x), y: round3(y), z: round3(z) },
      status: inferNodeStatus({
        node,
        isRoot: node.id === input.rootId,
        isSelected: node.id === input.selectedNodeId || node.id === input.selectedLeafId,
        inPath: pathSet.has(node.id),
        parentSampleById,
      }),
    } satisfies SceneNodeRecord;
  });

  const scenePayload = {
    rootId: input.rootId,
    configHash: input.configHash,
    snapshotHash: input.snapshotHash,
    nodes,
    edges,
  };

  return {
    sceneHash: hashStable(scenePayload),
    rootId: input.rootId,
    nodeCount: nodes.length,
    edgeCount: edges.length,
    maxDepth,
    diagnostics: [],
    nodes,
    edges,
  };
}

function inferNodeStatus(input: {
  node: TreeNodeRecord;
  isRoot: boolean;
  isSelected: boolean;
  inPath: boolean;
  parentSampleById: Map<string, PolicyReportResponse["report"]["parentSamples"][number]>;
}): SceneNodeStatus {
  if (input.isSelected) {
    return "selected";
  }
  if (input.inPath) {
    return "path";
  }
  if (input.isRoot) {
    return "root";
  }
  if (input.node.kind === "leaf") {
    return "leaf";
  }

  const sample = input.parentSampleById.get(input.node.id);
  if (sample) {
    if (sample.supportedClaimRatio < 1) {
      return "unsupported_parent";
    }
    if (sample.prerequisiteOrderViolations > 0) {
      return "prerequisite_violation";
    }
    if (sample.policyViolationCount > 0) {
      return "policy_violation";
    }
    return "parent_ok";
  }

  if (input.node.policyDiagnostics?.postSummary.ok === false) {
    if (input.node.policyDiagnostics.postSummary.metrics.prerequisiteOrderViolations > 0) {
      return "prerequisite_violation";
    }
    return "policy_violation";
  }

  return "parent_ok";
}

function mapEdgeStatus(status: SceneNodeStatus): SceneEdgeRecord["status"] {
  if (status === "unsupported_parent") {
    return "unsupported_parent";
  }
  if (status === "prerequisite_violation") {
    return "prerequisite_violation";
  }
  if (status === "policy_violation") {
    return "policy_violation";
  }
  return "normal";
}

function deterministicJitter(nodeId: string, seed: string): number {
  const hash = fnv1a(`${seed}:${nodeId}`);
  return (hash % 1000) / 1000 - 0.5;
}

function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash +=
      (hash << 1) +
      (hash << 4) +
      (hash << 7) +
      (hash << 8) +
      (hash << 24);
  }
  return hash >>> 0;
}

function hashStable(value: unknown): string {
  return fnv1a(JSON.stringify(value)).toString(16).padStart(8, "0");
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function isWholeTreeLoaded(
  rootId: string,
  nodesById: Record<string, TreeNodeRecord>,
  childrenByParentId: Record<string, { childIds: string[]; totalChildren: number; hasMore: boolean }>,
): boolean {
  const root = nodesById[rootId];
  if (!root) {
    return false;
  }
  if (root.kind === "leaf") {
    return true;
  }

  const queue: string[] = [rootId];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const nodeId = queue.shift() as string;
    if (visited.has(nodeId)) {
      continue;
    }
    visited.add(nodeId);

    const node = nodesById[nodeId];
    if (!node || node.kind !== "parent") {
      continue;
    }

    const childrenState = childrenByParentId[nodeId];
    if (!childrenState || childrenState.hasMore || childrenState.childIds.length < childrenState.totalChildren) {
      return false;
    }

    for (const childId of childrenState.childIds) {
      if (!nodesById[childId]) {
        return false;
      }
      if (nodesById[childId].kind === "parent") {
        queue.push(childId);
      }
    }
  }

  return true;
}
