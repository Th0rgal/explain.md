import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, ENTAILMENT_MODE_OPTIONS } from "../components/proof-explorer";

describe("proof explorer controls contract", () => {
  it("defaults to calibrated entailment mode", () => {
    expect(DEFAULT_CONFIG.entailmentMode).toBe("calibrated");
  });

  it("exposes deterministic entailment mode options", () => {
    expect(ENTAILMENT_MODE_OPTIONS).toEqual([
      { value: "calibrated", label: "Calibrated" },
      { value: "strict", label: "Strict" },
    ]);
  });
});
