import { NextRequest } from "next/server";
import { jsonError, jsonSuccess, normalizeString } from "../../../../../../lib/http-contract";
import { listLeafVerificationJobs } from "../../../../../../lib/verification-service";
import { SEED_PROOF_ID } from "../../../../../../lib/proof-service";

export const runtime = "nodejs";

export async function GET(request: NextRequest, context: { params: { leafId: string } }) {
  try {
    const proofId = normalizeString(request.nextUrl.searchParams.get("proofId"), SEED_PROOF_ID);
    const parentTraceId = normalizeString(request.nextUrl.searchParams.get("parentTraceId"), "");
    const leafId = normalizeString(context.params.leafId, "");
    const response = await listLeafVerificationJobs(proofId, leafId, {
      parentTraceId: parentTraceId.length > 0 ? parentTraceId : undefined,
    });
    return jsonSuccess(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonError("invalid_request", message, 400);
  }
}
