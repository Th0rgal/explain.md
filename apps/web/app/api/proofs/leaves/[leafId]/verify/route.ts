import { jsonError, jsonSuccess, normalizeString } from "../../../../../../lib/http-contract";
import { verifyLeafProof } from "../../../../../../lib/verification-service";
import { SEED_PROOF_ID } from "../../../../../../lib/proof-service";

export const runtime = "nodejs";

interface VerifyBody {
  proofId?: string;
  autoRun?: boolean;
  parentTraceId?: string;
}

export async function POST(request: Request, context: { params: { leafId: string } }) {
  try {
    const body = (await request.json()) as VerifyBody;
    const proofId = normalizeString(body.proofId, SEED_PROOF_ID);
    const leafId = normalizeString(context.params.leafId, "");

    const response = await verifyLeafProof({
      proofId,
      leafId,
      autoRun: body.autoRun !== false,
      parentTraceId: body.parentTraceId,
    });

    return jsonSuccess(response, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonError("invalid_request", message, 400);
  }
}
