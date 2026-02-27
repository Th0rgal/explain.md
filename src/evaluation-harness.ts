import { createHash } from "node:crypto";
import type { ExplanationConfig } from "./config-contract.js";
import type { ExplanationTree } from "./tree-builder.js";
import { stemToken, tokenizeNormalized } from "./text-normalization.js";

const STOP_WORDS = new Set<string>([
  "about",
  "after",
  "again",
  "because",
  "before",
  "being",
  "between",
  "could",
  "every",
  "first",
  "from",
  "have",
  "into",
  "their",
  "there",
  "these",
  "those",
  "through",
  "under",
  "using",
  "where",
  "which",
  "while",
  "with",
  "without",
  "this",
  "that",
  "therefore",
  "thus",
]);

const MIN_MEANINGFUL_TOKEN_LENGTH = 3;

export interface TreeQualityThresholds {
  maxUnsupportedParentRate: number;
  maxPrerequisiteViolationRate: number;
  maxPolicyViolationRate: number;
  maxTermJumpRate: number;
  maxComplexitySpreadMean: number;
  minEvidenceCoverageMean: number;
  minVocabularyContinuityMean: number;
  minRepartitionEventRate: number;
  maxRepartitionEventRate: number;
  maxRepartitionMaxRound: number;
}

export interface TreeQualityThresholdFailure {
  code:
    | "unsupported_parent_rate"
    | "prerequisite_violation_rate"
    | "policy_violation_rate"
    | "term_jump_rate"
    | "complexity_spread_mean"
    | "evidence_coverage_mean"
    | "vocabulary_continuity_mean"
    | "min_repartition_event_rate"
    | "repartition_event_rate"
    | "repartition_max_round";
  message: string;
  details: {
    actual: number;
    expected: number;
    comparator: "<=" | ">=";
  };
}

export interface ParentQualitySample {
  parentId: string;
  depth: number;
  childCount: number;
  complexitySpread: number;
  prerequisiteOrderViolations: number;
  evidenceCoverageRatio: number;
  vocabularyContinuityRatio: number;
  supportedClaimRatio: number;
  introducedTermCount: number;
  introducedTermRate: number;
  policyViolationCount: number;
}

export interface DepthQualityMetrics {
  depth: number;
  parentCount: number;
  unsupportedParentRate: number;
  prerequisiteViolationRate: number;
  policyViolationRate: number;
  meanComplexitySpread: number;
  meanEvidenceCoverage: number;
  meanVocabularyContinuity: number;
  meanTermJumpRate: number;
}

export interface TreeQualityMetrics {
  parentCount: number;
  unsupportedParentCount: number;
  prerequisiteViolationParentCount: number;
  policyViolationParentCount: number;
  introducedTermOverflowParentCount: number;
  unsupportedParentRate: number;
  prerequisiteViolationRate: number;
  policyViolationRate: number;
  meanComplexitySpread: number;
  maxComplexitySpread: number;
  meanEvidenceCoverage: number;
  meanVocabularyContinuity: number;
  meanTermJumpRate: number;
  supportCoverageFloor: number;
}

export interface RepartitionDepthMetrics {
  depth: number;
  eventCount: number;
  preSummaryEventCount: number;
  postSummaryEventCount: number;
  maxRound: number;
}

export interface RepartitionMetrics {
  eventCount: number;
  preSummaryEventCount: number;
  postSummaryEventCount: number;
  maxRound: number;
  depthMetrics: RepartitionDepthMetrics[];
}

export interface EvaluateTreeQualityOptions {
  thresholds?: Partial<TreeQualityThresholds>;
}

export interface TreeQualityReport {
  rootId: string;
  configHash: string;
  generatedAt: string;
  metrics: TreeQualityMetrics;
  thresholds: TreeQualityThresholds;
  thresholdPass: boolean;
  thresholdFailures: TreeQualityThresholdFailure[];
  parentSamples: ParentQualitySample[];
  depthMetrics: DepthQualityMetrics[];
  repartitionMetrics: RepartitionMetrics;
}

export function evaluateExplanationTreeQuality(
  tree: ExplanationTree,
  config: ExplanationConfig,
  options: EvaluateTreeQualityOptions = {},
): TreeQualityReport {
  const supportCoverageFloor = computeSupportCoverageFloor(config);
  const thresholds = normalizeThresholds(config, options.thresholds);
  const parentSamples = collectParentSamples(tree, config, supportCoverageFloor);
  const depthMetrics = buildDepthMetrics(parentSamples, supportCoverageFloor);
  const metrics = aggregateMetrics(parentSamples, supportCoverageFloor);
  const repartitionMetrics = collectRepartitionMetrics(tree);
  const thresholdFailures = evaluateThresholds(metrics, repartitionMetrics, thresholds);

  return {
    rootId: tree.rootId,
    configHash: tree.configHash,
    generatedAt: new Date().toISOString(),
    metrics,
    thresholds,
    thresholdPass: thresholdFailures.length === 0,
    thresholdFailures,
    parentSamples,
    depthMetrics,
    repartitionMetrics,
  };
}

export function renderTreeQualityReportCanonical(report: TreeQualityReport): string {
  const canonical = canonicalizeReport(report);
  return JSON.stringify({
    ...canonical,
    generatedAt: "<non-deterministic>",
  });
}

export function computeTreeQualityReportHash(report: TreeQualityReport): string {
  return createHash("sha256").update(renderTreeQualityReportCanonical(report)).digest("hex");
}

function canonicalizeReport(report: TreeQualityReport): TreeQualityReport {
  return {
    ...report,
    parentSamples: report.parentSamples
      .slice()
      .sort((left, right) => left.parentId.localeCompare(right.parentId)),
    depthMetrics: report.depthMetrics.slice().sort((left, right) => left.depth - right.depth),
    thresholdFailures: report.thresholdFailures
      .slice()
      .sort((left, right) => left.code.localeCompare(right.code) || left.message.localeCompare(right.message)),
    repartitionMetrics: {
      ...report.repartitionMetrics,
      depthMetrics: report.repartitionMetrics.depthMetrics.slice().sort((left, right) => left.depth - right.depth),
    },
  };
}

function collectRepartitionMetrics(tree: ExplanationTree): RepartitionMetrics {
  const byDepth = new Map<number, RepartitionDepthMetrics>();
  let eventCount = 0;
  let preSummaryEventCount = 0;
  let postSummaryEventCount = 0;
  let maxRound = 0;

  for (const layer of tree.groupingDiagnostics) {
    const events = layer.repartitionEvents ?? [];
    for (const event of events) {
      eventCount += 1;
      if (event.reason === "pre_summary_policy") {
        preSummaryEventCount += 1;
      } else {
        postSummaryEventCount += 1;
      }
      maxRound = Math.max(maxRound, event.round);

      const current = byDepth.get(event.depth) ?? {
        depth: event.depth,
        eventCount: 0,
        preSummaryEventCount: 0,
        postSummaryEventCount: 0,
        maxRound: 0,
      };
      current.eventCount += 1;
      if (event.reason === "pre_summary_policy") {
        current.preSummaryEventCount += 1;
      } else {
        current.postSummaryEventCount += 1;
      }
      current.maxRound = Math.max(current.maxRound, event.round);
      byDepth.set(event.depth, current);
    }
  }

  return {
    eventCount,
    preSummaryEventCount,
    postSummaryEventCount,
    maxRound,
    depthMetrics: Array.from(byDepth.values()).sort((left, right) => left.depth - right.depth),
  };
}

function collectParentSamples(
  tree: ExplanationTree,
  config: ExplanationConfig,
  supportCoverageFloor: number,
): ParentQualitySample[] {
  const samples: ParentQualitySample[] = [];
  const descendantVocabularyMemo = new Map<string, Set<string>>();

  const parentNodes = Object.values(tree.nodes)
    .filter((node) => node.kind === "parent")
    .sort((left, right) => left.id.localeCompare(right.id));

  for (const parentNode of parentNodes) {
    const policyDiagnostics = tree.policyDiagnosticsByParent[parentNode.id] ?? parentNode.policyDiagnostics;
    const childCount = parentNode.childIds.length;

    const complexitySpread = policyDiagnostics?.preSummary.metrics.complexitySpread ?? 0;
    const prerequisiteOrderViolations = policyDiagnostics?.preSummary.metrics.prerequisiteOrderViolations ?? 0;
    const evidenceCoverageRatio =
      policyDiagnostics?.postSummary.metrics.evidenceCoverageRatio ??
      computeDirectEvidenceCoverageRatio(parentNode.childIds, parentNode.evidenceRefs);
    const vocabularyContinuityRatio = policyDiagnostics?.postSummary.metrics.vocabularyContinuityRatio ?? 1;
    const policyViolationCount =
      (policyDiagnostics?.preSummary.violations.length ?? 0) + (policyDiagnostics?.postSummary.violations.length ?? 0);

    const parentTokens = meaningfulStems(parentNode.statement);
    const descendantVocabulary = collectDescendantVocabulary(tree, parentNode.id, descendantVocabularyMemo);
    const allowedNewTerms = new Set(meaningfulStems((parentNode.newTermsIntroduced ?? []).join(" ")));

    const supportedTokens = parentTokens.filter((token) => descendantVocabulary.has(token) || allowedNewTerms.has(token));
    const supportedClaimRatio = parentTokens.length === 0 ? 1 : supportedTokens.length / parentTokens.length;

    const introducedTermCount = (parentNode.newTermsIntroduced ?? []).length;
    const introducedTermRate = parentTokens.length === 0 ? 0 : introducedTermCount / parentTokens.length;

    samples.push({
      parentId: parentNode.id,
      depth: parentNode.depth,
      childCount,
      complexitySpread,
      prerequisiteOrderViolations,
      evidenceCoverageRatio,
      vocabularyContinuityRatio,
      supportedClaimRatio,
      introducedTermCount,
      introducedTermRate,
      policyViolationCount,
    });
  }

  return samples;
}

function aggregateMetrics(samples: ParentQualitySample[], supportCoverageFloor: number): TreeQualityMetrics {
  if (samples.length === 0) {
    return {
      parentCount: 0,
      unsupportedParentCount: 0,
      prerequisiteViolationParentCount: 0,
      policyViolationParentCount: 0,
      introducedTermOverflowParentCount: 0,
      unsupportedParentRate: 0,
      prerequisiteViolationRate: 0,
      policyViolationRate: 0,
      meanComplexitySpread: 0,
      maxComplexitySpread: 0,
      meanEvidenceCoverage: 1,
      meanVocabularyContinuity: 1,
      meanTermJumpRate: 0,
      supportCoverageFloor,
    };
  }

  let unsupportedParentCount = 0;
  let prerequisiteViolationParentCount = 0;
  let policyViolationParentCount = 0;
  let introducedTermOverflowParentCount = 0;

  let sumComplexitySpread = 0;
  let maxComplexitySpread = 0;
  let sumEvidenceCoverage = 0;
  let sumVocabularyContinuity = 0;
  let sumTermJumpRate = 0;

  for (const sample of samples) {
    if (sample.supportedClaimRatio < supportCoverageFloor) {
      unsupportedParentCount += 1;
    }
    if (sample.prerequisiteOrderViolations > 0) {
      prerequisiteViolationParentCount += 1;
    }
    if (sample.policyViolationCount > 0) {
      policyViolationParentCount += 1;
    }
    if (sample.introducedTermRate > 1) {
      introducedTermOverflowParentCount += 1;
    }

    sumComplexitySpread += sample.complexitySpread;
    maxComplexitySpread = Math.max(maxComplexitySpread, sample.complexitySpread);
    sumEvidenceCoverage += sample.evidenceCoverageRatio;
    sumVocabularyContinuity += sample.vocabularyContinuityRatio;
    sumTermJumpRate += sample.introducedTermRate;
  }

  const denominator = samples.length;

  return {
    parentCount: denominator,
    unsupportedParentCount,
    prerequisiteViolationParentCount,
    policyViolationParentCount,
    introducedTermOverflowParentCount,
    unsupportedParentRate: unsupportedParentCount / denominator,
    prerequisiteViolationRate: prerequisiteViolationParentCount / denominator,
    policyViolationRate: policyViolationParentCount / denominator,
    meanComplexitySpread: sumComplexitySpread / denominator,
    maxComplexitySpread,
    meanEvidenceCoverage: sumEvidenceCoverage / denominator,
    meanVocabularyContinuity: sumVocabularyContinuity / denominator,
    meanTermJumpRate: sumTermJumpRate / denominator,
    supportCoverageFloor,
  };
}

function buildDepthMetrics(samples: ParentQualitySample[], supportCoverageFloor: number): DepthQualityMetrics[] {
  const byDepth = new Map<number, ParentQualitySample[]>();
  for (const sample of samples) {
    const current = byDepth.get(sample.depth) ?? [];
    current.push(sample);
    byDepth.set(sample.depth, current);
  }

  return Array.from(byDepth.entries())
    .sort((left, right) => left[0] - right[0])
    .map(([depth, depthSamples]) => {
      const aggregate = aggregateMetrics(depthSamples, supportCoverageFloor);
      return {
        depth,
        parentCount: aggregate.parentCount,
        unsupportedParentRate: aggregate.unsupportedParentRate,
        prerequisiteViolationRate: aggregate.prerequisiteViolationRate,
        policyViolationRate: aggregate.policyViolationRate,
        meanComplexitySpread: aggregate.meanComplexitySpread,
        meanEvidenceCoverage: aggregate.meanEvidenceCoverage,
        meanVocabularyContinuity: aggregate.meanVocabularyContinuity,
        meanTermJumpRate: aggregate.meanTermJumpRate,
      };
    });
}

function evaluateThresholds(
  metrics: TreeQualityMetrics,
  repartitionMetrics: RepartitionMetrics,
  thresholds: TreeQualityThresholds,
): TreeQualityThresholdFailure[] {
  const failures: TreeQualityThresholdFailure[] = [];
  const repartitionEventRate = metrics.parentCount === 0 ? 0 : repartitionMetrics.eventCount / metrics.parentCount;

  if (metrics.unsupportedParentRate > thresholds.maxUnsupportedParentRate) {
    failures.push({
      code: "unsupported_parent_rate",
      message: "Unsupported parent rate exceeded threshold.",
      details: {
        actual: metrics.unsupportedParentRate,
        expected: thresholds.maxUnsupportedParentRate,
        comparator: "<=",
      },
    });
  }

  if (metrics.prerequisiteViolationRate > thresholds.maxPrerequisiteViolationRate) {
    failures.push({
      code: "prerequisite_violation_rate",
      message: "Prerequisite-order violation rate exceeded threshold.",
      details: {
        actual: metrics.prerequisiteViolationRate,
        expected: thresholds.maxPrerequisiteViolationRate,
        comparator: "<=",
      },
    });
  }

  if (metrics.policyViolationRate > thresholds.maxPolicyViolationRate) {
    failures.push({
      code: "policy_violation_rate",
      message: "Policy-violation rate exceeded threshold.",
      details: {
        actual: metrics.policyViolationRate,
        expected: thresholds.maxPolicyViolationRate,
        comparator: "<=",
      },
    });
  }

  if (metrics.meanTermJumpRate > thresholds.maxTermJumpRate) {
    failures.push({
      code: "term_jump_rate",
      message: "Mean term-introduction jump rate exceeded threshold.",
      details: {
        actual: metrics.meanTermJumpRate,
        expected: thresholds.maxTermJumpRate,
        comparator: "<=",
      },
    });
  }

  if (metrics.meanComplexitySpread > thresholds.maxComplexitySpreadMean) {
    failures.push({
      code: "complexity_spread_mean",
      message: "Mean sibling complexity spread exceeded threshold.",
      details: {
        actual: metrics.meanComplexitySpread,
        expected: thresholds.maxComplexitySpreadMean,
        comparator: "<=",
      },
    });
  }

  if (metrics.meanEvidenceCoverage < thresholds.minEvidenceCoverageMean) {
    failures.push({
      code: "evidence_coverage_mean",
      message: "Mean evidence coverage dropped below threshold.",
      details: {
        actual: metrics.meanEvidenceCoverage,
        expected: thresholds.minEvidenceCoverageMean,
        comparator: ">=",
      },
    });
  }

  if (metrics.meanVocabularyContinuity < thresholds.minVocabularyContinuityMean) {
    failures.push({
      code: "vocabulary_continuity_mean",
      message: "Mean vocabulary continuity dropped below threshold.",
      details: {
        actual: metrics.meanVocabularyContinuity,
        expected: thresholds.minVocabularyContinuityMean,
        comparator: ">=",
      },
    });
  }

  if (repartitionEventRate < thresholds.minRepartitionEventRate) {
    failures.push({
      code: "min_repartition_event_rate",
      message: "Repartition event rate dropped below threshold.",
      details: {
        actual: repartitionEventRate,
        expected: thresholds.minRepartitionEventRate,
        comparator: ">=",
      },
    });
  }

  if (repartitionEventRate > thresholds.maxRepartitionEventRate) {
    failures.push({
      code: "repartition_event_rate",
      message: "Repartition event rate exceeded threshold.",
      details: {
        actual: repartitionEventRate,
        expected: thresholds.maxRepartitionEventRate,
        comparator: "<=",
      },
    });
  }

  if (repartitionMetrics.maxRound > thresholds.maxRepartitionMaxRound) {
    failures.push({
      code: "repartition_max_round",
      message: "Maximum repartition round exceeded threshold.",
      details: {
        actual: repartitionMetrics.maxRound,
        expected: thresholds.maxRepartitionMaxRound,
        comparator: "<=",
      },
    });
  }

  return failures;
}

function normalizeThresholds(config: ExplanationConfig, overrides?: Partial<TreeQualityThresholds>): TreeQualityThresholds {
  const defaults: TreeQualityThresholds = {
    maxUnsupportedParentRate: 0.1,
    maxPrerequisiteViolationRate: 0,
    maxPolicyViolationRate: 0,
    maxTermJumpRate: 0.35,
    maxComplexitySpreadMean: config.complexityBandWidth,
    minEvidenceCoverageMean: 1,
    minVocabularyContinuityMean: computeVocabularyContinuityThreshold(config),
    minRepartitionEventRate: 0,
    maxRepartitionEventRate: 1,
    maxRepartitionMaxRound: 3,
  };

  return {
    maxUnsupportedParentRate: clampRate(overrides?.maxUnsupportedParentRate ?? defaults.maxUnsupportedParentRate),
    maxPrerequisiteViolationRate: clampRate(overrides?.maxPrerequisiteViolationRate ?? defaults.maxPrerequisiteViolationRate),
    maxPolicyViolationRate: clampRate(overrides?.maxPolicyViolationRate ?? defaults.maxPolicyViolationRate),
    maxTermJumpRate: clampRate(overrides?.maxTermJumpRate ?? defaults.maxTermJumpRate),
    maxComplexitySpreadMean: clampSpread(
      overrides?.maxComplexitySpreadMean ?? defaults.maxComplexitySpreadMean,
      config.complexityBandWidth,
    ),
    minEvidenceCoverageMean: clampRate(overrides?.minEvidenceCoverageMean ?? defaults.minEvidenceCoverageMean),
    minVocabularyContinuityMean: clampRate(overrides?.minVocabularyContinuityMean ?? defaults.minVocabularyContinuityMean),
    minRepartitionEventRate: clampRate(overrides?.minRepartitionEventRate ?? defaults.minRepartitionEventRate),
    maxRepartitionEventRate: clampRate(overrides?.maxRepartitionEventRate ?? defaults.maxRepartitionEventRate),
    maxRepartitionMaxRound: clampNonNegativeInteger(
      overrides?.maxRepartitionMaxRound ?? defaults.maxRepartitionMaxRound,
      defaults.maxRepartitionMaxRound,
    ),
  };
}

function clampRate(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

function clampSpread(value: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, value);
}

function clampNonNegativeInteger(value: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, Math.floor(value));
}

function computeSupportCoverageFloor(config: ExplanationConfig): number {
  if (config.entailmentMode === "strict") {
    return 1;
  }

  const audienceBump = config.audienceLevel === "expert" ? 0.05 : config.audienceLevel === "novice" ? -0.05 : 0;
  const proofBump = config.proofDetailMode === "formal" ? 0.1 : config.proofDetailMode === "minimal" ? -0.05 : 0;
  const raw = 0.5 + audienceBump + proofBump;
  return Math.max(0.35, Math.min(0.75, raw));
}

function computeVocabularyContinuityThreshold(config: ExplanationConfig): number {
  const proofFloor = config.proofDetailMode === "formal" ? 0.7 : config.proofDetailMode === "balanced" ? 0.6 : 0.5;
  const audienceDelta = config.audienceLevel === "novice" ? -0.05 : config.audienceLevel === "expert" ? 0.05 : 0;
  return Math.max(0.4, Math.min(0.8, proofFloor + audienceDelta));
}

function collectDescendantVocabulary(
  tree: ExplanationTree,
  nodeId: string,
  memo: Map<string, Set<string>>,
): Set<string> {
  const cached = memo.get(nodeId);
  if (cached) {
    return cached;
  }

  const node = tree.nodes[nodeId];
  if (!node) {
    memo.set(nodeId, new Set<string>());
    return memo.get(nodeId) as Set<string>;
  }

  const combined = new Set<string>();
  for (const childId of node.childIds) {
    const child = tree.nodes[childId];
    if (!child) {
      continue;
    }

    for (const token of meaningfulStems(child.statement)) {
      combined.add(token);
    }

    const descendantTokens = collectDescendantVocabulary(tree, childId, memo);
    for (const token of descendantTokens) {
      combined.add(token);
    }
  }

  memo.set(nodeId, combined);
  return combined;
}

function computeDirectEvidenceCoverageRatio(childIds: string[], evidenceRefs: string[]): number {
  if (childIds.length === 0) {
    return 1;
  }

  const evidenceSet = new Set(evidenceRefs);
  let covered = 0;

  for (const childId of childIds) {
    if (evidenceSet.has(childId)) {
      covered += 1;
    }
  }

  return covered / childIds.length;
}

function meaningfulStems(text: string): string[] {
  const rawTokens = tokenizeNormalized(text);
  const stems = rawTokens
    .map((token) => stemToken(token))
    .filter((token) => token.length >= MIN_MEANINGFUL_TOKEN_LENGTH && !STOP_WORDS.has(token));

  return Array.from(new Set(stems));
}
