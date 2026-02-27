import { afterEach, describe, expect, it } from "vitest";
import {
  clearUiInteractionObservabilityMetricsForTests,
  exportUiInteractionObservabilityMetrics,
  recordUiInteractionEvent,
} from "../lib/ui-interaction-observability";

describe("ui interaction observability", () => {
  afterEach(() => {
    clearUiInteractionObservabilityMetricsForTests();
  });

  it("exports deterministic interaction metrics with stable hashes", () => {
    recordUiInteractionEvent({
      proofId: "seed-verity",
      interaction: "config_update",
      source: "mouse",
      success: true,
      parentTraceId: "trace-parent-a",
      durationMs: 8,
    });
    recordUiInteractionEvent({
      proofId: "seed-verity",
      interaction: "tree_select_leaf",
      source: "keyboard",
      success: true,
      durationMs: 12,
    });
    recordUiInteractionEvent({
      proofId: "seed-verity",
      interaction: "verification_run",
      source: "mouse",
      success: false,
      durationMs: 15,
    });

    const first = exportUiInteractionObservabilityMetrics({
      generatedAt: "2026-02-27T00:00:00.000Z",
    });
    const second = exportUiInteractionObservabilityMetrics({
      generatedAt: "2026-02-27T00:00:00.000Z",
    });

    expect(first.requestCount).toBe(3);
    expect(first.successCount).toBe(2);
    expect(first.failureCount).toBe(1);
    expect(first.correlation.parentTraceProvidedRate).toBeCloseTo(1 / 3, 5);
    expect(first.interactions.find((entry) => entry.interaction === "config_update")?.requestCount).toBe(1);
    expect(first.interactions.find((entry) => entry.interaction === "verification_run")?.p95DurationMs).toBe(15);
    expect(first.snapshotHash).toBe(second.snapshotHash);
  });

  it("rejects empty proof ids for interaction events", () => {
    expect(() =>
      recordUiInteractionEvent({
        proofId: "",
        interaction: "tree_keyboard",
        source: "keyboard",
      }),
    ).toThrow("'proofId' must be non-empty.");
  });
});
