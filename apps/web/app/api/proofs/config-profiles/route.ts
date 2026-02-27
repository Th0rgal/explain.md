import type { ExplanationConfigInput } from "../../../../../../src/config-contract";
import { normalizeConfigInput } from "../../../../lib/config-input";
import { jsonError, jsonSuccess, normalizeString } from "../../../../lib/http-contract";
import { listConfigProfiles, upsertConfigProfile } from "../../../../lib/config-profile-service";

interface UpsertConfigProfileBody {
  projectId?: string;
  userId?: string;
  profileId?: string;
  name?: string;
  config?: ExplanationConfigInput;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const response = await listConfigProfiles({
      projectId: normalizeString(url.searchParams.get("projectId"), "default-project"),
      userId: normalizeString(url.searchParams.get("userId"), "anonymous"),
    });
    return jsonSuccess(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonError("invalid_request", message, 400);
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as UpsertConfigProfileBody;
    const response = await upsertConfigProfile({
      projectId: normalizeString(body.projectId, "default-project"),
      userId: normalizeString(body.userId, "anonymous"),
      profileId: normalizeString(body.profileId, "default"),
      name: normalizeString(body.name, "Default profile"),
      config: normalizeConfigInput(body.config ?? {}),
    });
    return jsonSuccess(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonError("invalid_request", message, 400);
  }
}
