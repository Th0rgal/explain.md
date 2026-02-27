import { createHash } from "node:crypto";
import type { TreeQualityThresholds } from "./evaluation-harness.js";

export interface QualityBenchmarkPreset {
  name: string;
  description: string;
  projectRoot: string;
  includePaths: string[];
  thresholdOverrides: Partial<TreeQualityThresholds>;
}

const PRESET_DEFINITIONS: Record<string, Omit<QualityBenchmarkPreset, "name">> = {
  "fixture-verity-core": {
    description: "Deterministic fixture benchmark covering the Verity mini corpus in tests/fixtures/lean-project.",
    projectRoot: "tests/fixtures/lean-project",
    includePaths: ["Verity"],
    thresholdOverrides: {},
  },
  "fixture-verity-loop": {
    description: "Focused deterministic fixture benchmark for loop-heavy Verity proof snippets.",
    projectRoot: "tests/fixtures/lean-project",
    includePaths: ["Verity/Loop.lean"],
    thresholdOverrides: {},
  },
};

export function listQualityBenchmarkPresets(): QualityBenchmarkPreset[] {
  return Object.entries(PRESET_DEFINITIONS)
    .map(([name, preset]) => materializePreset(name, preset))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function resolveQualityBenchmarkPreset(name: string): QualityBenchmarkPreset | undefined {
  const preset = PRESET_DEFINITIONS[name];
  if (!preset) {
    return undefined;
  }
  return materializePreset(name, preset);
}

export function renderQualityBenchmarkPresetCanonical(preset: QualityBenchmarkPreset): string {
  return JSON.stringify({
    name: preset.name,
    description: preset.description,
    projectRoot: preset.projectRoot,
    includePaths: preset.includePaths.slice().sort((left, right) => left.localeCompare(right)),
    thresholdOverrides: sortThresholdOverrides(preset.thresholdOverrides),
  });
}

export function computeQualityBenchmarkPresetHash(preset: QualityBenchmarkPreset): string {
  return createHash("sha256").update(renderQualityBenchmarkPresetCanonical(preset)).digest("hex");
}

function materializePreset(name: string, preset: Omit<QualityBenchmarkPreset, "name">): QualityBenchmarkPreset {
  return {
    name,
    description: preset.description,
    projectRoot: preset.projectRoot,
    includePaths: uniqSorted(preset.includePaths),
    thresholdOverrides: sortThresholdOverrides(preset.thresholdOverrides),
  };
}

function uniqSorted(values: readonly string[]): string[] {
  return Array.from(new Set(values)).sort((left, right) => left.localeCompare(right));
}

function sortThresholdOverrides(overrides: Partial<TreeQualityThresholds>): Partial<TreeQualityThresholds> {
  return Object.fromEntries(
    Object.entries(overrides)
      .filter(([, value]) => value !== undefined)
      .sort(([left], [right]) => left.localeCompare(right)),
  ) as Partial<TreeQualityThresholds>;
}
