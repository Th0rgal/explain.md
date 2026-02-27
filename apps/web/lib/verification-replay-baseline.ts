import type { VerificationReplayEvaluationReport } from "./verification-replay-evaluation";

export function assertVerificationReplayEvaluationBaseline(
  baseline: Partial<VerificationReplayEvaluationReport>,
  report: VerificationReplayEvaluationReport,
): void {
  if (typeof baseline.schemaVersion === "string" && baseline.schemaVersion !== report.schemaVersion) {
    throw new Error(
      `Verification replay baseline schemaVersion mismatch. expected=${baseline.schemaVersion} actual=${report.schemaVersion}`,
    );
  }

  const expectedRequestHash = typeof baseline.requestHash === "string" ? baseline.requestHash : undefined;
  if (expectedRequestHash !== report.requestHash) {
    throw new Error(
      `Verification replay baseline requestHash mismatch. expected=${expectedRequestHash ?? "missing"} actual=${report.requestHash}`,
    );
  }

  const expectedOutcomeHash = typeof baseline.outcomeHash === "string" ? baseline.outcomeHash : undefined;
  if (expectedOutcomeHash !== report.outcomeHash) {
    throw new Error(
      `Verification replay baseline outcomeHash mismatch. expected=${expectedOutcomeHash ?? "missing"} actual=${report.outcomeHash}`,
    );
  }

  if (baseline.summary && typeof baseline.summary === "object") {
    assertSummaryField("exportFilename", baseline, report);
    assertSummaryField("requestHash", baseline, report);
    assertSummaryField("jobHash", baseline, report);
    assertSummaryField("reproducibilityHash", baseline, report);
    assertSummaryField("replayCommand", baseline, report);
    assertSummaryField("treeConfigHash", baseline, report);
    assertSummaryField("treeSnapshotHash", baseline, report);
    assertSummaryField("leafDetailRequestHash", baseline, report);
    assertSummaryField("leafDetailConfigHash", baseline, report);
    assertSummaryField("leafDetailHash", baseline, report);
    assertSummaryField("nodePathRequestHash", baseline, report);
    assertSummaryField("nodePathSnapshotHash", baseline, report);
    assertSummaryField("envKeyCount", baseline, report);
    assertSummaryField("logLineCount", baseline, report);
    assertSummaryField("jsonLineCount", baseline, report);
  }
}

function assertSummaryField(
  key: keyof VerificationReplayEvaluationReport["summary"],
  baseline: Partial<VerificationReplayEvaluationReport>,
  report: VerificationReplayEvaluationReport,
): void {
  const expected = baseline.summary?.[key];
  if (expected !== undefined && expected !== report.summary[key]) {
    throw new Error(
      `Verification replay baseline summary.${key} mismatch. expected=${String(expected)} actual=${String(report.summary[key])}`,
    );
  }
}
