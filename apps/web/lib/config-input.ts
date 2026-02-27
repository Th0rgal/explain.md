import type { ExplanationConfigInput } from "../../../src/config-contract";
import { normalizeEnum, normalizeInteger, normalizeOptionalInteger, normalizeString } from "./http-contract";

export function readConfigFromSearchParams(searchParams: URLSearchParams): ExplanationConfigInput {
  return {
    abstractionLevel: normalizeInteger(searchParams.get("abstractionLevel"), 3, 1, 5) as 1 | 2 | 3 | 4 | 5,
    complexityLevel: normalizeInteger(searchParams.get("complexityLevel"), 3, 1, 5) as 1 | 2 | 3 | 4 | 5,
    maxChildrenPerParent: normalizeInteger(searchParams.get("maxChildrenPerParent"), 3, 2, 12),
    audienceLevel: normalizeEnum(
      searchParams.get("audienceLevel"),
      "intermediate",
      ["novice", "intermediate", "expert"] as const,
      "audienceLevel",
    ),
    language: normalizeString(searchParams.get("language"), "en").toLowerCase(),
    readingLevelTarget: normalizeEnum(
      searchParams.get("readingLevelTarget"),
      "high_school",
      ["elementary", "middle_school", "high_school", "undergraduate", "graduate"] as const,
      "readingLevelTarget",
    ),
    complexityBandWidth: normalizeInteger(searchParams.get("complexityBandWidth"), 1, 0, 3),
    termIntroductionBudget: normalizeOptionalInteger(searchParams.get("termIntroductionBudget"), 0, 8),
    proofDetailMode: normalizeEnum(
      searchParams.get("proofDetailMode"),
      "balanced",
      ["minimal", "balanced", "formal"] as const,
      "proofDetailMode",
    ),
  };
}
