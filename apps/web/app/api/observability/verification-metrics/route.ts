import { jsonError, jsonSuccess } from "../../../../lib/http-contract";
import { exportVerificationObservabilityMetrics } from "../../../../lib/verification-service";

export const runtime = "nodejs";

export async function GET() {
  try {
    return jsonSuccess(exportVerificationObservabilityMetrics());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonError("invalid_request", message, 400);
  }
}
