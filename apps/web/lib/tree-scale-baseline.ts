import type { TreeScaleEvaluationReport } from "./tree-scale-evaluation";

export function assertTreeScaleEvaluationBaseline(
  baseline: Partial<TreeScaleEvaluationReport>,
  report: TreeScaleEvaluationReport,
): void {
  if (typeof baseline.schemaVersion === "string" && baseline.schemaVersion !== report.schemaVersion) {
    throw new Error(`Tree scale baseline schemaVersion mismatch. expected=${baseline.schemaVersion} actual=${report.schemaVersion}`);
  }

  const expectedRequestHash = typeof baseline.requestHash === "string" ? baseline.requestHash : undefined;
  if (expectedRequestHash !== report.requestHash) {
    throw new Error(`Tree scale baseline requestHash mismatch. expected=${expectedRequestHash ?? "missing"} actual=${report.requestHash}`);
  }

  const expectedOutcomeHash = typeof baseline.outcomeHash === "string" ? baseline.outcomeHash : undefined;
  if (expectedOutcomeHash !== report.outcomeHash) {
    throw new Error(`Tree scale baseline outcomeHash mismatch. expected=${expectedOutcomeHash ?? "missing"} actual=${report.outcomeHash}`);
  }

  if (baseline.summary && typeof baseline.summary === "object") {
    assertSummaryField("profileCount", baseline, report);
    assertSummaryField("totalSamples", baseline, report);
    assertSummaryField("fullModeSampleCount", baseline, report);
    assertSummaryField("windowedModeSampleCount", baseline, report);
    assertSummaryField("virtualizedModeSampleCount", baseline, report);
    assertSummaryField("boundedSampleCount", baseline, report);
  }

  const expectedProfileIds = Array.isArray(baseline.profileReports)
    ? baseline.profileReports.map((profile) => profile.profileId)
    : undefined;
  if (expectedProfileIds) {
    const actualProfileIds = report.profileReports.map((profile) => profile.profileId);
    if (JSON.stringify(expectedProfileIds) !== JSON.stringify(actualProfileIds)) {
      throw new Error(
        `Tree scale baseline profileReports profileId mismatch. expected=${expectedProfileIds.join(",")} actual=${actualProfileIds.join(",")}`,
      );
    }
  }
}

function assertSummaryField(
  key: keyof TreeScaleEvaluationReport["summary"],
  baseline: Partial<TreeScaleEvaluationReport>,
  report: TreeScaleEvaluationReport,
): void {
  const expected = baseline.summary?.[key];
  if (expected !== undefined && expected !== report.summary[key]) {
    throw new Error(`Tree scale baseline summary.${key} mismatch. expected=${String(expected)} actual=${String(report.summary[key])}`);
  }
}
