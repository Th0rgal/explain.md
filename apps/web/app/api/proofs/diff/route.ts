import type { ExplanationConfigInput } from "../../../../../../src/config-contract";
import { normalizeConfigInput } from "../../../../lib/config-input";
import { jsonError, jsonSuccess, normalizeString } from "../../../../lib/http-contract";
import { buildProofDiff, SEED_PROOF_ID } from "../../../../lib/proof-service";

interface DiffBody {
  proofId?: string;
  baselineConfig?: ExplanationConfigInput;
  candidateConfig?: ExplanationConfigInput;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as DiffBody;
    const proofId = normalizeString(body.proofId, SEED_PROOF_ID);
    const response = await buildProofDiff({
      proofId,
      baselineConfig: normalizeConfigInput(body.baselineConfig ?? {}),
      candidateConfig: normalizeConfigInput(body.candidateConfig ?? {}),
    });

    return jsonSuccess(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonError("invalid_request", message, 400);
  }
}
