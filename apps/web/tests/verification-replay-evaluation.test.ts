import { describe, expect, it } from "vitest";
import { assertVerificationReplayEvaluationBaseline } from "../lib/verification-replay-baseline";
import { runVerificationReplayEvaluation } from "../lib/verification-replay-evaluation";

describe("verification replay evaluation", () => {
  it("produces deterministic request and outcome hashes", () => {
    const first = runVerificationReplayEvaluation();
    const second = runVerificationReplayEvaluation();

    expect(first.requestHash).toBe(second.requestHash);
    expect(first.outcomeHash).toBe(second.outcomeHash);
    expect(first.summary.exportFilename).toBe("verification-replay-seed-verity-leaf-tx-prover-job-1-ffffffffffff.json");
    expect(first.summary.envKeyCount).toBe(2);
    expect(first.summary.logLineCount).toBe(2);
    expect(first.summary.jsonLineCount).toBeGreaterThan(1);
  });

  it("fails closed when baseline request hash drifts", () => {
    const report = runVerificationReplayEvaluation();

    expect(() =>
      assertVerificationReplayEvaluationBaseline(
        {
          requestHash: `${"a".repeat(63)}b`,
          outcomeHash: report.outcomeHash,
          summary: report.summary,
        },
        report,
      ),
    ).toThrow(/requestHash mismatch/);
  });
});
