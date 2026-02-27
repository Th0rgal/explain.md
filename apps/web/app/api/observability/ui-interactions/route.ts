import { jsonError, jsonSuccess } from "../../../../lib/http-contract";
import { recordUiInteractionEvent, type UiInteractionEventInput } from "../../../../lib/ui-interaction-observability";

export const runtime = "nodejs";

const ALLOWED_INTERACTIONS = new Set<UiInteractionEventInput["interaction"]>([
  "config_update",
  "tree_expand_toggle",
  "tree_load_more",
  "tree_select_leaf",
  "tree_keyboard",
  "verification_run",
  "verification_job_select",
  "profile_save",
  "profile_delete",
  "profile_apply",
]);

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as Partial<UiInteractionEventInput>;
    if (!payload || typeof payload !== "object") {
      throw new Error("JSON body is required.");
    }
    if (typeof payload.proofId !== "string" || payload.proofId.trim().length === 0) {
      throw new Error("Field 'proofId' must be a non-empty string.");
    }
    if (typeof payload.interaction !== "string" || !ALLOWED_INTERACTIONS.has(payload.interaction as UiInteractionEventInput["interaction"])) {
      throw new Error("Field 'interaction' must be a supported interaction kind.");
    }
    if (
      payload.source !== "mouse" &&
      payload.source !== "keyboard" &&
      payload.source !== "programmatic"
    ) {
      throw new Error("Field 'source' must be one of: mouse, keyboard, programmatic.");
    }

    const receipt = recordUiInteractionEvent({
      proofId: payload.proofId,
      interaction: payload.interaction as UiInteractionEventInput["interaction"],
      source: payload.source,
      success: payload.success,
      parentTraceId: typeof payload.parentTraceId === "string" ? payload.parentTraceId : undefined,
      durationMs: typeof payload.durationMs === "number" ? payload.durationMs : undefined,
    });
    return jsonSuccess({
      schemaVersion: "1.0.0" as const,
      ...receipt,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonError("invalid_request", message, 400);
  }
}
