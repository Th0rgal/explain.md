import { NextRequest } from "next/server";
import { ConfigContractError, parseConfigFromSearchParams } from "../../../../../lib/config-input";
import { jsonError, jsonSuccess, normalizeString } from "../../../../../lib/http-contract";
import { buildSeedLeafDetail, SEED_PROOF_ID } from "../../../../../lib/proof-service";

export async function GET(request: NextRequest, context: { params: { leafId: string } }) {
  try {
    const proofId = normalizeString(request.nextUrl.searchParams.get("proofId"), SEED_PROOF_ID);
    const leafId = normalizeString(context.params.leafId, "");
    const response = buildSeedLeafDetail({
      proofId,
      leafId,
      config: parseConfigFromSearchParams(request.nextUrl.searchParams),
    });

    return jsonSuccess(response, response.ok ? 200 : 404);
  } catch (error) {
    if (error instanceof ConfigContractError) {
      return jsonError("invalid_config", error.message, 400, { errors: error.details });
    }

    const message = error instanceof Error ? error.message : String(error);
    return jsonError("invalid_request", message, 400);
  }
}
