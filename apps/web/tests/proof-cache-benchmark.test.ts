import { describe, expect, it } from "vitest";
import { runProofCacheBenchmark } from "../lib/proof-cache-benchmark";

describe("proof cache benchmark", () => {
  it("produces machine-checkable cold/warm/semantic-noop/invalidation/topology-change outcomes", async () => {
    const report = await runProofCacheBenchmark({
      coldIterations: 2,
      warmIterations: 2,
    });

    expect(report.schemaVersion).toBe("1.0.0");
    expect(report.requestHash).toHaveLength(64);
    expect(report.outcomeHash).toHaveLength(64);

    expect(report.scenarios.coldNoPersistentCache.statuses).toEqual(["miss", "miss"]);
    expect(report.scenarios.warmPersistentCache.statuses).toEqual(["hit", "hit"]);
    expect(report.scenarios.semanticNoop.beforeChangeStatus).toBe("hit");
    expect(report.scenarios.semanticNoop.afterChangeStatus).toBe("hit");
    expect(report.scenarios.semanticNoop.afterChangeDiagnostics).toContain("cache_semantic_hit");
    expect(report.scenarios.invalidation.beforeChangeStatus).toBe("hit");
    expect(report.scenarios.invalidation.afterChangeStatus).toBe("hit");
    expect(report.scenarios.invalidation.afterChangeDiagnostics).toContain("cache_incremental_subtree_rebuild");
    expect(report.scenarios.invalidation.afterChangeDiagnostics).not.toContain("cache_incremental_rebuild");
    expect(report.scenarios.invalidation.recoveryStatus).toBe("hit");
    expect(report.scenarios.topologyChange.beforeChangeStatus).toBe("hit");
    expect(report.scenarios.topologyChange.afterChangeStatus).toBe("hit");
    expect(report.scenarios.topologyChange.afterChangeDiagnostics).toContain("cache_incremental_topology_rebuild");
    expect(report.scenarios.topologyChange.afterChangeDiagnostics).not.toContain("cache_incremental_rebuild");
    expect(report.scenarios.topologyChange.reusedParentByStableIdCount).toBeGreaterThanOrEqual(0);
    expect(report.scenarios.topologyChange.reusedParentByChildHashCount).toBeGreaterThanOrEqual(0);
    expect(report.scenarios.topologyChange.reusedParentByChildStatementHashCount).toBeGreaterThanOrEqual(0);
    expect(report.scenarios.topologyChange.reusedParentByFrontierChildHashCount).toBeGreaterThanOrEqual(0);
    expect(report.scenarios.topologyChange.reusedParentByFrontierChildStatementHashCount).toBeGreaterThanOrEqual(0);
    expect(report.scenarios.topologyChange.skippedAmbiguousChildHashReuseCount).toBeGreaterThanOrEqual(0);
    expect(report.scenarios.topologyChange.skippedAmbiguousChildStatementHashReuseCount).toBeGreaterThanOrEqual(0);
    expect(report.scenarios.topologyChange.frontierPartitionLeafCount).toBeGreaterThanOrEqual(0);
    expect(report.scenarios.topologyChange.frontierPartitionBlockedGroupCount).toBeGreaterThanOrEqual(0);
    expect(report.scenarios.topologyChange.frontierPartitionRecoveredLeafCount).toBeGreaterThanOrEqual(0);
    expect(report.scenarios.topologyChange.frontierPartitionRecoveredSummaryCount).toBeGreaterThanOrEqual(0);
    expect(report.scenarios.topologyChange.frontierPartitionRecoveryPassCount).toBeGreaterThanOrEqual(0);
    expect(report.scenarios.topologyChange.frontierPartitionRecoveryScheduledGroupCount).toBeGreaterThanOrEqual(0);
    expect(report.scenarios.topologyChange.frontierPartitionRecoveryStrategy).toBe("minimal_hitting_set_greedy");
    expect(typeof report.scenarios.topologyChange.frontierPartitionFallbackUsed).toBe("boolean");
    expect(report.scenarios.topologyChange.recoveryStatus).toBe("hit");
  });

  it("keeps deterministic outcome hash across reruns for identical inputs", async () => {
    const first = await runProofCacheBenchmark({
      coldIterations: 1,
      warmIterations: 1,
    });
    const second = await runProofCacheBenchmark({
      coldIterations: 1,
      warmIterations: 1,
    });

    expect(first.requestHash).toBe(second.requestHash);
    expect(first.outcomeHash).toBe(second.outcomeHash);
  });
});
