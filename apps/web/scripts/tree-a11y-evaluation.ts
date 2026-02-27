import { promises as fs } from "node:fs";
import path from "node:path";
import { runTreeA11yEvaluation } from "../lib/tree-a11y-evaluation";

interface CliOptions {
  outPath?: string;
}

async function main(): Promise<void> {
  const options = parseCliArgs(process.argv.slice(2));
  const report = runTreeA11yEvaluation();

  if (options.outPath) {
    const resolvedPath = path.resolve(options.outPath);
    await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
    await fs.writeFile(resolvedPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(`Wrote tree accessibility evaluation report to ${resolvedPath}`);
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
    throw new Error(`Unsupported argument '${arg}'.`);
  }

  return parsed;
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
