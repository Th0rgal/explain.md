import { describe, expect, it } from "vitest";
import { planTreeRenderWindow, resolveTreeRenderSettings } from "../lib/tree-render-window";

describe("tree render window planner", () => {
  it("returns full mode when total rows are below max", () => {
    const plan = planTreeRenderWindow({
      totalRowCount: 12,
      anchorRowIndex: 3,
      maxVisibleRows: 20,
      overscanRows: 4,
    });
    expect(plan).toEqual({
      mode: "full",
      startIndex: 0,
      endIndex: 11,
      renderedRowCount: 12,
      hiddenAboveCount: 0,
      hiddenBelowCount: 0,
    });
  });

  it("returns deterministic centered window with overscan", () => {
    const plan = planTreeRenderWindow({
      totalRowCount: 500,
      anchorRowIndex: 250,
      maxVisibleRows: 100,
      overscanRows: 20,
    });
    expect(plan).toEqual({
      mode: "windowed",
      startIndex: 180,
      endIndex: 319,
      renderedRowCount: 140,
      hiddenAboveCount: 180,
      hiddenBelowCount: 180,
    });
  });

  it("clamps anchor near boundaries", () => {
    expect(
      planTreeRenderWindow({
        totalRowCount: 500,
        anchorRowIndex: -50,
        maxVisibleRows: 100,
        overscanRows: 20,
      }),
    ).toEqual({
      mode: "windowed",
      startIndex: 0,
      endIndex: 119,
      renderedRowCount: 120,
      hiddenAboveCount: 0,
      hiddenBelowCount: 380,
    });

    expect(
      planTreeRenderWindow({
        totalRowCount: 500,
        anchorRowIndex: 9999,
        maxVisibleRows: 100,
        overscanRows: 20,
      }),
    ).toEqual({
      mode: "windowed",
      startIndex: 380,
      endIndex: 499,
      renderedRowCount: 120,
      hiddenAboveCount: 380,
      hiddenBelowCount: 0,
    });
  });
});

describe("tree render settings parser", () => {
  it("uses deterministic defaults for missing/invalid values", () => {
    expect(resolveTreeRenderSettings({})).toEqual({
      maxVisibleRows: 120,
      overscanRows: 24,
    });
    expect(
      resolveTreeRenderSettings({
        NEXT_PUBLIC_EXPLAIN_MD_TREE_RENDER_MAX_ROWS: "0",
        NEXT_PUBLIC_EXPLAIN_MD_TREE_RENDER_OVERSCAN_ROWS: "-1",
      }),
    ).toEqual({
      maxVisibleRows: 1,
      overscanRows: 0,
    });
  });

  it("parses numeric environment overrides", () => {
    expect(
      resolveTreeRenderSettings({
        NEXT_PUBLIC_EXPLAIN_MD_TREE_RENDER_MAX_ROWS: "220",
        NEXT_PUBLIC_EXPLAIN_MD_TREE_RENDER_OVERSCAN_ROWS: "40",
      }),
    ).toEqual({
      maxVisibleRows: 220,
      overscanRows: 40,
    });
  });
});
