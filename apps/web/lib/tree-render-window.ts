export interface TreeRenderWindowInput {
  totalRowCount: number;
  anchorRowIndex: number | null;
  maxVisibleRows: number;
  overscanRows: number;
}

export interface TreeRenderWindow {
  mode: "full" | "windowed";
  anchorRowIndex: number;
  startIndex: number;
  endIndex: number;
  renderedRowCount: number;
  hiddenAboveCount: number;
  hiddenBelowCount: number;
}

function toPositiveInteger(value: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  const rounded = Math.floor(value);
  return rounded > 0 ? rounded : fallback;
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}

export function computeTreeRenderWindow(input: TreeRenderWindowInput): TreeRenderWindow {
  const totalRowCount = Math.max(0, Math.floor(input.totalRowCount));
  if (totalRowCount === 0) {
    return {
      mode: "full",
      anchorRowIndex: 0,
      startIndex: 0,
      endIndex: 0,
      renderedRowCount: 0,
      hiddenAboveCount: 0,
      hiddenBelowCount: 0,
    };
  }

  const maxVisibleRows = toPositiveInteger(input.maxVisibleRows, 120);
  const overscanRows = Number.isFinite(input.overscanRows) ? Math.max(0, Math.floor(input.overscanRows)) : 0;
  const clampedAnchor = clamp(input.anchorRowIndex ?? 0, 0, totalRowCount - 1);
  const coreWindowSize = Math.min(totalRowCount, maxVisibleRows);
  const coreStart = clamp(clampedAnchor - Math.floor(coreWindowSize / 2), 0, totalRowCount - coreWindowSize);
  const startIndex = Math.max(0, coreStart - overscanRows);
  const endIndex = Math.min(totalRowCount, coreStart + coreWindowSize + overscanRows);
  const renderedRowCount = endIndex - startIndex;

  return {
    mode: renderedRowCount < totalRowCount ? "windowed" : "full",
    anchorRowIndex: clampedAnchor,
    startIndex,
    endIndex,
    renderedRowCount,
    hiddenAboveCount: startIndex,
    hiddenBelowCount: totalRowCount - endIndex,
  };
}
