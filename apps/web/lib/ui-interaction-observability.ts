import { createHash } from "node:crypto";

const UI_INTERACTION_SAMPLE_WINDOW = 1024;

export type UiInteractionKind =
  | "config_update"
  | "tree_expand_toggle"
  | "tree_load_more"
  | "tree_select_leaf"
  | "tree_keyboard"
  | "verification_run"
  | "verification_job_select"
  | "profile_save"
  | "profile_delete"
  | "profile_apply";

export interface UiInteractionEventInput {
  proofId: string;
  interaction: UiInteractionKind;
  source: "mouse" | "keyboard" | "programmatic";
  success?: boolean;
  parentTraceId?: string;
  durationMs?: number;
}

interface UiInteractionEventRecord {
  requestId: string;
  traceId: string;
  proofId: string;
  interaction: UiInteractionKind;
  source: UiInteractionEventInput["source"];
  success: boolean;
  parentTraceProvided: boolean;
  durationMs: number;
}

export interface UiInteractionEventReceipt {
  requestId: string;
  traceId: string;
}

export interface UiInteractionObservabilityMetricsSnapshot {
  schemaVersion: "1.0.0";
  requestCount: number;
  successCount: number;
  failureCount: number;
  uniqueTraceCount: number;
  correlation: {
    parentTraceProvidedCount: number;
    parentTraceProvidedRate: number;
  };
  interactions: Array<{
    interaction: UiInteractionKind;
    requestCount: number;
    successRate: number;
    meanDurationMs: number;
    p95DurationMs: number;
  }>;
  generatedAt: string;
  snapshotHash: string;
}

const uiInteractionEvents: UiInteractionEventRecord[] = [];

export function recordUiInteractionEvent(input: UiInteractionEventInput): UiInteractionEventReceipt {
  const proofId = normalizeRequired(input.proofId, "proofId");
  const interaction = input.interaction;
  const source = input.source;
  const success = input.success !== false;
  const parentTraceId = normalizeOptional(input.parentTraceId);
  const durationMs = clampNonNegative(input.durationMs ?? 0);

  const requestId = computeHash({
    proofId,
    interaction,
    source,
    success,
    parentTraceId: parentTraceId ?? "",
    durationMs,
    sequence: uiInteractionEvents.length,
  });
  const traceId = computeHash({
    proofId,
    interaction,
    source,
    parentTraceId: parentTraceId ?? "",
  });

  const event: UiInteractionEventRecord = {
    requestId,
    traceId,
    proofId,
    interaction,
    source,
    success,
    parentTraceProvided: Boolean(parentTraceId),
    durationMs,
  };
  uiInteractionEvents.push(event);
  if (uiInteractionEvents.length > UI_INTERACTION_SAMPLE_WINDOW) {
    uiInteractionEvents.splice(0, uiInteractionEvents.length - UI_INTERACTION_SAMPLE_WINDOW);
  }

  return { requestId, traceId };
}

export function exportUiInteractionObservabilityMetrics(
  options: { generatedAt?: string } = {},
): UiInteractionObservabilityMetricsSnapshot {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const requestCount = uiInteractionEvents.length;
  const successCount = uiInteractionEvents.filter((event) => event.success).length;
  const failureCount = requestCount - successCount;
  const uniqueTraceCount = new Set(uiInteractionEvents.map((event) => event.traceId)).size;
  const parentTraceProvidedCount = uiInteractionEvents.filter((event) => event.parentTraceProvided).length;
  const interactionOrder: UiInteractionKind[] = [
    "config_update",
    "tree_expand_toggle",
    "tree_load_more",
    "tree_select_leaf",
    "tree_keyboard",
    "verification_run",
    "verification_job_select",
    "profile_save",
    "profile_delete",
    "profile_apply",
  ];
  const interactions = interactionOrder.map((interaction) => {
    const events = uiInteractionEvents.filter((event) => event.interaction === interaction);
    const count = events.length;
    const successForInteraction = events.filter((event) => event.success).length;
    return {
      interaction,
      requestCount: count,
      successRate: count === 0 ? 0 : successForInteraction / count,
      meanDurationMs: count === 0 ? 0 : sum(events.map((event) => event.durationMs)) / count,
      p95DurationMs: percentile95(events.map((event) => event.durationMs)),
    };
  });

  const snapshotWithoutHash = {
    schemaVersion: "1.0.0" as const,
    requestCount,
    successCount,
    failureCount,
    uniqueTraceCount,
    correlation: {
      parentTraceProvidedCount,
      parentTraceProvidedRate: requestCount === 0 ? 0 : parentTraceProvidedCount / requestCount,
    },
    interactions,
    generatedAt,
  };

  return {
    ...snapshotWithoutHash,
    snapshotHash: computeHash(snapshotWithoutHash),
  };
}

export function clearUiInteractionObservabilityMetricsForTests(): void {
  uiInteractionEvents.length = 0;
}

function normalizeRequired(value: string, key: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(`'${key}' must be non-empty.`);
  }
  return normalized;
}

function normalizeOptional(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function clampNonNegative(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, value);
}

function percentile95(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.ceil(sorted.length * 0.95) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, index))] ?? 0;
}

function sum(values: number[]): number {
  return values.reduce((accumulator, value) => accumulator + value, 0);
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
