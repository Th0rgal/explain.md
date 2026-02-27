import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearUiInteractionObservabilityMetricsForTests,
  exportUiInteractionObservabilityLedger,
  exportUiInteractionObservabilityMetrics,
  recordUiInteractionEvent,
} from "../lib/ui-interaction-observability";

describe("ui interaction observability", () => {
  afterEach(() => {
    clearUiInteractionObservabilityMetricsForTests({ clearRetention: true });
    delete process.env.EXPLAIN_MD_UI_INTERACTION_LEDGER_PATH;
    delete process.env.EXPLAIN_MD_UI_INTERACTION_LEDGER_MAX_EVENTS;
    delete process.env.EXPLAIN_MD_UI_INTERACTION_LEDGER_TTL_SECONDS;
    vi.useRealTimers();
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

  it("persists deterministic durable ledger snapshots when retention path is configured", () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "explain-md-ui-ledger-"));
    const ledgerPath = path.join(tempDir, "ui-interactions.ndjson");
    process.env.EXPLAIN_MD_UI_INTERACTION_LEDGER_PATH = ledgerPath;
    clearUiInteractionObservabilityMetricsForTests({ clearRetention: true });

    const firstReceipt = recordUiInteractionEvent({
      proofId: "seed-verity",
      interaction: "tree_keyboard",
      source: "keyboard",
      parentTraceId: "trace-parent-a",
      durationMs: 7,
    });
    const secondReceipt = recordUiInteractionEvent({
      proofId: "seed-verity",
      interaction: "profile_apply",
      source: "mouse",
      durationMs: 5,
    });

    const first = exportUiInteractionObservabilityLedger({
      generatedAt: "2026-02-27T00:00:00.000Z",
    });
    const second = exportUiInteractionObservabilityLedger({
      generatedAt: "2026-02-27T00:00:00.000Z",
    });

    expect(first.retention.enabled).toBe(true);
    expect(first.retention.mode).toBe("ndjson");
    expect(first.retention.compaction.enabled).toBe(false);
    expect(first.retention.compaction.policy).toBe("disabled");
    expect(first.persistedEventCount).toBe(2);
    expect(first.rollingWindowRequestCount).toBe(2);
    expect(first.latestRequestId).toBe(secondReceipt.requestId);
    expect(first.snapshotHash).toBe(second.snapshotHash);

    const lines = readFileSync(ledgerPath, "utf8")
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as { requestId: string; sequence: number });
    expect(lines).toHaveLength(2);
    expect(lines[0]?.sequence).toBe(0);
    expect(lines[0]?.requestId).toBe(firstReceipt.requestId);
    expect(lines[1]?.sequence).toBe(1);
    expect(lines[1]?.requestId).toBe(secondReceipt.requestId);

    rmSync(tempDir, { recursive: true, force: true });
  });

  it("deterministically compacts ledger to max event count when configured", () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "explain-md-ui-ledger-prune-"));
    const ledgerPath = path.join(tempDir, "ui-interactions.ndjson");
    process.env.EXPLAIN_MD_UI_INTERACTION_LEDGER_PATH = ledgerPath;
    process.env.EXPLAIN_MD_UI_INTERACTION_LEDGER_MAX_EVENTS = "2";
    clearUiInteractionObservabilityMetricsForTests({ clearRetention: true });

    recordUiInteractionEvent({
      proofId: "seed-verity",
      interaction: "tree_keyboard",
      source: "keyboard",
      durationMs: 2,
    });
    const second = recordUiInteractionEvent({
      proofId: "seed-verity",
      interaction: "tree_expand_toggle",
      source: "mouse",
      durationMs: 3,
    });
    const third = recordUiInteractionEvent({
      proofId: "seed-verity",
      interaction: "profile_apply",
      source: "programmatic",
      durationMs: 4,
    });

    const snapshot = exportUiInteractionObservabilityLedger({
      generatedAt: "2026-02-27T00:00:00.000Z",
    });

    expect(snapshot.persistedEventCount).toBe(2);
    expect(snapshot.rollingWindowRequestCount).toBe(3);
    expect(snapshot.latestRequestId).toBe(third.requestId);
    expect(snapshot.retention.compaction.enabled).toBe(true);
    expect(snapshot.retention.compaction.policy).toBe("max_events");
    expect(snapshot.retention.compaction.maxEvents).toBe(2);
    expect(snapshot.retention.compaction.prunedEventCount).toBe(1);
    expect(snapshot.retention.compaction.rewriteCount).toBe(1);

    const lines = readFileSync(ledgerPath, "utf8")
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as { requestId: string; sequence: number });
    expect(lines).toHaveLength(2);
    expect(lines[0]?.requestId).toBe(second.requestId);
    expect(lines[1]?.requestId).toBe(third.requestId);
    expect(lines[0]?.sequence).toBe(1);
    expect(lines[1]?.sequence).toBe(2);

    rmSync(tempDir, { recursive: true, force: true });
  });

  it("deterministically compacts ledger by TTL window when configured", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-27T00:00:00.000Z"));
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "explain-md-ui-ledger-ttl-"));
    const ledgerPath = path.join(tempDir, "ui-interactions.ndjson");
    process.env.EXPLAIN_MD_UI_INTERACTION_LEDGER_PATH = ledgerPath;
    process.env.EXPLAIN_MD_UI_INTERACTION_LEDGER_TTL_SECONDS = "60";
    clearUiInteractionObservabilityMetricsForTests({ clearRetention: true });

    recordUiInteractionEvent({
      proofId: "seed-verity",
      interaction: "tree_keyboard",
      source: "keyboard",
      durationMs: 1,
    });
    vi.setSystemTime(new Date("2026-02-27T00:01:30.000Z"));
    const fresh = recordUiInteractionEvent({
      proofId: "seed-verity",
      interaction: "tree_select_leaf",
      source: "mouse",
      durationMs: 1,
    });

    const snapshot = exportUiInteractionObservabilityLedger({
      generatedAt: "2026-02-27T00:01:30.000Z",
    });
    expect(snapshot.persistedEventCount).toBe(1);
    expect(snapshot.retention.compaction.enabled).toBe(true);
    expect(snapshot.retention.compaction.policy).toBe("ttl_seconds");
    expect(snapshot.retention.compaction.ttlSeconds).toBe(60);
    expect(snapshot.retention.compaction.prunedEventCount).toBe(1);
    expect(snapshot.retention.compaction.rewriteCount).toBe(1);

    const lines = readFileSync(ledgerPath, "utf8")
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as { requestId: string });
    expect(lines).toHaveLength(1);
    expect(lines[0]?.requestId).toBe(fresh.requestId);

    rmSync(tempDir, { recursive: true, force: true });
  });
});
