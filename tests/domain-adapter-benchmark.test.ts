import { describe, expect, test } from "vitest";
import { assertDomainAdapterBenchmarkBaseline } from "../src/domain-adapter-benchmark-baseline.js";
import { evaluateDomainAdapterBenchmark } from "../src/domain-adapter-benchmark.js";

describe("domain adapter benchmark", () => {
  test("evaluates deterministic benchmark profiles with full pass coverage", () => {
    const first = evaluateDomainAdapterBenchmark();
    const second = evaluateDomainAdapterBenchmark();

    expect(first.schemaVersion).toBe("1.0.0");
    expect(first.requestHash).toBe(second.requestHash);
    expect(first.outcomeHash).toBe(second.outcomeHash);
    expect(first.summary.profileCount).toBeGreaterThanOrEqual(4);
    expect(first.summary.passCount).toBe(first.summary.profileCount);
    expect(first.summary.downgradedProfileCount).toBeGreaterThan(0);
    expect(first.summary.manualOverrideProfileCount).toBeGreaterThan(0);
    expect(first.summary.macroPrecision).toBeGreaterThan(0.8);
    expect(first.summary.macroRecall).toBeGreaterThan(0.8);
    expect(first.summary.macroF1).toBeGreaterThan(0.8);
    expect(first.profiles.every((profile) => profile.pass)).toBe(true);
  });

  test("baseline assertion fails on hash mismatch", () => {
    const report = evaluateDomainAdapterBenchmark();

    expect(() =>
      assertDomainAdapterBenchmarkBaseline(
        {
          schemaVersion: "1.0.0",
          requestHash: report.requestHash,
          outcomeHash: "0".repeat(64),
        },
        report,
      ),
    ).toThrow(/outcomeHash mismatch/i);
  });
});
