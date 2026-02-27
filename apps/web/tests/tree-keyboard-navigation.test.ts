import { describe, expect, it } from "vitest";
import { resolveTreeKeyboardIntent, type KeyboardTreeRow } from "../lib/tree-keyboard-navigation";

function buildRows(): KeyboardTreeRow[] {
  return [
    {
      nodeId: "root",
      nodeKind: "parent",
      isExpanded: true,
      loadedChildIds: ["p1", "l3"],
    },
    {
      nodeId: "p1",
      nodeKind: "parent",
      parentId: "root",
      isExpanded: false,
      loadedChildIds: ["l1", "l2"],
    },
    {
      nodeId: "l3",
      nodeKind: "leaf",
      parentId: "root",
      isExpanded: false,
      loadedChildIds: [],
    },
  ];
}

describe("tree keyboard navigation", () => {
  it("moves focus with arrow and home/end keys in visible order", () => {
    const rows = buildRows();

    expect(resolveTreeKeyboardIntent("ArrowDown", "root", rows)).toEqual({ kind: "move_focus", nodeId: "p1" });
    expect(resolveTreeKeyboardIntent("ArrowUp", "p1", rows)).toEqual({ kind: "move_focus", nodeId: "root" });
    expect(resolveTreeKeyboardIntent("Home", "l3", rows)).toEqual({ kind: "move_focus", nodeId: "root" });
    expect(resolveTreeKeyboardIntent("End", "root", rows)).toEqual({ kind: "move_focus", nodeId: "l3" });
  });

  it("expands collapsed parents before descending", () => {
    const rows = buildRows();
    expect(resolveTreeKeyboardIntent("ArrowRight", "p1", rows)).toEqual({
      kind: "set_expanded",
      nodeId: "p1",
      expanded: true,
    });
  });

  it("moves to first loaded child when a parent is already expanded", () => {
    const rows = buildRows().map((row) => (row.nodeId === "p1" ? { ...row, isExpanded: true } : row));
    expect(resolveTreeKeyboardIntent("ArrowRight", "p1", rows)).toEqual({ kind: "move_focus", nodeId: "l1" });
  });

  it("collapses expanded parent on ArrowLeft and then moves to parent", () => {
    const rows = buildRows().map((row) => (row.nodeId === "p1" ? { ...row, isExpanded: true } : row));
    expect(resolveTreeKeyboardIntent("ArrowLeft", "p1", rows)).toEqual({
      kind: "set_expanded",
      nodeId: "p1",
      expanded: false,
    });
    expect(resolveTreeKeyboardIntent("ArrowLeft", "l3", rows)).toEqual({ kind: "move_focus", nodeId: "root" });
  });

  it("activates leaves and clears leaf selection for parent activation keys", () => {
    const rows = buildRows();
    expect(resolveTreeKeyboardIntent("Enter", "l3", rows)).toEqual({ kind: "activate_leaf", nodeId: "l3" });
    expect(resolveTreeKeyboardIntent(" ", "p1", rows)).toEqual({ kind: "clear_leaf_selection" });
  });
});
