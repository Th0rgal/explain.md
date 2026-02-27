import { describe, expect, it } from "vitest";
import { runObservabilitySloBenchmark } from "../lib/observability-slo-benchmark";

describe("observability SLO benchmark", () => {
  it("produces deterministic pass/fail SLO evidence with stable hashes", async () => {
    const report = await runObservabilitySloBenchmark();

    expect(report.schemaVersion).toBe("1.0.0");
    expect(report.requestHash).toHaveLength(64);
    expect(report.outcomeHash).toHaveLength(64);
    expect(report.evaluation.baseline.thresholdPass).toBe(true);
    expect(report.evaluation.strictRegression.thresholdPass).toBe(false);

    expect(report.snapshots.proof.requestCount).toBe(9);
    expect(report.snapshots.proof.uniqueRequestCount).toBe(9);
    expect(report.snapshots.proof.uniqueTraceCount).toBe(9);
    expect(report.snapshots.verification.requestCount).toBe(3);
    expect(report.snapshots.verification.failureCount).toBe(0);
    expect(report.snapshots.verification.parentTraceProvidedRate).toBeCloseTo(2 / 3, 5);

    expect(report.evaluation.strictRegression.thresholdFailureCodes).toEqual([
      "proof_request_count_below_min",
      "verification_request_count_below_min",
      "proof_cache_hit_rate_below_min",
      "verification_p95_latency_above_max",
      "verification_mean_latency_above_max",
      "verification_parent_trace_rate_below_min",
    ]);
  });

  it("keeps request and outcome hashes stable across reruns", async () => {
    const first = await runObservabilitySloBenchmark();
    const second = await runObservabilitySloBenchmark();

    expect(first.requestHash).toBe(second.requestHash);
    expect(first.outcomeHash).toBe(second.outcomeHash);
    expect(first.snapshots).toEqual(second.snapshots);
    expect(first.evaluation).toEqual(second.evaluation);
  });
});
