import { describe, expect, it } from "vitest";
import { buildExplanationDiffPanelView, computeStatementDelta } from "../lib/explanation-diff-view";

describe("explanation diff view", () => {
  it("computes deterministic statement deltas", () => {
    expect(computeStatementDelta("alpha beta1 gamma", "alpha delta2 gamma")).toEqual({
      prefix: "alpha ",
      beforeChanged: "beta1",
      afterChanged: "delta2",
      suffix: " gamma",
    });
  });

  it("handles insertion without removing suffix", () => {
    expect(computeStatementDelta("A -> C", "A -> B -> C")).toEqual({
      prefix: "A -> ",
      beforeChanged: "",
      afterChanged: "B -> ",
      suffix: "C",
    });
  });

  it("groups by change type and exposes support metadata", () => {
    const view = buildExplanationDiffPanelView(
      {
        summary: { total: 3, added: 1, removed: 1, changed: 1 },
        changes: [
          {
            key: "parent:changed",
            type: "changed",
            kind: "parent",
            supportLeafIds: ["leaf_2", "leaf_1"],
            baselineStatement: "Old statement",
            candidateStatement: "New statement",
          },
          {
            key: "leaf:added",
            type: "added",
            kind: "leaf",
            supportLeafIds: ["leaf_3"],
            candidateStatement: "Added statement",
          },
          {
            key: "leaf:removed",
            type: "removed",
            kind: "leaf",
            supportLeafIds: ["leaf_4"],
            baselineStatement: "Removed statement",
          },
        ],
      },
      { maxChanges: 8 },
    );

    expect(view.totalChanges).toBe(3);
    expect(view.renderedChanges).toBe(3);
    expect(view.truncatedChangeCount).toBe(0);
    expect(view.changed).toHaveLength(1);
    expect(view.changed[0]?.supportLeafCount).toBe(2);
    expect(view.changed[0]?.statementDelta).toEqual({
      prefix: "",
      beforeChanged: "Old",
      afterChanged: "New",
      suffix: " statement",
    });
    expect(view.added).toHaveLength(1);
    expect(view.removed).toHaveLength(1);
  });

  it("truncates deterministically and sanitizes maxChanges", () => {
    const changes = Array.from({ length: 4 }, (_, index) => ({
      key: `leaf:${index}`,
      type: "added" as const,
      kind: "leaf" as const,
      supportLeafIds: [`leaf_${index}`],
      candidateStatement: `Statement ${index}`,
    }));

    const limited = buildExplanationDiffPanelView(
      {
        summary: { total: 4, added: 4, removed: 0, changed: 0 },
        changes,
      },
      { maxChanges: 2.8 },
    );

    expect(limited.renderedChanges).toBe(2);
    expect(limited.truncatedChangeCount).toBe(2);
    expect(limited.added.map((change) => change.key)).toEqual(["leaf:0", "leaf:1"]);

    const clamped = buildExplanationDiffPanelView(
      {
        summary: { total: 4, added: 4, removed: 0, changed: 0 },
        changes,
      },
      { maxChanges: 0 },
    );

    expect(clamped.renderedChanges).toBe(1);
    expect(clamped.truncatedChangeCount).toBe(3);
  });
});
