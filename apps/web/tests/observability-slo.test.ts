import { describe, expect, it } from "vitest";
import { evaluateObservabilitySLOs } from "../lib/observability-slo";
import type { ProofQueryObservabilityMetricsSnapshot } from "../lib/proof-service";
import type { UiInteractionObservabilityMetricsSnapshot } from "../lib/ui-interaction-observability";
import type { VerificationObservabilityMetricsSnapshot } from "../lib/verification-service";

describe("observability SLO policy", () => {
  it("passes deterministically when all thresholds are satisfied", () => {
    const proof = buildProofSnapshot();
    const verification = buildVerificationSnapshot();
    const uiInteraction = buildUiInteractionSnapshot();

    const first = evaluateObservabilitySLOs({
      proof,
      verification,
      uiInteraction,
      generatedAt: "2026-02-27T00:00:00.000Z",
      thresholds: {
        minProofUniqueTraceRate: 0.75,
        maxProofP95LatencyMs: 100,
        maxProofMeanLatencyMs: 90,
        maxVerificationFailureRate: 0.3,
        minUiInteractionSuccessRate: 0.6,
        minUiInteractionKeyboardActionRate: 0,
      },
    });
    const second = evaluateObservabilitySLOs({
      proof,
      verification,
      uiInteraction,
      generatedAt: "2026-02-27T00:00:00.000Z",
      thresholds: {
        minProofUniqueTraceRate: 0.75,
        maxProofP95LatencyMs: 100,
        maxProofMeanLatencyMs: 90,
        maxVerificationFailureRate: 0.3,
        minUiInteractionSuccessRate: 0.6,
        minUiInteractionKeyboardActionRate: 0,
      },
    });

    expect(first.thresholdPass).toBe(true);
    expect(first.thresholdFailures).toEqual([]);
    expect(first.snapshotHash).toBe(second.snapshotHash);
    expect(first.metrics.proof.cacheHitRate).toBe(0.5);
    expect(first.metrics.proof.maxP95LatencyMs).toBe(100);
    expect(first.metrics.proof.maxMeanLatencyMs).toBe(70);
    expect(first.metrics.verification.maxP95LatencyMs).toBe(120);
    expect(first.metrics.uiInteraction.successRate).toBe(0.75);
    expect(first.metrics.uiInteraction.keyboardActionRate).toBe(0);
  });

  it("emits machine-checkable failures when thresholds regress", () => {
    const proof = buildProofSnapshot();
    const verification = buildVerificationSnapshot();
    const uiInteraction = buildUiInteractionSnapshot();

    const result = evaluateObservabilitySLOs({
      proof,
      verification,
      uiInteraction,
      generatedAt: "2026-02-27T00:00:00.000Z",
      thresholds: {
        minProofCacheHitRate: 0.8,
        minProofUniqueTraceRate: 0.95,
        maxProofP95LatencyMs: 70,
        maxProofMeanLatencyMs: 60,
        maxVerificationFailureRate: 0.05,
        maxVerificationP95LatencyMs: 100,
        maxVerificationMeanLatencyMs: 80,
        minUiInteractionSuccessRate: 0.9,
        minUiInteractionKeyboardActionRate: 0.1,
        minUiInteractionParentTraceRate: 0.6,
        maxUiInteractionP95DurationMs: 10,
      },
    });

    expect(result.thresholdPass).toBe(false);
    expect(result.thresholdFailures.map((failure) => failure.code)).toEqual([
      "proof_cache_hit_rate_below_min",
      "proof_unique_trace_rate_below_min",
      "proof_p95_latency_above_max",
      "proof_mean_latency_above_max",
      "verification_failure_rate_above_max",
      "verification_p95_latency_above_max",
      "verification_mean_latency_above_max",
      "ui_interaction_success_rate_below_min",
      "ui_interaction_keyboard_action_rate_below_min",
      "ui_interaction_parent_trace_rate_below_min",
      "ui_interaction_p95_duration_above_max",
    ]);
  });
});

function buildProofSnapshot(): ProofQueryObservabilityMetricsSnapshot {
  return {
    schemaVersion: "1.0.0",
    requestCount: 4,
    uniqueRequestCount: 4,
    uniqueTraceCount: 3,
    cache: {
      hitCount: 2,
      missCount: 2,
      hitRate: 0.5,
    },
    queries: [
      {
        query: "view",
        requestCount: 2,
        cacheHitCount: 1,
        cacheMissCount: 1,
        minLatencyMs: 20,
        maxLatencyMs: 80,
        meanLatencyMs: 50,
        p95LatencyMs: 80,
        meanLeafCount: 8,
        meanParentCount: 4,
        meanNodeCount: 12,
        maxDepth: 3,
      },
      {
        query: "diff",
        requestCount: 2,
        cacheHitCount: 1,
        cacheMissCount: 1,
        minLatencyMs: 40,
        maxLatencyMs: 100,
        meanLatencyMs: 70,
        p95LatencyMs: 100,
        meanLeafCount: 8,
        meanParentCount: 4,
        meanNodeCount: 12,
        maxDepth: 3,
      },
      {
        query: "leaf-detail",
        requestCount: 0,
        cacheHitCount: 0,
        cacheMissCount: 0,
        minLatencyMs: 0,
        maxLatencyMs: 0,
        meanLatencyMs: 0,
        p95LatencyMs: 0,
        meanLeafCount: 0,
        meanParentCount: 0,
        meanNodeCount: 0,
        maxDepth: 0,
      },
      {
        query: "root",
        requestCount: 0,
        cacheHitCount: 0,
        cacheMissCount: 0,
        minLatencyMs: 0,
        maxLatencyMs: 0,
        meanLatencyMs: 0,
        p95LatencyMs: 0,
        meanLeafCount: 0,
        meanParentCount: 0,
        meanNodeCount: 0,
        maxDepth: 0,
      },
      {
        query: "children",
        requestCount: 0,
        cacheHitCount: 0,
        cacheMissCount: 0,
        minLatencyMs: 0,
        maxLatencyMs: 0,
        meanLatencyMs: 0,
        p95LatencyMs: 0,
        meanLeafCount: 0,
        meanParentCount: 0,
        meanNodeCount: 0,
        maxDepth: 0,
      },
      {
        query: "path",
        requestCount: 0,
        cacheHitCount: 0,
        cacheMissCount: 0,
        minLatencyMs: 0,
        maxLatencyMs: 0,
        meanLatencyMs: 0,
        p95LatencyMs: 0,
        meanLeafCount: 0,
        meanParentCount: 0,
        meanNodeCount: 0,
        maxDepth: 0,
      },
      {
        query: "dependency-graph",
        requestCount: 0,
        cacheHitCount: 0,
        cacheMissCount: 0,
        minLatencyMs: 0,
        maxLatencyMs: 0,
        meanLatencyMs: 0,
        p95LatencyMs: 0,
        meanLeafCount: 0,
        meanParentCount: 0,
        meanNodeCount: 0,
        maxDepth: 0,
      },
      {
        query: "policy-report",
        requestCount: 0,
        cacheHitCount: 0,
        cacheMissCount: 0,
        minLatencyMs: 0,
        maxLatencyMs: 0,
        meanLatencyMs: 0,
        p95LatencyMs: 0,
        meanLeafCount: 0,
        meanParentCount: 0,
        meanNodeCount: 0,
        maxDepth: 0,
      },
      {
        query: "cache-report",
        requestCount: 0,
        cacheHitCount: 0,
        cacheMissCount: 0,
        minLatencyMs: 0,
        maxLatencyMs: 0,
        meanLatencyMs: 0,
        p95LatencyMs: 0,
        meanLeafCount: 0,
        meanParentCount: 0,
        meanNodeCount: 0,
        maxDepth: 0,
      },
    ],
    generatedAt: "2026-02-27T00:00:00.000Z",
    snapshotHash: "a".repeat(64),
  };
}

function buildVerificationSnapshot(): VerificationObservabilityMetricsSnapshot {
  return {
    schemaVersion: "1.0.0",
    requestCount: 4,
    failureCount: 1,
    correlation: {
      parentTraceProvidedCount: 2,
      parentTraceProvidedRate: 0.5,
    },
    queries: [
      {
        query: "verify_leaf",
        requestCount: 2,
        failureCount: 1,
        minLatencyMs: 80,
        maxLatencyMs: 120,
        meanLatencyMs: 100,
        p95LatencyMs: 120,
      },
      {
        query: "list_leaf_jobs",
        requestCount: 1,
        failureCount: 0,
        minLatencyMs: 40,
        maxLatencyMs: 40,
        meanLatencyMs: 40,
        p95LatencyMs: 40,
      },
      {
        query: "get_job",
        requestCount: 1,
        failureCount: 0,
        minLatencyMs: 20,
        maxLatencyMs: 20,
        meanLatencyMs: 20,
        p95LatencyMs: 20,
      },
    ],
    generatedAt: "2026-02-27T00:00:00.000Z",
    snapshotHash: "b".repeat(64),
  };
}

function buildUiInteractionSnapshot(): UiInteractionObservabilityMetricsSnapshot {
  return {
    schemaVersion: "1.0.0",
    requestCount: 4,
    successCount: 3,
    failureCount: 1,
    keyboardActionCount: 0,
    keyboardActionRate: 0,
    uniqueTraceCount: 4,
    correlation: {
      parentTraceProvidedCount: 2,
      parentTraceProvidedRate: 0.5,
    },
    interactions: [
      {
        interaction: "config_update",
        requestCount: 1,
        successRate: 1,
        meanDurationMs: 8,
        p95DurationMs: 8,
      },
      {
        interaction: "tree_expand_toggle",
        requestCount: 1,
        successRate: 1,
        meanDurationMs: 10,
        p95DurationMs: 10,
      },
      {
        interaction: "tree_load_more",
        requestCount: 0,
        successRate: 0,
        meanDurationMs: 0,
        p95DurationMs: 0,
      },
      {
        interaction: "tree_select_leaf",
        requestCount: 1,
        successRate: 1,
        meanDurationMs: 11,
        p95DurationMs: 11,
      },
      {
        interaction: "tree_keyboard",
        requestCount: 0,
        successRate: 0,
        meanDurationMs: 0,
        p95DurationMs: 0,
      },
      {
        interaction: "verification_run",
        requestCount: 1,
        successRate: 0,
        meanDurationMs: 12,
        p95DurationMs: 12,
      },
      {
        interaction: "verification_job_select",
        requestCount: 0,
        successRate: 0,
        meanDurationMs: 0,
        p95DurationMs: 0,
      },
      {
        interaction: "profile_save",
        requestCount: 0,
        successRate: 0,
        meanDurationMs: 0,
        p95DurationMs: 0,
      },
      {
        interaction: "profile_delete",
        requestCount: 0,
        successRate: 0,
        meanDurationMs: 0,
        p95DurationMs: 0,
      },
      {
        interaction: "profile_apply",
        requestCount: 0,
        successRate: 0,
        meanDurationMs: 0,
        p95DurationMs: 0,
      },
    ],
    generatedAt: "2026-02-27T00:00:00.000Z",
    snapshotHash: "c".repeat(64),
  };
}
