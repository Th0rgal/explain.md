import { describe, expect, it } from "vitest";
import { ConfigContractError, parseConfigFromBody, parseConfigFromSearchParams } from "../lib/config-input";

describe("config input parser", () => {
  it("returns canonicalized partial config without injecting defaults", () => {
    const parsed = parseConfigFromBody({
      language: " EN ",
      abstractionLevel: 4,
      modelProvider: {
        provider: " OpenAI-Compatible ",
        temperature: 0.125555,
      },
    });

    expect(parsed).toEqual({
      language: "en",
      abstractionLevel: 4,
      modelProvider: {
        provider: "openai-compatible",
        temperature: 0.1256,
      },
    });
    expect(parsed.maxChildrenPerParent).toBeUndefined();
  });

  it("rejects unknown top-level fields", () => {
    expect(() => parseConfigFromBody({
      unknownField: 1,
    })).toThrowError(ConfigContractError);

    try {
      parseConfigFromBody({ unknownField: 1 });
      throw new Error("expected parse to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigContractError);
      const typed = error as ConfigContractError;
      expect(typed.details[0]?.path).toBe("config.unknownField");
    }
  });

  it("rejects cross-field contract violations", () => {
    expect(() =>
      parseConfigFromBody({
        audienceLevel: "expert",
        readingLevelTarget: "middle_school",
      }),
    ).toThrowError(ConfigContractError);
  });

  it("parses query params including modelProvider fields", () => {
    const search = new URLSearchParams({
      language: "FR",
      termIntroductionBudget: "5",
      "modelProvider.maxOutputTokens": "1500",
      "modelProvider.temperature": "0.2",
      ignoreMe: "1",
    });

    const parsed = parseConfigFromSearchParams(search);
    expect(parsed).toEqual({
      language: "fr",
      termIntroductionBudget: 5,
      modelProvider: {
        maxOutputTokens: 1500,
        temperature: 0.2,
      },
    });
  });

  it("fails with machine-checkable details for invalid numeric values", () => {
    try {
      parseConfigFromSearchParams(new URLSearchParams({ complexityBandWidth: "9" }));
      throw new Error("expected parse to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigContractError);
      const typed = error as ConfigContractError;
      expect(typed.details.map((entry) => entry.path)).toContain("complexityBandWidth");
    }
  });
});
