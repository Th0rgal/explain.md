import path from "node:path";
import process from "node:process";
import { createChildProcessVerificationRunner, startVerificationHttpServer } from "../dist/index.js";

const host = process.env.EXPLAIN_MD_VERIFICATION_HOST ?? "127.0.0.1";
const portRaw = process.env.EXPLAIN_MD_VERIFICATION_PORT ?? "8787";
const port = Number(portRaw);
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error(`Invalid EXPLAIN_MD_VERIFICATION_PORT: '${portRaw}'`);
  process.exit(1);
}

const ledgerPath = path.resolve(process.env.EXPLAIN_MD_VERIFICATION_LEDGER ?? ".explain-md/verification-ledger.json");
const defaultTimeoutRaw = process.env.EXPLAIN_MD_VERIFICATION_TIMEOUT_MS;
const defaultTimeoutMs = defaultTimeoutRaw ? Number(defaultTimeoutRaw) : undefined;
if (
  defaultTimeoutRaw &&
  (!Number.isInteger(defaultTimeoutMs) || (defaultTimeoutMs ?? 0) <= 0)
) {
  console.error(`Invalid EXPLAIN_MD_VERIFICATION_TIMEOUT_MS: '${defaultTimeoutRaw}'`);
  process.exit(1);
}

const server = await startVerificationHttpServer({
  host,
  port,
  ledgerPath,
  defaultTimeoutMs,
  runner: createChildProcessVerificationRunner(),
});

console.log(`verification_api_url=${server.url}`);
console.log(`verification_ledger_path=${server.ledgerPath}`);

const shutdown = async () => {
  await server.close();
};

process.on("SIGINT", async () => {
  await shutdown();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await shutdown();
  process.exit(0);
});
