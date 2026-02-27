import { describe, expect, it } from "vitest";
import {
  formatTreeKeyboardAnnouncement,
  resolveTreeKeyboardIndex,
  resolveTreeKeyboardIntent,
} from "../lib/tree-keyboard-navigation";

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

  it("expands a collapsed parent on arrow-right", () => {
    expect(
      resolveTreeKeyboardIntent({
        currentIndex: 0,
        totalRows: 2,
        key: "ArrowRight",
        pageSize: 10,
        rows: [
          { nodeId: "parent-1", kind: "parent", isExpanded: false },
          { nodeId: "leaf-1", kind: "leaf", parentId: "parent-1", isExpanded: false },
        ],
      }),
    ).toEqual({ kind: "expand", index: 0 });
  });

  it("moves to first visible child on arrow-right when parent is expanded", () => {
    expect(
      resolveTreeKeyboardIntent({
        currentIndex: 0,
        totalRows: 3,
        key: "ArrowRight",
        pageSize: 10,
        rows: [
          { nodeId: "parent-1", kind: "parent", isExpanded: true },
          { nodeId: "child-1", kind: "leaf", parentId: "parent-1", isExpanded: false },
          { nodeId: "child-2", kind: "leaf", parentId: "parent-1", isExpanded: false },
        ],
      }),
    ).toEqual({ kind: "set-active-index", index: 1 });
  });

  it("collapses expanded parent on arrow-left", () => {
    expect(
      resolveTreeKeyboardIntent({
        currentIndex: 0,
        totalRows: 2,
        key: "ArrowLeft",
        pageSize: 10,
        rows: [
          { nodeId: "parent-1", kind: "parent", isExpanded: true },
          { nodeId: "child-1", kind: "leaf", parentId: "parent-1", isExpanded: false },
        ],
      }),
    ).toEqual({ kind: "collapse", index: 0 });
  });

  it("moves leaf focus to parent on arrow-left", () => {
    expect(
      resolveTreeKeyboardIntent({
        currentIndex: 2,
        totalRows: 3,
        key: "ArrowLeft",
        pageSize: 10,
        rows: [
          { nodeId: "root", kind: "parent", isExpanded: true },
          { nodeId: "child-parent", kind: "parent", parentId: "root", isExpanded: false },
          { nodeId: "leaf-1", kind: "leaf", parentId: "child-parent", isExpanded: false },
        ],
      }),
    ).toEqual({ kind: "set-active-index", index: 1 });
  });

  it("returns noop for left-right navigation with no applicable target", () => {
    expect(
      resolveTreeKeyboardIntent({
        currentIndex: 0,
        totalRows: 1,
        key: "ArrowLeft",
        pageSize: 10,
        rows: [{ nodeId: "root", kind: "parent", isExpanded: false }],
      }),
    ).toEqual({ kind: "noop", index: 0 });
    expect(
      resolveTreeKeyboardIntent({
        currentIndex: 0,
        totalRows: 1,
        key: "ArrowRight",
        pageSize: 10,
        rows: [{ nodeId: "leaf", kind: "leaf", isExpanded: false }],
      }),
    ).toEqual({ kind: "noop", index: 0 });
  });

  it("formats deterministic live-region announcements", () => {
    expect(
      formatTreeKeyboardAnnouncement({
        action: "active",
        statement: "  Root statement. ",
        depthFromRoot: 0,
      }),
    ).toBe("Active Root statement; depth 0.");
    expect(
      formatTreeKeyboardAnnouncement({
        action: "expand",
        statement: "Parent",
        depthFromRoot: 2,
        childCount: 3,
      }),
    ).toBe("Expanded Parent; depth 2; 3 loaded children.");
    expect(
      formatTreeKeyboardAnnouncement({
        action: "collapse",
        statement: "Parent",
        depthFromRoot: 2,
      }),
    ).toBe("Collapsed Parent; depth 2.");
  });
});
