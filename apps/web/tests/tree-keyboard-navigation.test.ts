import { describe, expect, it } from "vitest";
import { resolveTreeKeyboardIndex } from "../lib/tree-keyboard-navigation";

describe("tree keyboard navigation", () => {
  it("returns null for unsupported key", () => {
    expect(
      resolveTreeKeyboardIndex({
        currentIndex: 2,
        totalRows: 10,
        key: "Enter",
        pageSize: 4,
      }),
    ).toBeNull();
  });

  it("handles empty row sets", () => {
    expect(
      resolveTreeKeyboardIndex({
        currentIndex: 0,
        totalRows: 0,
        key: "ArrowDown",
        pageSize: 10,
      }),
    ).toBeNull();
  });

  it("moves by one row for arrow keys with clamping", () => {
    expect(
      resolveTreeKeyboardIndex({
        currentIndex: 0,
        totalRows: 4,
        key: "ArrowUp",
        pageSize: 10,
      }),
    ).toBe(0);
    expect(
      resolveTreeKeyboardIndex({
        currentIndex: 3,
        totalRows: 4,
        key: "ArrowDown",
        pageSize: 10,
      }),
    ).toBe(3);
    expect(
      resolveTreeKeyboardIndex({
        currentIndex: 1,
        totalRows: 4,
        key: "ArrowDown",
        pageSize: 10,
      }),
    ).toBe(2);
  });

  it("jumps to boundaries with home and end", () => {
    expect(
      resolveTreeKeyboardIndex({
        currentIndex: 2,
        totalRows: 7,
        key: "Home",
        pageSize: 10,
      }),
    ).toBe(0);
    expect(
      resolveTreeKeyboardIndex({
        currentIndex: 2,
        totalRows: 7,
        key: "End",
        pageSize: 10,
      }),
    ).toBe(6);
  });

  it("moves by deterministic page size for page keys", () => {
    expect(
      resolveTreeKeyboardIndex({
        currentIndex: 9,
        totalRows: 50,
        key: "PageDown",
        pageSize: 12,
      }),
    ).toBe(21);
    expect(
      resolveTreeKeyboardIndex({
        currentIndex: 9,
        totalRows: 50,
        key: "PageUp",
        pageSize: 12,
      }),
    ).toBe(0);
  });
});
