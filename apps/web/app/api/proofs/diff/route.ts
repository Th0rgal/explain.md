import type { ExplanationConfigInput } from "../../../../../../src/config-contract";
import { jsonError, jsonSuccess, normalizeInteger, normalizeOptionalInteger, normalizeString } from "../../../../lib/http-contract";
import { buildProofDiff, SEED_PROOF_ID } from "../../../../lib/proof-service";

interface DiffBody {
  proofId?: string;
  baselineConfig?: ExplanationConfigInput;
  candidateConfig?: ExplanationConfigInput;
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
    const body = (await request.json()) as DiffBody;
    const proofId = normalizeString(body.proofId, SEED_PROOF_ID);
    const response = await buildProofDiff({
      proofId,
      baselineConfig: normalizeConfigInput(body.baselineConfig),
      candidateConfig: normalizeConfigInput(body.candidateConfig),
    });

    return jsonSuccess(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonError("invalid_request", message, 400);
  }
}
