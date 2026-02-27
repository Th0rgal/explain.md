import { describe, expect, it } from "vitest";
import {
  computeQualityBenchmarkPresetHash,
  listQualityBenchmarkPresets,
  renderQualityBenchmarkPresetCanonical,
  resolveQualityBenchmarkPreset,
  type QualityBenchmarkPreset,
} from "../src/quality-benchmark-presets.js";

function cloneWithShuffledIncludes(preset: QualityBenchmarkPreset): QualityBenchmarkPreset {
  return {
    ...preset,
    includePaths: preset.includePaths.slice().reverse(),
  };
}

describe("quality-benchmark-presets", () => {
  it("lists deterministic, sorted preset definitions", () => {
    const presets = listQualityBenchmarkPresets();
    const names = presets.map((preset) => preset.name);

    expect(names).toEqual([
      "fixture-verity-broad",
      "fixture-verity-core",
      "fixture-verity-counter-snapshot",
      "fixture-verity-counter-snapshot-strict",
      "fixture-verity-loop",
      "fixture-verity-pressure",
      "fixture-verity-token-snapshot",
      "fixture-verity-token-snapshot-strict",
    ]);
    expect(presets[0].includePaths).toEqual(["Verity"]);
  });

  it("resolves known presets and rejects unknown names", () => {
    expect(resolveQualityBenchmarkPreset("fixture-verity-core")?.projectRoot).toBe("tests/fixtures/lean-project");
    expect(resolveQualityBenchmarkPreset("fixture-verity-pressure")).toMatchObject({
      projectRoot: "tests/fixtures/lean-pressure-project",
      thresholdOverrides: {
        maxUnsupportedParentRate: 1,
        minRepartitionEventRate: 0.3,
      },
    });
    expect(resolveQualityBenchmarkPreset("fixture-verity-broad")).toMatchObject({
      projectRoot: "tests/fixtures/lean-broad-project",
      thresholdOverrides: {
        maxUnsupportedParentRate: 1,
        minRepartitionEventRate: 0.1,
        maxRepartitionEventRate: 0.6,
        maxRepartitionMaxRound: 1,
      },
    });
    expect(resolveQualityBenchmarkPreset("fixture-verity-counter-snapshot")).toMatchObject({
      projectRoot: "tests/fixtures/lean-verity-counter-snapshot",
      includePaths: ["Verity"],
      configOverrides: {},
      thresholdOverrides: {},
    });
    expect(resolveQualityBenchmarkPreset("fixture-verity-counter-snapshot-strict")).toMatchObject({
      projectRoot: "tests/fixtures/lean-verity-counter-snapshot",
      includePaths: ["Verity"],
      configOverrides: {
        entailmentMode: "strict",
      },
      thresholdOverrides: {
        maxUnsupportedParentRate: 1,
      },
    });
    expect(resolveQualityBenchmarkPreset("fixture-verity-token-snapshot")).toMatchObject({
      projectRoot: "tests/fixtures/lean-verity-token-snapshot",
      includePaths: ["Verity"],
      configOverrides: {},
      thresholdOverrides: {},
    });
    expect(resolveQualityBenchmarkPreset("fixture-verity-token-snapshot-strict")).toMatchObject({
      projectRoot: "tests/fixtures/lean-verity-token-snapshot",
      includePaths: ["Verity"],
      configOverrides: {
        entailmentMode: "strict",
      },
      thresholdOverrides: {
        maxUnsupportedParentRate: 1,
      },
    });
    expect(resolveQualityBenchmarkPreset("unknown-preset")).toBeUndefined();
  });

  it("computes stable hash independent of include path ordering", () => {
    const preset: QualityBenchmarkPreset = {
      name: "test-multi-path",
      description: "Synthetic preset with multiple include paths for ordering test",
      projectRoot: "tests/fixtures/lean-project",
      includePaths: ["Verity/Core.lean", "Verity/Loop.lean", "Verity/Base.lean"],
      configOverrides: {},
      thresholdOverrides: {},
    };

    const shuffled = cloneWithShuffledIncludes(preset);
    expect(shuffled.includePaths).not.toEqual(preset.includePaths);
    expect(renderQualityBenchmarkPresetCanonical(preset)).toBe(
      renderQualityBenchmarkPresetCanonical(shuffled),
    );
    expect(computeQualityBenchmarkPresetHash(preset)).toBe(
      computeQualityBenchmarkPresetHash(shuffled),
    );
  });
});
