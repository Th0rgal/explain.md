export interface KeyboardTreeRow {
  nodeId: string;
  nodeKind: "leaf" | "parent";
  parentId?: string;
  isExpanded: boolean;
  loadedChildIds: string[];
}

export type TreeKeyboardIntent =
  | { kind: "move_focus"; nodeId: string }
  | { kind: "set_expanded"; nodeId: string; expanded: boolean }
  | { kind: "activate_leaf"; nodeId: string }
  | { kind: "clear_leaf_selection" }
  | { kind: "noop" };

function isActivationKey(key: string): boolean {
  return key === "Enter" || key === " ";
}

export function resolveTreeKeyboardIntent(key: string, focusedNodeId: string | null, rows: KeyboardTreeRow[]): TreeKeyboardIntent {
  if (!focusedNodeId || rows.length === 0) {
    return { kind: "noop" };
  }

  const rowIndex = rows.findIndex((row) => row.nodeId === focusedNodeId);
  if (rowIndex < 0) {
    return { kind: "noop" };
  }

  const row = rows[rowIndex];
  if (!row) {
    return { kind: "noop" };
  }

  if (key === "ArrowDown") {
    const next = rows[rowIndex + 1];
    return next ? { kind: "move_focus", nodeId: next.nodeId } : { kind: "noop" };
  }

  if (key === "ArrowUp") {
    const prev = rows[rowIndex - 1];
    return prev ? { kind: "move_focus", nodeId: prev.nodeId } : { kind: "noop" };
  }

  if (key === "Home") {
    return { kind: "move_focus", nodeId: rows[0]?.nodeId ?? focusedNodeId };
  }

  if (key === "End") {
    return { kind: "move_focus", nodeId: rows[rows.length - 1]?.nodeId ?? focusedNodeId };
  }

  if (key === "ArrowRight") {
    if (row.nodeKind !== "parent") {
      return { kind: "noop" };
    }
    if (!row.isExpanded) {
      return { kind: "set_expanded", nodeId: row.nodeId, expanded: true };
    }
    const firstChildId = row.loadedChildIds[0];
    return firstChildId ? { kind: "move_focus", nodeId: firstChildId } : { kind: "noop" };
  }

  if (key === "ArrowLeft") {
    if (row.nodeKind === "parent" && row.isExpanded) {
      return { kind: "set_expanded", nodeId: row.nodeId, expanded: false };
    }
    return row.parentId ? { kind: "move_focus", nodeId: row.parentId } : { kind: "noop" };
  }

  if (isActivationKey(key)) {
    if (row.nodeKind === "leaf") {
      return { kind: "activate_leaf", nodeId: row.nodeId };
    }
    return { kind: "clear_leaf_selection" };
  }

  return { kind: "noop" };
}
