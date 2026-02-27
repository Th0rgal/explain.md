import { describe, expect, it } from "vitest";
import { normalizeConfigInput, readConfigFromSearchParams } from "../lib/config-input";

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

  it("normalizes full body config contract with matching semantics", () => {
    expect(
      normalizeConfigInput({
        abstractionLevel: 5,
        complexityLevel: 1,
        maxChildrenPerParent: 4,
        audienceLevel: "novice",
        language: "EN",
        readingLevelTarget: "middle_school",
        complexityBandWidth: 3,
        termIntroductionBudget: 0,
        proofDetailMode: "minimal",
      }),
    ).toEqual({
      abstractionLevel: 5,
      complexityLevel: 1,
      maxChildrenPerParent: 4,
      audienceLevel: "novice",
      language: "en",
      readingLevelTarget: "middle_school",
      complexityBandWidth: 3,
      termIntroductionBudget: 0,
      proofDetailMode: "minimal",
    });
  });

  it("rejects invalid body config enums", () => {
    expect(() =>
      normalizeConfigInput({
        audienceLevel: "advanced",
      }),
    ).toThrow("Expected audienceLevel to be one of: novice, intermediate, expert.");
  });
});
