import { describe, expect, it } from "vitest";
import {
  planTreeVirtualizationWindow,
  resolveTreeVirtualizationSettings,
  resolveVirtualScrollTopForRowIndex,
} from "../lib/tree-virtualization";

describe("tree virtualization planner", () => {
  const settings = {
    enabled: true,
    minRows: 100,
    rowHeightPx: 30,
    viewportRows: 10,
    overscanRows: 2,
  };

  it("returns full mode when row count is below threshold", () => {
    const plan = planTreeVirtualizationWindow({
      totalRowCount: 80,
      scrollTopPx: 400,
      settings,
    });
    expect(plan).toEqual({
      mode: "full",
      startIndex: 0,
      endIndex: 79,
      renderedRowCount: 80,
      hiddenAboveCount: 0,
      hiddenBelowCount: 0,
      topSpacerHeightPx: 0,
      bottomSpacerHeightPx: 0,
      viewportHeightPx: 300,
      clampedScrollTopPx: 0,
      maxScrollTopPx: 0,
    });
  });

  it("returns deterministic virtualized window with overscan", () => {
    const plan = planTreeVirtualizationWindow({
      totalRowCount: 1000,
      scrollTopPx: 4500,
      settings,
    });
    expect(plan).toEqual({
      mode: "virtualized",
      startIndex: 148,
      endIndex: 161,
      renderedRowCount: 14,
      hiddenAboveCount: 148,
      hiddenBelowCount: 838,
      topSpacerHeightPx: 4440,
      bottomSpacerHeightPx: 25140,
      viewportHeightPx: 300,
      clampedScrollTopPx: 4500,
      maxScrollTopPx: 29700,
    });
  });

  it("clamps virtualized scroll and window boundaries", () => {
    const plan = planTreeVirtualizationWindow({
      totalRowCount: 220,
      scrollTopPx: 999999,
      settings,
    });
    expect(plan).toEqual({
      mode: "virtualized",
      startIndex: 208,
      endIndex: 219,
      renderedRowCount: 12,
      hiddenAboveCount: 208,
      hiddenBelowCount: 0,
      topSpacerHeightPx: 6240,
      bottomSpacerHeightPx: 0,
      viewportHeightPx: 300,
      clampedScrollTopPx: 6300,
      maxScrollTopPx: 6300,
    });
  });
});

describe("tree virtualization settings parser", () => {
  it("uses deterministic defaults for missing and invalid values", () => {
    expect(resolveTreeVirtualizationSettings({})).toEqual({
      enabled: true,
      minRows: 400,
      rowHeightPx: 36,
      viewportRows: 18,
      overscanRows: 6,
    });

    expect(
      resolveTreeVirtualizationSettings({
        NEXT_PUBLIC_EXPLAIN_MD_TREE_VIRTUALIZATION_ENABLED: "off",
        NEXT_PUBLIC_EXPLAIN_MD_TREE_VIRTUALIZATION_MIN_ROWS: "0",
        NEXT_PUBLIC_EXPLAIN_MD_TREE_ROW_HEIGHT_PX: "-5",
        NEXT_PUBLIC_EXPLAIN_MD_TREE_VIEWPORT_ROWS: "nan",
        NEXT_PUBLIC_EXPLAIN_MD_TREE_VIRTUALIZATION_OVERSCAN_ROWS: "-1",
      }),
    ).toEqual({
      enabled: false,
      minRows: 1,
      rowHeightPx: 1,
      viewportRows: 18,
      overscanRows: 0,
    });
  });

  it("parses explicit environment overrides", () => {
    expect(
      resolveTreeVirtualizationSettings({
        NEXT_PUBLIC_EXPLAIN_MD_TREE_VIRTUALIZATION_ENABLED: "true",
        NEXT_PUBLIC_EXPLAIN_MD_TREE_VIRTUALIZATION_MIN_ROWS: "700",
        NEXT_PUBLIC_EXPLAIN_MD_TREE_ROW_HEIGHT_PX: "40",
        NEXT_PUBLIC_EXPLAIN_MD_TREE_VIEWPORT_ROWS: "16",
        NEXT_PUBLIC_EXPLAIN_MD_TREE_VIRTUALIZATION_OVERSCAN_ROWS: "4",
      }),
    ).toEqual({
      enabled: true,
      minRows: 700,
      rowHeightPx: 40,
      viewportRows: 16,
      overscanRows: 4,
    });
  });
});

describe("virtualized keyboard scroll alignment", () => {
  const settings = {
    enabled: true,
    minRows: 100,
    rowHeightPx: 30,
    viewportRows: 10,
    overscanRows: 2,
  };

  it("keeps scroll unchanged when target row is visible", () => {
    expect(resolveVirtualScrollTopForRowIndex(600, 22, 1000, settings)).toBe(600);
  });

  it("scrolls up to include above-target rows", () => {
    expect(resolveVirtualScrollTopForRowIndex(600, 3, 1000, settings)).toBe(90);
  });

  it("scrolls down to include below-target rows", () => {
    expect(resolveVirtualScrollTopForRowIndex(600, 35, 1000, settings)).toBe(780);
  });
});
