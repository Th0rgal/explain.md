import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { SourceSpan, TheoremLeafRecord } from "./leaf-schema.js";

export const VERIFICATION_LEDGER_SCHEMA_VERSION = "1.0.0";

export type VerificationStatus = "queued" | "running" | "success" | "failure" | "timeout";

export interface VerificationTarget {
  leafId: string;
  declarationId: string;
  modulePath: string;
  declarationName: string;
  sourceSpan: SourceSpan;
  sourceUrl?: string;
}

export interface VerificationToolchainInfo {
  leanVersion: string;
  lakeVersion?: string;
}

export interface VerificationReproducibilityContract {
  sourceRevision: string;
  workingDirectory: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  toolchain: VerificationToolchainInfo;
}

export interface VerificationReplayDescriptor {
  reproducibilityHash: string;
  replayCommand: string;
}

export interface VerificationLogLine {
  index: number;
  stream: "stdout" | "stderr" | "system";
  message: string;
}

export interface VerificationResult {
  exitCode: number | null;
  signal: string | null;
  durationMs: number;
  logsTruncated: boolean;
  logLineCount: number;
}

export interface VerificationJob {
  schemaVersion: string;
  jobId: string;
  queueSequence: number;
  status: VerificationStatus;
  target: VerificationTarget;
  reproducibility: VerificationReproducibilityContract;
  timeoutMs: number;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  logs: VerificationLogLine[];
  result?: VerificationResult;
}

export interface VerificationLedger {
  schemaVersion: string;
  jobs: VerificationJob[];
}

export interface VerificationQueueOptions {
  timeoutMs?: number;
}

export interface VerificationQueueEntry {
  target: VerificationTarget;
  reproducibility: VerificationReproducibilityContract;
  options?: VerificationQueueOptions;
}

export interface VerificationRunOutput {
  exitCode: number | null;
  signal: string | null;
  durationMs: number;
  timedOut: boolean;
  stdout: string;
  stderr: string;
}

export interface VerificationCommandRunner {
  run(contract: VerificationReproducibilityContract, timeoutMs: number): Promise<VerificationRunOutput>;
}

export interface VerificationWorkflowOptions {
  runner: VerificationCommandRunner;
  now?: () => Date;
  idFactory?: () => string;
  defaultTimeoutMs?: number;
  maxLogLinesPerJob?: number;
}

interface WorkflowState {
  byId: Map<string, VerificationJob>;
  nextSequence: number;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_LOG_LINES = 400;

export class VerificationWorkflow {
  private readonly runner: VerificationCommandRunner;

  private readonly now: () => Date;

  private readonly idFactory: () => string;

  private readonly defaultTimeoutMs: number;

  private readonly maxLogLinesPerJob: number;

  private readonly state: WorkflowState;

  public constructor(options: VerificationWorkflowOptions, initialLedger?: VerificationLedger) {
    this.runner = options.runner;
    this.now = options.now ?? (() => new Date());
    this.idFactory = options.idFactory ?? (() => randomUUID());
    this.defaultTimeoutMs = normalizeTimeoutMs(options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS);
    this.maxLogLinesPerJob = normalizePositiveInt(options.maxLogLinesPerJob ?? DEFAULT_MAX_LOG_LINES, "maxLogLinesPerJob");
    this.state = buildWorkflowState(initialLedger);
  }

  public enqueue(entry: VerificationQueueEntry): VerificationJob {
    const timestamp = this.now().toISOString();
    const queueSequence = this.state.nextSequence;
    this.state.nextSequence += 1;

    const job: VerificationJob = {
      schemaVersion: VERIFICATION_LEDGER_SCHEMA_VERSION,
      jobId: this.idFactory(),
      queueSequence,
      status: "queued",
      target: canonicalizeVerificationTarget(entry.target),
      reproducibility: canonicalizeReproducibilityContract(entry.reproducibility),
      timeoutMs: normalizeTimeoutMs(entry.options?.timeoutMs ?? this.defaultTimeoutMs),
      createdAt: timestamp,
      updatedAt: timestamp,
      logs: [],
    };

    if (this.state.byId.has(job.jobId)) {
      throw new Error(`Verification job id already exists: ${job.jobId}`);
    }

    this.state.byId.set(job.jobId, job);
    return cloneJob(job);
  }

  public getJob(jobId: string): VerificationJob | undefined {
    const job = this.state.byId.get(jobId);
    return job ? cloneJob(job) : undefined;
  }

  public listJobs(): VerificationJob[] {
    return getSortedJobs(this.state.byId).map((job) => cloneJob(job));
  }

  public listJobsForLeaf(leafId: string): VerificationJob[] {
    const normalizedLeafId = normalizeRequired(leafId, "leafId");
    return getSortedJobs(this.state.byId)
      .filter((job) => job.target.leafId === normalizedLeafId)
      .map((job) => cloneJob(job));
  }

  public async runNextQueuedJob(): Promise<VerificationJob | null> {
    const queued = getSortedJobs(this.state.byId).find((job) => job.status === "queued");
    if (!queued) {
      return null;
    }

    return this.runJob(queued.jobId);
  }

  public async runJob(jobId: string): Promise<VerificationJob> {
    const normalizedJobId = normalizeRequired(jobId, "jobId");
    const job = this.state.byId.get(normalizedJobId);
    if (!job) {
      throw new Error(`Verification job '${normalizedJobId}' does not exist.`);
    }

    if (job.status !== "queued") {
      throw new Error(`Verification job '${normalizedJobId}' is not queued (current status: ${job.status}).`);
    }

    const startedAt = this.now().toISOString();
    job.status = "running";
    job.startedAt = startedAt;
    job.updatedAt = startedAt;

    let output: VerificationRunOutput;
    try {
      output = await this.runner.run(job.reproducibility, job.timeoutMs);
    } catch (error: unknown) {
      const finishedAt = this.now().toISOString();
      const message = error instanceof Error ? error.message : String(error);
      job.logs = capLogs([{ index: 0, stream: "system", message: `Runner error: ${message}` }], this.maxLogLinesPerJob);
      job.status = "failure";
      job.updatedAt = finishedAt;
      job.finishedAt = finishedAt;
      job.result = {
        exitCode: null,
        signal: null,
        durationMs: 0,
        logsTruncated: false,
        logLineCount: job.logs.length,
      };
      return cloneJob(job);
    }

    const lines = collectVerificationLogs(output.stdout, output.stderr);
    const cappedLogs = capLogs(lines, this.maxLogLinesPerJob);

    const finishedAt = this.now().toISOString();
    job.logs = cappedLogs;
    job.updatedAt = finishedAt;
    job.finishedAt = finishedAt;

    if (output.timedOut) {
      job.status = "timeout";
    } else if (output.exitCode === 0) {
      job.status = "success";
    } else {
      job.status = "failure";
    }

    job.result = {
      exitCode: output.exitCode,
      signal: output.signal,
      durationMs: normalizeDurationMs(output.durationMs),
      logsTruncated: cappedLogs.length < lines.length,
      logLineCount: lines.length,
    };

    return cloneJob(job);
  }

  public toLedger(): VerificationLedger {
    return {
      schemaVersion: VERIFICATION_LEDGER_SCHEMA_VERSION,
      jobs: getSortedJobs(this.state.byId).map((job) => cloneJob(job)),
    };
  }
}

export function createVerificationTargetFromLeaf(leaf: TheoremLeafRecord): VerificationTarget {
  return canonicalizeVerificationTarget({
    leafId: leaf.id,
    declarationId: leaf.declarationId,
    modulePath: leaf.modulePath,
    declarationName: leaf.declarationName,
    sourceSpan: leaf.sourceSpan,
    sourceUrl: leaf.sourceUrl,
  });
}

export function buildLeanVerificationContract(params: {
  projectRoot: string;
  sourceRevision: string;
  filePath: string;
  leanVersion: string;
  lakeVersion?: string;
  command?: string;
  argsPrefix?: string[];
  env?: Record<string, string>;
}): VerificationReproducibilityContract {
  const command = normalizeOptional(params.command) ?? "lake";
  const argsPrefix = (params.argsPrefix ?? ["env", "lean"]).map((value) => normalizeRequired(value, "argsPrefix"));

  return canonicalizeReproducibilityContract({
    sourceRevision: params.sourceRevision,
    workingDirectory: path.resolve(params.projectRoot),
    command,
    args: [...argsPrefix, normalizeRequired(params.filePath, "filePath")],
    env: params.env ?? {},
    toolchain: {
      leanVersion: params.leanVersion,
      lakeVersion: params.lakeVersion,
    },
  });
}

export function renderVerificationReproducibilityCanonical(contract: VerificationReproducibilityContract): string {
  const normalized = canonicalizeReproducibilityContract(contract);
  const lines = [
    `source_revision=${normalized.sourceRevision}`,
    `working_directory=${normalized.workingDirectory}`,
    `command=${normalized.command}`,
    `args=${normalized.args.join("\u001f")}`,
    `toolchain_lean=${normalized.toolchain.leanVersion}`,
    `toolchain_lake=${normalized.toolchain.lakeVersion ?? "none"}`,
    `env=${Object.entries(normalized.env)
      .map(([key, value]) => `${key}=${value}`)
      .join("\u001f") || "none"}`,
  ];

  return lines.join("\n");
}

export function computeVerificationReproducibilityHash(contract: VerificationReproducibilityContract): string {
  return createHash("sha256").update(renderVerificationReproducibilityCanonical(contract)).digest("hex");
}

export function renderVerificationReplayCommand(contract: VerificationReproducibilityContract): string {
  const normalized = canonicalizeReproducibilityContract(contract);
  const envPrefix = Object.entries(normalized.env)
    .map(([key, value]) => `${key}=${escapeShellToken(value)}`)
    .join(" ");
  const commandTokens = [normalized.command, ...normalized.args].map((token) => escapeShellToken(token)).join(" ");
  const executable = envPrefix.length > 0 ? `${envPrefix} ${commandTokens}` : commandTokens;
  return `cd ${escapeShellToken(normalized.workingDirectory)} && ${executable}`;
}

export function buildVerificationReplayDescriptor(contract: VerificationReproducibilityContract): VerificationReplayDescriptor {
  const normalized = canonicalizeReproducibilityContract(contract);
  return {
    reproducibilityHash: computeVerificationReproducibilityHash(normalized),
    replayCommand: renderVerificationReplayCommand(normalized),
  };
}

export function renderVerificationJobCanonical(job: VerificationJob): string {
  const normalized = canonicalizeVerificationJob(job);
  const lines = [
    `schema=${normalized.schemaVersion}`,
    `job_id=${normalized.jobId}`,
    `queue_sequence=${normalized.queueSequence}`,
    `status=${normalized.status}`,
    `leaf_id=${normalized.target.leafId}`,
    `declaration_id=${normalized.target.declarationId}`,
    `module_path=${normalized.target.modulePath}`,
    `declaration_name=${normalized.target.declarationName}`,
    `source_span=${formatSourceSpan(normalized.target.sourceSpan)}`,
    `source_url=${normalized.target.sourceUrl ?? "none"}`,
    `timeout_ms=${normalized.timeoutMs}`,
    `created_at=${normalized.createdAt}`,
    `updated_at=${normalized.updatedAt}`,
    `started_at=${normalized.startedAt ?? "none"}`,
    `finished_at=${normalized.finishedAt ?? "none"}`,
    `command=${normalized.reproducibility.command}`,
    `args=${normalized.reproducibility.args.join("\u001f")}`,
    `working_directory=${normalized.reproducibility.workingDirectory}`,
    `source_revision=${normalized.reproducibility.sourceRevision}`,
    `toolchain_lean=${normalized.reproducibility.toolchain.leanVersion}`,
    `toolchain_lake=${normalized.reproducibility.toolchain.lakeVersion ?? "none"}`,
    `env=${Object.entries(normalized.reproducibility.env)
      .map(([key, value]) => `${key}=${value}`)
      .join("\u001f") || "none"}`,
    `result_exit_code=${normalized.result?.exitCode ?? "none"}`,
    `result_signal=${normalized.result?.signal ?? "none"}`,
    `result_duration_ms=${normalized.result?.durationMs ?? "none"}`,
    `result_logs_truncated=${normalized.result?.logsTruncated ?? "none"}`,
    `result_log_line_count=${normalized.result?.logLineCount ?? "none"}`,
    `logs_count=${normalized.logs.length}`,
    ...normalized.logs.map((log) => `log[${log.index}]=${log.stream}:${JSON.stringify(log.message)}`),
  ];

  return lines.join("\n");
}

export function computeVerificationJobHash(job: VerificationJob): string {
  return createHash("sha256").update(renderVerificationJobCanonical(job)).digest("hex");
}

export async function writeVerificationLedger(filePath: string, ledger: VerificationLedger): Promise<void> {
  const normalized = canonicalizeVerificationLedger(ledger);
  const target = path.resolve(filePath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
}

export async function readVerificationLedger(filePath: string): Promise<VerificationLedger> {
  const target = path.resolve(filePath);
  const content = await fs.readFile(target, "utf8");
  const parsed = JSON.parse(content) as VerificationLedger;
  return canonicalizeVerificationLedger(parsed);
}

export function canonicalizeVerificationLedger(ledger: VerificationLedger): VerificationLedger {
  if (!ledger || typeof ledger !== "object") {
    throw new Error("Verification ledger must be an object.");
  }

  const jobs = Array.isArray(ledger.jobs) ? ledger.jobs.map((job) => canonicalizeVerificationJob(job)) : [];
  jobs.sort(compareJobs);

  const seen = new Set<string>();
  for (const job of jobs) {
    if (seen.has(job.jobId)) {
      throw new Error(`Duplicate verification job id: ${job.jobId}`);
    }
    seen.add(job.jobId);
  }

  return {
    schemaVersion: normalizeOptional(ledger.schemaVersion) ?? VERIFICATION_LEDGER_SCHEMA_VERSION,
    jobs,
  };
}

function buildWorkflowState(initialLedger?: VerificationLedger): WorkflowState {
  const byId = new Map<string, VerificationJob>();
  let nextSequence = 0;

  if (initialLedger) {
    const canonicalLedger = canonicalizeVerificationLedger(initialLedger);
    for (const job of canonicalLedger.jobs) {
      byId.set(job.jobId, cloneJob(job));
      nextSequence = Math.max(nextSequence, job.queueSequence + 1);
    }
  }

  return { byId, nextSequence };
}

function canonicalizeVerificationJob(job: VerificationJob): VerificationJob {
  const status = normalizeStatus(job.status);

  const normalized: VerificationJob = {
    schemaVersion: normalizeOptional(job.schemaVersion) ?? VERIFICATION_LEDGER_SCHEMA_VERSION,
    jobId: normalizeRequired(job.jobId, "jobId"),
    queueSequence: normalizeSequence(job.queueSequence),
    status,
    target: canonicalizeVerificationTarget(job.target),
    reproducibility: canonicalizeReproducibilityContract(job.reproducibility),
    timeoutMs: normalizeTimeoutMs(job.timeoutMs),
    createdAt: normalizeIsoTimestamp(job.createdAt, "createdAt"),
    updatedAt: normalizeIsoTimestamp(job.updatedAt, "updatedAt"),
    startedAt: normalizeOptional(job.startedAt),
    finishedAt: normalizeOptional(job.finishedAt),
    logs: canonicalizeLogs(job.logs),
    result: job.result ? canonicalizeResult(job.result) : undefined,
  };

  if (status === "queued" && (normalized.startedAt || normalized.finishedAt || normalized.result)) {
    throw new Error(`Queued job '${normalized.jobId}' cannot contain run timestamps or result.`);
  }

  if (status === "running" && !normalized.startedAt) {
    throw new Error(`Running job '${normalized.jobId}' must include startedAt.`);
  }

  if ((status === "success" || status === "failure" || status === "timeout") && (!normalized.finishedAt || !normalized.result)) {
    throw new Error(`Completed job '${normalized.jobId}' must include finishedAt and result.`);
  }

  return normalized;
}

function canonicalizeResult(result: VerificationResult): VerificationResult {
  return {
    exitCode: result.exitCode === null ? null : normalizeInteger(result.exitCode, "result.exitCode"),
    signal: result.signal === null ? null : normalizeRequired(result.signal, "result.signal"),
    durationMs: normalizeDurationMs(result.durationMs),
    logsTruncated: Boolean(result.logsTruncated),
    logLineCount: normalizeInteger(result.logLineCount, "result.logLineCount"),
  };
}

function canonicalizeLogs(logs: VerificationLogLine[]): VerificationLogLine[] {
  if (!Array.isArray(logs)) {
    throw new Error("logs must be an array.");
  }

  const normalized = logs.map((log, index) => {
    const stream = normalizeLogStream(log.stream);
    return {
      index: normalizeInteger(log.index, `logs[${index}].index`),
      stream,
      message: normalizeRequired(log.message, `logs[${index}].message`),
    };
  });

  normalized.sort((left, right) => left.index - right.index);
  return normalized;
}

function canonicalizeVerificationTarget(target: VerificationTarget): VerificationTarget {
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

function canonicalizeReproducibilityContract(
  contract: VerificationReproducibilityContract,
): VerificationReproducibilityContract {
  const envEntries = Object.entries(contract.env ?? {})
    .map(([key, value]) => [normalizeRequired(key, "reproducibility.env key"), normalizeRequired(value, `reproducibility.env.${key}`)] as const)
    .sort(([left], [right]) => left.localeCompare(right));

  return {
    sourceRevision: normalizeRequired(contract.sourceRevision, "reproducibility.sourceRevision"),
    workingDirectory: path.resolve(normalizeRequired(contract.workingDirectory, "reproducibility.workingDirectory")),
    command: normalizeRequired(contract.command, "reproducibility.command"),
    args: (contract.args ?? []).map((value, index) => normalizeRequired(value, `reproducibility.args[${index}]`)),
    env: Object.fromEntries(envEntries),
    toolchain: {
      leanVersion: normalizeRequired(contract.toolchain?.leanVersion, "reproducibility.toolchain.leanVersion"),
      lakeVersion: normalizeOptional(contract.toolchain?.lakeVersion),
    },
  };
}

function normalizeStatus(status: VerificationStatus): VerificationStatus {
  if (status === "queued" || status === "running" || status === "success" || status === "failure" || status === "timeout") {
    return status;
  }
  throw new Error(`Unsupported verification status: ${status}`);
}

function normalizeLogStream(stream: VerificationLogLine["stream"]): VerificationLogLine["stream"] {
  if (stream === "stdout" || stream === "stderr" || stream === "system") {
    return stream;
  }
  throw new Error(`Unsupported log stream: ${stream}`);
}

function normalizeIsoTimestamp(value: string, field: string): string {
  const normalized = normalizeRequired(value, field);
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${field} must be a valid ISO-8601 timestamp.`);
  }
  return date.toISOString();
}

function normalizeSequence(value: number): number {
  return normalizeInteger(value, "queueSequence");
}

function normalizeDurationMs(value: number): number {
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized < 0) {
    throw new Error("durationMs must be a finite non-negative number.");
  }
  return Math.round(normalized);
}

function normalizeTimeoutMs(value: number): number {
  const normalized = normalizeInteger(value, "timeoutMs");
  if (normalized <= 0) {
    throw new Error("timeoutMs must be > 0.");
  }
  return normalized;
}

function escapeShellToken(value: string): string {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(value)) {
    return value;
  }
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function normalizePositiveInt(value: number, field: string): number {
  const normalized = normalizeInteger(value, field);
  if (normalized <= 0) {
    throw new Error(`${field} must be > 0.`);
  }
  return normalized;
}

function normalizeInteger(value: number, field: string): number {
  const normalized = Number(value);
  if (!Number.isInteger(normalized)) {
    throw new Error(`${field} must be an integer.`);
  }
  return normalized;
}

function normalizeRequired(value: string, field: string): string {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    throw new Error(`${field} is required.`);
  }
  return normalized;
}

function normalizeOptional(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function collectVerificationLogs(stdout: string, stderr: string): VerificationLogLine[] {
  const stdoutLines = splitLines(stdout).map((message, index) => ({ index, stream: "stdout" as const, message }));
  const stderrLines = splitLines(stderr).map((message, index) => ({ index, stream: "stderr" as const, message }));

  const merged: VerificationLogLine[] = [];
  const max = Math.max(stdoutLines.length, stderrLines.length);

  for (let index = 0; index < max; index += 1) {
    if (stdoutLines[index]) {
      merged.push({
        index: merged.length,
        stream: "stdout",
        message: stdoutLines[index].message,
      });
    }

    if (stderrLines[index]) {
      merged.push({
        index: merged.length,
        stream: "stderr",
        message: stderrLines[index].message,
      });
    }
  }

  return merged;
}

function splitLines(content: string): string[] {
  if (!content) {
    return [];
  }

  return content
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function capLogs(lines: VerificationLogLine[], maxLines: number): VerificationLogLine[] {
  if (maxLines <= 0) {
    return [
      {
        index: 0,
        stream: "system",
        message: `Truncated ${lines.length} log lines.`,
      },
    ];
  }

  if (lines.length <= maxLines) {
    return lines;
  }

  const kept = lines.slice(0, maxLines - 1).map((line, index) => ({ ...line, index }));
  kept.push({
    index: kept.length,
    stream: "system",
    message: `Truncated ${lines.length - kept.length} log lines.`,
  });
  return kept;
}

function compareJobs(left: VerificationJob, right: VerificationJob): number {
  if (left.queueSequence !== right.queueSequence) {
    return left.queueSequence - right.queueSequence;
  }
  return left.jobId.localeCompare(right.jobId);
}

function getSortedJobs(byId: Map<string, VerificationJob>): VerificationJob[] {
  return [...byId.values()].sort(compareJobs);
}

function cloneJob(job: VerificationJob): VerificationJob {
  return {
    schemaVersion: job.schemaVersion,
    jobId: job.jobId,
    queueSequence: job.queueSequence,
    status: job.status,
    target: {
      ...job.target,
      sourceSpan: { ...job.target.sourceSpan },
    },
    reproducibility: {
      ...job.reproducibility,
      args: [...job.reproducibility.args],
      env: { ...job.reproducibility.env },
      toolchain: { ...job.reproducibility.toolchain },
    },
    timeoutMs: job.timeoutMs,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    logs: job.logs.map((line) => ({ ...line })),
    result: job.result ? { ...job.result } : undefined,
  };
}

function formatSourceSpan(sourceSpan: SourceSpan): string {
  return `${sourceSpan.filePath}:${sourceSpan.startLine}:${sourceSpan.startColumn}-${sourceSpan.endLine}:${sourceSpan.endColumn}`;
}
