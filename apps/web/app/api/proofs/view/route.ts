import type { ExplanationConfigInput } from "../../../../../../src/config-contract";
import { normalizeConfigInput } from "../../../../lib/config-input";
import { jsonError, jsonSuccess, normalizeOptionalInteger, normalizeString, normalizeStringArray } from "../../../../lib/http-contract";
import { buildProofProjection, SEED_PROOF_ID } from "../../../../lib/proof-service";

interface ProjectionBody {
  proofId?: string;
  config?: ExplanationConfigInput;
  expandedNodeIds?: unknown;
  maxChildrenPerExpandedNode?: unknown;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ProjectionBody;
    const proofId = normalizeString(body.proofId, SEED_PROOF_ID);
    const config = normalizeConfigInput(body.config ?? {});

    const response = await buildProofProjection({
      proofId,
      config,
      expandedNodeIds: normalizeStringArray(body.expandedNodeIds),
      maxChildrenPerExpandedNode: normalizeOptionalInteger(body.maxChildrenPerExpandedNode, 1, 12),
    });

    return jsonSuccess(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonError("invalid_request", message, 400);
  }
}
