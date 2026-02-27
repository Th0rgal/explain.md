import { describe, expect, it } from "vitest";
import { assertExplanationDiffEvaluationBaseline } from "../lib/explanation-diff-baseline";
import { runExplanationDiffEvaluation } from "../lib/explanation-diff-evaluation";

describe("explanation diff benchmark baseline assertion", () => {
  it("accepts an identical baseline report", async () => {
    const report = await runExplanationDiffEvaluation();
    expect(() => {
      assertExplanationDiffEvaluationBaseline(report, report);
    }).not.toThrow();
  });

  it("fails closed on request hash mismatch", async () => {
    const report = await runExplanationDiffEvaluation();
    const baseline = { ...report, requestHash: "deadbeef" };
    expect(() => {
      assertExplanationDiffEvaluationBaseline(baseline, report);
    }).toThrow(/requestHash mismatch/);
  });

  it("fails closed on outcome hash mismatch", async () => {
    const report = await runExplanationDiffEvaluation();
    const baseline = { ...report, outcomeHash: "deadbeef" };
    expect(() => {
      assertExplanationDiffEvaluationBaseline(baseline, report);
    }).toThrow(/outcomeHash mismatch/);
  });
});
