import type { ExplanationConfigInput } from "../../../../../../src/config-contract";
import { ConfigContractError, parseConfigFromBody } from "../../../../lib/config-input";
import { jsonError, jsonSuccess, normalizeString } from "../../../../lib/http-contract";
import { buildSeedDiff, SEED_PROOF_ID } from "../../../../lib/proof-service";

interface DiffBody {
  proofId?: string;
  baselineConfig?: ExplanationConfigInput;
  candidateConfig?: ExplanationConfigInput;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as DiffBody;
    const proofId = normalizeString(body.proofId, SEED_PROOF_ID);
    const response = buildSeedDiff({
      proofId,
      baselineConfig: parseConfigFromBody(body.baselineConfig),
      candidateConfig: parseConfigFromBody(body.candidateConfig),
    });

    return jsonSuccess(response);
  } catch (error) {
    if (error instanceof ConfigContractError) {
      return jsonError("invalid_config", error.message, 400, { errors: error.details });
    }

    const message = error instanceof Error ? error.message : String(error);
    return jsonError("invalid_request", message, 400);
  }
}
