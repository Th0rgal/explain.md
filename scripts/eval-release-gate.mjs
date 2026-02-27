import path from "node:path";
import process from "node:process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import {
  assertQualityGateBaseline,
  assertReleaseGateBaseline,
  buildReleaseGateBaseline,
  compareReleaseGateBaseline,
  evaluateReleaseGate,
} from "../dist/index.js";

function parseArgs(argv) {
  const cwd = process.cwd();
  let qualityBaselinePath = path.resolve(cwd, "docs/benchmarks/quality-gate-baseline.json");
  let qualityBaselineCheckPath = path.resolve(cwd, ".explain-md/quality-gate-baseline-check.json");
  let treeA11yPath = path.resolve(cwd, "docs/benchmarks/tree-a11y-evaluation.json");
  let proofCachePath = path.resolve(cwd, "docs/benchmarks/proof-cache-benchmark.json");
  let observabilityBaselinePath = path.resolve(cwd, "docs/benchmarks/observability-slo-benchmark.json");
  let observabilityActualPath = path.resolve(cwd, ".explain-md/observability-slo-benchmark-report.json");
  let outputPath = path.resolve(cwd, ".explain-md/release-gate-report.json");
  let baselinePath = path.resolve(cwd, "docs/benchmarks/release-gate-baseline.json");
  let writeBaseline = false;

  for (const arg of argv.slice(2)) {
    if (arg === "--write-baseline") {
      writeBaseline = true;
      continue;
    }
    if (arg.startsWith("--quality-baseline=")) {
      qualityBaselinePath = path.resolve(cwd, arg.slice("--quality-baseline=".length));
      continue;
    }
    if (arg.startsWith("--quality-check=")) {
      qualityBaselineCheckPath = path.resolve(cwd, arg.slice("--quality-check=".length));
      continue;
    }
    if (arg.startsWith("--tree-a11y=")) {
      treeA11yPath = path.resolve(cwd, arg.slice("--tree-a11y=".length));
      continue;
    }
    if (arg.startsWith("--proof-cache=")) {
      proofCachePath = path.resolve(cwd, arg.slice("--proof-cache=".length));
      continue;
    }
    if (arg.startsWith("--observability-baseline=")) {
      observabilityBaselinePath = path.resolve(cwd, arg.slice("--observability-baseline=".length));
      continue;
    }
    if (arg.startsWith("--observability-actual=")) {
      observabilityActualPath = path.resolve(cwd, arg.slice("--observability-actual=".length));
      continue;
    }
    if (arg.startsWith("--baseline=")) {
      baselinePath = path.resolve(cwd, arg.slice("--baseline=".length));
      continue;
    }
    if (arg.startsWith("--out=")) {
      outputPath = path.resolve(cwd, arg.slice("--out=".length));
      continue;
    }
  }

  return {
    qualityBaselinePath,
    qualityBaselineCheckPath,
    treeA11yPath,
    proofCachePath,
    observabilityBaselinePath,
    observabilityActualPath,
    outputPath,
    baselinePath,
    writeBaseline,
  };
}

async function readJson(jsonPath) {
  const content = await readFile(jsonPath, "utf8");
  return JSON.parse(content);
}

async function main() {
  const args = parseArgs(process.argv);

  const qualityBaseline = assertQualityGateBaseline(await readJson(args.qualityBaselinePath));
  const qualityBaselineCheck = await readJson(args.qualityBaselineCheckPath);
  const treeA11yBenchmark = await readJson(args.treeA11yPath);
  const proofCacheBenchmark = await readJson(args.proofCachePath);
  const observabilitySloBaseline = await readJson(args.observabilityBaselinePath);
  const observabilitySloActual = await readJson(args.observabilityActualPath);

  const report = evaluateReleaseGate({
    qualityBaseline,
    qualityBaselineCheck,
    treeA11yBenchmark,
    proofCacheBenchmark,
    observabilitySloBaseline,
    observabilitySloActual,
  });

  const actualBaseline = buildReleaseGateBaseline(report);

  if (args.writeBaseline) {
    await mkdir(path.dirname(args.baselinePath), { recursive: true });
    await writeFile(args.baselinePath, `${JSON.stringify(actualBaseline, null, 2)}\n`, "utf8");
    process.stdout.write(`Wrote release-gate baseline to ${args.baselinePath}\n`);
  }

  const expectedBaselineRaw = await readJson(args.baselinePath);
  const expectedBaseline = assertReleaseGateBaseline(expectedBaselineRaw);
  const comparison = compareReleaseGateBaseline(expectedBaseline, actualBaseline);

  const checkReport = {
    schemaVersion: "1.0.0",
    generatedAt: new Date().toISOString(),
    pass: comparison.pass && report.thresholdPass,
    reportThresholdPass: report.thresholdPass,
    baselinePass: comparison.pass,
    failureCount: comparison.failures.length,
    failures: comparison.failures,
    expectedOutcomeHash: expectedBaseline.outcomeHash,
    actualOutcomeHash: actualBaseline.outcomeHash,
    expectedRequestHash: expectedBaseline.requestHash,
    actualRequestHash: actualBaseline.requestHash,
    report,
  };

  await mkdir(path.dirname(args.outputPath), { recursive: true });
  await writeFile(args.outputPath, `${JSON.stringify(checkReport, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(checkReport, null, 2)}\n`);

  if (!checkReport.pass) {
    process.exitCode = 2;
  }
}

main().catch((error) => {
  process.stderr.write(`eval-release-gate failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
