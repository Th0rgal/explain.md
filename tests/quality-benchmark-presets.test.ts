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

    expect(names).toEqual(["fixture-verity-broad", "fixture-verity-core", "fixture-verity-loop", "fixture-verity-pressure"]);
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
    expect(resolveQualityBenchmarkPreset("unknown-preset")).toBeUndefined();
  });

  it("computes stable hash independent of include path ordering", () => {
    const preset = resolveQualityBenchmarkPreset("fixture-verity-loop");
    expect(preset).toBeDefined();

    const shuffled = cloneWithShuffledIncludes(preset as QualityBenchmarkPreset);
    expect(renderQualityBenchmarkPresetCanonical(preset as QualityBenchmarkPreset)).toBe(
      renderQualityBenchmarkPresetCanonical(shuffled),
    );
    expect(computeQualityBenchmarkPresetHash(preset as QualityBenchmarkPreset)).toBe(
      computeQualityBenchmarkPresetHash(shuffled),
    );
  });
});
