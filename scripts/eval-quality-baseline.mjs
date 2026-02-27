import path from "node:path";
import process from "node:process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import {
  assertQualityGateBaseline,
  buildQualityGateBaseline,
  compareQualityGateBaseline,
} from "../dist/index.js";

function parseArgs(argv) {
  const cwd = process.cwd();
  let reports = [];
  let baselinePath = path.resolve(cwd, "docs/benchmarks/quality-gate-baseline.json");
  let outputPath = path.resolve(cwd, ".explain-md/quality-gate-baseline-check.json");
  let writeBaseline = false;

  for (const arg of argv.slice(2)) {
    if (arg === "--write-baseline") {
      writeBaseline = true;
      continue;
    }
    if (arg.startsWith("--reports=")) {
      reports = arg
        .slice("--reports=".length)
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)
        .map((entry) => path.resolve(cwd, entry));
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

  if (reports.length === 0) {
    throw new Error("Missing --reports=<path1,path2,...>");
  }

  return {
    reports,
    baselinePath,
    outputPath,
    writeBaseline,
  };
}

async function readJson(jsonPath) {
  const content = await readFile(jsonPath, "utf8");
  return JSON.parse(content);
}

async function main() {
  const args = parseArgs(process.argv);
  const reportJson = await Promise.all(args.reports.map((jsonPath) => readJson(jsonPath)));
  const actualBaseline = buildQualityGateBaseline(reportJson);

  if (args.writeBaseline) {
    await mkdir(path.dirname(args.baselinePath), { recursive: true });
    await writeFile(args.baselinePath, `${JSON.stringify(actualBaseline, null, 2)}\n`, "utf8");
    process.stdout.write(`Wrote baseline to ${args.baselinePath}\n`);
  }

  const expectedBaselineRaw = await readJson(args.baselinePath);
  const expectedBaseline = assertQualityGateBaseline(expectedBaselineRaw);
  const comparison = compareQualityGateBaseline(expectedBaseline, actualBaseline);

  const checkReport = {
    schemaVersion: "1.0.0",
    generatedAt: new Date().toISOString(),
    reports: args.reports,
    baselinePath: args.baselinePath,
    pass: comparison.pass,
    failureCount: comparison.failures.length,
    failures: comparison.failures,
    expectedOutcomeHash: expectedBaseline.outcomeHash,
    actualOutcomeHash: actualBaseline.outcomeHash,
  };

  await mkdir(path.dirname(args.outputPath), { recursive: true });
  await writeFile(args.outputPath, `${JSON.stringify(checkReport, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(checkReport, null, 2)}\n`);

  if (!comparison.pass) {
    process.exitCode = 2;
  }
}

main().catch((error) => {
  process.stderr.write(`eval-quality-baseline failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
