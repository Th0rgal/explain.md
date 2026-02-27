import { promises as fs } from "node:fs";
import path from "node:path";
import { assertExplanationDiffEvaluationBaseline } from "../lib/explanation-diff-baseline";
import { runExplanationDiffEvaluation } from "../lib/explanation-diff-evaluation";

interface CliOptions {
  outPath?: string;
  baselinePath?: string;
}

async function main(): Promise<void> {
  const options = parseCliArgs(process.argv.slice(2));
  const report = await runExplanationDiffEvaluation();

  if (options.baselinePath) {
    const resolvedBaselinePath = path.resolve(options.baselinePath);
    const baselineRaw = await fs.readFile(resolvedBaselinePath, "utf8");
    const baseline = JSON.parse(baselineRaw) as Awaited<ReturnType<typeof runExplanationDiffEvaluation>>;
    assertExplanationDiffEvaluationBaseline(baseline, report);
  }

  if (options.outPath) {
    const resolvedPath = path.resolve(options.outPath);
    await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
    await fs.writeFile(resolvedPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(`Wrote explanation diff evaluation report to ${resolvedPath}`);
    return;
  }

  console.log(JSON.stringify(report, null, 2));
}

function parseCliArgs(argv: string[]): CliOptions {
  const parsed: CliOptions = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg.startsWith("--out=")) {
      parsed.outPath = arg.slice("--out=".length).trim();
      continue;
    }
    if (arg === "--out") {
      parsed.outPath = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith("--baseline=")) {
      parsed.baselinePath = arg.slice("--baseline=".length).trim();
      continue;
    }
    if (arg === "--baseline") {
      parsed.baselinePath = argv[index + 1];
      index += 1;
      continue;
    }
    throw new Error(`Unsupported argument '${arg}'.`);
  }

  return parsed;
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
