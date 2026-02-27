import { createHash } from "node:crypto";
import type { ExplanationConfigInput } from "./config-contract.js";
import type { TreeQualityThresholds } from "./evaluation-harness.js";

export interface QualityBenchmarkPreset {
  name: string;
  description: string;
  projectRoot: string;
  includePaths: string[];
  configOverrides: ExplanationConfigInput;
  thresholdOverrides: Partial<TreeQualityThresholds>;
}

const PRESET_DEFINITIONS: Record<string, Omit<QualityBenchmarkPreset, "name">> = {
  "fixture-verity-broad": {
    description:
      "Broader deterministic Verity fixture benchmark (core + loop + invariants + cycle pressure) for CI coverage.",
    projectRoot: "tests/fixtures/lean-broad-project",
    includePaths: ["Verity"],
    configOverrides: {},
    thresholdOverrides: {
      maxUnsupportedParentRate: 1,
      minRepartitionEventRate: 0.1,
      maxRepartitionEventRate: 0.6,
      maxRepartitionMaxRound: 1,
    },
  },
  "fixture-verity-counter-snapshot": {
    description:
      "Frozen real-Verity counter snapshot (example + AST + proofs) for CI-safe provenance-preserving benchmark coverage.",
    projectRoot: "tests/fixtures/lean-verity-counter-snapshot",
    includePaths: ["Verity"],
    configOverrides: {},
    thresholdOverrides: {},
  },
  "fixture-verity-counter-snapshot-strict": {
    description:
      "Frozen real-Verity counter snapshot with strict entailment mode enabled to gate unsupported-claim regressions.",
    projectRoot: "tests/fixtures/lean-verity-counter-snapshot",
    includePaths: ["Verity"],
    configOverrides: {
      entailmentMode: "strict",
    },
    thresholdOverrides: {
      maxUnsupportedParentRate: 1,
    },
  },
  "fixture-verity-core": {
    description: "Deterministic fixture benchmark covering the Verity mini corpus in tests/fixtures/lean-project.",
    projectRoot: "tests/fixtures/lean-project",
    includePaths: ["Verity"],
    configOverrides: {},
    thresholdOverrides: {},
  },
  "fixture-verity-loop": {
    description: "Focused deterministic fixture benchmark for loop-heavy Verity proof snippets.",
    projectRoot: "tests/fixtures/lean-project",
    includePaths: ["Verity/Loop.lean"],
    configOverrides: {},
    thresholdOverrides: {},
  },
  "fixture-verity-pressure": {
    description: "Deterministic Verity pressure benchmark that must trigger bounded repartition at least once.",
    projectRoot: "tests/fixtures/lean-pressure-project",
    includePaths: ["Verity"],
    configOverrides: {},
    thresholdOverrides: {
      maxUnsupportedParentRate: 1,
      minRepartitionEventRate: 0.3,
    },
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
  const configOverrides = sortConfigOverrides(preset.configOverrides);
  return JSON.stringify({
    name: preset.name,
    description: preset.description,
    projectRoot: preset.projectRoot,
    includePaths: preset.includePaths.slice().sort((left, right) => left.localeCompare(right)),
    ...(Object.keys(configOverrides).length > 0 ? { configOverrides } : {}),
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
    configOverrides: sortConfigOverrides(preset.configOverrides),
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

function sortConfigOverrides(overrides: ExplanationConfigInput): ExplanationConfigInput {
  return Object.fromEntries(
    Object.entries(overrides)
      .filter(([, value]) => value !== undefined)
      .sort(([left], [right]) => left.localeCompare(right)),
  ) as ExplanationConfigInput;
}
