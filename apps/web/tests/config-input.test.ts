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
      termIntroductionBudget: "3",
    });

    expect(readConfigFromSearchParams(params)).toEqual({
      abstractionLevel: 4,
      complexityLevel: 2,
      maxChildrenPerParent: 6,
      audienceLevel: "expert",
      language: "fr",
      termIntroductionBudget: 3,
    });
  });
});
