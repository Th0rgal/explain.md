import type { ExplanationConfigInput } from "../../../../../../src/config-contract";
import { jsonError, jsonSuccess, normalizeInteger, normalizeOptionalInteger, normalizeString, normalizeStringArray } from "../../../../lib/http-contract";
import { buildSeedProjection, SEED_PROOF_ID } from "../../../../lib/proof-service";

interface ProjectionBody {
  proofId?: string;
  config?: ExplanationConfigInput;
  expandedNodeIds?: unknown;
  maxChildrenPerExpandedNode?: unknown;
}

function normalizeConfigInput(input: ExplanationConfigInput | undefined): ExplanationConfigInput {
  return {
    abstractionLevel: normalizeInteger(input?.abstractionLevel, 3, 1, 5) as 1 | 2 | 3 | 4 | 5,
    complexityLevel: normalizeInteger(input?.complexityLevel, 3, 1, 5) as 1 | 2 | 3 | 4 | 5,
    maxChildrenPerParent: normalizeInteger(input?.maxChildrenPerParent, 3, 2, 12),
    audienceLevel: normalizeString(input?.audienceLevel, "intermediate") as "novice" | "intermediate" | "expert",
    language: normalizeString(input?.language, "en"),
    termIntroductionBudget: normalizeOptionalInteger(input?.termIntroductionBudget, 0, 8),
  };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ProjectionBody;
    const proofId = normalizeString(body.proofId, SEED_PROOF_ID);
    const config = normalizeConfigInput(body.config);

    const response = buildSeedProjection({
      proofId,
      config,
      expandedNodeIds: normalizeStringArray(body.expandedNodeIds),
      maxChildrenPerExpandedNode: normalizeOptionalInteger(body.maxChildrenPerExpandedNode, 1, 12),
    });

    return jsonSuccess(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonError("invalid_request", message, 400);
  }
}
