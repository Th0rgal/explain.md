import { describe, expect, it } from "vitest";
import { runTreeA11yEvaluation } from "../lib/tree-a11y-evaluation";

describe("tree accessibility evaluation", () => {
  it("produces deterministic assistive-tech interaction evidence", () => {
    const report = runTreeA11yEvaluation();

    expect(report.schemaVersion).toBe("1.0.0");
    expect(report.requestHash).toHaveLength(64);
    expect(report.outcomeHash).toHaveLength(64);
    expect(report.summary.totalSteps).toBe(report.parameters.keySequence.length);
    expect(report.summary.expandActionCount).toBeGreaterThan(0);
    expect(report.summary.collapseActionCount).toBeGreaterThan(0);
    expect(report.summary.activeAnnouncementCount).toBeGreaterThan(0);
    expect(report.summary.virtualizedStepCount).toBeGreaterThan(0);

    for (const step of report.steps) {
      expect(step.ariaActivedescendant).toBe(`treeitem-${step.activeNodeId}`);
      expect(step.ariaLevel).toBeGreaterThanOrEqual(1);
      expect(step.ariaPosInSet).toBeGreaterThanOrEqual(1);
      expect(step.ariaSetSize).toBeGreaterThanOrEqual(step.ariaPosInSet);
      expect(step.renderedRowCount).toBeGreaterThanOrEqual(1);
      expect(step.displayedStartIndex).toBeGreaterThanOrEqual(0);
      expect(step.displayedEndIndex).toBeGreaterThanOrEqual(step.displayedStartIndex);
    }
  });

  it("keeps request and outcome hashes stable for identical evaluation inputs", () => {
    const first = runTreeA11yEvaluation();
    const second = runTreeA11yEvaluation();

    expect(first.requestHash).toBe(second.requestHash);
    expect(first.outcomeHash).toBe(second.outcomeHash);
    expect(first.steps).toEqual(second.steps);
  });
});
