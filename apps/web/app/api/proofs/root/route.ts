import { readConfigFromSearchParams } from "../../../../lib/config-input";
import { jsonError, jsonSuccess, normalizeString } from "../../../../lib/http-contract";
import { buildProofRootView, SEED_PROOF_ID } from "../../../../lib/proof-service";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const proofId = normalizeString(url.searchParams.get("proofId"), SEED_PROOF_ID);
    const response = await buildProofRootView(proofId, readConfigFromSearchParams(url.searchParams));
    return jsonSuccess(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonError("invalid_request", message, 400);
  }
}
