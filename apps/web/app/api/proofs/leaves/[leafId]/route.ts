import { NextRequest } from "next/server";
import { readConfigFromSearchParams } from "../../../../../lib/config-input";
import { jsonError, jsonSuccess, normalizeString } from "../../../../../lib/http-contract";
import { buildSeedLeafDetail, SEED_PROOF_ID } from "../../../../../lib/proof-service";
import { listLeafVerificationJobs } from "../../../../../lib/verification-service";

export const runtime = "nodejs";

export async function GET(request: NextRequest, context: { params: { leafId: string } }) {
  try {
    const proofId = normalizeString(request.nextUrl.searchParams.get("proofId"), SEED_PROOF_ID);
    const leafId = normalizeString(context.params.leafId, "");
    const verification = await listLeafVerificationJobs(proofId, leafId);
    const response = buildSeedLeafDetail({
      proofId,
      leafId,
      config: readConfigFromSearchParams(request.nextUrl.searchParams),
      verificationJobs: verification.jobs,
    });

    return jsonSuccess(response, response.ok ? 200 : 404);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonError("invalid_request", message, 400);
  }
}
