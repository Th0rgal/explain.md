import { describe, expect, it } from "vitest";
import { runExplanationDiffEvaluation } from "../lib/explanation-diff-evaluation";

describe("explanation diff evaluation", () => {
  it("produces deterministic request and outcome hashes", async () => {
    const first = await runExplanationDiffEvaluation();
    const second = await runExplanationDiffEvaluation();

    expect(first.requestHash).toBe(second.requestHash);
    expect(first.outcomeHash).toBe(second.outcomeHash);
    expect(first.summary.profileCount).toBe(3);
    expect(first.summary.changedProfiles).toBe(first.summary.profileCount);
    expect(first.summary.truncatedProfiles).toBeGreaterThan(0);
    expect(first.summary.zeroSupportChangeCount).toBe(0);
    expect(first.summary.orderingPassProfiles).toBe(first.summary.profileCount);
    expect(first.summary.coverage).toEqual({
      abstractionLevel: true,
      complexityLevel: true,
      maxChildrenPerParent: true,
      language: true,
      audienceLevel: true,
    });
    expect(first.comparisons.map((comparison) => comparison.profileId)).toEqual([
      "abstraction-shift",
      "complexity-shift",
      "language-audience-shift",
    ]);
  });
});
