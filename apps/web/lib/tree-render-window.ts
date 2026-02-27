export interface TreeRenderWindowInput {
  totalRowCount: number;
  anchorRowIndex: number;
  maxVisibleRows: number;
  overscanRows: number;
}

export interface TreeRenderWindowPlan {
  mode: "full" | "windowed";
  startIndex: number;
  endIndex: number;
  renderedRowCount: number;
  hiddenAboveCount: number;
  hiddenBelowCount: number;
}

export interface TreeRenderSettings {
  maxVisibleRows: number;
  overscanRows: number;
}

const DEFAULT_MAX_VISIBLE_ROWS = 120;
const DEFAULT_OVERSCAN_ROWS = 24;

function normalizeNonNegativeInteger(value: unknown, fallback: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.max(0, Math.trunc(numeric));
}

function normalizePositiveInteger(value: unknown, fallback: number): number {
  const normalized = normalizeNonNegativeInteger(value, fallback);
  return Math.max(1, normalized);
}

function clampRowIndex(index: number, totalRowCount: number): number {
  if (totalRowCount <= 0) {
    return 0;
  }
  return Math.min(Math.max(index, 0), totalRowCount - 1);
}

export function resolveTreeRenderSettings(env: Record<string, string | undefined>): TreeRenderSettings {
  return {
    maxVisibleRows: normalizePositiveInteger(env.NEXT_PUBLIC_EXPLAIN_MD_TREE_RENDER_MAX_ROWS, DEFAULT_MAX_VISIBLE_ROWS),
    overscanRows: normalizeNonNegativeInteger(env.NEXT_PUBLIC_EXPLAIN_MD_TREE_RENDER_OVERSCAN_ROWS, DEFAULT_OVERSCAN_ROWS),
  };
}

export function planTreeRenderWindow(input: TreeRenderWindowInput): TreeRenderWindowPlan {
  const totalRowCount = Math.max(0, Math.trunc(input.totalRowCount));
  const maxVisibleRows = normalizePositiveInteger(input.maxVisibleRows, DEFAULT_MAX_VISIBLE_ROWS);
  const overscanRows = normalizeNonNegativeInteger(input.overscanRows, DEFAULT_OVERSCAN_ROWS);

  if (totalRowCount === 0) {
    return {
      mode: "full",
      startIndex: 0,
      endIndex: -1,
      renderedRowCount: 0,
      hiddenAboveCount: 0,
      hiddenBelowCount: 0,
    };
  }

  if (totalRowCount <= maxVisibleRows) {
    return {
      mode: "full",
      startIndex: 0,
      endIndex: totalRowCount - 1,
      renderedRowCount: totalRowCount,
      hiddenAboveCount: 0,
      hiddenBelowCount: 0,
    };
  }

  const anchorRowIndex = clampRowIndex(Math.trunc(input.anchorRowIndex), totalRowCount);
  const halfVisible = Math.floor(maxVisibleRows / 2);
  const unclampedStart = anchorRowIndex - halfVisible;
  const coreStart = Math.min(Math.max(0, unclampedStart), totalRowCount - maxVisibleRows);
  const coreEnd = coreStart + maxVisibleRows - 1;

  const startIndex = Math.max(0, coreStart - overscanRows);
  const endIndex = Math.min(totalRowCount - 1, coreEnd + overscanRows);

  return {
    mode: "windowed",
    startIndex,
    endIndex,
    renderedRowCount: endIndex - startIndex + 1,
    hiddenAboveCount: startIndex,
    hiddenBelowCount: totalRowCount - endIndex - 1,
  };
}
