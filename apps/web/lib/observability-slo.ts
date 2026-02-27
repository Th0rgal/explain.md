import { createHash } from "node:crypto";
import type { ProofQueryObservabilityMetricsSnapshot } from "./proof-service";
import type { UiInteractionObservabilityMetricsSnapshot } from "./ui-interaction-observability";
import type { VerificationObservabilityMetricsSnapshot } from "./verification-service";

export interface ObservabilitySloThresholds {
  minProofRequestCount: number;
  minVerificationRequestCount: number;
  minProofCacheHitRate: number;
  minProofUniqueTraceRate: number;
  maxProofP95LatencyMs: number;
  maxProofMeanLatencyMs: number;
  maxVerificationFailureRate: number;
  maxVerificationP95LatencyMs: number;
  maxVerificationMeanLatencyMs: number;
  minVerificationParentTraceRate: number;
  minUiInteractionRequestCount: number;
  minUiInteractionSuccessRate: number;
  minUiInteractionKeyboardActionRate: number;
  minUiInteractionParentTraceRate: number;
  maxUiInteractionP95DurationMs: number;
}

export interface ObservabilitySloThresholdFailure {
  code:
    | "proof_request_count_below_min"
    | "verification_request_count_below_min"
    | "proof_cache_hit_rate_below_min"
    | "proof_unique_trace_rate_below_min"
    | "proof_p95_latency_above_max"
    | "proof_mean_latency_above_max"
    | "verification_failure_rate_above_max"
    | "verification_p95_latency_above_max"
    | "verification_mean_latency_above_max"
    | "verification_parent_trace_rate_below_min"
    | "ui_interaction_request_count_below_min"
    | "ui_interaction_success_rate_below_min"
    | "ui_interaction_keyboard_action_rate_below_min"
    | "ui_interaction_parent_trace_rate_below_min"
    | "ui_interaction_p95_duration_above_max";
  message: string;
  details: {
    metric: string;
    actual: number;
    expected: number;
    comparator: ">=" | "<=";
  };
}

export interface ObservabilitySloReport {
  schemaVersion: "1.0.0";
  thresholds: ObservabilitySloThresholds;
  metrics: {
    proof: {
      requestCount: number;
      cacheHitRate: number;
      uniqueTraceRate: number;
      maxP95LatencyMs: number;
      maxMeanLatencyMs: number;
    };
    verification: {
      requestCount: number;
      failureRate: number;
      maxP95LatencyMs: number;
      maxMeanLatencyMs: number;
      parentTraceProvidedRate: number;
    };
    uiInteraction: {
      requestCount: number;
      successRate: number;
      keyboardActionRate: number;
      parentTraceProvidedRate: number;
      maxP95DurationMs: number;
    };
  };
  thresholdPass: boolean;
  thresholdFailures: ObservabilitySloThresholdFailure[];
  proofSnapshotHash: string;
  verificationSnapshotHash: string;
  uiInteractionSnapshotHash: string;
  generatedAt: string;
  snapshotHash: string;
}

export const DEFAULT_OBSERVABILITY_SLO_THRESHOLDS: ObservabilitySloThresholds = {
  minProofRequestCount: 1,
  minVerificationRequestCount: 1,
  minProofCacheHitRate: 0,
  minProofUniqueTraceRate: 1,
  maxProofP95LatencyMs: 500,
  maxProofMeanLatencyMs: 400,
  maxVerificationFailureRate: 0,
  maxVerificationP95LatencyMs: 250,
  maxVerificationMeanLatencyMs: 200,
  minVerificationParentTraceRate: 0,
  minUiInteractionRequestCount: 1,
  minUiInteractionSuccessRate: 0.95,
  minUiInteractionKeyboardActionRate: 0,
  minUiInteractionParentTraceRate: 0,
  maxUiInteractionP95DurationMs: 500,
};

export function evaluateObservabilitySLOs(input: {
  proof: ProofQueryObservabilityMetricsSnapshot;
  verification: VerificationObservabilityMetricsSnapshot;
  uiInteraction: UiInteractionObservabilityMetricsSnapshot;
  thresholds?: Partial<ObservabilitySloThresholds>;
  generatedAt?: string;
}): ObservabilitySloReport {
  const thresholds = resolveThresholds(input.thresholds);
  const proofRequestCount = input.proof.requestCount;
  const proofCacheHitRate = input.proof.cache.hitRate;
  const proofUniqueTraceRate = proofRequestCount === 0 ? 0 : input.proof.uniqueTraceCount / proofRequestCount;
  const proofMaxP95LatencyMs =
    input.proof.queries.length === 0 ? 0 : Math.max(...input.proof.queries.map((query) => query.p95LatencyMs));
  const proofMaxMeanLatencyMs =
    input.proof.queries.length === 0 ? 0 : Math.max(...input.proof.queries.map((query) => query.meanLatencyMs));
  const verificationRequestCount = input.verification.requestCount;
  const verificationFailureRate = verificationRequestCount === 0 ? 0 : input.verification.failureCount / verificationRequestCount;
  const verificationMaxP95LatencyMs =
    input.verification.queries.length === 0
      ? 0
      : Math.max(...input.verification.queries.map((query) => query.p95LatencyMs));
  const verificationMaxMeanLatencyMs =
    input.verification.queries.length === 0
      ? 0
      : Math.max(...input.verification.queries.map((query) => query.meanLatencyMs));
  const parentTraceProvidedRate = input.verification.correlation.parentTraceProvidedRate;
  const uiInteractionRequestCount = input.uiInteraction.requestCount;
  const uiInteractionSuccessRate = uiInteractionRequestCount === 0 ? 0 : input.uiInteraction.successCount / uiInteractionRequestCount;
  const uiInteractionKeyboardActionRate = input.uiInteraction.keyboardActionRate;
  const uiInteractionParentTraceRate = input.uiInteraction.correlation.parentTraceProvidedRate;
  const uiInteractionMaxP95DurationMs =
    input.uiInteraction.interactions.length === 0
      ? 0
      : Math.max(...input.uiInteraction.interactions.map((entry) => entry.p95DurationMs));

  const failures: ObservabilitySloThresholdFailure[] = [];
  pushFailureIfLessThan(failures, {
    actual: proofRequestCount,
    expected: thresholds.minProofRequestCount,
    code: "proof_request_count_below_min",
    metric: "proof.requestCount",
    message: "Proof-query observability request volume is below configured minimum.",
  });
  pushFailureIfLessThan(failures, {
    actual: verificationRequestCount,
    expected: thresholds.minVerificationRequestCount,
    code: "verification_request_count_below_min",
    metric: "verification.requestCount",
    message: "Verification observability request volume is below configured minimum.",
  });
  pushFailureIfLessThan(failures, {
    actual: proofCacheHitRate,
    expected: thresholds.minProofCacheHitRate,
    code: "proof_cache_hit_rate_below_min",
    metric: "proof.cacheHitRate",
    message: "Proof-query cache hit rate is below configured minimum.",
  });
  pushFailureIfLessThan(failures, {
    actual: proofUniqueTraceRate,
    expected: thresholds.minProofUniqueTraceRate,
    code: "proof_unique_trace_rate_below_min",
    metric: "proof.uniqueTraceRate",
    message: "Proof-query unique trace ratio is below configured minimum.",
  });
  pushFailureIfGreaterThan(failures, {
    actual: proofMaxP95LatencyMs,
    expected: thresholds.maxProofP95LatencyMs,
    code: "proof_p95_latency_above_max",
    metric: "proof.maxP95LatencyMs",
    message: "Proof-query p95 latency exceeds configured maximum.",
  });
  pushFailureIfGreaterThan(failures, {
    actual: proofMaxMeanLatencyMs,
    expected: thresholds.maxProofMeanLatencyMs,
    code: "proof_mean_latency_above_max",
    metric: "proof.maxMeanLatencyMs",
    message: "Proof-query mean latency exceeds configured maximum.",
  });
  pushFailureIfGreaterThan(failures, {
    actual: verificationFailureRate,
    expected: thresholds.maxVerificationFailureRate,
    code: "verification_failure_rate_above_max",
    metric: "verification.failureRate",
    message: "Verification failure rate exceeds configured maximum.",
  });
  pushFailureIfGreaterThan(failures, {
    actual: verificationMaxP95LatencyMs,
    expected: thresholds.maxVerificationP95LatencyMs,
    code: "verification_p95_latency_above_max",
    metric: "verification.maxP95LatencyMs",
    message: "Verification p95 latency exceeds configured maximum.",
  });
  pushFailureIfGreaterThan(failures, {
    actual: verificationMaxMeanLatencyMs,
    expected: thresholds.maxVerificationMeanLatencyMs,
    code: "verification_mean_latency_above_max",
    metric: "verification.maxMeanLatencyMs",
    message: "Verification mean latency exceeds configured maximum.",
  });
  pushFailureIfLessThan(failures, {
    actual: parentTraceProvidedRate,
    expected: thresholds.minVerificationParentTraceRate,
    code: "verification_parent_trace_rate_below_min",
    metric: "verification.parentTraceProvidedRate",
    message: "Verification parent-trace correlation rate is below configured minimum.",
  });
  pushFailureIfLessThan(failures, {
    actual: uiInteractionRequestCount,
    expected: thresholds.minUiInteractionRequestCount,
    code: "ui_interaction_request_count_below_min",
    metric: "uiInteraction.requestCount",
    message: "UI interaction observability request volume is below configured minimum.",
  });
  pushFailureIfLessThan(failures, {
    actual: uiInteractionSuccessRate,
    expected: thresholds.minUiInteractionSuccessRate,
    code: "ui_interaction_success_rate_below_min",
    metric: "uiInteraction.successRate",
    message: "UI interaction success rate is below configured minimum.",
  });
  pushFailureIfLessThan(failures, {
    actual: uiInteractionKeyboardActionRate,
    expected: thresholds.minUiInteractionKeyboardActionRate,
    code: "ui_interaction_keyboard_action_rate_below_min",
    metric: "uiInteraction.keyboardActionRate",
    message: "UI interaction keyboard-action rate is below configured minimum.",
  });
  pushFailureIfLessThan(failures, {
    actual: uiInteractionParentTraceRate,
    expected: thresholds.minUiInteractionParentTraceRate,
    code: "ui_interaction_parent_trace_rate_below_min",
    metric: "uiInteraction.parentTraceProvidedRate",
    message: "UI interaction parent-trace correlation rate is below configured minimum.",
  });
  pushFailureIfGreaterThan(failures, {
    actual: uiInteractionMaxP95DurationMs,
    expected: thresholds.maxUiInteractionP95DurationMs,
    code: "ui_interaction_p95_duration_above_max",
    metric: "uiInteraction.maxP95DurationMs",
    message: "UI interaction p95 duration exceeds configured maximum.",
  });

  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const withoutHash = {
    schemaVersion: "1.0.0" as const,
    thresholds,
    metrics: {
      proof: {
        requestCount: proofRequestCount,
        cacheHitRate: proofCacheHitRate,
        uniqueTraceRate: proofUniqueTraceRate,
        maxP95LatencyMs: proofMaxP95LatencyMs,
        maxMeanLatencyMs: proofMaxMeanLatencyMs,
      },
      verification: {
        requestCount: verificationRequestCount,
        failureRate: verificationFailureRate,
        maxP95LatencyMs: verificationMaxP95LatencyMs,
        maxMeanLatencyMs: verificationMaxMeanLatencyMs,
        parentTraceProvidedRate,
      },
      uiInteraction: {
        requestCount: uiInteractionRequestCount,
        successRate: uiInteractionSuccessRate,
        keyboardActionRate: uiInteractionKeyboardActionRate,
        parentTraceProvidedRate: uiInteractionParentTraceRate,
        maxP95DurationMs: uiInteractionMaxP95DurationMs,
      },
    },
    thresholdPass: failures.length === 0,
    thresholdFailures: failures,
    proofSnapshotHash: input.proof.snapshotHash,
    verificationSnapshotHash: input.verification.snapshotHash,
    uiInteractionSnapshotHash: input.uiInteraction.snapshotHash,
    generatedAt,
  };

  return {
    ...withoutHash,
    snapshotHash: computeHash(withoutHash),
  };
}

function resolveThresholds(overrides: Partial<ObservabilitySloThresholds> | undefined): ObservabilitySloThresholds {
  return {
    minProofRequestCount: clampInteger(overrides?.minProofRequestCount, DEFAULT_OBSERVABILITY_SLO_THRESHOLDS.minProofRequestCount),
    minVerificationRequestCount: clampInteger(
      overrides?.minVerificationRequestCount,
      DEFAULT_OBSERVABILITY_SLO_THRESHOLDS.minVerificationRequestCount,
    ),
    minProofCacheHitRate: clampUnit(overrides?.minProofCacheHitRate, DEFAULT_OBSERVABILITY_SLO_THRESHOLDS.minProofCacheHitRate),
    minProofUniqueTraceRate: clampUnit(
      overrides?.minProofUniqueTraceRate,
      DEFAULT_OBSERVABILITY_SLO_THRESHOLDS.minProofUniqueTraceRate,
    ),
    maxProofP95LatencyMs: clampNonNegative(
      overrides?.maxProofP95LatencyMs,
      DEFAULT_OBSERVABILITY_SLO_THRESHOLDS.maxProofP95LatencyMs,
    ),
    maxProofMeanLatencyMs: clampNonNegative(
      overrides?.maxProofMeanLatencyMs,
      DEFAULT_OBSERVABILITY_SLO_THRESHOLDS.maxProofMeanLatencyMs,
    ),
    maxVerificationFailureRate: clampUnit(
      overrides?.maxVerificationFailureRate,
      DEFAULT_OBSERVABILITY_SLO_THRESHOLDS.maxVerificationFailureRate,
    ),
    maxVerificationP95LatencyMs: clampNonNegative(
      overrides?.maxVerificationP95LatencyMs,
      DEFAULT_OBSERVABILITY_SLO_THRESHOLDS.maxVerificationP95LatencyMs,
    ),
    maxVerificationMeanLatencyMs: clampNonNegative(
      overrides?.maxVerificationMeanLatencyMs,
      DEFAULT_OBSERVABILITY_SLO_THRESHOLDS.maxVerificationMeanLatencyMs,
    ),
    minVerificationParentTraceRate: clampUnit(
      overrides?.minVerificationParentTraceRate,
      DEFAULT_OBSERVABILITY_SLO_THRESHOLDS.minVerificationParentTraceRate,
    ),
    minUiInteractionRequestCount: clampInteger(
      overrides?.minUiInteractionRequestCount,
      DEFAULT_OBSERVABILITY_SLO_THRESHOLDS.minUiInteractionRequestCount,
    ),
    minUiInteractionSuccessRate: clampUnit(
      overrides?.minUiInteractionSuccessRate,
      DEFAULT_OBSERVABILITY_SLO_THRESHOLDS.minUiInteractionSuccessRate,
    ),
    minUiInteractionKeyboardActionRate: clampUnit(
      overrides?.minUiInteractionKeyboardActionRate,
      DEFAULT_OBSERVABILITY_SLO_THRESHOLDS.minUiInteractionKeyboardActionRate,
    ),
    minUiInteractionParentTraceRate: clampUnit(
      overrides?.minUiInteractionParentTraceRate,
      DEFAULT_OBSERVABILITY_SLO_THRESHOLDS.minUiInteractionParentTraceRate,
    ),
    maxUiInteractionP95DurationMs: clampNonNegative(
      overrides?.maxUiInteractionP95DurationMs,
      DEFAULT_OBSERVABILITY_SLO_THRESHOLDS.maxUiInteractionP95DurationMs,
    ),
  };
}

function clampInteger(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, Math.floor(value));
}

function clampNonNegative(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, value);
}

function clampUnit(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(1, Math.max(0, value));
}

function pushFailureIfLessThan(
  failures: ObservabilitySloThresholdFailure[],
  input: {
    code: ObservabilitySloThresholdFailure["code"];
    message: string;
    metric: string;
    actual: number;
    expected: number;
  },
): void {
  if (input.actual >= input.expected) {
    return;
  }
  failures.push({
    code: input.code,
    message: input.message,
    details: {
      metric: input.metric,
      actual: input.actual,
      expected: input.expected,
      comparator: ">=",
    },
  });
}

function pushFailureIfGreaterThan(
  failures: ObservabilitySloThresholdFailure[],
  input: {
    code: ObservabilitySloThresholdFailure["code"];
    message: string;
    metric: string;
    actual: number;
    expected: number;
  },
): void {
  if (input.actual <= input.expected) {
    return;
  }
  failures.push({
    code: input.code,
    message: input.message,
    details: {
      metric: input.metric,
      actual: input.actual,
      expected: input.expected,
      comparator: "<=",
    },
  });
}

function computeHash(value: unknown): string {
  const canonical = JSON.stringify(value, stableReplacer);
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
