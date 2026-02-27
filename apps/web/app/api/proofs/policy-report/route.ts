import { readConfigFromSearchParams } from "../../../../lib/config-input";
import { jsonError, jsonSuccess, normalizeString } from "../../../../lib/http-contract";
import { buildProofPolicyReportView, SEED_PROOF_ID } from "../../../../lib/proof-service";

interface PolicyThresholdOverrides {
  maxUnsupportedParentRate?: number;
  maxPrerequisiteViolationRate?: number;
  maxPolicyViolationRate?: number;
  maxTermJumpRate?: number;
  maxComplexitySpreadMean?: number;
  minEvidenceCoverageMean?: number;
  minVocabularyContinuityMean?: number;
  maxRepartitionEventRate?: number;
  maxRepartitionMaxRound?: number;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const proofId = normalizeString(url.searchParams.get("proofId"), SEED_PROOF_ID);

    const response = await buildProofPolicyReportView({
      proofId,
      config: readConfigFromSearchParams(url.searchParams),
      thresholds: readThresholdOverrides(url.searchParams),
    });

    return jsonSuccess(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonError("invalid_request", message, 400);
  }
}

function readThresholdOverrides(searchParams: URLSearchParams): PolicyThresholdOverrides {
  const overrides: PolicyThresholdOverrides = {};

  setOptionalRate(searchParams, "maxUnsupportedParentRate", (value) => {
    overrides.maxUnsupportedParentRate = value;
  });
  setOptionalRate(searchParams, "maxPrerequisiteViolationRate", (value) => {
    overrides.maxPrerequisiteViolationRate = value;
  });
  setOptionalRate(searchParams, "maxPolicyViolationRate", (value) => {
    overrides.maxPolicyViolationRate = value;
  });
  setOptionalRate(searchParams, "maxTermJumpRate", (value) => {
    overrides.maxTermJumpRate = value;
  });
  setOptionalRate(searchParams, "maxComplexitySpreadMean", (value) => {
    overrides.maxComplexitySpreadMean = value;
  });
  setOptionalRate(searchParams, "minEvidenceCoverageMean", (value) => {
    overrides.minEvidenceCoverageMean = value;
  });
  setOptionalRate(searchParams, "minVocabularyContinuityMean", (value) => {
    overrides.minVocabularyContinuityMean = value;
  });
  setOptionalRate(searchParams, "maxRepartitionEventRate", (value) => {
    overrides.maxRepartitionEventRate = value;
  });
  setOptionalNonNegativeInteger(searchParams, "maxRepartitionMaxRound", (value) => {
    overrides.maxRepartitionMaxRound = value;
  });

  return overrides;
}

function setOptionalRate(searchParams: URLSearchParams, key: string, assign: (value: number) => void): void {
  const raw = searchParams.get(key);
  if (raw === null || raw.trim().length === 0) {
    return;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new Error(`Expected ${key} to be a number in [0, 1], but received '${raw}'.`);
  }

  assign(parsed);
}

function setOptionalNonNegativeInteger(searchParams: URLSearchParams, key: string, assign: (value: number) => void): void {
  const raw = searchParams.get(key);
  if (raw === null || raw.trim().length === 0) {
    return;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || !Number.isInteger(parsed)) {
    throw new Error(`Expected ${key} to be a non-negative integer, but received '${raw}'.`);
  }

  assign(parsed);
}
