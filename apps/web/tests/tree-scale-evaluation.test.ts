import { describe, expect, it } from "vitest";
import { runTreeScaleEvaluation } from "../lib/tree-scale-evaluation";

describe("tree scale evaluation", () => {
  it("produces deterministic request and outcome hashes", () => {
    const first = runTreeScaleEvaluation();
    const second = runTreeScaleEvaluation();

    expect(first.requestHash).toBe(second.requestHash);
    expect(first.outcomeHash).toBe(second.outcomeHash);
    expect(first.summary.profileCount).toBe(3);
    expect(first.summary.totalSamples).toBeGreaterThan(0);
    expect(first.summary.fullModeSampleCount).toBeGreaterThan(0);
    expect(first.summary.windowedModeSampleCount).toBeGreaterThan(0);
    expect(first.summary.virtualizedModeSampleCount).toBeGreaterThan(0);
    expect(first.summary.boundedSampleCount).toBe(first.summary.totalSamples);
    expect(first.profileReports.map((profile) => profile.profileId)).toEqual([
      "full-small-tree",
      "windowed-medium-tree",
      "virtualized-large-tree",
    ]);
  });
});
