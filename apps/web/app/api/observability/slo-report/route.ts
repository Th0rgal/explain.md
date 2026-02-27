import { jsonError, jsonSuccess } from "../../../../lib/http-contract";
import { evaluateObservabilitySLOs, type ObservabilitySloThresholds } from "../../../../lib/observability-slo";
import { exportProofQueryObservabilityMetrics } from "../../../../lib/proof-service";
import { exportUiInteractionObservabilityMetrics } from "../../../../lib/ui-interaction-observability";
import { exportVerificationObservabilityMetrics } from "../../../../lib/verification-service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const thresholds = parseThresholds(url.searchParams);
    const report = evaluateObservabilitySLOs({
      proof: exportProofQueryObservabilityMetrics(),
      verification: exportVerificationObservabilityMetrics(),
      uiInteraction: exportUiInteractionObservabilityMetrics(),
      thresholds,
    });
    return jsonSuccess(report);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonError("invalid_request", message, 400);
  }
}

function parseThresholds(params: URLSearchParams): Partial<ObservabilitySloThresholds> {
  return {
    minProofRequestCount: parseOptionalInteger(params, "minProofRequestCount"),
    minVerificationRequestCount: parseOptionalInteger(params, "minVerificationRequestCount"),
    minProofCacheHitRate: parseOptionalNumber(params, "minProofCacheHitRate"),
    minProofUniqueTraceRate: parseOptionalNumber(params, "minProofUniqueTraceRate"),
    maxProofP95LatencyMs: parseOptionalNumber(params, "maxProofP95LatencyMs"),
    maxProofMeanLatencyMs: parseOptionalNumber(params, "maxProofMeanLatencyMs"),
    maxVerificationFailureRate: parseOptionalNumber(params, "maxVerificationFailureRate"),
    maxVerificationP95LatencyMs: parseOptionalNumber(params, "maxVerificationP95LatencyMs"),
    maxVerificationMeanLatencyMs: parseOptionalNumber(params, "maxVerificationMeanLatencyMs"),
    minVerificationParentTraceRate: parseOptionalNumber(params, "minVerificationParentTraceRate"),
    minUiInteractionRequestCount: parseOptionalInteger(params, "minUiInteractionRequestCount"),
    minUiInteractionSuccessRate: parseOptionalNumber(params, "minUiInteractionSuccessRate"),
    minUiInteractionKeyboardActionRate: parseOptionalNumber(params, "minUiInteractionKeyboardActionRate"),
    minUiInteractionParentTraceRate: parseOptionalNumber(params, "minUiInteractionParentTraceRate"),
    maxUiInteractionP95DurationMs: parseOptionalNumber(params, "maxUiInteractionP95DurationMs"),
  };
}

function parseOptionalInteger(params: URLSearchParams, key: string): number | undefined {
  const raw = params.get(key);
  if (raw === null || raw.trim().length === 0) {
    return undefined;
  }
  if (!/^-?\d+$/.test(raw)) {
    throw new Error(`Query parameter '${key}' must be an integer.`);
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Query parameter '${key}' must be an integer.`);
  }
  return parsed;
}

function parseOptionalNumber(params: URLSearchParams, key: string): number | undefined {
  const raw = params.get(key);
  if (raw === null || raw.trim().length === 0) {
    return undefined;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Query parameter '${key}' must be a finite number.`);
  }
  return parsed;
}
