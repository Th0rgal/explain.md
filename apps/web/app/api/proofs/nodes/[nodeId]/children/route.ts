import { readConfigFromSearchParams } from "../../../../../../lib/config-input";
import {
  jsonError,
  jsonSuccess,
  normalizeOptionalInteger,
  normalizeString,
} from "../../../../../../lib/http-contract";
import { buildSeedNodeChildrenView, SEED_PROOF_ID } from "../../../../../../lib/proof-service";

export async function GET(request: Request, context: { params: { nodeId: string } }) {
  try {
    const url = new URL(request.url);
    const proofId = normalizeString(url.searchParams.get("proofId"), SEED_PROOF_ID);

    const response = buildSeedNodeChildrenView({
      proofId,
      nodeId: normalizeString(context.params.nodeId, ""),
      config: readConfigFromSearchParams(url.searchParams),
      offset: normalizeOptionalInteger(url.searchParams.get("offset"), 0, 10000),
      limit: normalizeOptionalInteger(url.searchParams.get("limit"), 1, 100),
    });

    return jsonSuccess(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonError("invalid_request", message, 400);
  }
}
