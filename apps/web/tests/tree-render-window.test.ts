import { describe, expect, it } from "vitest";
import { computeTreeRenderWindow } from "../lib/tree-render-window";

describe("tree render window", () => {
  it("renders full rows when tree is below the window threshold", () => {
    const result = computeTreeRenderWindow({
      totalRowCount: 40,
      anchorRowIndex: 10,
      maxVisibleRows: 80,
      overscanRows: 12,
    });

    expect(result).toEqual({
      mode: "full",
      anchorRowIndex: 10,
      startIndex: 0,
      endIndex: 40,
      renderedRowCount: 40,
      hiddenAboveCount: 0,
      hiddenBelowCount: 0,
    });
  });

  it("renders a deterministic centered window around the anchor", () => {
    const result = computeTreeRenderWindow({
      totalRowCount: 300,
      anchorRowIndex: 150,
      maxVisibleRows: 100,
      overscanRows: 10,
    });

    expect(result).toEqual({
      mode: "windowed",
      anchorRowIndex: 150,
      startIndex: 90,
      endIndex: 210,
      renderedRowCount: 120,
      hiddenAboveCount: 90,
      hiddenBelowCount: 90,
    });
  });

  it("clamps window boundaries near the start and end", () => {
    const startResult = computeTreeRenderWindow({
      totalRowCount: 300,
      anchorRowIndex: 2,
      maxVisibleRows: 90,
      overscanRows: 10,
    });
    const endResult = computeTreeRenderWindow({
      totalRowCount: 300,
      anchorRowIndex: 299,
      maxVisibleRows: 90,
      overscanRows: 10,
    });

    expect(startResult.startIndex).toBe(0);
    expect(startResult.endIndex).toBe(100);
    expect(endResult.startIndex).toBe(200);
    expect(endResult.endIndex).toBe(300);
  });

  it("defaults anchor to first row when null", () => {
    const result = computeTreeRenderWindow({
      totalRowCount: 180,
      anchorRowIndex: null,
      maxVisibleRows: 60,
      overscanRows: 6,
    });

    expect(result.anchorRowIndex).toBe(0);
    expect(result.startIndex).toBe(0);
  });

  it("sanitizes invalid maxVisibleRows and overscan inputs", () => {
    const result = computeTreeRenderWindow({
      totalRowCount: 220,
      anchorRowIndex: 20,
      maxVisibleRows: Number.NaN,
      overscanRows: -5,
    });

    expect(result.mode).toBe("windowed");
    expect(result.renderedRowCount).toBe(120);
    expect(result.startIndex).toBe(0);
    expect(result.endIndex).toBe(120);
  });
});
