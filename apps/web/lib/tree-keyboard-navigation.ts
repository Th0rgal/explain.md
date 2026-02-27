export type TreeKeyboardKey =
  | "ArrowUp"
  | "ArrowDown"
  | "ArrowLeft"
  | "ArrowRight"
  | "Home"
  | "End"
  | "PageUp"
  | "PageDown";

export interface TreeKeyboardIndexInput {
  currentIndex: number;
  totalRows: number;
  key: string;
  pageSize: number;
}

export interface TreeKeyboardRow {
  nodeId: string;
  parentId?: string;
  kind: "leaf" | "parent";
  isExpanded: boolean;
}

export type TreeKeyboardIntent =
  | { kind: "set-active-index"; index: number }
  | { kind: "expand"; index: number }
  | { kind: "collapse"; index: number }
  | { kind: "noop"; index: number };

export interface TreeKeyboardIntentInput extends TreeKeyboardIndexInput {
  rows: TreeKeyboardRow[];
}

export interface TreeKeyboardAnnouncementInput {
  action: "active" | "expand" | "collapse";
  statement: string;
  depthFromRoot: number;
  childCount?: number;
}

export function resolveTreeKeyboardIntent(input: TreeKeyboardIntentInput): TreeKeyboardIntent | null {
  const boundedIndex = clamp(input.currentIndex, 0, Math.max(0, input.totalRows - 1));
  const boundedRows = input.rows.slice(0, input.totalRows);
  const activeRow = boundedRows[boundedIndex];
  if (!activeRow) {
    return null;
  }

  if (input.key === "ArrowRight") {
    if (activeRow.kind !== "parent") {
      return { kind: "noop", index: boundedIndex };
    }
    if (!activeRow.isExpanded) {
      return { kind: "expand", index: boundedIndex };
    }
    const nextRow = boundedRows[boundedIndex + 1];
    if (nextRow?.parentId === activeRow.nodeId) {
      return { kind: "set-active-index", index: boundedIndex + 1 };
    }
    return { kind: "noop", index: boundedIndex };
  }

  if (input.key === "ArrowLeft") {
    if (activeRow.kind === "parent" && activeRow.isExpanded) {
      return { kind: "collapse", index: boundedIndex };
    }
    if (!activeRow.parentId) {
      return { kind: "noop", index: boundedIndex };
    }
    const parentIndex = boundedRows.findIndex((row) => row.nodeId === activeRow.parentId);
    if (parentIndex < 0) {
      return { kind: "noop", index: boundedIndex };
    }
    return { kind: "set-active-index", index: parentIndex };
  }

  const verticalIndex = resolveTreeKeyboardIndex(input);
  if (verticalIndex === null) {
    return null;
  }
  return { kind: "set-active-index", index: verticalIndex };
}

export function formatTreeKeyboardAnnouncement(input: TreeKeyboardAnnouncementInput): string {
  const depthLabel = `depth ${Math.max(0, Math.floor(input.depthFromRoot))}`;
  const statement = normalizeWhitespace(input.statement);
  if (input.action === "expand") {
    const boundedChildCount = Math.max(0, Math.floor(input.childCount ?? 0));
    return `Expanded ${statement}; ${depthLabel}; ${boundedChildCount} loaded children.`;
  }
  if (input.action === "collapse") {
    return `Collapsed ${statement}; ${depthLabel}.`;
  }
  return `Active ${statement}; ${depthLabel}.`;
}

export function resolveTreeKeyboardIndex(input: TreeKeyboardIndexInput): number | null {
  if (input.totalRows <= 0) {
    return null;
  }

  const boundedCurrentIndex = clamp(input.currentIndex, 0, input.totalRows - 1);
  const boundedPageSize = Math.max(1, Math.floor(input.pageSize));

  switch (input.key as TreeKeyboardKey) {
    case "ArrowUp":
      return clamp(boundedCurrentIndex - 1, 0, input.totalRows - 1);
    case "ArrowDown":
      return clamp(boundedCurrentIndex + 1, 0, input.totalRows - 1);
    case "Home":
      return 0;
    case "End":
      return input.totalRows - 1;
    case "PageUp":
      return clamp(boundedCurrentIndex - boundedPageSize, 0, input.totalRows - 1);
    case "PageDown":
      return clamp(boundedCurrentIndex + boundedPageSize, 0, input.totalRows - 1);
    default:
      return null;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

function normalizeWhitespace(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\.$/, "");
}
