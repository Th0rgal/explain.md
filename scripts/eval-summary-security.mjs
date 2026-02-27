import path from "node:path";
import process from "node:process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { assertSummarySecurityBenchmarkBaseline, evaluateSummarySecurityBenchmark } from "../dist/index.js";

function parseArgs(argv) {
  const cwd = process.cwd();
  let baselinePath;
  let outputPath;
  let writeBaseline = false;

  for (const arg of argv.slice(2)) {
    if (arg === "--write-baseline") {
      writeBaseline = true;
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
    baselinePath,
    outputPath,
    writeBaseline,
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const report = await evaluateSummarySecurityBenchmark();

  if (args.writeBaseline) {
    const baselinePath = args.baselinePath ?? path.resolve(process.cwd(), "docs/benchmarks/summary-security-evaluation.json");
    await mkdir(path.dirname(baselinePath), { recursive: true });
    await writeFile(baselinePath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    process.stdout.write(`Wrote summary security baseline to ${baselinePath}\n`);
    return;
  }

  if (args.baselinePath) {
    const baselineRaw = JSON.parse(await readFile(args.baselinePath, "utf8"));
    assertSummarySecurityBenchmarkBaseline(baselineRaw, report);
  }

  if (args.outputPath) {
    await mkdir(path.dirname(args.outputPath), { recursive: true });
    await writeFile(args.outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    process.stdout.write(`Wrote summary security evaluation report to ${args.outputPath}\n`);
    return;
  }

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`eval-summary-security failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
