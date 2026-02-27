export interface TreeAccessibilityRow {
  nodeId: string;
  parentId?: string;
  depthFromRoot: number;
}

export interface TreeAccessibilityNodeMetadata {
  level: number;
  posInSet: number;
  setSize: number;
}

export interface TreeAccessibilityMetadata {
  byNodeId: Record<string, TreeAccessibilityNodeMetadata>;
}

export function buildTreeAccessibilityMetadata(
  rows: TreeAccessibilityRow[],
  options?: {
    orderedChildIdsByParentId?: Record<string, string[]>;
    totalChildrenByParentId?: Record<string, number>;
  },
): TreeAccessibilityMetadata {
  const siblingBuckets = new Map<string, string[]>();
  for (const row of rows) {
    const bucketKey = row.parentId ?? "__root__";
    const siblingIds = siblingBuckets.get(bucketKey) ?? [];
    siblingIds.push(row.nodeId);
    siblingBuckets.set(bucketKey, siblingIds);
  }

  const byNodeId: Record<string, TreeAccessibilityNodeMetadata> = {};
  for (const row of rows) {
    const fallbackSiblingIds = siblingBuckets.get(row.parentId ?? "__root__") ?? [row.nodeId];
    const orderedSiblingIds = resolveOrderedSiblings(row.parentId, fallbackSiblingIds, options?.orderedChildIdsByParentId);
    const fallbackPos = Math.max(0, fallbackSiblingIds.indexOf(row.nodeId));
    const orderedPos = orderedSiblingIds.indexOf(row.nodeId);
    const posInSet = (orderedPos >= 0 ? orderedPos : fallbackPos) + 1;
    const fallbackSetSize = Math.max(1, orderedSiblingIds.length || fallbackSiblingIds.length);
    const configuredSetSize = row.parentId ? options?.totalChildrenByParentId?.[row.parentId] : undefined;
    const setSize = Math.max(1, configuredSetSize ?? fallbackSetSize);

    byNodeId[row.nodeId] = {
      level: Math.max(1, Math.floor(row.depthFromRoot) + 1),
      posInSet,
      setSize,
    };
  }

  return { byNodeId };
}

function resolveOrderedSiblings(
  parentId: string | undefined,
  fallbackSiblingIds: string[],
  orderedChildIdsByParentId: Record<string, string[]> | undefined,
): string[] {
  if (!parentId) {
    return fallbackSiblingIds;
  }
  const orderedChildren = orderedChildIdsByParentId?.[parentId];
  if (!orderedChildren || orderedChildren.length === 0) {
    return fallbackSiblingIds;
  }
  const siblingSet = new Set(fallbackSiblingIds);
  const orderedVisible = orderedChildren.filter((nodeId) => siblingSet.has(nodeId));
  if (orderedVisible.length === 0) {
    return fallbackSiblingIds;
  }
  return orderedVisible;
}
