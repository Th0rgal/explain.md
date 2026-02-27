export type TreeKeyboardKey = "ArrowUp" | "ArrowDown" | "Home" | "End" | "PageUp" | "PageDown";

export interface TreeKeyboardIndexInput {
  currentIndex: number;
  totalRows: number;
  key: string;
  pageSize: number;
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
