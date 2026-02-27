import { describe, expect, it } from "vitest";
import { runObservabilitySloBenchmark } from "../lib/observability-slo-benchmark";

describe("observability SLO benchmark", () => {
  it("produces deterministic pass/fail SLO evidence with stable hashes", async () => {
    const report = await runObservabilitySloBenchmark();

    expect(report.schemaVersion).toBe("1.0.0");
    expect(report.requestHash).toHaveLength(64);
    expect(report.outcomeHash).toHaveLength(64);
    expect(report.parameters.profiles.map((profile) => profile.profileId)).toEqual(["seed-verity", "lean-verity-fixture"]);
    expect(report.profileReports.map((profile) => profile.profileId)).toEqual(["seed-verity", "lean-verity-fixture"]);
    expect(report.evaluation.baseline.thresholdPass).toBe(true);
    expect(report.evaluation.strictRegression.thresholdPass).toBe(false);

    expect(report.snapshots.proof.requestCount).toBe(18);
    expect(report.snapshots.proof.uniqueRequestCount).toBe(18);
    expect(report.snapshots.proof.uniqueTraceCount).toBe(18);
    expect(report.snapshots.verification.requestCount).toBe(6);
    expect(report.snapshots.verification.failureCount).toBe(0);
    expect(report.snapshots.verification.parentTraceProvidedRate).toBeCloseTo(2 / 3, 5);
    expect(report.snapshots.uiInteraction.requestCount).toBe(10);
    expect(report.snapshots.uiInteraction.successRate).toBe(1);
    expect(report.snapshots.uiInteraction.keyboardActionRate).toBeCloseTo(0.2, 5);
    expect(report.snapshots.uiInteraction.parentTraceProvidedRate).toBeCloseTo(0.6, 5);

    expect(report.evaluation.strictRegression.thresholdFailureCodes).toEqual([
      "lean-verity-fixture:proof_request_count_below_min",
      "lean-verity-fixture:ui_interaction_keyboard_action_rate_below_min",
      "lean-verity-fixture:ui_interaction_p95_duration_above_max",
      "lean-verity-fixture:ui_interaction_parent_trace_rate_below_min",
      "lean-verity-fixture:ui_interaction_request_count_below_min",
      "lean-verity-fixture:verification_mean_latency_above_max",
      "lean-verity-fixture:verification_p95_latency_above_max",
      "lean-verity-fixture:verification_parent_trace_rate_below_min",
      "lean-verity-fixture:verification_request_count_below_min",
      "seed-verity:proof_cache_hit_rate_below_min",
      "seed-verity:proof_request_count_below_min",
      "seed-verity:ui_interaction_keyboard_action_rate_below_min",
      "seed-verity:ui_interaction_p95_duration_above_max",
      "seed-verity:ui_interaction_parent_trace_rate_below_min",
      "seed-verity:ui_interaction_request_count_below_min",
      "seed-verity:verification_mean_latency_above_max",
      "seed-verity:verification_p95_latency_above_max",
      "seed-verity:verification_parent_trace_rate_below_min",
      "seed-verity:verification_request_count_below_min",
    ]);
    expect(report.evaluation.byProfile).toHaveLength(2);
    expect(report.evaluation.byProfile.every((profile) => profile.baseline.thresholdPass)).toBe(true);
    expect(report.evaluation.byProfile.every((profile) => !profile.strictRegression.thresholdPass)).toBe(true);
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
