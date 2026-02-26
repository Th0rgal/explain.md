import path from "node:path";
import process from "node:process";
import { ingestLeanProject } from "../dist/lean-ingestion.js";

async function main() {
  const args = process.argv.slice(2);
  const cwd = process.cwd();

  let projectRoot = cwd;
  let sourceBaseUrl;
  let strictUnsupported = false;

  for (const arg of args) {
    if (arg.startsWith("--source-base-url=")) {
      sourceBaseUrl = arg.slice("--source-base-url=".length);
      continue;
    }
    if (arg === "--strict-unsupported") {
      strictUnsupported = true;
      continue;
    }
    if (!arg.startsWith("--")) {
      projectRoot = path.resolve(cwd, arg);
    }
  }

  const result = await ingestLeanProject(projectRoot, {
    sourceBaseUrl,
    strictUnsupported,
  });

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`lean-ingest failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
