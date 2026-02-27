import type { MultilingualEvaluationReport } from "./multilingual-evaluation";

export function assertMultilingualEvaluationBaseline(
  baseline: Partial<MultilingualEvaluationReport>,
  report: MultilingualEvaluationReport,
): void {
  if (typeof baseline.schemaVersion === "string" && baseline.schemaVersion !== report.schemaVersion) {
    throw new Error(
      `Multilingual evaluation baseline schemaVersion mismatch. expected=${baseline.schemaVersion} actual=${report.schemaVersion}`,
    );
  }

  const expectedRequestHash = typeof baseline.requestHash === "string" ? baseline.requestHash : undefined;
  if (expectedRequestHash !== report.requestHash) {
    throw new Error(
      `Multilingual evaluation baseline requestHash mismatch. expected=${expectedRequestHash ?? "missing"} actual=${report.requestHash}`,
    );
  }

  const expectedOutcomeHash = typeof baseline.outcomeHash === "string" ? baseline.outcomeHash : undefined;
  if (expectedOutcomeHash !== report.outcomeHash) {
    throw new Error(
      `Multilingual evaluation baseline outcomeHash mismatch. expected=${expectedOutcomeHash ?? "missing"} actual=${report.outcomeHash}`,
    );
  }

  if (baseline.summary && typeof baseline.summary === "object") {
    assertSummaryField("profileCount", baseline, report);
    assertSummaryField("rootStructureStableProfiles", baseline, report);
    assertSummaryField("childrenStructureStableProfiles", baseline, report);
    assertSummaryField("pathStructureStableProfiles", baseline, report);
    assertSummaryField("localizedRootStatementProfiles", baseline, report);
    assertSummaryField("localizedChildStatementProfiles", baseline, report);
    assertSummaryField("localizedPathStatementProfiles", baseline, report);
    assertSummaryField("fallbackProfiles", baseline, report);
    assertSummaryField("localeVariantProfiles", baseline, report);
    assertSummaryField("leafProvenanceStableProfiles", baseline, report);
  }

  const expectedProfileIds = Array.isArray(baseline.comparisons)
    ? baseline.comparisons.map((comparison) => comparison.profileId)
    : undefined;

  if (expectedProfileIds) {
    const actualProfileIds = report.comparisons.map((comparison) => comparison.profileId);
    if (JSON.stringify(expectedProfileIds) !== JSON.stringify(actualProfileIds)) {
      throw new Error(
        `Multilingual evaluation baseline comparisons profileId mismatch. expected=${expectedProfileIds.join(",")} actual=${actualProfileIds.join(",")}`,
      );
    }
  }
}

function assertSummaryField(
  key: keyof MultilingualEvaluationReport["summary"],
  baseline: Partial<MultilingualEvaluationReport>,
  report: MultilingualEvaluationReport,
): void {
  const expected = baseline.summary?.[key];
  if (expected !== undefined && expected !== report.summary[key]) {
    throw new Error(
      `Multilingual evaluation baseline summary.${key} mismatch. expected=${String(expected)} actual=${String(report.summary[key])}`,
    );
  }
}
