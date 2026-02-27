import { jsonError, jsonSuccess } from "../../../../lib/http-contract";
import { exportUiInteractionObservabilityMetrics } from "../../../../lib/ui-interaction-observability";

export const runtime = "nodejs";

export async function GET() {
  try {
    return jsonSuccess(exportUiInteractionObservabilityMetrics());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonError("invalid_request", message, 400);
  }
}
