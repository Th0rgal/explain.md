import { describe, expect, it } from "vitest";
import { assertMultilingualEvaluationBaseline } from "../lib/multilingual-baseline";
import { runMultilingualEvaluation } from "../lib/multilingual-evaluation";

describe("multilingual evaluation baseline assertion", () => {
  it("accepts an identical baseline report", async () => {
    const report = await runMultilingualEvaluation();
    expect(() => {
      assertMultilingualEvaluationBaseline(report, report);
    }).not.toThrow();
  });

  it("fails closed on request hash mismatch", async () => {
    const report = await runMultilingualEvaluation();
    const baseline = { ...report, requestHash: "deadbeef" };
    expect(() => {
      assertMultilingualEvaluationBaseline(baseline, report);
    }).toThrow(/requestHash mismatch/);
  });

  it("fails closed on outcome hash mismatch", async () => {
    const report = await runMultilingualEvaluation();
    const baseline = { ...report, outcomeHash: "deadbeef" };
    expect(() => {
      assertMultilingualEvaluationBaseline(baseline, report);
    }).toThrow(/outcomeHash mismatch/);
  });
});
