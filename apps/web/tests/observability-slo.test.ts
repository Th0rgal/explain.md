import { describe, expect, it } from "vitest";
import { evaluateObservabilitySLOs } from "../lib/observability-slo";
import type { ProofQueryObservabilityMetricsSnapshot } from "../lib/proof-service";
import type { VerificationObservabilityMetricsSnapshot } from "../lib/verification-service";

describe("observability SLO policy", () => {
  it("passes deterministically when all thresholds are satisfied", () => {
    const proof = buildProofSnapshot();
    const verification = buildVerificationSnapshot();

    const first = evaluateObservabilitySLOs({
      proof,
      verification,
      generatedAt: "2026-02-27T00:00:00.000Z",
      thresholds: {
        minProofUniqueTraceRate: 0.75,
        maxVerificationFailureRate: 0.3,
      },
    });
    const second = evaluateObservabilitySLOs({
      proof,
      verification,
      generatedAt: "2026-02-27T00:00:00.000Z",
      thresholds: {
        minProofUniqueTraceRate: 0.75,
        maxVerificationFailureRate: 0.3,
      },
    });

    expect(first.thresholdPass).toBe(true);
    expect(first.thresholdFailures).toEqual([]);
    expect(first.snapshotHash).toBe(second.snapshotHash);
    expect(first.metrics.proof.cacheHitRate).toBe(0.5);
    expect(first.metrics.verification.maxP95LatencyMs).toBe(120);
  });

  it("emits machine-checkable failures when thresholds regress", () => {
    const proof = buildProofSnapshot();
    const verification = buildVerificationSnapshot();

    const result = evaluateObservabilitySLOs({
      proof,
      verification,
      generatedAt: "2026-02-27T00:00:00.000Z",
      thresholds: {
        minProofCacheHitRate: 0.8,
        minProofUniqueTraceRate: 0.95,
        maxVerificationFailureRate: 0.05,
        maxVerificationP95LatencyMs: 100,
        maxVerificationMeanLatencyMs: 80,
      },
    });

    expect(result.thresholdPass).toBe(false);
    expect(result.thresholdFailures.map((failure) => failure.code)).toEqual([
      "proof_cache_hit_rate_below_min",
      "proof_unique_trace_rate_below_min",
      "verification_failure_rate_above_max",
      "verification_p95_latency_above_max",
      "verification_mean_latency_above_max",
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
