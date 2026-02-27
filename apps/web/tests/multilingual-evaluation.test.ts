import { describe, expect, it } from "vitest";
import { runMultilingualEvaluation } from "../lib/multilingual-evaluation";

describe("multilingual evaluation", () => {
  it("produces deterministic request/outcome hashes and full contract coverage", async () => {
    const first = await runMultilingualEvaluation();
    const second = await runMultilingualEvaluation();

    expect(first.requestHash).toBe(second.requestHash);
    expect(first.outcomeHash).toBe(second.outcomeHash);
    expect(first.summary.profileCount).toBe(2);
    expect(first.summary.rootStructureStableProfiles).toBe(first.summary.profileCount);
    expect(first.summary.childrenStructureStableProfiles).toBe(first.summary.profileCount);
    expect(first.summary.pathStructureStableProfiles).toBe(first.summary.profileCount);
    expect(first.summary.localizedRootStatementProfiles).toBe(first.summary.profileCount);
    expect(first.summary.localizedChildStatementProfiles).toBe(first.summary.profileCount);
    expect(first.summary.localizedPathStatementProfiles).toBe(first.summary.profileCount);
    expect(first.summary.fallbackProfiles).toBe(first.summary.profileCount);
    expect(first.summary.localeVariantProfiles).toBe(first.summary.profileCount);
    expect(first.summary.leafProvenanceStableProfiles).toBe(first.summary.profileCount);
    expect(first.comparisons.map((comparison) => comparison.profileId)).toEqual([
      "seed-verity",
      "lean-verity-fixture",
    ]);
  });
});
