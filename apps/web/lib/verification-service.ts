import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  VerificationWorkflow,
  buildVerificationReplayDescriptor,
  buildLeanVerificationContract,
  computeVerificationJobHash,
  createVerificationTargetFromLeaf,
  readVerificationLedger,
  writeVerificationLedger,
  type VerificationCommandRunner,
  type VerificationJob,
  type VerificationWorkflowOptions,
} from "../../../dist/verification-flow";
import { createChildProcessVerificationRunner } from "../../../dist/verification-api";
import { findProofLeaf, getSupportedProofIds } from "./proof-service";

interface VerificationServiceContext {
  ledgerPath: string;
  workflow: VerificationWorkflow;
}

interface VerificationServiceOverrides {
  ledgerPath?: string;
  projectRoot?: string;
  sourceRevision?: string;
  leanVersion?: string;
  lakeVersion?: string;
  runner?: VerificationCommandRunner;
  defaultTimeoutMs?: number;
  maxLogLinesPerJob?: number;
  now?: VerificationWorkflowOptions["now"];
  nowMs?: () => number;
}

const DEFAULT_LEDGER_PATH = path.resolve(process.cwd(), ".explain-md", "web-verification-ledger.json");
const OBSERVABILITY_SAMPLE_WINDOW = 512;

let overrides: VerificationServiceOverrides = {};
let contextPromise: Promise<VerificationServiceContext> | undefined;

export type VerificationObservabilityQuery = "verify_leaf" | "list_leaf_jobs" | "get_job";

export interface VerificationQueryObservability {
  requestId: string;
  traceId: string;
  query: VerificationObservabilityQuery;
  parentTraceId?: string;
  spans: Array<{
    spanId: string;
    name: "request_parse" | "workflow_execute" | "response_materialization";
    attributes: Record<string, boolean | number | string>;
  }>;
  metrics: {
    latencyMs: number;
    totalJobs: number;
    queueDepth: number;
    queuedJobs: number;
    runningJobs: number;
    successJobs: number;
    failureJobs: number;
    timeoutJobs: number;
    returnedJobCount: number;
    autoRun: boolean;
  };
}

export interface VerificationObservabilityMetricsSnapshot {
  schemaVersion: "1.0.0";
  requestCount: number;
  failureCount: number;
  correlation: {
    parentTraceProvidedCount: number;
    parentTraceProvidedRate: number;
  };
  queries: Array<{
    query: VerificationObservabilityQuery;
    requestCount: number;
    failureCount: number;
    minLatencyMs: number;
    maxLatencyMs: number;
    meanLatencyMs: number;
    p95LatencyMs: number;
  }>;
  generatedAt: string;
  snapshotHash: string;
}

interface VerificationObservabilityEvent {
  query: VerificationObservabilityQuery;
  latencyMs: number;
  failed: boolean;
  parentTraceProvided: boolean;
}

const verificationObservabilityEvents: VerificationObservabilityEvent[] = [];

export interface VerifyLeafRequest {
  proofId: string;
  leafId: string;
  autoRun?: boolean;
  parentTraceId?: string;
}

export interface VerifyLeafResponse {
  requestHash: string;
  queuedJob: VerificationJob;
  queuedJobHash: string;
  queuedJobReplay: VerificationJobReplay;
  finalJob: VerificationJob;
  finalJobHash: string;
  finalJobReplay: VerificationJobReplay;
  observability: VerificationQueryObservability;
}

export interface VerificationJobReplay {
  jobId: string;
  jobHash: string;
  reproducibilityHash: string;
  replayCommand: string;
}

export interface VerificationJobsResponse {
  proofId: string;
  leafId: string;
  requestHash: string;
  jobs: VerificationJob[];
  jobHashes: Array<{ jobId: string; hash: string }>;
  jobReplays: VerificationJobReplay[];
  observability: VerificationQueryObservability;
}

export interface VerificationJobResponse {
  requestHash: string;
  job: VerificationJob;
  jobHash: string;
  jobReplay: VerificationJobReplay;
  observability: VerificationQueryObservability;
}

export async function verifyLeafProof(request: VerifyLeafRequest): Promise<VerifyLeafResponse> {
  const startedAt = nowMs();
  const proofId = normalizeRequired(request.proofId, "proofId");
  const leafId = normalizeRequired(request.leafId, "leafId");
  const autoRun = request.autoRun !== false;
  const parentTraceId = normalizeOptional(request.parentTraceId);
  const requestHash = computeRequestHash({ proofId, leafId, autoRun, query: "verify_leaf" });

  try {
    assertSupportedProof(proofId);
    const context = await getContext();
    const queueEntry = await buildQueueEntryAsync(proofId, leafId);
    const queuedJob = context.workflow.enqueue(queueEntry);
    await persist(context);

    const finalJob = autoRun ? await context.workflow.runJob(queuedJob.jobId) : queuedJob;
    if (autoRun) {
      await persist(context);
    }

    const jobStats = computeJobStatusMetrics(context.workflow.listJobsForLeaf(leafId));
    const observability = buildVerificationQueryObservability({
      query: "verify_leaf",
      proofId,
      leafId,
      requestHash,
      parentTraceId,
      latencyMs: elapsedMs(startedAt),
      jobStats,
      returnedJobCount: 1,
      autoRun,
    });

    recordVerificationObservabilityEvent({
      query: observability.query,
      latencyMs: observability.metrics.latencyMs,
      failed: false,
      parentTraceProvided: Boolean(parentTraceId),
    });

    return {
      requestHash,
      queuedJob,
      queuedJobHash: computeVerificationJobHash(queuedJob),
      queuedJobReplay: buildVerificationJobReplay(queuedJob),
      finalJob,
      finalJobHash: computeVerificationJobHash(finalJob),
      finalJobReplay: buildVerificationJobReplay(finalJob),
      observability,
    };
  } catch (error) {
    recordVerificationObservabilityEvent({
      query: "verify_leaf",
      latencyMs: elapsedMs(startedAt),
      failed: true,
      parentTraceProvided: Boolean(parentTraceId),
    });
    throw error;
  }
}

export async function listLeafVerificationJobs(
  proofId: string,
  leafId: string,
  options: { parentTraceId?: string } = {},
): Promise<VerificationJobsResponse> {
  const startedAt = nowMs();
  const normalizedProofId = normalizeRequired(proofId, "proofId");
  const normalizedLeafId = normalizeRequired(leafId, "leafId");
  const parentTraceId = normalizeOptional(options.parentTraceId);
  const requestHash = computeRequestHash({ proofId: normalizedProofId, leafId: normalizedLeafId, query: "list_leaf_jobs" });

  try {
    assertSupportedProof(normalizedProofId);

    const context = await getContext();
    const jobs = context.workflow.listJobsForLeaf(normalizedLeafId);
    const observability = buildVerificationQueryObservability({
      query: "list_leaf_jobs",
      proofId: normalizedProofId,
      leafId: normalizedLeafId,
      requestHash,
      parentTraceId,
      latencyMs: elapsedMs(startedAt),
      jobStats: computeJobStatusMetrics(jobs),
      returnedJobCount: jobs.length,
      autoRun: false,
    });

    recordVerificationObservabilityEvent({
      query: observability.query,
      latencyMs: observability.metrics.latencyMs,
      failed: false,
      parentTraceProvided: Boolean(parentTraceId),
    });

    return {
      proofId: normalizedProofId,
      leafId: normalizedLeafId,
      requestHash,
      jobs,
      jobHashes: jobs.map((job) => ({
        jobId: job.jobId,
        hash: computeVerificationJobHash(job),
      })),
      jobReplays: jobs.map((job) => buildVerificationJobReplay(job)),
      observability,
    };
  } catch (error) {
    recordVerificationObservabilityEvent({
      query: "list_leaf_jobs",
      latencyMs: elapsedMs(startedAt),
      failed: true,
      parentTraceProvided: Boolean(parentTraceId),
    });
    throw error;
  }
}

export async function getVerificationJobById(
  jobId: string,
  options: { parentTraceId?: string } = {},
): Promise<VerificationJobResponse | null> {
  const startedAt = nowMs();
  const normalizedJobId = normalizeRequired(jobId, "jobId");
  const parentTraceId = normalizeOptional(options.parentTraceId);
  const requestHash = computeRequestHash({ jobId: normalizedJobId, query: "get_job" });

  try {
    const context = await getContext();
    const job = context.workflow.getJob(normalizedJobId);
    if (!job) {
      recordVerificationObservabilityEvent({
        query: "get_job",
        latencyMs: elapsedMs(startedAt),
        failed: false,
        parentTraceProvided: Boolean(parentTraceId),
      });
      return null;
    }

    const observability = buildVerificationQueryObservability({
      query: "get_job",
      proofId: "verification-ledger",
      leafId: job.target.leafId,
      requestHash,
      parentTraceId,
      latencyMs: elapsedMs(startedAt),
      jobStats: computeJobStatusMetrics([job]),
      returnedJobCount: 1,
      autoRun: false,
    });

    recordVerificationObservabilityEvent({
      query: observability.query,
      latencyMs: observability.metrics.latencyMs,
      failed: false,
      parentTraceProvided: Boolean(parentTraceId),
    });

    return {
      requestHash,
      job,
      jobHash: computeVerificationJobHash(job),
      jobReplay: buildVerificationJobReplay(job),
      observability,
    };
  } catch (error) {
    recordVerificationObservabilityEvent({
      query: "get_job",
      latencyMs: elapsedMs(startedAt),
      failed: true,
      parentTraceProvided: Boolean(parentTraceId),
    });
    throw error;
  }
}

export function exportVerificationObservabilityMetrics(
  options: { generatedAt?: string } = {},
): VerificationObservabilityMetricsSnapshot {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const requestCount = verificationObservabilityEvents.length;
  const failureCount = verificationObservabilityEvents.filter((event) => event.failed).length;
  const parentTraceProvidedCount = verificationObservabilityEvents.filter((event) => event.parentTraceProvided).length;

  const queries = ["verify_leaf", "list_leaf_jobs", "get_job"].map((query) => {
    const events = verificationObservabilityEvents.filter((event) => event.query === query);
    const latencies = events.map((event) => event.latencyMs).sort((left, right) => left - right);
    const requestCountForQuery = events.length;
    const failureCountForQuery = events.filter((event) => event.failed).length;

    return {
      query,
      requestCount: requestCountForQuery,
      failureCount: failureCountForQuery,
      minLatencyMs: latencies[0] ?? 0,
      maxLatencyMs: latencies[latencies.length - 1] ?? 0,
      meanLatencyMs: requestCountForQuery === 0 ? 0 : sum(latencies) / requestCountForQuery,
      p95LatencyMs: percentile(latencies, 0.95),
    };
  }) as VerificationObservabilityMetricsSnapshot["queries"];

  const snapshotWithoutHash = {
    schemaVersion: "1.0.0" as const,
    requestCount,
    failureCount,
    correlation: {
      parentTraceProvidedCount,
      parentTraceProvidedRate: requestCount === 0 ? 0 : parentTraceProvidedCount / requestCount,
    },
    queries,
    generatedAt,
  };

  return {
    ...snapshotWithoutHash,
    snapshotHash: computeRequestHash(snapshotWithoutHash),
  };
}

export function clearVerificationObservabilityMetricsForTests(): void {
  verificationObservabilityEvents.length = 0;
}

export function configureVerificationServiceForTests(next: VerificationServiceOverrides): void {
  overrides = { ...next };
  contextPromise = undefined;
}

export function resetVerificationServiceForTests(): void {
  overrides = {};
  contextPromise = undefined;
  clearVerificationObservabilityMetricsForTests();
}

async function getContext(): Promise<VerificationServiceContext> {
  if (!contextPromise) {
    contextPromise = createContext();
  }
  return contextPromise;
}

async function createContext(): Promise<VerificationServiceContext> {
  const ledgerPath = path.resolve(overrides.ledgerPath ?? process.env.EXPLAIN_MD_WEB_VERIFICATION_LEDGER ?? DEFAULT_LEDGER_PATH);
  const initialLedger = await readLedgerIfExists(ledgerPath);
  let nextJobId = computeNextJobId(initialLedger?.jobs.map((job) => job.jobId) ?? []);
  const runner = overrides.runner ?? createChildProcessVerificationRunner();

  const workflow = new VerificationWorkflow(
    {
      runner,
      now: overrides.now,
      idFactory: () => {
        const jobId = `job-${String(nextJobId).padStart(6, "0")}`;
        nextJobId += 1;
        return jobId;
      },
      defaultTimeoutMs: overrides.defaultTimeoutMs ?? parsePositiveInt(process.env.EXPLAIN_MD_VERIFICATION_TIMEOUT_MS),
      maxLogLinesPerJob: overrides.maxLogLinesPerJob,
    },
    initialLedger,
  );

  return {
    ledgerPath,
    workflow,
  };
}

async function persist(context: VerificationServiceContext): Promise<void> {
  await writeVerificationLedger(context.ledgerPath, context.workflow.toLedger());
}

async function buildQueueEntryAsync(proofId: string, leafId: string) {
  const leaf = await findProofLeaf(proofId, leafId);
  if (!leaf) {
    throw new Error(`Leaf '${leafId}' was not found for proof '${proofId}'.`);
  }

  const target = createVerificationTargetFromLeaf(leaf);
  return {
    target,
    reproducibility: buildLeanVerificationContract({
      projectRoot: path.resolve(overrides.projectRoot ?? process.env.EXPLAIN_MD_VERIFICATION_PROJECT_ROOT ?? process.cwd()),
      sourceRevision:
        normalizeOptional(overrides.sourceRevision) ??
        normalizeOptional(process.env.EXPLAIN_MD_SOURCE_REVISION) ??
        normalizeOptional(process.env.VERCEL_GIT_COMMIT_SHA) ??
        "seed-revision",
      filePath: leaf.sourceSpan.filePath,
      leanVersion:
        normalizeOptional(overrides.leanVersion) ?? normalizeOptional(process.env.EXPLAIN_MD_VERIFICATION_LEAN_VERSION) ?? "unknown",
      lakeVersion: normalizeOptional(overrides.lakeVersion) ?? normalizeOptional(process.env.EXPLAIN_MD_VERIFICATION_LAKE_VERSION),
    }),
  };
}

function computeNextJobId(existingJobIds: string[]): number {
  let maxSeen = 0;
  for (const jobId of existingJobIds) {
    const match = jobId.match(/^job-(\d+)$/);
    if (!match) {
      continue;
    }
    const numeric = Number.parseInt(match[1], 10);
    if (Number.isInteger(numeric)) {
      maxSeen = Math.max(maxSeen, numeric);
    }
  }
  return maxSeen + 1;
}

async function readLedgerIfExists(ledgerPath: string) {
  try {
    await fs.access(ledgerPath);
  } catch {
    return undefined;
  }
  return readVerificationLedger(ledgerPath);
}

function assertSupportedProof(proofId: string): void {
  const supported = getSupportedProofIds();
  if (!supported.includes(proofId)) {
    throw new Error(`Unsupported proofId '${proofId}'. Supported proofs: ${supported.join(", ")}.`);
  }
}

function buildVerificationQueryObservability(input: {
  query: VerificationObservabilityQuery;
  proofId: string;
  leafId: string;
  requestHash: string;
  parentTraceId?: string;
  latencyMs: number;
  jobStats: ReturnType<typeof computeJobStatusMetrics>;
  returnedJobCount: number;
  autoRun: boolean;
}): VerificationQueryObservability {
  const traceId = computeRequestHash({
    requestId: input.requestHash,
    query: input.query,
    proofId: input.proofId,
    leafId: input.leafId,
    parentTraceId: input.parentTraceId ?? null,
  });

  const metrics: VerificationQueryObservability["metrics"] = {
    latencyMs: input.latencyMs,
    totalJobs: input.jobStats.totalJobs,
    queueDepth: input.jobStats.queuedJobs + input.jobStats.runningJobs,
    queuedJobs: input.jobStats.queuedJobs,
    runningJobs: input.jobStats.runningJobs,
    successJobs: input.jobStats.successJobs,
    failureJobs: input.jobStats.failureJobs,
    timeoutJobs: input.jobStats.timeoutJobs,
    returnedJobCount: input.returnedJobCount,
    autoRun: input.autoRun,
  };

  const spanAttributes = {
    query: input.query,
    proofId: input.proofId,
    leafId: input.leafId,
    ...metrics,
    parentTraceProvided: Boolean(input.parentTraceId),
  };

  const spanNames: VerificationQueryObservability["spans"][number]["name"][] = [
    "request_parse",
    "workflow_execute",
    "response_materialization",
  ];

  return {
    requestId: input.requestHash,
    traceId,
    query: input.query,
    parentTraceId: input.parentTraceId,
    spans: spanNames.map((name) => ({
      spanId: computeRequestHash({ traceId, name }),
      name,
      attributes: {
        ...spanAttributes,
      },
    })),
    metrics,
  };
}

function computeJobStatusMetrics(jobs: VerificationJob[]): {
  totalJobs: number;
  queuedJobs: number;
  runningJobs: number;
  successJobs: number;
  failureJobs: number;
  timeoutJobs: number;
} {
  let queuedJobs = 0;
  let runningJobs = 0;
  let successJobs = 0;
  let failureJobs = 0;
  let timeoutJobs = 0;

  for (const job of jobs) {
    if (job.status === "queued") {
      queuedJobs += 1;
    } else if (job.status === "running") {
      runningJobs += 1;
    } else if (job.status === "success") {
      successJobs += 1;
    } else if (job.status === "failure") {
      failureJobs += 1;
    } else if (job.status === "timeout") {
      timeoutJobs += 1;
    }
  }

  return {
    totalJobs: jobs.length,
    queuedJobs,
    runningJobs,
    successJobs,
    failureJobs,
    timeoutJobs,
  };
}

function recordVerificationObservabilityEvent(event: VerificationObservabilityEvent): void {
  verificationObservabilityEvents.push({
    ...event,
    latencyMs: Number.isFinite(event.latencyMs) ? Math.max(0, Math.round(event.latencyMs)) : 0,
  });
  if (verificationObservabilityEvents.length > OBSERVABILITY_SAMPLE_WINDOW) {
    verificationObservabilityEvents.splice(0, verificationObservabilityEvents.length - OBSERVABILITY_SAMPLE_WINDOW);
  }
}

function percentile(sortedValues: number[], quantile: number): number {
  if (sortedValues.length === 0) {
    return 0;
  }
  const clamped = Math.min(1, Math.max(0, quantile));
  const index = Math.min(sortedValues.length - 1, Math.ceil(clamped * sortedValues.length) - 1);
  return sortedValues[index] ?? 0;
}

function sum(values: number[]): number {
  return values.reduce((accumulator, value) => accumulator + value, 0);
}

function nowMs(): number {
  return overrides.nowMs ? overrides.nowMs() : Date.now();
}

function elapsedMs(startedAtMs: number): number {
  return Math.max(0, Math.round(nowMs() - startedAtMs));
}

function parsePositiveInt(raw: string | undefined): number | undefined {
  const normalized = normalizeOptional(raw);
  if (!normalized) {
    return undefined;
  }

  const numeric = Number(normalized);
  if (!Number.isInteger(numeric) || numeric <= 0) {
    throw new Error(`Expected positive integer timeout but received '${raw ?? ""}'.`);
  }

  return numeric;
}

function buildVerificationJobReplay(job: VerificationJob): VerificationJobReplay {
  const descriptor = buildVerificationReplayDescriptor(job.reproducibility);
  return {
    jobId: job.jobId,
    jobHash: computeVerificationJobHash(job),
    reproducibilityHash: descriptor.reproducibilityHash,
    replayCommand: descriptor.replayCommand,
  };
}

function computeRequestHash(input: Record<string, unknown>): string {
  const canonical = JSON.stringify(input, stableReplacer);
  return createHash("sha256").update(canonical).digest("hex");
}

function stableReplacer(_key: string, value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }

  const record = value as Record<string, unknown>;
  return Object.keys(record)
    .sort((left, right) => left.localeCompare(right))
    .reduce<Record<string, unknown>>((accumulator, key) => {
      accumulator[key] = record[key];
      return accumulator;
    }, {});
}

function normalizeOptional(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeRequired(value: string, field: string): string {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    throw new Error(`${field} is required.`);
  }
  return normalized;
}
