import type { ExplanationConfigInput } from "../../../src/config-contract";
import { normalizeInteger, normalizeOptionalInteger, normalizeString } from "./http-contract";

export function readConfigFromSearchParams(searchParams: URLSearchParams): ExplanationConfigInput {
  return {
    abstractionLevel: normalizeInteger(searchParams.get("abstractionLevel"), 3, 1, 5) as 1 | 2 | 3 | 4 | 5,
    complexityLevel: normalizeInteger(searchParams.get("complexityLevel"), 3, 1, 5) as 1 | 2 | 3 | 4 | 5,
    maxChildrenPerParent: normalizeInteger(searchParams.get("maxChildrenPerParent"), 3, 2, 12),
    audienceLevel: normalizeString(searchParams.get("audienceLevel"), "intermediate") as "novice" | "intermediate" | "expert",
    language: normalizeString(searchParams.get("language"), "en"),
    termIntroductionBudget: normalizeOptionalInteger(searchParams.get("termIntroductionBudget"), 0, 8),
  };
}
