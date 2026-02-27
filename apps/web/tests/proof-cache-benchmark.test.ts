import { describe, expect, it } from "vitest";
import { runProofCacheBenchmark } from "../lib/proof-cache-benchmark";

describe("proof cache benchmark", () => {
  it("produces machine-checkable cold/warm/semantic-noop/invalidation outcomes", async () => {
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
