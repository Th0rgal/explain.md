import { describe, expect, it } from "vitest";
import { readConfigFromSearchParams } from "../lib/config-input";

describe("config input", () => {
  it("normalizes shared config input from URLSearchParams", () => {
    const params = new URLSearchParams({
      abstractionLevel: "4",
      complexityLevel: "2",
      maxChildrenPerParent: "6",
      audienceLevel: "expert",
      language: "fr",
      readingLevelTarget: "graduate",
      complexityBandWidth: "2",
      termIntroductionBudget: "3",
      proofDetailMode: "formal",
    });

    expect(readConfigFromSearchParams(params)).toEqual({
      abstractionLevel: 4,
      complexityLevel: 2,
      maxChildrenPerParent: 6,
      audienceLevel: "expert",
      language: "fr",
      readingLevelTarget: "graduate",
      complexityBandWidth: 2,
      termIntroductionBudget: 3,
      proofDetailMode: "formal",
    });
  });

  it("rejects invalid enum values with deterministic errors", () => {
    const params = new URLSearchParams({
      proofDetailMode: "verbose",
    });

    expect(() => readConfigFromSearchParams(params)).toThrow("Expected proofDetailMode to be one of: minimal, balanced, formal.");
  });
});
