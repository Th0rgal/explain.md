import type { ExplanationDiffEvaluationReport } from "./explanation-diff-evaluation";

export function assertExplanationDiffEvaluationBaseline(
  baseline: Partial<ExplanationDiffEvaluationReport>,
  report: ExplanationDiffEvaluationReport,
): void {
  if (typeof baseline.schemaVersion === "string" && baseline.schemaVersion !== report.schemaVersion) {
    throw new Error(
      `Explanation diff baseline schemaVersion mismatch. expected=${baseline.schemaVersion} actual=${report.schemaVersion}`,
    );
  }

  const expectedRequestHash = typeof baseline.requestHash === "string" ? baseline.requestHash : undefined;
  if (expectedRequestHash !== report.requestHash) {
    throw new Error(
      `Explanation diff baseline requestHash mismatch. expected=${expectedRequestHash ?? "missing"} actual=${report.requestHash}`,
    );
  }

  const expectedOutcomeHash = typeof baseline.outcomeHash === "string" ? baseline.outcomeHash : undefined;
  if (expectedOutcomeHash !== report.outcomeHash) {
    throw new Error(
      `Explanation diff baseline outcomeHash mismatch. expected=${expectedOutcomeHash ?? "missing"} actual=${report.outcomeHash}`,
    );
  }

  if (baseline.summary && typeof baseline.summary === "object") {
    assertSummaryField("profileCount", baseline, report);
    assertSummaryField("totalChanges", baseline, report);
    assertSummaryField("changedProfiles", baseline, report);
    assertSummaryField("truncatedProfiles", baseline, report);
    assertSummaryField("provenanceCoveredChanges", baseline, report);
    assertSummaryField("zeroSupportChangeCount", baseline, report);
    assertSummaryField("orderingPassProfiles", baseline, report);
    assertSummaryField("coverage", baseline, report);
  }

  const expectedProfileIds = Array.isArray(baseline.comparisons)
    ? baseline.comparisons.map((comparison) => comparison.profileId)
    : undefined;
  if (expectedProfileIds) {
    const actualProfileIds = report.comparisons.map((comparison) => comparison.profileId);
    if (JSON.stringify(expectedProfileIds) !== JSON.stringify(actualProfileIds)) {
      throw new Error(
        `Explanation diff baseline comparisons profileId mismatch. expected=${expectedProfileIds.join(",")} actual=${actualProfileIds.join(",")}`,
      );
    }
  }
}

function assertSummaryField(
  key: keyof ExplanationDiffEvaluationReport["summary"],
  baseline: Partial<ExplanationDiffEvaluationReport>,
  report: ExplanationDiffEvaluationReport,
): void {
  const expected = baseline.summary?.[key];
  if (expected !== undefined && JSON.stringify(expected) !== JSON.stringify(report.summary[key])) {
    throw new Error(
      `Explanation diff baseline summary.${key} mismatch. expected=${JSON.stringify(expected)} actual=${JSON.stringify(report.summary[key])}`,
    );
  }
}
