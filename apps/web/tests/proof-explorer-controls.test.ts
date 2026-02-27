import { describe, expect, it } from "vitest";
import {
  DEFAULT_CONFIG,
  DIFF_PANEL_SETTINGS,
  ENTAILMENT_MODE_OPTIONS,
  LANGUAGE_OPTIONS,
  shouldEmitDirectTreeInteractionTelemetry,
} from "../components/proof-explorer";

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

  it("uses deterministic diff panel truncation settings", () => {
    expect(DIFF_PANEL_SETTINGS.maxChanges).toBe(24);
  });

  it("exposes deterministic language options", () => {
    expect(LANGUAGE_OPTIONS).toEqual([
      { value: "en", label: "English" },
      { value: "fr", label: "French" },
    ]);
  });

  it("does not double-emit direct tree telemetry for keyboard interactions", () => {
    expect(shouldEmitDirectTreeInteractionTelemetry("keyboard")).toBe(false);
  });

  it("keeps direct tree telemetry enabled for mouse/programmatic interactions", () => {
    expect(shouldEmitDirectTreeInteractionTelemetry("mouse")).toBe(true);
    expect(shouldEmitDirectTreeInteractionTelemetry("programmatic")).toBe(true);
  });
});
