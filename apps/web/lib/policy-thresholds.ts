import type { PolicyThresholdFailure } from "./api-client";

const FAILURE_CODE_LABELS: Record<string, string> = {
  unsupported_parent_rate: "Unsupported parent rate too high",
  prerequisite_violation_rate: "Prerequisite-order violation rate too high",
  policy_violation_rate: "Policy violation rate too high",
  term_jump_rate: "Term-jump rate too high",
  complexity_spread_mean: "Mean complexity spread too high",
  evidence_coverage_mean: "Mean evidence coverage too low",
  vocabulary_continuity_mean: "Mean vocabulary continuity too low",
  min_repartition_event_rate: "Repartition pressure below minimum",
  repartition_event_rate: "Repartition pressure above maximum",
  repartition_max_round: "Repartition max round above maximum",
};

function humanizeCode(code: string): string {
  return code
    .replaceAll("_", " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function getPolicyThresholdFailureLabel(code: string): string {
  return FAILURE_CODE_LABELS[code] ?? `Threshold check failed (${humanizeCode(code)})`;
}

export function formatPolicyThresholdFailure(failure: PolicyThresholdFailure): string {
  const label = getPolicyThresholdFailureLabel(failure.code);
  const { actual, comparator, expected } = failure.details;
  return `${label}: ${actual} ${comparator} ${expected}`;
}
