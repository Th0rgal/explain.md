import { describe, expect, it } from "vitest";
import { assertTreeA11yEvaluationBaseline } from "../lib/tree-a11y-baseline";
import { runTreeA11yEvaluation } from "../lib/tree-a11y-evaluation";

describe("tree a11y benchmark baseline assertion", () => {
  it("accepts an identical baseline report", () => {
    const report = runTreeA11yEvaluation();
    expect(() => {
      assertTreeA11yEvaluationBaseline(report, report);
    }).not.toThrow();
  });

  it("fails closed on request hash mismatch", () => {
    const report = runTreeA11yEvaluation();
    const baseline = { ...report, requestHash: "deadbeef" };
    expect(() => {
      assertTreeA11yEvaluationBaseline(baseline, report);
    }).toThrow(/requestHash mismatch/);
  });

  it("fails closed on outcome hash mismatch", () => {
    const report = runTreeA11yEvaluation();
    const baseline = { ...report, outcomeHash: "deadbeef" };
    expect(() => {
      assertTreeA11yEvaluationBaseline(baseline, report);
    }).toThrow(/outcomeHash mismatch/);
  });
});
