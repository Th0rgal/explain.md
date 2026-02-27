import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  assertReleaseGateBaseline,
  buildReleaseGateBaseline,
  compareReleaseGateBaseline,
  evaluateReleaseGate,
} from "../src/release-gate";
import { assertQualityGateBaseline } from "../src/quality-gate-baseline";

const REPO_ROOT = path.resolve(__dirname, "..");

describe("release gate", () => {
  test("evaluates deterministic cross-benchmark release checks", () => {
    const qualityBaseline = assertQualityGateBaseline(readJson("docs/benchmarks/quality-gate-baseline.json"));
    const treeA11yBenchmark = readJson("docs/benchmarks/tree-a11y-evaluation.json");
    const treeScaleBenchmark = readJson("docs/benchmarks/tree-scale-evaluation.json");
    const explanationDiffBenchmark = readJson("docs/benchmarks/explanation-diff-evaluation.json");
    const verificationReplayBenchmark = readJson("docs/benchmarks/verification-replay-evaluation.json");
    const multilingualBenchmark = readJson("docs/benchmarks/multilingual-evaluation.json");
    const proofCacheBenchmark = readJson("docs/benchmarks/proof-cache-benchmark.json");
    const domainAdapterBenchmark = readJson("docs/benchmarks/domain-adapter-evaluation.json");
    const summarySecurityBenchmark = readJson("docs/benchmarks/summary-security-evaluation.json");
    const observabilitySloBaseline = readJson("docs/benchmarks/observability-slo-benchmark.json");

    const qualityBaselineCheck = {
      schemaVersion: "1.0.0",
      pass: true,
      expectedOutcomeHash: qualityBaseline.outcomeHash,
      actualOutcomeHash: qualityBaseline.outcomeHash,
    };

    const first = evaluateReleaseGate({
      qualityBaseline,
      qualityBaselineCheck,
      treeA11yBenchmark,
      treeScaleBenchmark,
      explanationDiffBenchmark,
      verificationReplayBenchmark,
      multilingualBenchmark,
      proofCacheBenchmark,
      domainAdapterBenchmark,
      summarySecurityBenchmark,
      observabilitySloBaseline,
      observabilitySloActual: observabilitySloBaseline,
      generatedAt: "2026-02-27T00:00:00.000Z",
    });

    const second = evaluateReleaseGate({
      qualityBaseline,
      qualityBaselineCheck,
      treeA11yBenchmark,
      treeScaleBenchmark,
      explanationDiffBenchmark,
      verificationReplayBenchmark,
      multilingualBenchmark,
      proofCacheBenchmark,
      domainAdapterBenchmark,
      summarySecurityBenchmark,
      observabilitySloBaseline,
      observabilitySloActual: observabilitySloBaseline,
      generatedAt: "2026-02-27T00:00:00.000Z",
    });

    expect(first.thresholdPass).toBe(true);
    expect(first.requestHash).toBe(second.requestHash);
    expect(first.outcomeHash).toBe(second.outcomeHash);
    expect(first.checks.every((check) => check.pass)).toBe(true);
  });

  test("detects baseline mismatch", () => {
    const baseline = assertReleaseGateBaseline({
      schemaVersion: "1.0.0",
      requestHash: "req-1",
      outcomeHash: "out-1",
      thresholdPass: true,
      checkStatus: [
        { code: "quality_baseline_consistent", pass: true },
        { code: "observability_slo_gate", pass: true },
      ],
    });

    const drifted = buildReleaseGateBaseline({
      schemaVersion: "1.0.0",
      generatedAt: "2026-02-27T00:00:00.000Z",
      requestHash: "req-2",
      outcomeHash: "out-2",
      thresholdPass: false,
      summary: {
        passedChecks: 1,
        failedChecks: 1,
        leafCount: 1,
        parentCount: 1,
        qualityOutcomeHash: "q",
        treeA11yOutcomeHash: "a",
        treeScaleOutcomeHash: "s",
        explanationDiffOutcomeHash: "d",
        multilingualOutcomeHash: "m",
        verificationReplayOutcomeHash: "v",
        proofCacheOutcomeHash: "c",
        domainAdapterOutcomeHash: "da",
        summarySecurityOutcomeHash: "ss",
        observabilityOutcomeHash: "o",
      },
      checks: [
        { code: "quality_baseline_consistent", pass: true, details: "ok" },
        { code: "tree_scale_profiles_cover_modes", pass: true, details: "ok" },
        { code: "domain_adapter_quality_floor", pass: true, details: "ok" },
        { code: "summary_prompt_security_contract", pass: true, details: "ok" },
        { code: "observability_slo_gate", pass: false, details: "bad" },
      ],
    });

    const comparison = compareReleaseGateBaseline(baseline, drifted);
    expect(comparison.pass).toBe(false);
    expect(comparison.failures.map((failure) => failure.field)).toEqual(
      expect.arrayContaining(["requestHash", "outcomeHash", "thresholdPass", "checkStatus"]),
    );
  });
});

function readJson(relativePath: string): unknown {
  const absolutePath = path.resolve(REPO_ROOT, relativePath);
  return JSON.parse(readFileSync(absolutePath, "utf8"));
}
