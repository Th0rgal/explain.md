import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";

const UI_INTERACTION_SAMPLE_WINDOW = 1024;
const UI_INTERACTION_LEDGER_SCHEMA_VERSION = "1.0.0";
const DEFAULT_UI_INTERACTION_LEDGER_PATH = path.resolve(process.cwd(), ".explain-md", "web-ui-interaction-ledger.ndjson");

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

interface UiInteractionLedgerEntry extends UiInteractionEventRecord {
  schemaVersion: "1.0.0";
  sequence: number;
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

export interface UiInteractionObservabilityLedgerSnapshot {
  schemaVersion: "1.0.0";
  sampleWindowSize: number;
  rollingWindowRequestCount: number;
  persistedEventCount: number;
  droppedFromRollingWindowCount: number;
  appendFailureCount: number;
  latestRequestId?: string;
  retention: {
    enabled: boolean;
    mode: "disabled" | "ndjson";
    pathHash?: string;
  };
  generatedAt: string;
  snapshotHash: string;
}

const uiInteractionEvents: UiInteractionEventRecord[] = [];
const uiInteractionLedgerState: {
  initialized: boolean;
  path: string | undefined;
  nextSequence: number;
  persistedEventCount: number;
  appendFailureCount: number;
  latestRequestId?: string;
} = {
  initialized: false,
  path: undefined,
  nextSequence: 0,
  persistedEventCount: 0,
  appendFailureCount: 0,
};

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
  persistUiInteractionLedgerEvent(event);

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

export function exportUiInteractionObservabilityLedger(
  options: { generatedAt?: string } = {},
): UiInteractionObservabilityLedgerSnapshot {
  ensureLedgerStateInitialized();
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const droppedFromRollingWindowCount = Math.max(0, uiInteractionLedgerState.persistedEventCount - uiInteractionEvents.length);

  const snapshotWithoutHash = {
    schemaVersion: UI_INTERACTION_LEDGER_SCHEMA_VERSION,
    sampleWindowSize: UI_INTERACTION_SAMPLE_WINDOW,
    rollingWindowRequestCount: uiInteractionEvents.length,
    persistedEventCount: uiInteractionLedgerState.persistedEventCount,
    droppedFromRollingWindowCount,
    appendFailureCount: uiInteractionLedgerState.appendFailureCount,
    latestRequestId: uiInteractionLedgerState.latestRequestId,
    retention: {
      enabled: Boolean(uiInteractionLedgerState.path),
      mode: uiInteractionLedgerState.path ? "ndjson" : "disabled",
      pathHash: uiInteractionLedgerState.path ? computeHash(uiInteractionLedgerState.path) : undefined,
    },
    generatedAt,
  } as const;

  return {
    ...snapshotWithoutHash,
    snapshotHash: computeHash(snapshotWithoutHash),
  };
}

export function clearUiInteractionObservabilityMetricsForTests(options: { clearRetention?: boolean } = {}): void {
  uiInteractionEvents.length = 0;
  ensureLedgerStateInitialized();
  if (options.clearRetention && uiInteractionLedgerState.path) {
    rmSync(uiInteractionLedgerState.path, { force: true });
  }
  resetLedgerState();
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

function persistUiInteractionLedgerEvent(event: UiInteractionEventRecord): void {
  ensureLedgerStateInitialized();
  if (!uiInteractionLedgerState.path) {
    return;
  }
  const ledgerEntry: UiInteractionLedgerEntry = {
    schemaVersion: UI_INTERACTION_LEDGER_SCHEMA_VERSION,
    sequence: uiInteractionLedgerState.nextSequence,
    ...event,
  };
  try {
    mkdirSync(path.dirname(uiInteractionLedgerState.path), { recursive: true });
    appendFileSync(uiInteractionLedgerState.path, `${JSON.stringify(ledgerEntry)}\n`, "utf8");
    uiInteractionLedgerState.nextSequence += 1;
    uiInteractionLedgerState.persistedEventCount += 1;
    uiInteractionLedgerState.latestRequestId = event.requestId;
  } catch {
    uiInteractionLedgerState.appendFailureCount += 1;
  }
}

function ensureLedgerStateInitialized(): void {
  const resolvedPath = resolveLedgerPath();
  if (uiInteractionLedgerState.initialized && resolvedPath === uiInteractionLedgerState.path) {
    return;
  }

  uiInteractionLedgerState.initialized = true;
  uiInteractionLedgerState.path = resolvedPath;
  uiInteractionLedgerState.nextSequence = 0;
  uiInteractionLedgerState.persistedEventCount = 0;
  uiInteractionLedgerState.latestRequestId = undefined;

  if (!resolvedPath || !existsSync(resolvedPath)) {
    return;
  }

  const raw = readFileSync(resolvedPath, "utf8");
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as Partial<UiInteractionLedgerEntry>;
      if (typeof parsed.sequence !== "number" || !Number.isFinite(parsed.sequence) || parsed.sequence < 0) {
        continue;
      }
      if (typeof parsed.requestId !== "string" || parsed.requestId.length === 0) {
        continue;
      }
      uiInteractionLedgerState.persistedEventCount += 1;
      uiInteractionLedgerState.nextSequence = Math.max(uiInteractionLedgerState.nextSequence, Math.floor(parsed.sequence) + 1);
      uiInteractionLedgerState.latestRequestId = parsed.requestId;
    } catch {
      uiInteractionLedgerState.appendFailureCount += 1;
    }
  }
}

function resetLedgerState(): void {
  uiInteractionLedgerState.initialized = false;
  uiInteractionLedgerState.path = undefined;
  uiInteractionLedgerState.nextSequence = 0;
  uiInteractionLedgerState.persistedEventCount = 0;
  uiInteractionLedgerState.appendFailureCount = 0;
  uiInteractionLedgerState.latestRequestId = undefined;
}

function resolveLedgerPath(): string | undefined {
  const envPath = process.env.EXPLAIN_MD_UI_INTERACTION_LEDGER_PATH;
  if (typeof envPath === "string" && envPath.trim().length > 0) {
    return path.resolve(envPath.trim());
  }
  if (process.env.NODE_ENV === "test") {
    return undefined;
  }
  return DEFAULT_UI_INTERACTION_LEDGER_PATH;
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
