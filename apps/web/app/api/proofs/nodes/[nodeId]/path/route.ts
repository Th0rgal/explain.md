import { readConfigFromSearchParams } from "../../../../../../lib/config-input";
import { jsonError, jsonSuccess, normalizeString } from "../../../../../../lib/http-contract";
import { buildSeedNodePathView, SEED_PROOF_ID } from "../../../../../../lib/proof-service";

export async function GET(request: Request, context: { params: { nodeId: string } }) {
  try {
    const url = new URL(request.url);
    const proofId = normalizeString(url.searchParams.get("proofId"), SEED_PROOF_ID);

    const response = buildSeedNodePathView({
      proofId,
      nodeId: normalizeString(context.params.nodeId, ""),
      config: readConfigFromSearchParams(url.searchParams),
    });

    return jsonSuccess(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonError("invalid_request", message, 400);
  }
}
