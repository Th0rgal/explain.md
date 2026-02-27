import type { ExplanationConfigInput } from "../../../src/config-contract";
import { normalizeEnum, normalizeInteger, normalizeOptionalInteger, normalizeString } from "./http-contract";

interface RawConfigInput {
  abstractionLevel?: unknown;
  complexityLevel?: unknown;
  maxChildrenPerParent?: unknown;
  audienceLevel?: unknown;
  language?: unknown;
  readingLevelTarget?: unknown;
  complexityBandWidth?: unknown;
  termIntroductionBudget?: unknown;
  proofDetailMode?: unknown;
  entailmentMode?: unknown;
}

export function normalizeConfigInput(input: RawConfigInput = {}): ExplanationConfigInput {
  return {
    abstractionLevel: normalizeInteger(input.abstractionLevel, 3, 1, 5) as 1 | 2 | 3 | 4 | 5,
    complexityLevel: normalizeInteger(input.complexityLevel, 3, 1, 5) as 1 | 2 | 3 | 4 | 5,
    maxChildrenPerParent: normalizeInteger(input.maxChildrenPerParent, 3, 2, 12),
    audienceLevel: normalizeEnum(input.audienceLevel, "intermediate", ["novice", "intermediate", "expert"] as const, "audienceLevel"),
    language: normalizeString(input.language, "en").toLowerCase(),
    readingLevelTarget: normalizeEnum(
      input.readingLevelTarget,
      "high_school",
      ["elementary", "middle_school", "high_school", "undergraduate", "graduate"] as const,
      "readingLevelTarget",
    ),
    complexityBandWidth: normalizeInteger(input.complexityBandWidth, 1, 0, 3),
    termIntroductionBudget: normalizeOptionalInteger(input.termIntroductionBudget, 0, 8),
    proofDetailMode: normalizeEnum(input.proofDetailMode, "balanced", ["minimal", "balanced", "formal"] as const, "proofDetailMode"),
    entailmentMode: normalizeEnum(input.entailmentMode, "calibrated", ["calibrated", "strict"] as const, "entailmentMode"),
  };
}

export function readConfigFromSearchParams(searchParams: URLSearchParams): ExplanationConfigInput {
  return normalizeConfigInput({
    abstractionLevel: searchParams.get("abstractionLevel"),
    complexityLevel: searchParams.get("complexityLevel"),
    maxChildrenPerParent: searchParams.get("maxChildrenPerParent"),
    audienceLevel: searchParams.get("audienceLevel"),
    language: searchParams.get("language"),
    readingLevelTarget: searchParams.get("readingLevelTarget"),
    complexityBandWidth: searchParams.get("complexityBandWidth"),
    termIntroductionBudget: searchParams.get("termIntroductionBudget"),
    proofDetailMode: searchParams.get("proofDetailMode"),
    entailmentMode: searchParams.get("entailmentMode"),
  });
}
