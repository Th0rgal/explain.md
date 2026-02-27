import { describe, expect, it } from "vitest";
import { formatPolicyThresholdFailure, getPolicyThresholdFailureLabel } from "../lib/policy-thresholds";

describe("policy-threshold labels", () => {
  it("maps known deterministic failure codes to readable labels", () => {
    expect(getPolicyThresholdFailureLabel("min_repartition_event_rate")).toBe("Repartition pressure below minimum");
    expect(getPolicyThresholdFailureLabel("repartition_event_rate")).toBe("Repartition pressure above maximum");
    expect(getPolicyThresholdFailureLabel("repartition_max_round")).toBe("Repartition max round above maximum");
    expect(getPolicyThresholdFailureLabel("policy_violation_rate")).toBe("Policy violation rate too high");
  });

  it("keeps unknown codes auditable with deterministic fallback text", () => {
    expect(getPolicyThresholdFailureLabel("custom_policy_gate")).toBe("Threshold check failed (custom policy gate)");
  });

  it("formats threshold failures with comparator semantics", () => {
    expect(
      formatPolicyThresholdFailure({
        code: "min_repartition_event_rate",
        message: "repartition event rate is below minimum threshold",
        details: {
          actual: 0,
          comparator: ">=",
          expected: 0.3,
        },
      }),
    ).toBe("Repartition pressure below minimum: 0 >= 0.3");
  });
});
