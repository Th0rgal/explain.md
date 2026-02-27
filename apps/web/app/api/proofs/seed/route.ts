import { NextRequest } from "next/server";
import type { ExplanationConfigInput } from "../../../../../../src/config-contract";
import { readConfigFromSearchParams } from "../../../../lib/config-input";
import { jsonError, jsonSuccess } from "../../../../lib/http-contract";
import { listProofs } from "../../../../lib/proof-service";

function readConfigFromSearch(request: NextRequest): ExplanationConfigInput {
  return readConfigFromSearchParams(request.nextUrl.searchParams);
}

export async function GET(request: NextRequest) {
  try {
    const config = readConfigFromSearch(request);
    return jsonSuccess({
      proofs: await listProofs(config),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonError("invalid_request", message, 400);
  }
}
