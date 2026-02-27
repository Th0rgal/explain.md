import { jsonError, jsonSuccess } from "../../../../lib/http-contract";
import { exportProofQueryObservabilityMetrics } from "../../../../lib/proof-service";

export const runtime = "nodejs";

export async function GET() {
  try {
    return jsonSuccess(exportProofQueryObservabilityMetrics());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonError("invalid_request", message, 400);
  }
}
