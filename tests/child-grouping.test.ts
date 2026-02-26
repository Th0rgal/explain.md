import { describe, expect, test } from "vitest";
import { groupChildrenDeterministically } from "../src/child-grouping.js";

describe("child grouping", () => {
  test("is deterministic across input ordering", () => {
    const request = {
      maxChildrenPerParent: 2,
      targetComplexity: 3,
      complexityBandWidth: 1,
      nodes: [
        { id: "c", statement: "Bounded transfer preserves storage invariant.", complexity: 3 },
        { id: "a", statement: "Initialization establishes storage invariant.", complexity: 2 },
        { id: "b", statement: "Transfer preserves storage invariant.", complexity: 3, prerequisiteIds: ["a"] },
        { id: "d", statement: "Withdrawal preserves storage invariant.", complexity: 4, prerequisiteIds: ["a"] },
      ],
    };

    const first = groupChildrenDeterministically(request);
    const second = groupChildrenDeterministically({
      ...request,
      nodes: request.nodes.slice().reverse(),
    });

    expect(first.groups).toEqual(second.groups);
    expect(first.diagnostics.orderedNodeIds).toEqual(second.diagnostics.orderedNodeIds);
  });

  test("respects prerequisite ordering in topological schedule", () => {
    const result = groupChildrenDeterministically({
      maxChildrenPerParent: 3,
      targetComplexity: 3,
      complexityBandWidth: 2,
      nodes: [
        { id: "lemma_c", statement: "C depends on B.", complexity: 3, prerequisiteIds: ["lemma_b"] },
        { id: "lemma_a", statement: "A is base case.", complexity: 2 },
        { id: "lemma_b", statement: "B depends on A.", complexity: 3, prerequisiteIds: ["lemma_a"] },
      ],
    });

    const order = result.diagnostics.orderedNodeIds;
    expect(order.indexOf("lemma_a")).toBeLessThan(order.indexOf("lemma_b"));
    expect(order.indexOf("lemma_b")).toBeLessThan(order.indexOf("lemma_c"));
  });

  test("enforces max children and complexity spread bound", () => {
    const result = groupChildrenDeterministically({
      maxChildrenPerParent: 4,
      targetComplexity: 3,
      complexityBandWidth: 1,
      nodes: [
        { id: "l1", statement: "Low complexity base lemma.", complexity: 1 },
        { id: "l2", statement: "Low complexity preservation lemma.", complexity: 2 },
        { id: "h1", statement: "High complexity compositional theorem.", complexity: 4 },
        { id: "h2", statement: "High complexity refinement theorem.", complexity: 5 },
      ],
    });

    expect(result.groups.every((group) => group.length <= 4)).toBe(true);
    expect(result.groups.length).toBeGreaterThan(1);
    expect(result.diagnostics.complexitySpreadByGroup.every((spread) => spread <= 1)).toBe(true);
  });

  test("flags prerequisite cycles and still produces total ordering", () => {
    const result = groupChildrenDeterministically({
      maxChildrenPerParent: 2,
      targetComplexity: 3,
      complexityBandWidth: 2,
      nodes: [
        { id: "x", statement: "Depends on y.", prerequisiteIds: ["y"] },
        { id: "y", statement: "Depends on x.", prerequisiteIds: ["x"] },
      ],
    });

    expect(result.diagnostics.warnings.map((warning) => warning.code)).toContain("cycle_detected");
    expect(result.diagnostics.orderedNodeIds).toEqual(["x", "y"]);
  });

  test("rejects non-array prerequisiteIds with a clear error", () => {
    expect(() =>
      groupChildrenDeterministically({
        maxChildrenPerParent: 2,
        targetComplexity: 3,
        complexityBandWidth: 1,
        nodes: [{ id: "a", statement: "A", prerequisiteIds: "b" as unknown as string[] }],
      }),
    ).toThrow("prerequisiteIds must be an array");
  });
});
