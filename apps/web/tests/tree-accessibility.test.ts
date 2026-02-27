import { describe, expect, it } from "vitest";
import { buildTreeAccessibilityMetadata } from "../lib/tree-accessibility";

describe("tree accessibility metadata", () => {
  it("assigns deterministic level/position metadata for visible rows", () => {
    const metadata = buildTreeAccessibilityMetadata([
      { nodeId: "root", depthFromRoot: 0 },
      { nodeId: "a", parentId: "root", depthFromRoot: 1 },
      { nodeId: "b", parentId: "root", depthFromRoot: 1 },
      { nodeId: "c", parentId: "a", depthFromRoot: 2 },
    ]);

    expect(metadata.byNodeId).toEqual({
      root: { level: 1, posInSet: 1, setSize: 1 },
      a: { level: 2, posInSet: 1, setSize: 2 },
      b: { level: 2, posInSet: 2, setSize: 2 },
      c: { level: 3, posInSet: 1, setSize: 1 },
    });
  });

  it("preserves deterministic sibling order using loaded child ordering", () => {
    const metadata = buildTreeAccessibilityMetadata(
      [
        { nodeId: "root", depthFromRoot: 0 },
        { nodeId: "b", parentId: "root", depthFromRoot: 1 },
        { nodeId: "a", parentId: "root", depthFromRoot: 1 },
      ],
      {
        orderedChildIdsByParentId: {
          root: ["a", "b"],
        },
      },
    );

    expect(metadata.byNodeId.a).toEqual({ level: 2, posInSet: 1, setSize: 2 });
    expect(metadata.byNodeId.b).toEqual({ level: 2, posInSet: 2, setSize: 2 });
  });

  it("uses total child counts when the loaded window is partial", () => {
    const metadata = buildTreeAccessibilityMetadata(
      [
        { nodeId: "root", depthFromRoot: 0 },
        { nodeId: "only-loaded", parentId: "root", depthFromRoot: 1 },
      ],
      {
        orderedChildIdsByParentId: {
          root: ["only-loaded"],
        },
        totalChildrenByParentId: {
          root: 4,
        },
      },
    );

    expect(metadata.byNodeId["only-loaded"]).toEqual({
      level: 2,
      posInSet: 1,
      setSize: 4,
    });
  });
});
