import { describe, expect, it } from "vitest";
import { assertTreeScaleEvaluationBaseline } from "../lib/tree-scale-baseline";
import { runTreeScaleEvaluation } from "../lib/tree-scale-evaluation";

describe("tree scale benchmark baseline assertion", () => {
  it("accepts an identical baseline report", () => {
    const report = runTreeScaleEvaluation();
    expect(() => {
      assertTreeScaleEvaluationBaseline(report, report);
    }).not.toThrow();
  });

  it("fails closed on request hash mismatch", () => {
    const report = runTreeScaleEvaluation();
    const baseline = { ...report, requestHash: "deadbeef" };
    expect(() => {
      assertTreeScaleEvaluationBaseline(baseline, report);
    }).toThrow(/requestHash mismatch/);
  });

  it("fails closed on outcome hash mismatch", () => {
    const report = runTreeScaleEvaluation();
    const baseline = { ...report, outcomeHash: "deadbeef" };
    expect(() => {
      assertTreeScaleEvaluationBaseline(baseline, report);
    }).toThrow(/outcomeHash mismatch/);
  });
});
