import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { normalizeConfig, type ExplanationConfigInput } from "../../../dist/index";
import { computeConfigHash } from "../../../dist/config-contract";
import { LEAN_FIXTURE_PROOF_ID, buildProofCacheReportView, clearProofDatasetCacheForTests } from "./proof-service";

const BENCHMARK_SCHEMA_VERSION = "1.0.0";
const MUTATION_TARGET_RELATIVE_PATH = "Verity/Core.lean";
const MUTATION_COMMENT = "-- explain-md benchmark mutation";

export interface ProofCacheBenchmarkOptions {
  proofId?: string;
  config?: ExplanationConfigInput;
  coldIterations?: number;
  warmIterations?: number;
  fixtureProjectRoot?: string;
  cacheDir?: string;
  keepTempDirs?: boolean;
}

interface ScenarioSample {
  durationMs: number;
  status: "hit" | "miss";
}

export interface ProofCacheBenchmarkReport {
  schemaVersion: string;
  generatedAt: string;
  proofId: string;
  configHash: string;
  requestHash: string;
  outcomeHash: string;
  parameters: {
    coldIterations: number;
    warmIterations: number;
    mutationTargetPath: string;
  };
  paths: {
    fixtureProjectRootHash: string;
    cacheDirHash: string;
  };
  scenarios: {
    coldNoPersistentCache: ScenarioSummary;
    warmPersistentCache: ScenarioSummary;
    invalidation: {
      beforeChangeStatus: "hit" | "miss";
      afterChangeStatus: "hit" | "miss";
      afterChangeDiagnostics: string[];
      afterChangeSnapshotHash: string;
      recoveryStatus: "hit" | "miss";
      recoverySnapshotHash: string;
    };
  };
}

export interface ScenarioSummary {
  iterations: number;
  statuses: Array<"hit" | "miss">;
  meanMs: number;
  medianMs: number;
  minMs: number;
  maxMs: number;
}

export async function runProofCacheBenchmark(options: ProofCacheBenchmarkOptions = {}): Promise<ProofCacheBenchmarkReport> {
  const proofId = options.proofId ?? LEAN_FIXTURE_PROOF_ID;
  const coldIterations = normalizeIterationCount(options.coldIterations, 3);
  const warmIterations = normalizeIterationCount(options.warmIterations, 3);
  const normalizedConfig = normalizeConfig(options.config ?? {});
  const configHash = computeConfigHash(normalizedConfig);
  const fixtureSourceRoot = path.resolve(options.fixtureProjectRoot ?? (await resolveFixtureSourceRoot()));
  const fixtureProjectRoot = path.resolve(options.fixtureProjectRoot ?? (await fs.mkdtemp(path.join(os.tmpdir(), "explain-md-benchmark-fixture-"))));
  const cacheDir = path.resolve(options.cacheDir ?? (await fs.mkdtemp(path.join(os.tmpdir(), "explain-md-benchmark-cache-"))));
  const keepTempDirs = options.keepTempDirs ?? false;
  const ownsFixtureDir = !options.fixtureProjectRoot;
  const ownsCacheDir = !options.cacheDir;

  if (ownsFixtureDir) {
    await copyDirectory(fixtureSourceRoot, fixtureProjectRoot);
  }

  const previousFixtureRoot = process.env.EXPLAIN_MD_LEAN_FIXTURE_PROJECT_ROOT;
  const previousCacheDir = process.env.EXPLAIN_MD_WEB_PROOF_CACHE_DIR;
  process.env.EXPLAIN_MD_LEAN_FIXTURE_PROJECT_ROOT = fixtureProjectRoot;
  process.env.EXPLAIN_MD_WEB_PROOF_CACHE_DIR = cacheDir;

  try {
    await fs.mkdir(cacheDir, { recursive: true });
    clearProofDatasetCacheForTests();

    const coldSamples: ScenarioSample[] = [];
    for (let index = 0; index < coldIterations; index += 1) {
      await fs.rm(cacheDir, { recursive: true, force: true });
      await fs.mkdir(cacheDir, { recursive: true });
      clearProofDatasetCacheForTests();
      coldSamples.push(await captureCacheReportDuration(proofId, normalizedConfig));
    }

    await fs.rm(cacheDir, { recursive: true, force: true });
    await fs.mkdir(cacheDir, { recursive: true });
    clearProofDatasetCacheForTests();
    await buildProofCacheReportView({ proofId, config: normalizedConfig });

    const warmSamples: ScenarioSample[] = [];
    for (let index = 0; index < warmIterations; index += 1) {
      clearProofDatasetCacheForTests();
      warmSamples.push(await captureCacheReportDuration(proofId, normalizedConfig));
    }

    clearProofDatasetCacheForTests();
    const beforeChange = await buildProofCacheReportView({ proofId, config: normalizedConfig });
    const mutationPath = path.join(fixtureProjectRoot, MUTATION_TARGET_RELATIVE_PATH);
    const originalContent = await fs.readFile(mutationPath, "utf8");
    let afterChange: Awaited<ReturnType<typeof buildProofCacheReportView>>;
    let recovery: Awaited<ReturnType<typeof buildProofCacheReportView>>;
    try {
      await fs.writeFile(mutationPath, `${originalContent.trimEnd()}\n${MUTATION_COMMENT}\n`, "utf8");

      clearProofDatasetCacheForTests();
      afterChange = await buildProofCacheReportView({ proofId, config: normalizedConfig });
      clearProofDatasetCacheForTests();
      recovery = await buildProofCacheReportView({ proofId, config: normalizedConfig });
    } finally {
      await fs.writeFile(mutationPath, originalContent, "utf8");
    }

    const coldSummary = summarizeScenario(coldSamples);
    const warmSummary = summarizeScenario(warmSamples);
    const invalidation = {
      beforeChangeStatus: beforeChange.cache.status,
      afterChangeStatus: afterChange.cache.status,
      afterChangeDiagnostics: afterChange.cache.diagnostics.map((diagnostic) => diagnostic.code).sort(),
      afterChangeSnapshotHash: afterChange.cache.snapshotHash,
      recoveryStatus: recovery.cache.status,
      recoverySnapshotHash: recovery.cache.snapshotHash,
    };

    const requestHash = computeStableHash({
      schemaVersion: BENCHMARK_SCHEMA_VERSION,
      proofId,
      configHash,
      coldIterations,
      warmIterations,
    });
    const outcomeHash = computeStableHash({
      proofId,
      configHash,
      coldStatuses: coldSummary.statuses,
      warmStatuses: warmSummary.statuses,
      invalidation: {
        beforeChangeStatus: invalidation.beforeChangeStatus,
        afterChangeStatus: invalidation.afterChangeStatus,
        afterChangeDiagnostics: invalidation.afterChangeDiagnostics,
        recoveryStatus: invalidation.recoveryStatus,
        snapshotChangedOnMutation: invalidation.afterChangeSnapshotHash !== beforeChange.cache.snapshotHash,
      },
    });

    return {
      schemaVersion: BENCHMARK_SCHEMA_VERSION,
      generatedAt: new Date().toISOString(),
      proofId,
      configHash,
      requestHash,
      outcomeHash,
      parameters: {
        coldIterations,
        warmIterations,
        mutationTargetPath: MUTATION_TARGET_RELATIVE_PATH,
      },
      paths: {
        fixtureProjectRootHash: computeStableHash(fixtureProjectRoot),
        cacheDirHash: computeStableHash(cacheDir),
      },
      scenarios: {
        coldNoPersistentCache: coldSummary,
        warmPersistentCache: warmSummary,
        invalidation,
      },
    };
  } finally {
    clearProofDatasetCacheForTests();
    if (previousFixtureRoot === undefined) {
      delete process.env.EXPLAIN_MD_LEAN_FIXTURE_PROJECT_ROOT;
    } else {
      process.env.EXPLAIN_MD_LEAN_FIXTURE_PROJECT_ROOT = previousFixtureRoot;
    }
    if (previousCacheDir === undefined) {
      delete process.env.EXPLAIN_MD_WEB_PROOF_CACHE_DIR;
    } else {
      process.env.EXPLAIN_MD_WEB_PROOF_CACHE_DIR = previousCacheDir;
    }

    if (!keepTempDirs) {
      if (ownsFixtureDir) {
        await fs.rm(fixtureProjectRoot, { recursive: true, force: true });
      }
      if (ownsCacheDir) {
        await fs.rm(cacheDir, { recursive: true, force: true });
      }
    }
  }
}

async function captureCacheReportDuration(proofId: string, config: ExplanationConfigInput): Promise<ScenarioSample> {
  const start = process.hrtime.bigint();
  const report = await buildProofCacheReportView({ proofId, config });
  const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
  return {
    durationMs,
    status: report.cache.status,
  };
}

function summarizeScenario(samples: ScenarioSample[]): ScenarioSummary {
  if (samples.length === 0) {
    throw new Error("benchmark scenario must include at least one sample");
  }

  const durations = samples.map((sample) => sample.durationMs).sort((left, right) => left - right);
  const mean = durations.reduce((total, duration) => total + duration, 0) / durations.length;
  const median =
    durations.length % 2 === 1
      ? durations[(durations.length - 1) / 2]
      : (durations[durations.length / 2 - 1] + durations[durations.length / 2]) / 2;

  return {
    iterations: samples.length,
    statuses: samples.map((sample) => sample.status),
    meanMs: roundMs(mean),
    medianMs: roundMs(median),
    minMs: roundMs(durations[0]),
    maxMs: roundMs(durations[durations.length - 1]),
  };
}

function roundMs(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function normalizeIterationCount(value: number | undefined, fallback: number): number {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved < 1 || resolved > 50) {
    throw new Error(`iteration count must be an integer in [1, 50], received ${String(value)}`);
  }
  return resolved;
}

function computeStableHash(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  const objectValue = value as Record<string, unknown>;
  const keys = Object.keys(objectValue).sort((left, right) => left.localeCompare(right));
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(objectValue[key])}`).join(",")}}`;
}

async function copyDirectory(sourceDir: string, destinationDir: string): Promise<void> {
  await fs.mkdir(destinationDir, { recursive: true });
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const destinationPath = path.join(destinationDir, entry.name);
    if (entry.isDirectory()) {
      await copyDirectory(sourcePath, destinationPath);
      continue;
    }
    await fs.copyFile(sourcePath, destinationPath);
  }
}

async function resolveFixtureSourceRoot(): Promise<string> {
  const candidates = [
    path.resolve(process.cwd(), "tests", "fixtures", "lean-project"),
    path.resolve(process.cwd(), "..", "tests", "fixtures", "lean-project"),
    path.resolve(process.cwd(), "..", "..", "tests", "fixtures", "lean-project"),
  ];

  for (const candidate of candidates) {
    try {
      await fs.access(path.join(candidate, MUTATION_TARGET_RELATIVE_PATH));
      return candidate;
    } catch {
      // Try next candidate.
    }
  }

  throw new Error(`Lean fixture root not found for benchmark. Tried: ${candidates.join(", ")}`);
}
