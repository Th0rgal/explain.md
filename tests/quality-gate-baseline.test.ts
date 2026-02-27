import { describe, expect, it } from "vitest";
import {
  assertQualityGateBaseline,
  buildQualityGateBaseline,
  compareQualityGateBaseline,
  computeQualityGateBaselineOutcomeHash,
  renderQualityGateBaselineEntriesCanonical,
  type QualityGateReportInput,
} from "../src/quality-gate-baseline.js";

function makeReport(overrides: Partial<QualityGateReportInput> = {}): QualityGateReportInput {
  return {
    preset: {
      name: "fixture-verity-pressure",
      hash: "preset-hash",
    },
    qualityReportHash: "quality-hash",
    thresholdPass: true,
    leafCount: 4,
    parentCount: 3,
    repartitionMetrics: {
      eventCount: 1,
      maxRound: 0,
    },
    ...overrides,
  };
}

describe("quality-gate-baseline", () => {
  it("builds stable canonical baseline entries", () => {
    const first = buildQualityGateBaseline([makeReport()]);
    const second = buildQualityGateBaseline([
      makeReport({
        preset: {
          name: "fixture-verity-pressure",
          hash: "preset-hash",
        },
      }),
    ]);

    expect(renderQualityGateBaselineEntriesCanonical(first.entries)).toBe(renderQualityGateBaselineEntriesCanonical(second.entries));
    expect(computeQualityGateBaselineOutcomeHash(first.entries)).toBe(first.outcomeHash);
  });

  it("detects mismatches and missing presets deterministically", () => {
    const expected = buildQualityGateBaseline([
      makeReport(),
      makeReport({
        preset: { name: "fixture-verity-broad", hash: "broad-preset-hash" },
        qualityReportHash: "broad-quality-hash",
        leafCount: 13,
        parentCount: 5,
      }),
    ]);

    const actual = buildQualityGateBaseline([
      makeReport({ qualityReportHash: "different-hash" }),
    ]);

    const comparison = compareQualityGateBaseline(expected, actual);
    expect(comparison.pass).toBe(false);
    expect(comparison.failures).toEqual([
      {
        code: "field_mismatch",
        field: "qualityReportHash",
        presetName: "fixture-verity-pressure",
        expected: "quality-hash",
        actual: "different-hash",
      },
      {
        code: "missing_preset",
        presetName: "fixture-verity-broad",
      },
    ]);
  });

  it("validates baseline schema and outcome hash", () => {
    const baseline = buildQualityGateBaseline([makeReport()]);
    const parsed = assertQualityGateBaseline(JSON.parse(JSON.stringify(baseline)));
    expect(parsed).toEqual(baseline);

    expect(() =>
      assertQualityGateBaseline({
        ...baseline,
        outcomeHash: "wrong",
      }),
    ).toThrow(/outcomeHash mismatch/);
  });
});
