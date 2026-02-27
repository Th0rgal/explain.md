import { NextRequest } from "next/server";
import type { ExplanationConfigInput } from "../../../../../../../src/config-contract";
import { jsonError, jsonSuccess, normalizeInteger, normalizeOptionalInteger, normalizeString } from "../../../../../lib/http-contract";
import { buildSeedLeafDetail, SEED_PROOF_ID } from "../../../../../lib/proof-service";

function readConfigFromSearch(request: NextRequest): ExplanationConfigInput {
  const search = request.nextUrl.searchParams;
  return {
    abstractionLevel: normalizeInteger(search.get("abstractionLevel"), 3, 1, 5) as 1 | 2 | 3 | 4 | 5,
    complexityLevel: normalizeInteger(search.get("complexityLevel"), 3, 1, 5) as 1 | 2 | 3 | 4 | 5,
    maxChildrenPerParent: normalizeInteger(search.get("maxChildrenPerParent"), 3, 2, 12),
    audienceLevel: normalizeString(search.get("audienceLevel"), "intermediate") as "novice" | "intermediate" | "expert",
    language: normalizeString(search.get("language"), "en"),
    termIntroductionBudget: normalizeOptionalInteger(search.get("termIntroductionBudget"), 0, 8),
  };
}

export async function GET(request: NextRequest, context: { params: { leafId: string } }) {
  try {
    const proofId = normalizeString(request.nextUrl.searchParams.get("proofId"), SEED_PROOF_ID);
    const leafId = normalizeString(context.params.leafId, "");
    const response = buildSeedLeafDetail({
      proofId,
      leafId,
      config: readConfigFromSearch(request),
    });

    return jsonSuccess(response, response.ok ? 200 : 404);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonError("invalid_request", message, 400);
  }
}
