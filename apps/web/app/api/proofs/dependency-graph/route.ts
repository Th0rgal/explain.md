import { readConfigFromSearchParams } from "../../../../lib/config-input";
import { jsonError, jsonSuccess, normalizeString } from "../../../../lib/http-contract";
import { buildProofDependencyGraphView, SEED_PROOF_ID } from "../../../../lib/proof-service";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const proofId = normalizeString(url.searchParams.get("proofId"), SEED_PROOF_ID);
    const declarationId = normalizeOptionalString(url.searchParams.get("declarationId"));
    const includeExternalSupport = normalizeBoolean(url.searchParams.get("includeExternalSupport"), true);

    const response = await buildProofDependencyGraphView({
      proofId,
      declarationId,
      config: readConfigFromSearchParams(url.searchParams),
      includeExternalSupport,
    });
    return jsonSuccess(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonError("invalid_request", message, 400);
  }
}

function normalizeOptionalString(input: string | null): string | undefined {
  if (input === null) {
    return undefined;
  }
  const normalized = input.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeBoolean(input: string | null, fallback: boolean): boolean {
  if (input === null || input.trim().length === 0) {
    return fallback;
  }
  const normalized = input.trim().toLowerCase();
  if (normalized === "true") {
    return true;
  }
  if (normalized === "false") {
    return false;
  }
  throw new Error(`Expected boolean query value ('true' or 'false') but received '${input}'.`);
}
