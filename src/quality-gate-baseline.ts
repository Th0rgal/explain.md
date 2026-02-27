import { createHash } from "node:crypto";

const QUALITY_GATE_BASELINE_SCHEMA_VERSION = "1.0.0";

export interface QualityGateReportInput {
  preset: {
    name: string;
    hash: string;
  } | null;
  qualityReportHash: string;
  thresholdPass: boolean;
  leafCount: number;
  parentCount: number;
  repartitionMetrics: {
    eventCount: number;
    maxRound: number;
  };
}

export interface QualityGateBaselineEntry {
  presetName: string;
  presetHash: string;
  qualityReportHash: string;
  thresholdPass: boolean;
  leafCount: number;
  parentCount: number;
  repartitionEventCount: number;
  repartitionMaxRound: number;
}

export interface QualityGateBaseline {
  schemaVersion: string;
  entries: QualityGateBaselineEntry[];
  outcomeHash: string;
}

export interface QualityGateBaselineFailure {
  code: "missing_preset" | "unexpected_preset" | "field_mismatch";
  presetName: string;
  field?: keyof QualityGateBaselineEntry;
  expected?: string | number | boolean;
  actual?: string | number | boolean;
}

export interface QualityGateBaselineComparison {
  pass: boolean;
  failures: QualityGateBaselineFailure[];
}

export function buildQualityGateBaseline(reports: QualityGateReportInput[]): QualityGateBaseline {
  const entries = reports.map((report) => mapReportToBaselineEntry(report));
  const deduped = dedupePresetEntries(entries);
  return {
    schemaVersion: QUALITY_GATE_BASELINE_SCHEMA_VERSION,
    entries: deduped,
    outcomeHash: computeQualityGateBaselineOutcomeHash(deduped),
  };
}

export function compareQualityGateBaseline(
  expected: QualityGateBaseline,
  actual: QualityGateBaseline,
): QualityGateBaselineComparison {
  const failures: QualityGateBaselineFailure[] = [];

  const expectedByPreset = toPresetMap(expected.entries);
  const actualByPreset = toPresetMap(actual.entries);

  for (const [presetName, expectedEntry] of expectedByPreset.entries()) {
    const actualEntry = actualByPreset.get(presetName);
    if (!actualEntry) {
      failures.push({
        code: "missing_preset",
        presetName,
      });
      continue;
    }

    for (const field of entryFields()) {
      if (expectedEntry[field] === actualEntry[field]) {
        continue;
      }
      failures.push({
        code: "field_mismatch",
        presetName,
        field,
        expected: expectedEntry[field],
        actual: actualEntry[field],
      });
    }
  }

  for (const presetName of actualByPreset.keys()) {
    if (expectedByPreset.has(presetName)) {
      continue;
    }
    failures.push({
      code: "unexpected_preset",
      presetName,
    });
  }

  return {
    pass: failures.length === 0,
    failures: sortFailures(failures),
  };
}

export function computeQualityGateBaselineOutcomeHash(entries: QualityGateBaselineEntry[]): string {
  return createHash("sha256").update(renderQualityGateBaselineEntriesCanonical(entries)).digest("hex");
}

export function renderQualityGateBaselineEntriesCanonical(entries: QualityGateBaselineEntry[]): string {
  const sortedEntries = sortEntries(entries);
  return JSON.stringify(
    sortedEntries.map((entry) => ({
      presetName: entry.presetName,
      presetHash: entry.presetHash,
      qualityReportHash: entry.qualityReportHash,
      thresholdPass: entry.thresholdPass,
      leafCount: entry.leafCount,
      parentCount: entry.parentCount,
      repartitionEventCount: entry.repartitionEventCount,
      repartitionMaxRound: entry.repartitionMaxRound,
    })),
  );
}

export function assertQualityGateBaseline(input: unknown): QualityGateBaseline {
  if (!isObject(input)) {
    throw new Error("quality gate baseline must be an object");
  }

  const schemaVersion = expectString(input.schemaVersion, "schemaVersion");
  if (schemaVersion !== QUALITY_GATE_BASELINE_SCHEMA_VERSION) {
    throw new Error(
      `quality gate baseline schemaVersion must be ${QUALITY_GATE_BASELINE_SCHEMA_VERSION}, received ${schemaVersion}`,
    );
  }

  if (!Array.isArray(input.entries)) {
    throw new Error("quality gate baseline entries must be an array");
  }

  const entries = input.entries.map((entry, index) => assertQualityGateBaselineEntry(entry, `entries[${String(index)}]`));
  const dedupedEntries = dedupePresetEntries(entries);
  const expectedOutcomeHash = expectString(input.outcomeHash, "outcomeHash");
  const actualOutcomeHash = computeQualityGateBaselineOutcomeHash(dedupedEntries);
  if (expectedOutcomeHash !== actualOutcomeHash) {
    throw new Error(`quality gate baseline outcomeHash mismatch: expected ${expectedOutcomeHash}, actual ${actualOutcomeHash}`);
  }

  return {
    schemaVersion,
    entries: dedupedEntries,
    outcomeHash: expectedOutcomeHash,
  };
}

function mapReportToBaselineEntry(report: QualityGateReportInput): QualityGateBaselineEntry {
  if (!report.preset) {
    throw new Error("quality gate report must include preset metadata");
  }
  return {
    presetName: report.preset.name,
    presetHash: report.preset.hash,
    qualityReportHash: report.qualityReportHash,
    thresholdPass: report.thresholdPass,
    leafCount: report.leafCount,
    parentCount: report.parentCount,
    repartitionEventCount: report.repartitionMetrics.eventCount,
    repartitionMaxRound: report.repartitionMetrics.maxRound,
  };
}

function assertQualityGateBaselineEntry(input: unknown, context: string): QualityGateBaselineEntry {
  if (!isObject(input)) {
    throw new Error(`${context} must be an object`);
  }

  return {
    presetName: expectString(input.presetName, `${context}.presetName`),
    presetHash: expectString(input.presetHash, `${context}.presetHash`),
    qualityReportHash: expectString(input.qualityReportHash, `${context}.qualityReportHash`),
    thresholdPass: expectBoolean(input.thresholdPass, `${context}.thresholdPass`),
    leafCount: expectFiniteNumber(input.leafCount, `${context}.leafCount`),
    parentCount: expectFiniteNumber(input.parentCount, `${context}.parentCount`),
    repartitionEventCount: expectFiniteNumber(input.repartitionEventCount, `${context}.repartitionEventCount`),
    repartitionMaxRound: expectFiniteNumber(input.repartitionMaxRound, `${context}.repartitionMaxRound`),
  };
}

function dedupePresetEntries(entries: QualityGateBaselineEntry[]): QualityGateBaselineEntry[] {
  const byPreset = new Map<string, QualityGateBaselineEntry>();
  for (const entry of sortEntries(entries)) {
    if (byPreset.has(entry.presetName)) {
      throw new Error(`duplicate quality gate baseline entry for preset '${entry.presetName}'`);
    }
    byPreset.set(entry.presetName, entry);
  }
  return [...byPreset.values()];
}

function sortEntries(entries: QualityGateBaselineEntry[]): QualityGateBaselineEntry[] {
  return entries.slice().sort((left, right) => left.presetName.localeCompare(right.presetName));
}

function sortFailures(failures: QualityGateBaselineFailure[]): QualityGateBaselineFailure[] {
  return failures
    .slice()
    .sort((left, right) =>
      `${left.code}:${left.presetName}:${left.field ?? ""}`.localeCompare(`${right.code}:${right.presetName}:${right.field ?? ""}`),
    );
}

function toPresetMap(entries: QualityGateBaselineEntry[]): Map<string, QualityGateBaselineEntry> {
  return new Map(entries.map((entry) => [entry.presetName, entry]));
}

function entryFields(): Array<keyof QualityGateBaselineEntry> {
  return [
    "presetHash",
    "qualityReportHash",
    "thresholdPass",
    "leafCount",
    "parentCount",
    "repartitionEventCount",
    "repartitionMaxRound",
  ];
}

function expectString(value: unknown, context: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${context} must be a non-empty string`);
  }
  return value;
}

function expectBoolean(value: unknown, context: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${context} must be a boolean`);
  }
  return value;
}

function expectFiniteNumber(value: unknown, context: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${context} must be a finite number`);
  }
  return value;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}
