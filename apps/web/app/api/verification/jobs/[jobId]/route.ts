import { jsonError, jsonSuccess, normalizeString } from "../../../../../lib/http-contract";
import { getVerificationJobById } from "../../../../../lib/verification-service";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: { jobId: string } }) {
  try {
    const jobId = normalizeString(context.params.jobId, "");
    const result = await getVerificationJobById(jobId);
    if (!result) {
      return jsonError("job_not_found", `Verification job '${jobId}' was not found.`, 404);
    }
    return jsonSuccess(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonError("invalid_request", message, 400);
  }
}
