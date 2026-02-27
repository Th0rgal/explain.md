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
  LEAN_FIXTURE_PROOF_ID,
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
const DEFAULT_LEAN_FIXTURE_LEAF_ID = "lean:Verity/Loop:loop_preserves:3:1";

interface BenchmarkProfileDefinition {
  profileId: string;
  proofId: string;
  leafId: string;
}

const DEFAULT_PROFILE_DEFINITIONS: BenchmarkProfileDefinition[] = [
  {
    profileId: "seed-verity",
    proofId: SEED_PROOF_ID,
    leafId: DEFAULT_PROOF_LEAF_ID,
  },
  {
    profileId: "lean-verity-fixture",
    proofId: LEAN_FIXTURE_PROOF_ID,
    leafId: DEFAULT_LEAN_FIXTURE_LEAF_ID,
  },
];

export interface ObservabilitySloBenchmarkOptions {
  proofId?: string;
  leafId?: string;
  config?: ExplanationConfigInput;
  generatedAt?: string;
}

export interface ObservabilitySloBenchmarkReport {
  schemaVersion: string;
  generatedAt: string;
  requestHash: string;
  outcomeHash: string;
  parameters: {
    profiles: Array<{
      profileId: string;
      proofId: string;
      leafId: string;
      configHash: string;
    }>;
    proofQueries: string[];
    verificationQueries: string[];
    baselineThresholds: ObservabilitySloThresholds;
    strictThresholds: ObservabilitySloThresholds;
  };
  profileReports: BenchmarkProfileReport[];
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
    byProfile: Array<{
      profileId: string;
      baseline: BenchmarkScenario;
      strictRegression: BenchmarkScenario;
    }>;
  };
}

interface BenchmarkScenario {
  thresholdPass: boolean;
  thresholdFailureCodes: string[];
  reportSnapshotHash: string;
}

interface BenchmarkProfileReport {
  profileId: string;
  proofId: string;
  leafId: string;
  configHash: string;
  requestHash: string;
  outcomeHash: string;
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

export async function runObservabilitySloBenchmark(
  options: ObservabilitySloBenchmarkOptions = {},
): Promise<ObservabilitySloBenchmarkReport> {
  const config = normalizeConfig(options.config ?? {});
  const generatedAt = normalizeString(options.generatedAt) ?? DEFAULT_GENERATED_AT;
  const baselineThresholds = buildBaselineThresholds();
  const strictThresholds = buildStrictThresholds();
  const profiles = resolveProfiles(options, config);
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
    profiles: profiles.map((profile) => ({
      profileId: profile.profileId,
      proofId: profile.proofId,
      leafId: profile.leafId,
      configHash: profile.configHash,
    })),
    generatedAt,
    proofQueries,
    verificationQueries,
    baselineThresholds,
    strictThresholds,
  });

  const profileReports: BenchmarkProfileReport[] = [];
  for (const profile of profiles) {
    profileReports.push(
      await runBenchmarkProfile({
        profile,
        generatedAt,
        baselineThresholds,
        strictThresholds,
      }),
    );
  }

  const aggregateBaseline = aggregateScenario(
    profileReports.map((profile) => ({
      profileId: profile.profileId,
      scenario: profile.evaluation.baseline,
    })),
  );
  const aggregateStrict = aggregateScenario(
    profileReports.map((profile) => ({
      profileId: profile.profileId,
      scenario: profile.evaluation.strictRegression,
    })),
  );

  const aggregateProof = {
    snapshotHash: computeHash(profileReports.map((profile) => profile.snapshots.proof.snapshotHash)),
    requestCount: sum(profileReports.map((profile) => profile.snapshots.proof.requestCount)),
    uniqueRequestCount: sum(profileReports.map((profile) => profile.snapshots.proof.uniqueRequestCount)),
    uniqueTraceCount: sum(profileReports.map((profile) => profile.snapshots.proof.uniqueTraceCount)),
    cacheHitRate:
      profileReports.length === 0 ? 0 : sum(profileReports.map((profile) => profile.snapshots.proof.cacheHitRate)) / profileReports.length,
  };
  const aggregateVerification = {
    snapshotHash: computeHash(profileReports.map((profile) => profile.snapshots.verification.snapshotHash)),
    requestCount: sum(profileReports.map((profile) => profile.snapshots.verification.requestCount)),
    failureCount: sum(profileReports.map((profile) => profile.snapshots.verification.failureCount)),
    parentTraceProvidedRate:
      profileReports.length === 0
        ? 0
        : sum(profileReports.map((profile) => profile.snapshots.verification.parentTraceProvidedRate)) / profileReports.length,
    maxP95LatencyMs: Math.max(...profileReports.map((profile) => profile.snapshots.verification.maxP95LatencyMs), 0),
    maxMeanLatencyMs: Math.max(...profileReports.map((profile) => profile.snapshots.verification.maxMeanLatencyMs), 0),
  };

  const outcomeHash = computeHash({
    schemaVersion: SCHEMA_VERSION,
    profileOutcomes: profileReports.map((profile) => ({
      profileId: profile.profileId,
      outcomeHash: profile.outcomeHash,
      baselinePass: profile.evaluation.baseline.thresholdPass,
      strictPass: profile.evaluation.strictRegression.thresholdPass,
    })),
    aggregateBaselinePass: aggregateBaseline.thresholdPass,
    aggregateStrictPass: aggregateStrict.thresholdPass,
    aggregateStrictFailureCodes: aggregateStrict.thresholdFailureCodes,
  });

  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt,
    requestHash,
    outcomeHash,
    parameters: {
      profiles: profiles.map((profile) => ({
        profileId: profile.profileId,
        proofId: profile.proofId,
        leafId: profile.leafId,
        configHash: profile.configHash,
      })),
      proofQueries,
      verificationQueries,
      baselineThresholds,
      strictThresholds,
    },
    profileReports,
    snapshots: {
      proof: aggregateProof,
      verification: aggregateVerification,
    },
    evaluation: {
      baseline: aggregateBaseline,
      strictRegression: aggregateStrict,
      byProfile: profileReports.map((profile) => ({
        profileId: profile.profileId,
        baseline: profile.evaluation.baseline,
        strictRegression: profile.evaluation.strictRegression,
      })),
    },
  };
}

function toScenario(report: ObservabilitySloReport): BenchmarkScenario {
  return {
    thresholdPass: report.thresholdPass,
    thresholdFailureCodes: report.thresholdFailures.map((failure) => failure.code),
    reportSnapshotHash: report.snapshotHash,
  };
}

async function runBenchmarkProfile(options: {
  profile: BenchmarkProfileDefinition & { config: ReturnType<typeof normalizeConfig>; configHash: string };
  generatedAt: string;
  baselineThresholds: ObservabilitySloThresholds;
  strictThresholds: ObservabilitySloThresholds;
}): Promise<BenchmarkProfileReport> {
  const { profile, generatedAt, baselineThresholds, strictThresholds } = options;
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), `explain-md-slo-benchmark-${profile.profileId}-`));
  const ledgerPath = path.join(tempDir, "verification-ledger.json");

  clearProofDatasetCacheForTests();
  clearProofQueryObservabilityMetricsForTests();
  clearVerificationObservabilityMetricsForTests();
  resetVerificationServiceForTests();

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
      proofId: profile.proofId,
      config: profile.config,
      expandedNodeIds: ["p2_root"],
      maxChildrenPerExpandedNode: 3,
    });
    await buildProofDiff({
      proofId: profile.proofId,
      baselineConfig: profile.config,
      candidateConfig: profile.config,
    });
    await buildProofLeafDetail({ proofId: profile.proofId, leafId: profile.leafId, config: profile.config });
    const root = await buildProofRootView(profile.proofId, profile.config);
    const rootNodeId = root.root.node?.id ?? "";
    await buildProofNodeChildrenView({
      proofId: profile.proofId,
      nodeId: rootNodeId,
      config: profile.config,
      offset: 0,
      limit: 3,
    });
    await buildProofNodePathView({
      proofId: profile.proofId,
      nodeId: profile.leafId,
      config: profile.config,
    });
    await buildProofDependencyGraphView({
      proofId: profile.proofId,
      config: profile.config,
      includeExternalSupport: true,
    });
    await buildProofPolicyReportView({
      proofId: profile.proofId,
      config: profile.config,
    });
    await buildProofCacheReportView({
      proofId: profile.proofId,
      config: profile.config,
    });

    const verify = await verifyLeafProof({
      proofId: profile.proofId,
      leafId: profile.leafId,
      autoRun: true,
      parentTraceId: "trace-parent-benchmark",
    });
    await listLeafVerificationJobs(profile.proofId, profile.leafId);
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

    const requestHash = computeHash({
      schemaVersion: SCHEMA_VERSION,
      profileId: profile.profileId,
      proofId: profile.proofId,
      leafId: profile.leafId,
      configHash: profile.configHash,
      generatedAt,
      baselineThresholds,
      strictThresholds,
    });
    const outcomeHash = computeHash({
      schemaVersion: SCHEMA_VERSION,
      profileId: profile.profileId,
      proofSnapshotHash: proofMetrics.snapshotHash,
      verificationSnapshotHash: verificationMetrics.snapshotHash,
      baselineSnapshotHash: baselineReport.snapshotHash,
      strictSnapshotHash: strictReport.snapshotHash,
      baselineThresholdPass: baselineReport.thresholdPass,
      strictThresholdPass: strictReport.thresholdPass,
      strictFailureCodes: strictReport.thresholdFailures.map((failure) => failure.code),
    });

    return {
      profileId: profile.profileId,
      proofId: profile.proofId,
      leafId: profile.leafId,
      configHash: profile.configHash,
      requestHash,
      outcomeHash,
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

function resolveProfiles(
  options: ObservabilitySloBenchmarkOptions,
  config: ReturnType<typeof normalizeConfig>,
): Array<BenchmarkProfileDefinition & { config: ReturnType<typeof normalizeConfig>; configHash: string }> {
  const customProofId = normalizeString(options.proofId);
  const customLeafId = normalizeString(options.leafId);

  if (customProofId || customLeafId) {
    return [
      {
        profileId: "custom",
        proofId: customProofId ?? SEED_PROOF_ID,
        leafId: customLeafId ?? DEFAULT_PROOF_LEAF_ID,
        config,
        configHash: computeConfigHash(config),
      },
    ];
  }

  return DEFAULT_PROFILE_DEFINITIONS.map((profile) => ({
    profileId: profile.profileId,
    proofId: profile.proofId,
    leafId: profile.leafId,
    config,
    configHash: computeConfigHash(config),
  }));
}

function aggregateScenario(
  scenarios: Array<{ profileId: string; scenario: BenchmarkScenario }>,
): BenchmarkScenario {
  const thresholdPass = scenarios.every((entry) => entry.scenario.thresholdPass);
  const thresholdFailureCodes = scenarios
    .flatMap((entry) => entry.scenario.thresholdFailureCodes.map((code) => `${entry.profileId}:${code}`))
    .sort((left, right) => left.localeCompare(right));
  const reportSnapshotHash = computeHash(
    scenarios.map((entry) => ({
      profileId: entry.profileId,
      thresholdPass: entry.scenario.thresholdPass,
      reportSnapshotHash: entry.scenario.reportSnapshotHash,
    })),
  );

  return {
    thresholdPass,
    thresholdFailureCodes,
    reportSnapshotHash,
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

function sum(values: number[]): number {
  return values.reduce((accumulator, value) => accumulator + value, 0);
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
