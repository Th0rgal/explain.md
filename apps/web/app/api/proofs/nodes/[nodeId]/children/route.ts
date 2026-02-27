import type { ExplanationConfigInput } from "../../../../../../../../src/config-contract";
import {
  jsonError,
  jsonSuccess,
  normalizeInteger,
  normalizeOptionalInteger,
  normalizeString,
} from "../../../../../../lib/http-contract";
import { buildSeedNodeChildrenView, SEED_PROOF_ID } from "../../../../../../lib/proof-service";

function normalizeConfigInput(searchParams: URLSearchParams): ExplanationConfigInput {
  return {
    abstractionLevel: normalizeInteger(searchParams.get("abstractionLevel"), 3, 1, 5) as 1 | 2 | 3 | 4 | 5,
    complexityLevel: normalizeInteger(searchParams.get("complexityLevel"), 3, 1, 5) as 1 | 2 | 3 | 4 | 5,
    maxChildrenPerParent: normalizeInteger(searchParams.get("maxChildrenPerParent"), 3, 2, 12),
    audienceLevel: normalizeString(searchParams.get("audienceLevel"), "intermediate") as "novice" | "intermediate" | "expert",
    language: normalizeString(searchParams.get("language"), "en"),
    termIntroductionBudget: normalizeOptionalInteger(searchParams.get("termIntroductionBudget"), 0, 8),
  };
}

export async function GET(request: Request, context: { params: Promise<{ nodeId: string }> }) {
  try {
    const url = new URL(request.url);
    const params = await context.params;
    const proofId = normalizeString(url.searchParams.get("proofId"), SEED_PROOF_ID);

    const response = buildSeedNodeChildrenView({
      proofId,
      nodeId: normalizeString(params.nodeId, ""),
      config: normalizeConfigInput(url.searchParams),
      offset: normalizeOptionalInteger(url.searchParams.get("offset"), 0, 10000),
      limit: normalizeOptionalInteger(url.searchParams.get("limit"), 1, 100),
    });

    return jsonSuccess(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonError("invalid_request", message, 400);
  }
}
