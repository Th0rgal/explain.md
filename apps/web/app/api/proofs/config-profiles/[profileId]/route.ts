import { deleteConfigProfile } from "../../../../../lib/config-profile-service";
import { jsonError, jsonSuccess, normalizeString } from "../../../../../lib/http-contract";

interface DeleteParams {
  params: {
    profileId: string;
  };
}

export async function DELETE(request: Request, { params }: DeleteParams) {
  try {
    const url = new URL(request.url);
    const response = await deleteConfigProfile({
      projectId: normalizeString(url.searchParams.get("projectId"), "default-project"),
      userId: normalizeString(url.searchParams.get("userId"), "anonymous"),
      profileId: normalizeString(params.profileId, ""),
    });
    return jsonSuccess(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonError("invalid_request", message, 400);
  }
}
