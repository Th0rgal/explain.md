import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { assertSummarySecurityBenchmarkBaseline } from "../src/summary-security-benchmark-baseline";
import { evaluateSummarySecurityBenchmark } from "../src/summary-security-benchmark";

const REPO_ROOT = path.resolve(__dirname, "..");

describe("summary security benchmark", () => {
  test("evaluates deterministic security benchmark profiles with full pass coverage", async () => {
    const first = await evaluateSummarySecurityBenchmark();
    const second = await evaluateSummarySecurityBenchmark();

    expect(first.schemaVersion).toBe("1.0.0");
    expect(first.summary.profileCount).toBeGreaterThanOrEqual(6);
    expect(first.summary.passCount).toBe(first.summary.profileCount);
    expect(first.summary.sanitizationPassCount).toBe(first.summary.sanitizationProfileCount);
    expect(first.summary.promptInjectionRejectionCount).toBeGreaterThanOrEqual(2);
    expect(first.summary.secretLeakRejectionCount).toBeGreaterThanOrEqual(2);
    expect(first.summary.configuredSecretRejectionCount).toBeGreaterThanOrEqual(1);

    expect(first.requestHash).toBe(second.requestHash);
    expect(first.outcomeHash).toBe(second.outcomeHash);
  });

  test("matches committed summary security benchmark baseline", async () => {
    const baseline = readJson("docs/benchmarks/summary-security-evaluation.json") as Record<string, unknown>;
    const report = await evaluateSummarySecurityBenchmark();

    expect(() => assertSummarySecurityBenchmarkBaseline(baseline, report)).not.toThrow();
  });
});

function readJson(relativePath: string): unknown {
  const absolutePath = path.resolve(REPO_ROOT, relativePath);
  return JSON.parse(readFileSync(absolutePath, "utf8"));
}
