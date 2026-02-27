import { NextRequest } from "next/server";
import type { ExplanationConfigInput } from "../../../../../../src/config-contract";
import { jsonError, jsonSuccess, normalizeEnum, normalizeInteger, normalizeOptionalInteger, normalizeString } from "../../../../lib/http-contract";
import { listProofs } from "../../../../lib/proof-service";

function readConfigFromSearch(request: NextRequest): ExplanationConfigInput {
  const search = request.nextUrl.searchParams;
  return {
    abstractionLevel: normalizeInteger(search.get("abstractionLevel"), 3, 1, 5) as 1 | 2 | 3 | 4 | 5,
    complexityLevel: normalizeInteger(search.get("complexityLevel"), 3, 1, 5) as 1 | 2 | 3 | 4 | 5,
    maxChildrenPerParent: normalizeInteger(search.get("maxChildrenPerParent"), 3, 2, 12),
    audienceLevel: normalizeString(search.get("audienceLevel"), "intermediate") as "novice" | "intermediate" | "expert",
    language: normalizeString(search.get("language"), "en"),
    termIntroductionBudget: normalizeOptionalInteger(search.get("termIntroductionBudget"), 0, 8),
    entailmentMode: normalizeEnum(search.get("entailmentMode"), "calibrated", ["calibrated", "strict"] as const, "entailmentMode"),
  };
}

export async function GET(request: NextRequest) {
  try {
    const config = readConfigFromSearch(request);
    return jsonSuccess({
      proofs: await listProofs(config),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonError("invalid_request", message, 400);
  }
}
