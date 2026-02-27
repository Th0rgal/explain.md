import type { TreeA11yEvaluationReport } from "./tree-a11y-evaluation";

export function assertTreeA11yEvaluationBaseline(
  baseline: Partial<TreeA11yEvaluationReport>,
  report: TreeA11yEvaluationReport,
): void {
  if (typeof baseline.schemaVersion === "string" && baseline.schemaVersion !== report.schemaVersion) {
    throw new Error(`Tree a11y baseline schemaVersion mismatch. expected=${baseline.schemaVersion} actual=${report.schemaVersion}`);
  }

  const expectedRequestHash = typeof baseline.requestHash === "string" ? baseline.requestHash : undefined;
  if (expectedRequestHash !== report.requestHash) {
    throw new Error(`Tree a11y baseline requestHash mismatch. expected=${expectedRequestHash ?? "missing"} actual=${report.requestHash}`);
  }

  const expectedOutcomeHash = typeof baseline.outcomeHash === "string" ? baseline.outcomeHash : undefined;
  if (expectedOutcomeHash !== report.outcomeHash) {
    throw new Error(`Tree a11y baseline outcomeHash mismatch. expected=${expectedOutcomeHash ?? "missing"} actual=${report.outcomeHash}`);
  }

  if (baseline.summary && typeof baseline.summary === "object") {
    assertSummaryField("totalSteps", baseline, report);
    assertSummaryField("expandActionCount", baseline, report);
    assertSummaryField("collapseActionCount", baseline, report);
    assertSummaryField("activeAnnouncementCount", baseline, report);
    assertSummaryField("virtualizedStepCount", baseline, report);
    assertSummaryField("windowedStepCount", baseline, report);
  }

  const expectedStepCount = Array.isArray(baseline.steps) ? baseline.steps.length : undefined;
  if (expectedStepCount !== undefined && expectedStepCount !== report.steps.length) {
    throw new Error(`Tree a11y baseline steps.length mismatch. expected=${expectedStepCount} actual=${report.steps.length}`);
  }
}

function assertSummaryField(
  key: keyof TreeA11yEvaluationReport["summary"],
  baseline: Partial<TreeA11yEvaluationReport>,
  report: TreeA11yEvaluationReport,
): void {
  const expected = baseline.summary?.[key];
  if (expected !== undefined && expected !== report.summary[key]) {
    throw new Error(`Tree a11y baseline summary.${key} mismatch. expected=${String(expected)} actual=${String(report.summary[key])}`);
  }
}
