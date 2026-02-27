import { NextRequest } from "next/server";
import { ConfigContractError, parseConfigFromSearchParams } from "../../../../lib/config-input";
import { jsonError, jsonSuccess } from "../../../../lib/http-contract";
import { listSeedProofs } from "../../../../lib/proof-service";

export async function GET(request: NextRequest) {
  try {
    const config = parseConfigFromSearchParams(request.nextUrl.searchParams);
    return jsonSuccess({
      proofs: listSeedProofs(config),
    });
  } catch (error) {
    if (error instanceof ConfigContractError) {
      return jsonError("invalid_config", error.message, 400, { errors: error.details });
    }

    const message = error instanceof Error ? error.message : String(error);
    return jsonError("invalid_request", message, 400);
  }
}
