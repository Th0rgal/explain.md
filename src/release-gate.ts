import { createHash } from "node:crypto";
import { assertQualityGateBaseline, type QualityGateBaseline } from "./quality-gate-baseline.js";

const RELEASE_GATE_SCHEMA_VERSION = "1.0.0";
const RELEASE_GATE_BASELINE_SCHEMA_VERSION = "1.0.0";

export interface TreeA11yBenchmarkArtifact {
  schemaVersion: string;
  requestHash: string;
  outcomeHash: string;
  summary: {
    totalSteps: number;
    expandActionCount: number;
    collapseActionCount: number;
    activeAnnouncementCount: number;
    virtualizedStepCount: number;
  };
}

export interface TreeScaleBenchmarkArtifact {
  schemaVersion: string;
  requestHash: string;
  outcomeHash: string;
  summary: {
    profileCount: number;
    totalSamples: number;
    fullModeSampleCount: number;
    windowedModeSampleCount: number;
    virtualizedModeSampleCount: number;
    maxRenderedRowCount: number;
    boundedSampleCount: number;
  };
}

export interface ProofCacheBenchmarkArtifact {
  schemaVersion: string;
  requestHash: string;
  outcomeHash: string;
  scenarios: {
    coldNoPersistentCache: {
      statuses: string[];
      meanMs: number;
    };
    warmPersistentCache: {
      statuses: string[];
      meanMs: number;
    };
    invalidation: {
      recoveryStatus: string;
    };
    topologyShapeInvalidation: {
      recoveryStatus: string;
    };
    mixedTopologyShapeInvalidation: {
      recoveryStatus: string;
    };
  };
}

export interface VerificationReplayBenchmarkArtifact {
  schemaVersion: string;
  requestHash: string;
  outcomeHash: string;
  summary: {
    exportFilename: string;
    requestHash: string;
    jobHash: string;
    reproducibilityHash: string;
    replayCommand: string;
    envKeyCount: number;
    logLineCount: number;
    jsonLineCount: number;
  };
}

export interface ExplanationDiffBenchmarkArtifact {
  schemaVersion: string;
  requestHash: string;
  outcomeHash: string;
  summary: {
    profileCount: number;
    totalChanges: number;
    changedProfiles: number;
    truncatedProfiles: number;
    provenanceCoveredChanges: number;
    zeroSupportChangeCount: number;
    orderingPassProfiles: number;
    coverage: {
      abstractionLevel: boolean;
      complexityLevel: boolean;
      maxChildrenPerParent: boolean;
      language: boolean;
      audienceLevel: boolean;
    };
  };
}

export interface MultilingualBenchmarkArtifact {
  schemaVersion: string;
  requestHash: string;
  outcomeHash: string;
  summary: {
    profileCount: number;
    rootStructureStableProfiles: number;
    childrenStructureStableProfiles: number;
    pathStructureStableProfiles: number;
    localizedRootStatementProfiles: number;
    localizedChildStatementProfiles: number;
    localizedPathStatementProfiles: number;
    fallbackProfiles: number;
    localeVariantProfiles: number;
    leafProvenanceStableProfiles: number;
  };
}

export interface ObservabilitySloBenchmarkArtifact {
  schemaVersion: string;
  requestHash: string;
  outcomeHash: string;
  evaluation: {
    baseline: {
      thresholdPass: boolean;
    };
    strictRegression: {
      thresholdPass: boolean;
    };
  };
}

export interface DomainAdapterBenchmarkArtifact {
  schemaVersion: string;
  requestHash: string;
  outcomeHash: string;
  summary: {
    profileCount: number;
    passCount: number;
    downgradedProfileCount: number;
    manualOverrideProfileCount: number;
    macroPrecision: number;
    macroRecall: number;
    macroF1: number;
    taggingReportHash: string;
  };
}

export interface BaselineCheckArtifact {
  schemaVersion: string;
  pass: boolean;
  expectedOutcomeHash: string;
  actualOutcomeHash: string;
}

export interface ReleaseGateInput {
  qualityBaseline: QualityGateBaseline;
  qualityBaselineCheck: BaselineCheckArtifact;
  treeA11yBenchmark: TreeA11yBenchmarkArtifact;
  treeScaleBenchmark: TreeScaleBenchmarkArtifact;
  explanationDiffBenchmark: ExplanationDiffBenchmarkArtifact;
  verificationReplayBenchmark: VerificationReplayBenchmarkArtifact;
  multilingualBenchmark: MultilingualBenchmarkArtifact;
  proofCacheBenchmark: ProofCacheBenchmarkArtifact;
  domainAdapterBenchmark: DomainAdapterBenchmarkArtifact;
  observabilitySloBaseline: ObservabilitySloBenchmarkArtifact;
  observabilitySloActual: ObservabilitySloBenchmarkArtifact;
  generatedAt?: string;
}

export interface ReleaseGateCheck {
  code:
    | "quality_baseline_consistent"
    | "quality_thresholds_pass"
    | "strict_entailment_presets_present"
    | "tree_a11y_transcript_complete"
    | "tree_scale_profiles_cover_modes"
    | "explanation_diff_profiles_cover_config_knobs"
    | "multilingual_generation_contract"
    | "verification_replay_contract_complete"
    | "cache_warm_speedup"
    | "cache_recovery_hits"
    | "domain_adapter_quality_floor"
    | "observability_baseline_consistent"
    | "observability_slo_gate";
  pass: boolean;
  details: string;
}

export interface ReleaseGateReport {
  schemaVersion: string;
  generatedAt: string;
  requestHash: string;
  outcomeHash: string;
  thresholdPass: boolean;
  summary: {
    passedChecks: number;
    failedChecks: number;
    leafCount: number;
    parentCount: number;
    qualityOutcomeHash: string;
    treeA11yOutcomeHash: string;
    treeScaleOutcomeHash: string;
    explanationDiffOutcomeHash: string;
    multilingualOutcomeHash: string;
    verificationReplayOutcomeHash: string;
    proofCacheOutcomeHash: string;
    domainAdapterOutcomeHash: string;
    observabilityOutcomeHash: string;
  };
  checks: ReleaseGateCheck[];
}

export interface ReleaseGateBaseline {
  schemaVersion: string;
  requestHash: string;
  outcomeHash: string;
  thresholdPass: boolean;
  checkStatus: Array<{ code: ReleaseGateCheck["code"]; pass: boolean }>;
}

export interface ReleaseGateBaselineFailure {
  code: "field_mismatch";
  field: "requestHash" | "outcomeHash" | "thresholdPass" | "checkStatus";
  expected: string | boolean;
  actual: string | boolean;
}

export interface ReleaseGateBaselineComparison {
  pass: boolean;
  failures: ReleaseGateBaselineFailure[];
}

const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/;

export function evaluateReleaseGate(input: ReleaseGateInput): ReleaseGateReport {
  const qualityBaseline = assertQualityGateBaseline(input.qualityBaseline);
  const qualityBaselineCheck = assertBaselineCheckArtifact(input.qualityBaselineCheck, "qualityBaselineCheck");
  const treeA11yBenchmark = assertTreeA11yBenchmarkArtifact(input.treeA11yBenchmark);
  const treeScaleBenchmark = assertTreeScaleBenchmarkArtifact(input.treeScaleBenchmark);
  const explanationDiffBenchmark = assertExplanationDiffBenchmarkArtifact(input.explanationDiffBenchmark);
  const verificationReplayBenchmark = assertVerificationReplayBenchmarkArtifact(input.verificationReplayBenchmark);
  const multilingualBenchmark = assertMultilingualBenchmarkArtifact(input.multilingualBenchmark);
  const proofCacheBenchmark = assertProofCacheBenchmarkArtifact(input.proofCacheBenchmark);
  const domainAdapterBenchmark = assertDomainAdapterBenchmarkArtifact(input.domainAdapterBenchmark);
  const observabilitySloBaseline = assertObservabilitySloBenchmarkArtifact(input.observabilitySloBaseline);
  const observabilitySloActual = assertObservabilitySloBenchmarkArtifact(input.observabilitySloActual);

  const strictPresetNames = new Set(qualityBaseline.entries.map((entry) => entry.presetName));

  const checks: ReleaseGateCheck[] = [
    {
      code: "quality_baseline_consistent",
      pass:
        qualityBaselineCheck.pass &&
        qualityBaselineCheck.expectedOutcomeHash === qualityBaseline.outcomeHash &&
        qualityBaselineCheck.actualOutcomeHash === qualityBaseline.outcomeHash,
      details: `expected=${qualityBaselineCheck.expectedOutcomeHash} actual=${qualityBaselineCheck.actualOutcomeHash} baseline=${qualityBaseline.outcomeHash}`,
    },
    {
      code: "quality_thresholds_pass",
      pass: qualityBaseline.entries.every((entry) => entry.thresholdPass),
      details: `passing_presets=${qualityBaseline.entries.filter((entry) => entry.thresholdPass).length}/${qualityBaseline.entries.length}`,
    },
    {
      code: "strict_entailment_presets_present",
      pass:
        strictPresetNames.has("fixture-verity-counter-snapshot-strict") &&
        strictPresetNames.has("fixture-verity-token-snapshot-strict"),
      details: "required=fixture-verity-counter-snapshot-strict,fixture-verity-token-snapshot-strict",
    },
    {
      code: "tree_a11y_transcript_complete",
      pass:
        treeA11yBenchmark.summary.totalSteps > 0 &&
        treeA11yBenchmark.summary.activeAnnouncementCount > 0 &&
        treeA11yBenchmark.summary.expandActionCount > 0 &&
        treeA11yBenchmark.summary.collapseActionCount > 0 &&
        treeA11yBenchmark.summary.virtualizedStepCount === treeA11yBenchmark.summary.totalSteps,
      details: `steps=${treeA11yBenchmark.summary.totalSteps} announcements=${treeA11yBenchmark.summary.activeAnnouncementCount} expand=${treeA11yBenchmark.summary.expandActionCount} collapse=${treeA11yBenchmark.summary.collapseActionCount}`,
    },
    {
      code: "tree_scale_profiles_cover_modes",
      pass:
        treeScaleBenchmark.summary.profileCount >= 3 &&
        treeScaleBenchmark.summary.totalSamples > 0 &&
        treeScaleBenchmark.summary.fullModeSampleCount > 0 &&
        treeScaleBenchmark.summary.windowedModeSampleCount > 0 &&
        treeScaleBenchmark.summary.virtualizedModeSampleCount > 0 &&
        treeScaleBenchmark.summary.boundedSampleCount === treeScaleBenchmark.summary.totalSamples,
      details: `profiles=${treeScaleBenchmark.summary.profileCount} total_samples=${treeScaleBenchmark.summary.totalSamples} modes=full:${treeScaleBenchmark.summary.fullModeSampleCount},windowed:${treeScaleBenchmark.summary.windowedModeSampleCount},virtualized:${treeScaleBenchmark.summary.virtualizedModeSampleCount} bounded=${treeScaleBenchmark.summary.boundedSampleCount}`,
    },
    {
      code: "explanation_diff_profiles_cover_config_knobs",
      pass:
        explanationDiffBenchmark.summary.profileCount >= 3 &&
        explanationDiffBenchmark.summary.changedProfiles === explanationDiffBenchmark.summary.profileCount &&
        explanationDiffBenchmark.summary.truncatedProfiles > 0 &&
        explanationDiffBenchmark.summary.provenanceCoveredChanges > 0 &&
        explanationDiffBenchmark.summary.zeroSupportChangeCount === 0 &&
        explanationDiffBenchmark.summary.orderingPassProfiles === explanationDiffBenchmark.summary.profileCount &&
        explanationDiffBenchmark.summary.coverage.abstractionLevel &&
        explanationDiffBenchmark.summary.coverage.complexityLevel &&
        explanationDiffBenchmark.summary.coverage.maxChildrenPerParent &&
        explanationDiffBenchmark.summary.coverage.language &&
        explanationDiffBenchmark.summary.coverage.audienceLevel,
      details:
        `profiles=${explanationDiffBenchmark.summary.profileCount} changed_profiles=${explanationDiffBenchmark.summary.changedProfiles} ` +
        `truncated_profiles=${explanationDiffBenchmark.summary.truncatedProfiles} total_changes=${explanationDiffBenchmark.summary.totalChanges} ` +
        `provenance_changes=${explanationDiffBenchmark.summary.provenanceCoveredChanges}`,
    },
    {
      code: "multilingual_generation_contract",
      pass:
        multilingualBenchmark.summary.profileCount >= 2 &&
        multilingualBenchmark.summary.rootStructureStableProfiles === multilingualBenchmark.summary.profileCount &&
        multilingualBenchmark.summary.childrenStructureStableProfiles === multilingualBenchmark.summary.profileCount &&
        multilingualBenchmark.summary.pathStructureStableProfiles === multilingualBenchmark.summary.profileCount &&
        multilingualBenchmark.summary.localizedRootStatementProfiles === multilingualBenchmark.summary.profileCount &&
        multilingualBenchmark.summary.localizedChildStatementProfiles === multilingualBenchmark.summary.profileCount &&
        multilingualBenchmark.summary.localizedPathStatementProfiles === multilingualBenchmark.summary.profileCount &&
        multilingualBenchmark.summary.fallbackProfiles === multilingualBenchmark.summary.profileCount &&
        multilingualBenchmark.summary.localeVariantProfiles === multilingualBenchmark.summary.profileCount &&
        multilingualBenchmark.summary.leafProvenanceStableProfiles === multilingualBenchmark.summary.profileCount,
      details:
        `profiles=${multilingualBenchmark.summary.profileCount} localized_root=${multilingualBenchmark.summary.localizedRootStatementProfiles} ` +
        `localized_children=${multilingualBenchmark.summary.localizedChildStatementProfiles} localized_path=${multilingualBenchmark.summary.localizedPathStatementProfiles} ` +
        `fallback=${multilingualBenchmark.summary.fallbackProfiles} locale_variant=${multilingualBenchmark.summary.localeVariantProfiles}`,
    },
    {
      code: "verification_replay_contract_complete",
      pass:
        verificationReplayBenchmark.summary.exportFilename.endsWith(".json") &&
        SHA256_HEX_PATTERN.test(verificationReplayBenchmark.summary.requestHash) &&
        SHA256_HEX_PATTERN.test(verificationReplayBenchmark.summary.jobHash) &&
        SHA256_HEX_PATTERN.test(verificationReplayBenchmark.summary.reproducibilityHash) &&
        verificationReplayBenchmark.summary.replayCommand.includes("lake env lean") &&
        verificationReplayBenchmark.summary.envKeyCount > 0 &&
        verificationReplayBenchmark.summary.logLineCount > 0 &&
        verificationReplayBenchmark.summary.jsonLineCount > 1,
      details: `export=${verificationReplayBenchmark.summary.exportFilename} env_keys=${verificationReplayBenchmark.summary.envKeyCount} log_lines=${verificationReplayBenchmark.summary.logLineCount} replay=${verificationReplayBenchmark.summary.replayCommand}`,
    },
    {
      code: "cache_warm_speedup",
      pass:
        proofCacheBenchmark.scenarios.warmPersistentCache.meanMs < proofCacheBenchmark.scenarios.coldNoPersistentCache.meanMs &&
        proofCacheBenchmark.scenarios.warmPersistentCache.statuses.every((status) => status === "hit") &&
        proofCacheBenchmark.scenarios.coldNoPersistentCache.statuses.every((status) => status === "miss"),
      details: `cold_mean_ms=${proofCacheBenchmark.scenarios.coldNoPersistentCache.meanMs} warm_mean_ms=${proofCacheBenchmark.scenarios.warmPersistentCache.meanMs}`,
    },
    {
      code: "cache_recovery_hits",
      pass:
        proofCacheBenchmark.scenarios.invalidation.recoveryStatus === "hit" &&
        proofCacheBenchmark.scenarios.topologyShapeInvalidation.recoveryStatus === "hit" &&
        proofCacheBenchmark.scenarios.mixedTopologyShapeInvalidation.recoveryStatus === "hit",
      details: "required_recovery_status=hit",
    },
    {
      code: "domain_adapter_quality_floor",
      pass:
        domainAdapterBenchmark.summary.profileCount >= 4 &&
        domainAdapterBenchmark.summary.passCount === domainAdapterBenchmark.summary.profileCount &&
        domainAdapterBenchmark.summary.downgradedProfileCount > 0 &&
        domainAdapterBenchmark.summary.manualOverrideProfileCount > 0 &&
        domainAdapterBenchmark.summary.macroPrecision >= 0.8 &&
        domainAdapterBenchmark.summary.macroRecall >= 0.8 &&
        domainAdapterBenchmark.summary.macroF1 >= 0.8,
      details:
        `profiles=${domainAdapterBenchmark.summary.profileCount} pass=${domainAdapterBenchmark.summary.passCount} ` +
        `downgraded=${domainAdapterBenchmark.summary.downgradedProfileCount} manual_override=${domainAdapterBenchmark.summary.manualOverrideProfileCount} ` +
        `macro=${domainAdapterBenchmark.summary.macroPrecision.toFixed(4)}/${domainAdapterBenchmark.summary.macroRecall.toFixed(4)}/${domainAdapterBenchmark.summary.macroF1.toFixed(4)}`,
    },
    {
      code: "observability_baseline_consistent",
      pass:
        observabilitySloActual.requestHash === observabilitySloBaseline.requestHash &&
        observabilitySloActual.outcomeHash === observabilitySloBaseline.outcomeHash &&
        observabilitySloActual.evaluation.baseline.thresholdPass === observabilitySloBaseline.evaluation.baseline.thresholdPass &&
        observabilitySloActual.evaluation.strictRegression.thresholdPass ===
          observabilitySloBaseline.evaluation.strictRegression.thresholdPass,
      details: `expected_request=${observabilitySloBaseline.requestHash} actual_request=${observabilitySloActual.requestHash} expected_outcome=${observabilitySloBaseline.outcomeHash} actual_outcome=${observabilitySloActual.outcomeHash}`,
    },
    {
      code: "observability_slo_gate",
      pass: observabilitySloActual.evaluation.baseline.thresholdPass && !observabilitySloActual.evaluation.strictRegression.thresholdPass,
      details: `baseline=${observabilitySloActual.evaluation.baseline.thresholdPass} strict_regression=${observabilitySloActual.evaluation.strictRegression.thresholdPass}`,
    },
  ];

  const thresholdPass = checks.every((check) => check.pass);
  const generatedAt = normalizeString(input.generatedAt) ?? new Date().toISOString();

  const requestHash = computeHash({
    schemaVersion: RELEASE_GATE_SCHEMA_VERSION,
    qualityOutcomeHash: qualityBaseline.outcomeHash,
    treeA11yRequestHash: treeA11yBenchmark.requestHash,
    treeScaleRequestHash: treeScaleBenchmark.requestHash,
    explanationDiffRequestHash: explanationDiffBenchmark.requestHash,
    verificationReplayRequestHash: verificationReplayBenchmark.requestHash,
    multilingualRequestHash: multilingualBenchmark.requestHash,
    proofCacheRequestHash: proofCacheBenchmark.requestHash,
    domainAdapterRequestHash: domainAdapterBenchmark.requestHash,
    observabilityRequestHash: observabilitySloActual.requestHash,
  });

  const canonicalChecks = checks.map((check) => ({
    code: check.code,
    pass: check.pass,
    details: check.details,
  }));

  const outcomeHash = computeHash({
    schemaVersion: RELEASE_GATE_SCHEMA_VERSION,
    thresholdPass,
    checks: canonicalChecks,
    evidence: {
      qualityOutcomeHash: qualityBaseline.outcomeHash,
      treeA11yOutcomeHash: treeA11yBenchmark.outcomeHash,
      treeScaleOutcomeHash: treeScaleBenchmark.outcomeHash,
      explanationDiffOutcomeHash: explanationDiffBenchmark.outcomeHash,
      multilingualOutcomeHash: multilingualBenchmark.outcomeHash,
      verificationReplayOutcomeHash: verificationReplayBenchmark.outcomeHash,
      proofCacheOutcomeHash: proofCacheBenchmark.outcomeHash,
      domainAdapterOutcomeHash: domainAdapterBenchmark.outcomeHash,
      observabilityOutcomeHash: observabilitySloActual.outcomeHash,
    },
  });

  return {
    schemaVersion: RELEASE_GATE_SCHEMA_VERSION,
    generatedAt,
    requestHash,
    outcomeHash,
    thresholdPass,
    summary: {
      passedChecks: checks.filter((check) => check.pass).length,
      failedChecks: checks.filter((check) => !check.pass).length,
      leafCount: qualityBaseline.entries.reduce((sum, entry) => sum + entry.leafCount, 0),
      parentCount: qualityBaseline.entries.reduce((sum, entry) => sum + entry.parentCount, 0),
      qualityOutcomeHash: qualityBaseline.outcomeHash,
      treeA11yOutcomeHash: treeA11yBenchmark.outcomeHash,
      treeScaleOutcomeHash: treeScaleBenchmark.outcomeHash,
      explanationDiffOutcomeHash: explanationDiffBenchmark.outcomeHash,
      multilingualOutcomeHash: multilingualBenchmark.outcomeHash,
      verificationReplayOutcomeHash: verificationReplayBenchmark.outcomeHash,
      proofCacheOutcomeHash: proofCacheBenchmark.outcomeHash,
      domainAdapterOutcomeHash: domainAdapterBenchmark.outcomeHash,
      observabilityOutcomeHash: observabilitySloActual.outcomeHash,
    },
    checks,
  };
}

export function buildReleaseGateBaseline(report: ReleaseGateReport): ReleaseGateBaseline {
  return {
    schemaVersion: RELEASE_GATE_BASELINE_SCHEMA_VERSION,
    requestHash: report.requestHash,
    outcomeHash: report.outcomeHash,
    thresholdPass: report.thresholdPass,
    checkStatus: report.checks
      .map((check) => ({ code: check.code, pass: check.pass }))
      .sort((left, right) => left.code.localeCompare(right.code)),
  };
}

export function assertReleaseGateBaseline(input: unknown): ReleaseGateBaseline {
  if (!isObject(input)) {
    throw new Error("release gate baseline must be an object");
  }
  const schemaVersion = expectString(input.schemaVersion, "schemaVersion");
  if (schemaVersion !== RELEASE_GATE_BASELINE_SCHEMA_VERSION) {
    throw new Error(
      `release gate baseline schemaVersion must be ${RELEASE_GATE_BASELINE_SCHEMA_VERSION}, received ${schemaVersion}`,
    );
  }
  const requestHash = expectString(input.requestHash, "requestHash");
  const outcomeHash = expectString(input.outcomeHash, "outcomeHash");
  const thresholdPass = expectBoolean(input.thresholdPass, "thresholdPass");
  if (!Array.isArray(input.checkStatus)) {
    throw new Error("checkStatus must be an array");
  }
  const checkStatus = input.checkStatus
    .map((entry, index) => assertCheckStatus(entry, `checkStatus[${String(index)}]`))
    .sort((left, right) => left.code.localeCompare(right.code));

  return {
    schemaVersion,
    requestHash,
    outcomeHash,
    thresholdPass,
    checkStatus,
  };
}

export function compareReleaseGateBaseline(
  expected: ReleaseGateBaseline,
  actual: ReleaseGateBaseline,
): ReleaseGateBaselineComparison {
  const failures: ReleaseGateBaselineFailure[] = [];

  if (expected.requestHash !== actual.requestHash) {
    failures.push({
      code: "field_mismatch",
      field: "requestHash",
      expected: expected.requestHash,
      actual: actual.requestHash,
    });
  }
  if (expected.outcomeHash !== actual.outcomeHash) {
    failures.push({
      code: "field_mismatch",
      field: "outcomeHash",
      expected: expected.outcomeHash,
      actual: actual.outcomeHash,
    });
  }
  if (expected.thresholdPass !== actual.thresholdPass) {
    failures.push({
      code: "field_mismatch",
      field: "thresholdPass",
      expected: expected.thresholdPass,
      actual: actual.thresholdPass,
    });
  }
  const expectedCheckStatus = JSON.stringify(expected.checkStatus);
  const actualCheckStatus = JSON.stringify(actual.checkStatus);
  if (expectedCheckStatus !== actualCheckStatus) {
    failures.push({
      code: "field_mismatch",
      field: "checkStatus",
      expected: expectedCheckStatus,
      actual: actualCheckStatus,
    });
  }

  return {
    pass: failures.length === 0,
    failures,
  };
}

export function assertTreeA11yBenchmarkArtifact(input: unknown): TreeA11yBenchmarkArtifact {
  if (!isObject(input)) {
    throw new Error("tree a11y benchmark artifact must be an object");
  }
  if (expectString(input.schemaVersion, "treeA11y.schemaVersion") !== "1.0.0") {
    throw new Error("tree a11y benchmark schemaVersion must be 1.0.0");
  }
  if (!isObject(input.summary)) {
    throw new Error("treeA11y.summary must be an object");
  }
  return {
    schemaVersion: "1.0.0",
    requestHash: expectString(input.requestHash, "treeA11y.requestHash"),
    outcomeHash: expectString(input.outcomeHash, "treeA11y.outcomeHash"),
    summary: {
      totalSteps: expectFiniteNumber(input.summary.totalSteps, "treeA11y.summary.totalSteps"),
      expandActionCount: expectFiniteNumber(input.summary.expandActionCount, "treeA11y.summary.expandActionCount"),
      collapseActionCount: expectFiniteNumber(input.summary.collapseActionCount, "treeA11y.summary.collapseActionCount"),
      activeAnnouncementCount: expectFiniteNumber(
        input.summary.activeAnnouncementCount,
        "treeA11y.summary.activeAnnouncementCount",
      ),
      virtualizedStepCount: expectFiniteNumber(input.summary.virtualizedStepCount, "treeA11y.summary.virtualizedStepCount"),
    },
  };
}

export function assertVerificationReplayBenchmarkArtifact(input: unknown): VerificationReplayBenchmarkArtifact {
  if (!isObject(input)) {
    throw new Error("verification replay benchmark artifact must be an object");
  }
  if (expectString(input.schemaVersion, "verificationReplay.schemaVersion") !== "1.0.0") {
    throw new Error("verification replay benchmark schemaVersion must be 1.0.0");
  }
  if (!isObject(input.summary)) {
    throw new Error("verificationReplay.summary must be an object");
  }
  return {
    schemaVersion: "1.0.0",
    requestHash: expectString(input.requestHash, "verificationReplay.requestHash"),
    outcomeHash: expectString(input.outcomeHash, "verificationReplay.outcomeHash"),
    summary: {
      exportFilename: expectString(input.summary.exportFilename, "verificationReplay.summary.exportFilename"),
      requestHash: expectString(input.summary.requestHash, "verificationReplay.summary.requestHash"),
      jobHash: expectString(input.summary.jobHash, "verificationReplay.summary.jobHash"),
      reproducibilityHash: expectString(input.summary.reproducibilityHash, "verificationReplay.summary.reproducibilityHash"),
      replayCommand: expectString(input.summary.replayCommand, "verificationReplay.summary.replayCommand"),
      envKeyCount: expectFiniteNumber(input.summary.envKeyCount, "verificationReplay.summary.envKeyCount"),
      logLineCount: expectFiniteNumber(input.summary.logLineCount, "verificationReplay.summary.logLineCount"),
      jsonLineCount: expectFiniteNumber(input.summary.jsonLineCount, "verificationReplay.summary.jsonLineCount"),
    },
  };
}

export function assertExplanationDiffBenchmarkArtifact(input: unknown): ExplanationDiffBenchmarkArtifact {
  if (!isObject(input)) {
    throw new Error("explanation diff benchmark artifact must be an object");
  }
  if (expectString(input.schemaVersion, "explanationDiff.schemaVersion") !== "1.0.0") {
    throw new Error("explanation diff benchmark schemaVersion must be 1.0.0");
  }
  if (!isObject(input.summary) || !isObject(input.summary.coverage)) {
    throw new Error("explanationDiff.summary must contain coverage object");
  }

  return {
    schemaVersion: "1.0.0",
    requestHash: expectString(input.requestHash, "explanationDiff.requestHash"),
    outcomeHash: expectString(input.outcomeHash, "explanationDiff.outcomeHash"),
    summary: {
      profileCount: expectFiniteNumber(input.summary.profileCount, "explanationDiff.summary.profileCount"),
      totalChanges: expectFiniteNumber(input.summary.totalChanges, "explanationDiff.summary.totalChanges"),
      changedProfiles: expectFiniteNumber(input.summary.changedProfiles, "explanationDiff.summary.changedProfiles"),
      truncatedProfiles: expectFiniteNumber(input.summary.truncatedProfiles, "explanationDiff.summary.truncatedProfiles"),
      provenanceCoveredChanges: expectFiniteNumber(
        input.summary.provenanceCoveredChanges,
        "explanationDiff.summary.provenanceCoveredChanges",
      ),
      zeroSupportChangeCount: expectFiniteNumber(
        input.summary.zeroSupportChangeCount,
        "explanationDiff.summary.zeroSupportChangeCount",
      ),
      orderingPassProfiles: expectFiniteNumber(input.summary.orderingPassProfiles, "explanationDiff.summary.orderingPassProfiles"),
      coverage: {
        abstractionLevel: expectBoolean(input.summary.coverage.abstractionLevel, "explanationDiff.summary.coverage.abstractionLevel"),
        complexityLevel: expectBoolean(input.summary.coverage.complexityLevel, "explanationDiff.summary.coverage.complexityLevel"),
        maxChildrenPerParent: expectBoolean(
          input.summary.coverage.maxChildrenPerParent,
          "explanationDiff.summary.coverage.maxChildrenPerParent",
        ),
        language: expectBoolean(input.summary.coverage.language, "explanationDiff.summary.coverage.language"),
        audienceLevel: expectBoolean(input.summary.coverage.audienceLevel, "explanationDiff.summary.coverage.audienceLevel"),
      },
    },
  };
}

export function assertMultilingualBenchmarkArtifact(input: unknown): MultilingualBenchmarkArtifact {
  if (!isObject(input)) {
    throw new Error("multilingual benchmark artifact must be an object");
  }
  if (expectString(input.schemaVersion, "multilingual.schemaVersion") !== "1.0.0") {
    throw new Error("multilingual benchmark schemaVersion must be 1.0.0");
  }
  if (!isObject(input.summary)) {
    throw new Error("multilingual.summary must be an object");
  }
  return {
    schemaVersion: "1.0.0",
    requestHash: expectString(input.requestHash, "multilingual.requestHash"),
    outcomeHash: expectString(input.outcomeHash, "multilingual.outcomeHash"),
    summary: {
      profileCount: expectFiniteNumber(input.summary.profileCount, "multilingual.summary.profileCount"),
      rootStructureStableProfiles: expectFiniteNumber(
        input.summary.rootStructureStableProfiles,
        "multilingual.summary.rootStructureStableProfiles",
      ),
      childrenStructureStableProfiles: expectFiniteNumber(
        input.summary.childrenStructureStableProfiles,
        "multilingual.summary.childrenStructureStableProfiles",
      ),
      pathStructureStableProfiles: expectFiniteNumber(
        input.summary.pathStructureStableProfiles,
        "multilingual.summary.pathStructureStableProfiles",
      ),
      localizedRootStatementProfiles: expectFiniteNumber(
        input.summary.localizedRootStatementProfiles,
        "multilingual.summary.localizedRootStatementProfiles",
      ),
      localizedChildStatementProfiles: expectFiniteNumber(
        input.summary.localizedChildStatementProfiles,
        "multilingual.summary.localizedChildStatementProfiles",
      ),
      localizedPathStatementProfiles: expectFiniteNumber(
        input.summary.localizedPathStatementProfiles,
        "multilingual.summary.localizedPathStatementProfiles",
      ),
      fallbackProfiles: expectFiniteNumber(input.summary.fallbackProfiles, "multilingual.summary.fallbackProfiles"),
      localeVariantProfiles: expectFiniteNumber(
        input.summary.localeVariantProfiles,
        "multilingual.summary.localeVariantProfiles",
      ),
      leafProvenanceStableProfiles: expectFiniteNumber(
        input.summary.leafProvenanceStableProfiles,
        "multilingual.summary.leafProvenanceStableProfiles",
      ),
    },
  };
}

export function assertTreeScaleBenchmarkArtifact(input: unknown): TreeScaleBenchmarkArtifact {
  if (!isObject(input)) {
    throw new Error("tree scale benchmark artifact must be an object");
  }
  if (expectString(input.schemaVersion, "treeScale.schemaVersion") !== "1.0.0") {
    throw new Error("tree scale benchmark schemaVersion must be 1.0.0");
  }
  if (!isObject(input.summary)) {
    throw new Error("treeScale.summary must be an object");
  }
  return {
    schemaVersion: "1.0.0",
    requestHash: expectString(input.requestHash, "treeScale.requestHash"),
    outcomeHash: expectString(input.outcomeHash, "treeScale.outcomeHash"),
    summary: {
      profileCount: expectFiniteNumber(input.summary.profileCount, "treeScale.summary.profileCount"),
      totalSamples: expectFiniteNumber(input.summary.totalSamples, "treeScale.summary.totalSamples"),
      fullModeSampleCount: expectFiniteNumber(input.summary.fullModeSampleCount, "treeScale.summary.fullModeSampleCount"),
      windowedModeSampleCount: expectFiniteNumber(
        input.summary.windowedModeSampleCount,
        "treeScale.summary.windowedModeSampleCount",
      ),
      virtualizedModeSampleCount: expectFiniteNumber(
        input.summary.virtualizedModeSampleCount,
        "treeScale.summary.virtualizedModeSampleCount",
      ),
      maxRenderedRowCount: expectFiniteNumber(input.summary.maxRenderedRowCount, "treeScale.summary.maxRenderedRowCount"),
      boundedSampleCount: expectFiniteNumber(input.summary.boundedSampleCount, "treeScale.summary.boundedSampleCount"),
    },
  };
}

export function assertProofCacheBenchmarkArtifact(input: unknown): ProofCacheBenchmarkArtifact {
  if (!isObject(input)) {
    throw new Error("proof cache benchmark artifact must be an object");
  }
  if (expectString(input.schemaVersion, "proofCache.schemaVersion") !== "1.0.0") {
    throw new Error("proof cache benchmark schemaVersion must be 1.0.0");
  }
  if (!isObject(input.scenarios)) {
    throw new Error("proofCache.scenarios must be an object");
  }

  const cold = expectScenario(input.scenarios.coldNoPersistentCache, "proofCache.scenarios.coldNoPersistentCache");
  const warm = expectScenario(input.scenarios.warmPersistentCache, "proofCache.scenarios.warmPersistentCache");

  return {
    schemaVersion: "1.0.0",
    requestHash: expectString(input.requestHash, "proofCache.requestHash"),
    outcomeHash: expectString(input.outcomeHash, "proofCache.outcomeHash"),
    scenarios: {
      coldNoPersistentCache: cold,
      warmPersistentCache: warm,
      invalidation: {
        recoveryStatus: expectRecoveryStatus(input.scenarios.invalidation, "proofCache.scenarios.invalidation"),
      },
      topologyShapeInvalidation: {
        recoveryStatus: expectRecoveryStatus(
          input.scenarios.topologyShapeInvalidation,
          "proofCache.scenarios.topologyShapeInvalidation",
        ),
      },
      mixedTopologyShapeInvalidation: {
        recoveryStatus: expectRecoveryStatus(
          input.scenarios.mixedTopologyShapeInvalidation,
          "proofCache.scenarios.mixedTopologyShapeInvalidation",
        ),
      },
    },
  };
}

export function assertDomainAdapterBenchmarkArtifact(input: unknown): DomainAdapterBenchmarkArtifact {
  if (!isObject(input)) {
    throw new Error("domain adapter benchmark artifact must be an object");
  }
  if (expectString(input.schemaVersion, "domainAdapter.schemaVersion") !== "1.0.0") {
    throw new Error("domain adapter benchmark schemaVersion must be 1.0.0");
  }
  if (!isObject(input.summary)) {
    throw new Error("domainAdapter.summary must be an object");
  }
  return {
    schemaVersion: "1.0.0",
    requestHash: expectString(input.requestHash, "domainAdapter.requestHash"),
    outcomeHash: expectString(input.outcomeHash, "domainAdapter.outcomeHash"),
    summary: {
      profileCount: expectFiniteNumber(input.summary.profileCount, "domainAdapter.summary.profileCount"),
      passCount: expectFiniteNumber(input.summary.passCount, "domainAdapter.summary.passCount"),
      downgradedProfileCount: expectFiniteNumber(
        input.summary.downgradedProfileCount,
        "domainAdapter.summary.downgradedProfileCount",
      ),
      manualOverrideProfileCount: expectFiniteNumber(
        input.summary.manualOverrideProfileCount,
        "domainAdapter.summary.manualOverrideProfileCount",
      ),
      macroPrecision: expectFiniteNumber(input.summary.macroPrecision, "domainAdapter.summary.macroPrecision"),
      macroRecall: expectFiniteNumber(input.summary.macroRecall, "domainAdapter.summary.macroRecall"),
      macroF1: expectFiniteNumber(input.summary.macroF1, "domainAdapter.summary.macroF1"),
      taggingReportHash: expectString(input.summary.taggingReportHash, "domainAdapter.summary.taggingReportHash"),
    },
  };
}

export function assertObservabilitySloBenchmarkArtifact(input: unknown): ObservabilitySloBenchmarkArtifact {
  if (!isObject(input)) {
    throw new Error("observability slo benchmark artifact must be an object");
  }
  if (expectString(input.schemaVersion, "observability.schemaVersion") !== "1.0.0") {
    throw new Error("observability slo benchmark schemaVersion must be 1.0.0");
  }
  if (!isObject(input.evaluation) || !isObject(input.evaluation.baseline) || !isObject(input.evaluation.strictRegression)) {
    throw new Error("observability.evaluation must contain baseline and strictRegression objects");
  }

  return {
    schemaVersion: "1.0.0",
    requestHash: expectString(input.requestHash, "observability.requestHash"),
    outcomeHash: expectString(input.outcomeHash, "observability.outcomeHash"),
    evaluation: {
      baseline: {
        thresholdPass: expectBoolean(input.evaluation.baseline.thresholdPass, "observability.evaluation.baseline.thresholdPass"),
      },
      strictRegression: {
        thresholdPass: expectBoolean(
          input.evaluation.strictRegression.thresholdPass,
          "observability.evaluation.strictRegression.thresholdPass",
        ),
      },
    },
  };
}

export function assertBaselineCheckArtifact(input: unknown, context: string): BaselineCheckArtifact {
  if (!isObject(input)) {
    throw new Error(`${context} must be an object`);
  }
  return {
    schemaVersion: expectString(input.schemaVersion, `${context}.schemaVersion`),
    pass: expectBoolean(input.pass, `${context}.pass`),
    expectedOutcomeHash: expectString(input.expectedOutcomeHash, `${context}.expectedOutcomeHash`),
    actualOutcomeHash: expectString(input.actualOutcomeHash, `${context}.actualOutcomeHash`),
  };
}

function assertCheckStatus(input: unknown, context: string): { code: ReleaseGateCheck["code"]; pass: boolean } {
  if (!isObject(input)) {
    throw new Error(`${context} must be an object`);
  }
  const code = expectString(input.code, `${context}.code`) as ReleaseGateCheck["code"];
  if (!isKnownCheckCode(code)) {
    throw new Error(`${context}.code is not a known release gate check code: ${code}`);
  }
  return {
    code,
    pass: expectBoolean(input.pass, `${context}.pass`),
  };
}

function expectScenario(input: unknown, context: string): { statuses: string[]; meanMs: number } {
  if (!isObject(input)) {
    throw new Error(`${context} must be an object`);
  }
  if (!Array.isArray(input.statuses)) {
    throw new Error(`${context}.statuses must be an array`);
  }
  return {
    statuses: input.statuses.map((status, index) => expectString(status, `${context}.statuses[${String(index)}]`)),
    meanMs: expectFiniteNumber(input.meanMs, `${context}.meanMs`),
  };
}

function expectRecoveryStatus(input: unknown, context: string): string {
  if (!isObject(input)) {
    throw new Error(`${context} must be an object`);
  }
  return expectString(input.recoveryStatus, `${context}.recoveryStatus`);
}

function isKnownCheckCode(value: string): value is ReleaseGateCheck["code"] {
  return (
    value === "quality_baseline_consistent" ||
    value === "quality_thresholds_pass" ||
    value === "strict_entailment_presets_present" ||
    value === "tree_a11y_transcript_complete" ||
    value === "tree_scale_profiles_cover_modes" ||
    value === "explanation_diff_profiles_cover_config_knobs" ||
    value === "multilingual_generation_contract" ||
    value === "verification_replay_contract_complete" ||
    value === "cache_warm_speedup" ||
    value === "cache_recovery_hits" ||
    value === "domain_adapter_quality_floor" ||
    value === "observability_baseline_consistent" ||
    value === "observability_slo_gate"
  );
}

function computeHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function normalizeString(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function expectString(value: unknown, context: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${context} must be a non-empty string`);
  }
  return value;
}

function expectBoolean(value: unknown, context: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${context} must be a boolean`);
  }
  return value;
}

function expectFiniteNumber(value: unknown, context: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${context} must be a finite number`);
  }
  return value;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}
