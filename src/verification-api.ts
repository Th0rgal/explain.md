import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  VerificationWorkflow,
  computeVerificationJobHash,
  readVerificationLedger,
  writeVerificationLedger,
  type VerificationCommandRunner,
  type VerificationQueueEntry,
  type VerificationQueueOptions,
  type VerificationReproducibilityContract,
  type VerificationRunOutput,
  type VerificationTarget,
  type VerificationWorkflowOptions,
} from "./verification-flow.js";

export interface ChildProcessRunnerOptions {
  additionalEnv?: Record<string, string>;
}

export interface VerificationHttpServerOptions extends Omit<VerificationWorkflowOptions, "runner"> {
  runner?: VerificationCommandRunner;
  ledgerPath: string;
  host?: string;
  port?: number;
}

export interface VerificationHttpServer {
  readonly url: string;
  readonly ledgerPath: string;
  close(): Promise<void>;
}

interface JsonResponse<T> {
  ok: true;
  data: T;
}

interface ErrorResponse {
  ok: false;
  error: {
    code: string;
    message: string;
  };
}

export function createChildProcessVerificationRunner(options?: ChildProcessRunnerOptions): VerificationCommandRunner {
  const additionalEnv = canonicalizeEnv(options?.additionalEnv ?? {});
  return {
    async run(contract: VerificationReproducibilityContract, timeoutMs: number): Promise<VerificationRunOutput> {
      return runVerificationCommand(contract, timeoutMs, additionalEnv);
    },
  };
}

export async function startVerificationHttpServer(options: VerificationHttpServerOptions): Promise<VerificationHttpServer> {
  const host = normalizeOptional(options.host) ?? "127.0.0.1";
  const port = normalizePort(options.port ?? 8787);
  const ledgerPath = path.resolve(options.ledgerPath);
  const runner = options.runner ?? createChildProcessVerificationRunner();
  const initialLedger = await readVerificationLedgerIfExists(ledgerPath);
  const workflow = new VerificationWorkflow(
    {
      runner,
      now: options.now,
      idFactory: options.idFactory,
      defaultTimeoutMs: options.defaultTimeoutMs,
      maxLogLinesPerJob: options.maxLogLinesPerJob,
    },
    initialLedger,
  );

  const server = createServer(async (request, response) => {
    try {
      await handleRequest(request, response, workflow, ledgerPath);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      writeJson(response, 500, {
        ok: false,
        error: {
          code: "internal_error",
          message,
        },
      } satisfies ErrorResponse);
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Unable to determine verification API server address.");
  }

  const url = `http://${address.address}:${address.port}`;
  return {
    url,
    ledgerPath,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  workflow: VerificationWorkflow,
  ledgerPath: string,
): Promise<void> {
  const method = normalizeOptional(request.method) ?? "GET";
  const url = new URL(request.url ?? "/", "http://localhost");
  const pathname = url.pathname;

  if (method === "GET" && pathname === "/health") {
    writeJson(response, 200, { ok: true, data: { status: "ok" } } satisfies JsonResponse<{ status: string }>);
    return;
  }

  if (method === "GET" && pathname === "/api/verification/jobs") {
    const leafId = normalizeOptional(url.searchParams.get("leafId") ?? undefined);
    const jobs = leafId ? workflow.listJobsForLeaf(leafId) : workflow.listJobs();
    writeJson(response, 200, { ok: true, data: buildJobsPayload(jobs) } satisfies JsonResponse<ReturnType<typeof buildJobsPayload>>);
    return;
  }

  if (method === "POST" && pathname === "/api/verification/jobs") {
    try {
      const payload = await readJsonBody<Partial<VerificationQueueEntry>>(request);
      const entry = canonicalizeQueueEntry(payload);
      const job = workflow.enqueue(entry);
      await persistLedger(ledgerPath, workflow);
      writeJson(response, 201, {
        ok: true,
        data: {
          job,
          jobHash: computeVerificationJobHash(job),
        },
      } satisfies JsonResponse<{ job: ReturnType<VerificationWorkflow["enqueue"]>; jobHash: string }>);
    } catch (error: unknown) {
      writeJson(response, 400, buildError("invalid_request", error));
    }
    return;
  }

  const jobRunMatch = matchPath(pathname, /^\/api\/verification\/jobs\/([^/]+)\/run$/);
  if (method === "POST" && jobRunMatch) {
    const jobId = decodeURIComponent(jobRunMatch[1]);
    try {
      const job = await workflow.runJob(jobId);
      await persistLedger(ledgerPath, workflow);
      writeJson(response, 200, {
        ok: true,
        data: {
          job,
          jobHash: computeVerificationJobHash(job),
        },
      } satisfies JsonResponse<{ job: Awaited<ReturnType<VerificationWorkflow["runJob"]>>; jobHash: string }>);
    } catch (error: unknown) {
      writeJson(response, 409, buildError("job_run_conflict", error));
    }
    return;
  }

  const jobGetMatch = matchPath(pathname, /^\/api\/verification\/jobs\/([^/]+)$/);
  if (method === "GET" && jobGetMatch) {
    const jobId = decodeURIComponent(jobGetMatch[1]);
    const job = workflow.getJob(jobId);
    if (!job) {
      writeJson(response, 404, {
        ok: false,
        error: {
          code: "job_not_found",
          message: `Verification job '${jobId}' was not found.`,
        },
      } satisfies ErrorResponse);
      return;
    }
    writeJson(response, 200, {
      ok: true,
      data: {
        job,
        jobHash: computeVerificationJobHash(job),
      },
    } satisfies JsonResponse<{ job: ReturnType<VerificationWorkflow["getJob"]>; jobHash: string }>);
    return;
  }

  if (method === "POST" && pathname === "/api/verification/run-next") {
    const job = await workflow.runNextQueuedJob();
    if (job) {
      await persistLedger(ledgerPath, workflow);
    }
    writeJson(response, 200, {
      ok: true,
      data: {
        job,
        jobHash: job ? computeVerificationJobHash(job) : undefined,
      },
    } satisfies JsonResponse<{ job: Awaited<ReturnType<VerificationWorkflow["runNextQueuedJob"]>>; jobHash?: string }>);
    return;
  }

  writeJson(response, 404, {
    ok: false,
    error: {
      code: "not_found",
      message: `Route ${method} ${pathname} does not exist.`,
    },
  } satisfies ErrorResponse);
}

function buildJobsPayload(jobs: ReturnType<VerificationWorkflow["listJobs"]>): {
  jobs: ReturnType<VerificationWorkflow["listJobs"]>;
  jobHashes: Array<{ jobId: string; hash: string }>;
} {
  return {
    jobs,
    jobHashes: jobs.map((job) => ({
      jobId: job.jobId,
      hash: computeVerificationJobHash(job),
    })),
  };
}

function matchPath(pathname: string, pattern: RegExp): RegExpMatchArray | null {
  const matched = pathname.match(pattern);
  return matched ?? null;
}

function writeJson(response: ServerResponse, statusCode: number, payload: JsonResponse<unknown> | ErrorResponse): void {
  const content = `${JSON.stringify(payload)}\n`;
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("content-length", Buffer.byteLength(content));
  response.end(content);
}

function buildError(code: string, error: unknown): ErrorResponse {
  return {
    ok: false,
    error: {
      code,
      message: error instanceof Error ? error.message : String(error),
    },
  };
}

async function readJsonBody<T>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  if (chunks.length === 0) {
    throw new Error("Request body is required.");
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Request body must be valid JSON.");
  }
  return parsed as T;
}

function canonicalizeQueueEntry(entry: Partial<VerificationQueueEntry>): VerificationQueueEntry {
  if (!entry || typeof entry !== "object") {
    throw new Error("Queue payload must be an object.");
  }

  return {
    target: canonicalizeTarget(entry.target),
    reproducibility: canonicalizeContract(entry.reproducibility),
    options: canonicalizeOptions(entry.options),
  };
}

function canonicalizeTarget(target: Partial<VerificationTarget> | undefined): VerificationTarget {
  if (!target || typeof target !== "object") {
    throw new Error("target is required.");
  }

  if (!target.sourceSpan || typeof target.sourceSpan !== "object") {
    throw new Error("target.sourceSpan is required.");
  }

  return {
    leafId: normalizeRequired(target.leafId, "target.leafId"),
    declarationId: normalizeRequired(target.declarationId, "target.declarationId"),
    modulePath: normalizeRequired(target.modulePath, "target.modulePath"),
    declarationName: normalizeRequired(target.declarationName, "target.declarationName"),
    sourceSpan: {
      filePath: normalizeRequired(target.sourceSpan.filePath, "target.sourceSpan.filePath"),
      startLine: normalizePositiveInt(target.sourceSpan.startLine, "target.sourceSpan.startLine"),
      startColumn: normalizePositiveInt(target.sourceSpan.startColumn, "target.sourceSpan.startColumn"),
      endLine: normalizePositiveInt(target.sourceSpan.endLine, "target.sourceSpan.endLine"),
      endColumn: normalizePositiveInt(target.sourceSpan.endColumn, "target.sourceSpan.endColumn"),
    },
    sourceUrl: normalizeOptional(target.sourceUrl),
  };
}

function canonicalizeContract(contract: Partial<VerificationReproducibilityContract> | undefined): VerificationReproducibilityContract {
  if (!contract || typeof contract !== "object") {
    throw new Error("reproducibility is required.");
  }

  if (!Array.isArray(contract.args)) {
    throw new Error("reproducibility.args must be an array.");
  }

  return {
    sourceRevision: normalizeRequired(contract.sourceRevision, "reproducibility.sourceRevision"),
    workingDirectory: path.resolve(normalizeRequired(contract.workingDirectory, "reproducibility.workingDirectory")),
    command: normalizeRequired(contract.command, "reproducibility.command"),
    args: contract.args.map((arg, index) => normalizeRequired(arg, `reproducibility.args[${index}]`)),
    env: canonicalizeEnv(contract.env ?? {}),
    toolchain: {
      leanVersion: normalizeRequired(contract.toolchain?.leanVersion, "reproducibility.toolchain.leanVersion"),
      lakeVersion: normalizeOptional(contract.toolchain?.lakeVersion),
    },
  };
}

function canonicalizeOptions(options: Partial<VerificationQueueOptions> | undefined): VerificationQueueOptions | undefined {
  if (!options || typeof options !== "object") {
    return undefined;
  }

  if (options.timeoutMs === undefined) {
    return undefined;
  }

  return {
    timeoutMs: normalizePositiveInt(options.timeoutMs, "options.timeoutMs"),
  };
}

function canonicalizeEnv(env: Record<string, string>): Record<string, string> {
  const entries = Object.entries(env)
    .map(([key, value]) => [normalizeRequired(key, "env key"), normalizeRequired(value, `env.${key}`)] as const)
    .sort(([left], [right]) => left.localeCompare(right));
  return Object.fromEntries(entries);
}

function normalizeRequired(value: unknown, field: string): string {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    throw new Error(`${field} is required.`);
  }
  return normalized;
}

function normalizeOptional(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function normalizePositiveInt(value: unknown, field: string): number {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized <= 0) {
    throw new Error(`${field} must be a positive integer.`);
  }
  return normalized;
}

function normalizePort(value: number): number {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized < 0 || normalized > 65535) {
    throw new Error("port must be an integer in [0, 65535].");
  }
  return normalized;
}

async function readVerificationLedgerIfExists(ledgerPath: string) {
  try {
    await fs.access(ledgerPath);
  } catch {
    return undefined;
  }
  return readVerificationLedger(ledgerPath);
}

async function persistLedger(ledgerPath: string, workflow: VerificationWorkflow): Promise<void> {
  await writeVerificationLedger(ledgerPath, workflow.toLedger());
}

async function runVerificationCommand(
  contract: VerificationReproducibilityContract,
  timeoutMs: number,
  additionalEnv: Record<string, string>,
): Promise<VerificationRunOutput> {
  return new Promise<VerificationRunOutput>((resolve, reject) => {
    const startedAt = Date.now();
    const child = spawn(contract.command, contract.args, {
      cwd: contract.workingDirectory,
      env: {
        ...process.env,
        ...additionalEnv,
        ...contract.env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let timedOut = false;
    let settled = false;

    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdoutChunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      stderrChunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    });

    child.once("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeoutHandle);
      reject(error);
    });

    child.once("close", (code, signal) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeoutHandle);
      resolve({
        exitCode: code,
        signal,
        durationMs: Date.now() - startedAt,
        timedOut,
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
      });
    });
  });
}
