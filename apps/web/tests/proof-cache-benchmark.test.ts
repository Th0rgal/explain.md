import { describe, expect, it } from "vitest";
import { runProofCacheBenchmark } from "../lib/proof-cache-benchmark";

describe("proof cache benchmark", () => {
  it("produces machine-checkable cold/warm/invalidation outcomes", async () => {
    const report = await runProofCacheBenchmark({
      coldIterations: 2,
      warmIterations: 2,
    });

    expect(report.schemaVersion).toBe("1.0.0");
    expect(report.requestHash).toHaveLength(64);
    expect(report.outcomeHash).toHaveLength(64);

    expect(report.scenarios.coldNoPersistentCache.statuses).toEqual(["miss", "miss"]);
    expect(report.scenarios.warmPersistentCache.statuses).toEqual(["hit", "hit"]);
    expect(report.scenarios.invalidation.beforeChangeStatus).toBe("hit");
    expect(report.scenarios.invalidation.afterChangeStatus).toBe("hit");
    expect(report.scenarios.invalidation.afterChangeDiagnostics).toContain("cache_miss");
    expect(report.scenarios.invalidation.afterChangeDiagnostics).toContain("cache_blocked_subtree_rebuild_hit");
    expect(report.scenarios.invalidation.afterChangeTopologyPlan?.fullRebuildRequired).toBe(true);
    expect((report.scenarios.invalidation.afterChangeTopologyPlan?.blockedDeclarationCount ?? 0) > 0).toBe(true);
    expect(report.scenarios.invalidation.afterChangeTopologyPlan?.planHash).toHaveLength(64);
    expect(report.scenarios.invalidation.recoveryStatus).toBe("hit");

    expect(report.scenarios.topologyShapeInvalidation.beforeChangeStatus).toBe("hit");
    expect(report.scenarios.topologyShapeInvalidation.afterChangeStatus).toBe("hit");
    expect(report.scenarios.topologyShapeInvalidation.afterChangeDiagnostics).toContain("cache_miss");
    expect(report.scenarios.topologyShapeInvalidation.afterChangeDiagnostics).toContain(
      "cache_topology_regeneration_rebuild_hit",
    );
    expect(report.scenarios.topologyShapeInvalidation.afterChangeTopologyPlan?.fullRebuildRequired).toBe(true);
    expect(report.scenarios.topologyShapeInvalidation.afterChangeTopologyPlan?.topologyShapeChanged).toBe(true);
    expect((report.scenarios.topologyShapeInvalidation.afterChangeTopologyPlan?.addedDeclarationCount ?? 0) > 0).toBe(true);
    expect(report.scenarios.topologyShapeInvalidation.afterChangeTopologyPlan?.planHash).toHaveLength(64);
    expect(report.scenarios.topologyShapeInvalidation.recoveryStatus).toBe("hit");
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
