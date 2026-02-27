import { jsonError, jsonSuccess } from "../../../../lib/http-contract";
import { exportUiInteractionObservabilityLedger } from "../../../../lib/ui-interaction-observability";

export const runtime = "nodejs";

export async function GET() {
  try {
    return jsonSuccess(exportUiInteractionObservabilityLedger());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonError("invalid_request", message, 400);
  }
}
