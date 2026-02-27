import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  VerificationWorkflow,
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
import { findSeedLeaf, SEED_PROOF_ID } from "./proof-service";

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
}

const DEFAULT_LEDGER_PATH = path.resolve(process.cwd(), ".explain-md", "web-verification-ledger.json");

let overrides: VerificationServiceOverrides = {};
let contextPromise: Promise<VerificationServiceContext> | undefined;

export interface VerifyLeafRequest {
  proofId: string;
  leafId: string;
  autoRun?: boolean;
}

export interface VerifyLeafResponse {
  requestHash: string;
  queuedJob: VerificationJob;
  queuedJobHash: string;
  finalJob: VerificationJob;
  finalJobHash: string;
}

export interface VerificationJobsResponse {
  proofId: string;
  leafId: string;
  jobs: VerificationJob[];
  jobHashes: Array<{ jobId: string; hash: string }>;
}

export async function verifyLeafProof(request: VerifyLeafRequest): Promise<VerifyLeafResponse> {
  const proofId = normalizeRequired(request.proofId, "proofId");
  const leafId = normalizeRequired(request.leafId, "leafId");
  assertSupportedProof(proofId);

  const context = await getContext();
  const queueEntry = buildQueueEntry(proofId, leafId);
  const queuedJob = context.workflow.enqueue(queueEntry);
  await persist(context);

  const finalJob = request.autoRun === false ? queuedJob : await context.workflow.runJob(queuedJob.jobId);
  if (request.autoRun !== false) {
    await persist(context);
  }

  return {
    requestHash: computeRequestHash({ proofId, leafId, autoRun: request.autoRun !== false }),
    queuedJob,
    queuedJobHash: computeVerificationJobHash(queuedJob),
    finalJob,
    finalJobHash: computeVerificationJobHash(finalJob),
  };
}

export async function listLeafVerificationJobs(proofId: string, leafId: string): Promise<VerificationJobsResponse> {
  const normalizedProofId = normalizeRequired(proofId, "proofId");
  const normalizedLeafId = normalizeRequired(leafId, "leafId");
  assertSupportedProof(normalizedProofId);

  const context = await getContext();
  const jobs = context.workflow.listJobsForLeaf(normalizedLeafId);

  return {
    proofId: normalizedProofId,
    leafId: normalizedLeafId,
    jobs,
    jobHashes: jobs.map((job) => ({
      jobId: job.jobId,
      hash: computeVerificationJobHash(job),
    })),
  };
}

export async function getVerificationJobById(jobId: string): Promise<{ job: VerificationJob; jobHash: string } | null> {
  const normalizedJobId = normalizeRequired(jobId, "jobId");
  const context = await getContext();
  const job = context.workflow.getJob(normalizedJobId);
  if (!job) {
    return null;
  }
  return {
    job,
    jobHash: computeVerificationJobHash(job),
  };
}

export function configureVerificationServiceForTests(next: VerificationServiceOverrides): void {
  overrides = { ...next };
  contextPromise = undefined;
}

export function resetVerificationServiceForTests(): void {
  overrides = {};
  contextPromise = undefined;
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

function buildQueueEntry(proofId: string, leafId: string) {
  const leaf = findSeedLeaf(proofId, leafId);
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
  if (proofId !== SEED_PROOF_ID) {
    throw new Error(`Unsupported proofId '${proofId}'. Supported proofs: ${SEED_PROOF_ID}.`);
  }
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
