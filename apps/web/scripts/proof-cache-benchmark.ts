import { promises as fs } from "node:fs";
import path from "node:path";
import { runProofCacheBenchmark } from "../lib/proof-cache-benchmark";

interface CliOptions {
  outPath?: string;
  coldIterations?: number;
  warmIterations?: number;
  keepTempDirs: boolean;
}

async function main(): Promise<void> {
  const options = parseCliArgs(process.argv.slice(2));
  const report = await runProofCacheBenchmark({
    coldIterations: options.coldIterations,
    warmIterations: options.warmIterations,
    keepTempDirs: options.keepTempDirs,
  });

  if (options.outPath) {
    const resolvedPath = path.resolve(options.outPath);
    await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
    await fs.writeFile(resolvedPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(`Wrote benchmark report to ${resolvedPath}`);
    return;
  }

  console.log(JSON.stringify(report, null, 2));
}

function parseCliArgs(argv: string[]): CliOptions {
  const parsed: CliOptions = {
    keepTempDirs: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--keep-temp-dirs") {
      parsed.keepTempDirs = true;
      continue;
    }
    if (arg.startsWith("--out=")) {
      parsed.outPath = arg.slice("--out=".length).trim();
      continue;
    }
    if (arg === "--out") {
      parsed.outPath = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith("--cold-iterations=")) {
      parsed.coldIterations = Number.parseInt(arg.slice("--cold-iterations=".length), 10);
      continue;
    }
    if (arg === "--cold-iterations") {
      parsed.coldIterations = Number.parseInt(argv[index + 1] ?? "", 10);
      index += 1;
      continue;
    }
    if (arg.startsWith("--warm-iterations=")) {
      parsed.warmIterations = Number.parseInt(arg.slice("--warm-iterations=".length), 10);
      continue;
    }
    if (arg === "--warm-iterations") {
      parsed.warmIterations = Number.parseInt(argv[index + 1] ?? "", 10);
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
