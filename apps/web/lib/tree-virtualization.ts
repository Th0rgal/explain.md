export interface TreeVirtualizationSettings {
  enabled: boolean;
  minRows: number;
  rowHeightPx: number;
  viewportRows: number;
  overscanRows: number;
}

export interface TreeVirtualizationPlanInput {
  totalRowCount: number;
  scrollTopPx: number;
  settings: TreeVirtualizationSettings;
}

export interface TreeVirtualizationPlan {
  mode: "full" | "virtualized";
  startIndex: number;
  endIndex: number;
  renderedRowCount: number;
  hiddenAboveCount: number;
  hiddenBelowCount: number;
  topSpacerHeightPx: number;
  bottomSpacerHeightPx: number;
  viewportHeightPx: number;
  clampedScrollTopPx: number;
  maxScrollTopPx: number;
}

const DEFAULT_MIN_ROWS = 400;
const DEFAULT_ROW_HEIGHT_PX = 36;
const DEFAULT_VIEWPORT_ROWS = 18;
const DEFAULT_OVERSCAN_ROWS = 6;

function normalizeNonNegativeInteger(value: unknown, fallback: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.max(0, Math.trunc(numeric));
}

function normalizePositiveInteger(value: unknown, fallback: number): number {
  return Math.max(1, normalizeNonNegativeInteger(value, fallback));
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }
  const normalized = String(value).trim().toLowerCase();
  if (normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on") {
    return true;
  }
  if (normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off") {
    return false;
  }
  return fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function resolveTreeVirtualizationSettings(env: Record<string, string | undefined>): TreeVirtualizationSettings {
  return {
    enabled: normalizeBoolean(env.NEXT_PUBLIC_EXPLAIN_MD_TREE_VIRTUALIZATION_ENABLED, true),
    minRows: normalizePositiveInteger(env.NEXT_PUBLIC_EXPLAIN_MD_TREE_VIRTUALIZATION_MIN_ROWS, DEFAULT_MIN_ROWS),
    rowHeightPx: normalizePositiveInteger(env.NEXT_PUBLIC_EXPLAIN_MD_TREE_ROW_HEIGHT_PX, DEFAULT_ROW_HEIGHT_PX),
    viewportRows: normalizePositiveInteger(env.NEXT_PUBLIC_EXPLAIN_MD_TREE_VIEWPORT_ROWS, DEFAULT_VIEWPORT_ROWS),
    overscanRows: normalizeNonNegativeInteger(
      env.NEXT_PUBLIC_EXPLAIN_MD_TREE_VIRTUALIZATION_OVERSCAN_ROWS,
      DEFAULT_OVERSCAN_ROWS,
    ),
  };
}

export function planTreeVirtualizationWindow(input: TreeVirtualizationPlanInput): TreeVirtualizationPlan {
  const totalRowCount = Math.max(0, Math.trunc(input.totalRowCount));
  const settings = input.settings;
  const viewportHeightPx = settings.viewportRows * settings.rowHeightPx;

  if (!settings.enabled || totalRowCount < settings.minRows) {
    return {
      mode: "full",
      startIndex: 0,
      endIndex: totalRowCount > 0 ? totalRowCount - 1 : -1,
      renderedRowCount: totalRowCount,
      hiddenAboveCount: 0,
      hiddenBelowCount: 0,
      topSpacerHeightPx: 0,
      bottomSpacerHeightPx: 0,
      viewportHeightPx,
      clampedScrollTopPx: 0,
      maxScrollTopPx: 0,
    };
  }

  const maxScrollTopPx = Math.max(0, totalRowCount * settings.rowHeightPx - viewportHeightPx);
  const clampedScrollTopPx = clamp(Math.trunc(input.scrollTopPx), 0, maxScrollTopPx);

  const viewportStartRow = Math.floor(clampedScrollTopPx / settings.rowHeightPx);
  const viewportEndRow = Math.min(totalRowCount - 1, viewportStartRow + settings.viewportRows - 1);
  const startIndex = Math.max(0, viewportStartRow - settings.overscanRows);
  const endIndex = Math.min(totalRowCount - 1, viewportEndRow + settings.overscanRows);

  return {
    mode: "virtualized",
    startIndex,
    endIndex,
    renderedRowCount: endIndex - startIndex + 1,
    hiddenAboveCount: startIndex,
    hiddenBelowCount: totalRowCount - endIndex - 1,
    topSpacerHeightPx: startIndex * settings.rowHeightPx,
    bottomSpacerHeightPx: Math.max(0, totalRowCount - endIndex - 1) * settings.rowHeightPx,
    viewportHeightPx,
    clampedScrollTopPx,
    maxScrollTopPx,
  };
}

export function resolveVirtualScrollTopForRowIndex(
  currentScrollTopPx: number,
  targetRowIndex: number,
  totalRowCount: number,
  settings: TreeVirtualizationSettings,
): number {
  const clampedTargetIndex = clamp(Math.trunc(targetRowIndex), 0, Math.max(0, totalRowCount - 1));
  const viewportHeightPx = settings.viewportRows * settings.rowHeightPx;
  const maxScrollTopPx = Math.max(0, totalRowCount * settings.rowHeightPx - viewportHeightPx);
  const clampedCurrentScrollTopPx = clamp(Math.trunc(currentScrollTopPx), 0, maxScrollTopPx);

  const startRow = Math.floor(clampedCurrentScrollTopPx / settings.rowHeightPx);
  const endRow = Math.min(totalRowCount - 1, startRow + settings.viewportRows - 1);

  if (clampedTargetIndex < startRow) {
    return clamp(clampedTargetIndex * settings.rowHeightPx, 0, maxScrollTopPx);
  }
  if (clampedTargetIndex > endRow) {
    const nextTop = (clampedTargetIndex - settings.viewportRows + 1) * settings.rowHeightPx;
    return clamp(nextTop, 0, maxScrollTopPx);
  }
  return clampedCurrentScrollTopPx;
}
