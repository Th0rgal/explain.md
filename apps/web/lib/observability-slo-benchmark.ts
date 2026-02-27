import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { computeConfigHash, normalizeConfig, type ExplanationConfigInput } from "../../../dist/index";
import type { VerificationCommandRunner } from "../../../dist/verification-flow";
import {
  buildProofCacheReportView,
  buildProofDependencyGraphView,
  buildProofDiff,
  buildProofLeafDetail,
  buildProofNodeChildrenView,
  buildProofNodePathView,
  buildProofPolicyReportView,
  buildProofProjection,
  buildProofRootView,
  clearProofDatasetCacheForTests,
  clearProofQueryObservabilityMetricsForTests,
  exportProofQueryObservabilityMetrics,
  SEED_PROOF_ID,
} from "./proof-service";
import {
  clearVerificationObservabilityMetricsForTests,
  configureVerificationServiceForTests,
  exportVerificationObservabilityMetrics,
  getVerificationJobById,
  listLeafVerificationJobs,
  resetVerificationServiceForTests,
  verifyLeafProof,
} from "./verification-service";
import {
  evaluateObservabilitySLOs,
  type ObservabilitySloReport,
  type ObservabilitySloThresholds,
} from "./observability-slo";

const SCHEMA_VERSION = "1.0.0";
const DEFAULT_GENERATED_AT = "2026-02-27T00:00:00.000Z";
const DEFAULT_PROOF_LEAF_ID = "Verity.ContractSpec.init_sound";

export interface ObservabilitySloBenchmarkOptions {
  proofId?: string;
  leafId?: string;
  config?: ExplanationConfigInput;
  generatedAt?: string;
}

export interface ObservabilitySloBenchmarkReport {
  schemaVersion: string;
  generatedAt: string;
  proofId: string;
  leafId: string;
  configHash: string;
  requestHash: string;
  outcomeHash: string;
  parameters: {
    proofQueries: string[];
    verificationQueries: string[];
    baselineThresholds: ObservabilitySloThresholds;
    strictThresholds: ObservabilitySloThresholds;
  };
  snapshots: {
    proof: {
      snapshotHash: string;
      requestCount: number;
      uniqueRequestCount: number;
      uniqueTraceCount: number;
      cacheHitRate: number;
    };
    verification: {
      snapshotHash: string;
      requestCount: number;
      failureCount: number;
      parentTraceProvidedRate: number;
      maxP95LatencyMs: number;
      maxMeanLatencyMs: number;
    };
  };
  evaluation: {
    baseline: BenchmarkScenario;
    strictRegression: BenchmarkScenario;
  };
}

interface BenchmarkScenario {
  thresholdPass: boolean;
  thresholdFailureCodes: string[];
  reportSnapshotHash: string;
}

export async function runObservabilitySloBenchmark(
  options: ObservabilitySloBenchmarkOptions = {},
): Promise<ObservabilitySloBenchmarkReport> {
  const proofId = normalizeString(options.proofId) ?? SEED_PROOF_ID;
  const leafId = normalizeString(options.leafId) ?? DEFAULT_PROOF_LEAF_ID;
  const config = normalizeConfig(options.config ?? {});
  const configHash = computeConfigHash(config);
  const generatedAt = normalizeString(options.generatedAt) ?? DEFAULT_GENERATED_AT;
  const baselineThresholds = buildBaselineThresholds();
  const strictThresholds = buildStrictThresholds();
  const proofQueries = [
    "view",
    "diff",
    "leaf-detail",
    "root",
    "children",
    "path",
    "dependency-graph",
    "policy-report",
    "cache-report",
  ];
  const verificationQueries = ["verify_leaf", "list_leaf_jobs", "get_job"];

  const requestHash = computeHash({
    schemaVersion: SCHEMA_VERSION,
    proofId,
    leafId,
    configHash,
    generatedAt,
    proofQueries,
    verificationQueries,
    baselineThresholds,
    strictThresholds,
  });

  clearProofDatasetCacheForTests();
  clearProofQueryObservabilityMetricsForTests();
  clearVerificationObservabilityMetricsForTests();
  resetVerificationServiceForTests();

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "explain-md-slo-benchmark-"));
  const ledgerPath = path.join(tempDir, "verification-ledger.json");

  try {
    configureVerificationServiceForTests({
      ledgerPath,
      runner: successfulRunner(),
      sourceRevision: "benchmark-revision",
      leanVersion: "4.12.0",
      lakeVersion: "3.0.0",
      now: () => new Date(generatedAt),
      nowMs: buildDeterministicNowMs([1000, 1010, 2000, 2008, 3000, 3012]),
    });

    await buildProofProjection({
      proofId,
      config,
      expandedNodeIds: ["p2_root"],
      maxChildrenPerExpandedNode: 3,
    });
    await buildProofDiff({
      proofId,
      baselineConfig: config,
      candidateConfig: config,
    });
    await buildProofLeafDetail({ proofId, leafId, config });
    const root = await buildProofRootView(proofId, config);
    const rootNodeId = root.root.node?.id ?? "";
    await buildProofNodeChildrenView({
      proofId,
      nodeId: rootNodeId,
      config,
      offset: 0,
      limit: 3,
    });
    await buildProofNodePathView({
      proofId,
      nodeId: leafId,
      config,
    });
    await buildProofDependencyGraphView({
      proofId,
      config,
      includeExternalSupport: true,
    });
    await buildProofPolicyReportView({
      proofId,
      config,
    });
    await buildProofCacheReportView({
      proofId,
      config,
    });

    const verify = await verifyLeafProof({
      proofId,
      leafId,
      autoRun: true,
      parentTraceId: "trace-parent-benchmark",
    });
    await listLeafVerificationJobs(proofId, leafId);
    await getVerificationJobById(verify.finalJob.jobId, {
      parentTraceId: "trace-parent-benchmark",
    });

    const proofMetrics = exportProofQueryObservabilityMetrics({ generatedAt });
    const verificationMetrics = exportVerificationObservabilityMetrics({ generatedAt });

    const baselineReport = evaluateObservabilitySLOs({
      proof: proofMetrics,
      verification: verificationMetrics,
      thresholds: baselineThresholds,
      generatedAt,
    });
    const strictReport = evaluateObservabilitySLOs({
      proof: proofMetrics,
      verification: verificationMetrics,
      thresholds: strictThresholds,
      generatedAt,
    });

    const outcomeHash = computeHash({
      schemaVersion: SCHEMA_VERSION,
      proofSnapshotHash: proofMetrics.snapshotHash,
      verificationSnapshotHash: verificationMetrics.snapshotHash,
      baselineSnapshotHash: baselineReport.snapshotHash,
      strictSnapshotHash: strictReport.snapshotHash,
      baselineThresholdPass: baselineReport.thresholdPass,
      strictThresholdPass: strictReport.thresholdPass,
      strictFailureCodes: strictReport.thresholdFailures.map((failure) => failure.code),
    });

    return {
      schemaVersion: SCHEMA_VERSION,
      generatedAt,
      proofId,
      leafId,
      configHash,
      requestHash,
      outcomeHash,
      parameters: {
        proofQueries,
        verificationQueries,
        baselineThresholds,
        strictThresholds,
      },
      snapshots: {
        proof: {
          snapshotHash: proofMetrics.snapshotHash,
          requestCount: proofMetrics.requestCount,
          uniqueRequestCount: proofMetrics.uniqueRequestCount,
          uniqueTraceCount: proofMetrics.uniqueTraceCount,
          cacheHitRate: proofMetrics.cache.hitRate,
        },
        verification: {
          snapshotHash: verificationMetrics.snapshotHash,
          requestCount: verificationMetrics.requestCount,
          failureCount: verificationMetrics.failureCount,
          parentTraceProvidedRate: verificationMetrics.correlation.parentTraceProvidedRate,
          maxP95LatencyMs: Math.max(...verificationMetrics.queries.map((query) => query.p95LatencyMs), 0),
          maxMeanLatencyMs: Math.max(...verificationMetrics.queries.map((query) => query.meanLatencyMs), 0),
        },
      },
      evaluation: {
        baseline: toScenario(baselineReport),
        strictRegression: toScenario(strictReport),
      },
    };
  } finally {
    resetVerificationServiceForTests();
    clearVerificationObservabilityMetricsForTests();
    clearProofQueryObservabilityMetricsForTests();
    clearProofDatasetCacheForTests();
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

function toScenario(report: ObservabilitySloReport): BenchmarkScenario {
  return {
    thresholdPass: report.thresholdPass,
    thresholdFailureCodes: report.thresholdFailures.map((failure) => failure.code),
    reportSnapshotHash: report.snapshotHash,
  };
}

function buildBaselineThresholds(): ObservabilitySloThresholds {
  return {
    minProofRequestCount: 9,
    minVerificationRequestCount: 3,
    minProofCacheHitRate: 0,
    minProofUniqueTraceRate: 1,
    maxVerificationFailureRate: 0,
    maxVerificationP95LatencyMs: 25,
    maxVerificationMeanLatencyMs: 20,
    minVerificationParentTraceRate: 0.66,
  };
}

function buildStrictThresholds(): ObservabilitySloThresholds {
  return {
    minProofRequestCount: 10,
    minVerificationRequestCount: 4,
    minProofCacheHitRate: 0.2,
    minProofUniqueTraceRate: 1,
    maxVerificationFailureRate: 0,
    maxVerificationP95LatencyMs: 5,
    maxVerificationMeanLatencyMs: 5,
    minVerificationParentTraceRate: 0.9,
  };
}

function successfulRunner(): VerificationCommandRunner {
  return {
    run: async () => ({
      exitCode: 0,
      signal: null,
      durationMs: 120,
      timedOut: false,
      stdout: "checked theorem",
      stderr: "",
    }),
  };
}

function buildDeterministicNowMs(values: number[]): () => number {
  let index = 0;
  return () => {
    const value = values[index];
    index += 1;
    return value ?? (values[values.length - 1] ?? 0);
  };
}

function normalizeString(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function computeHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value, stableReplacer)).digest("hex");
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
