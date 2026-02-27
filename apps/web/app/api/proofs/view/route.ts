import { type ExplanationConfigInput } from "../../../../../../src/config-contract";
import { ConfigContractError, parseConfigFromBody } from "../../../../lib/config-input";
import { jsonError, jsonSuccess, normalizeOptionalInteger, normalizeString, normalizeStringArray } from "../../../../lib/http-contract";
import { buildSeedProjection, SEED_PROOF_ID } from "../../../../lib/proof-service";

interface ProjectionBody {
  proofId?: string;
  config?: ExplanationConfigInput;
  expandedNodeIds?: unknown;
  maxChildrenPerExpandedNode?: unknown;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ProjectionBody;
    const proofId = normalizeString(body.proofId, SEED_PROOF_ID);
    const config = parseConfigFromBody(body.config);

    const response = buildSeedProjection({
      proofId,
      config,
      expandedNodeIds: normalizeStringArray(body.expandedNodeIds),
      maxChildrenPerExpandedNode: normalizeOptionalInteger(body.maxChildrenPerExpandedNode, 1, 12),
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
