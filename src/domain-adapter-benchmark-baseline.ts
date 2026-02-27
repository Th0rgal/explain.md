import type { DomainAdapterBenchmarkReport } from "./domain-adapter-benchmark.js";

export function assertDomainAdapterBenchmarkBaseline(
  baseline: Partial<DomainAdapterBenchmarkReport>,
  report: DomainAdapterBenchmarkReport,
): void {
  if (typeof baseline.schemaVersion === "string" && baseline.schemaVersion !== report.schemaVersion) {
    throw new Error(
      `Domain adapter baseline schemaVersion mismatch. expected=${baseline.schemaVersion} actual=${report.schemaVersion}`,
    );
  }

  const expectedRequestHash = typeof baseline.requestHash === "string" ? baseline.requestHash : undefined;
  if (expectedRequestHash !== report.requestHash) {
    throw new Error(
      `Domain adapter baseline requestHash mismatch. expected=${expectedRequestHash ?? "missing"} actual=${report.requestHash}`,
    );
  }

  const expectedOutcomeHash = typeof baseline.outcomeHash === "string" ? baseline.outcomeHash : undefined;
  if (expectedOutcomeHash !== report.outcomeHash) {
    throw new Error(
      `Domain adapter baseline outcomeHash mismatch. expected=${expectedOutcomeHash ?? "missing"} actual=${report.outcomeHash}`,
    );
  }

  if (baseline.summary && typeof baseline.summary === "object") {
    assertSummaryField("profileCount", baseline, report);
    assertSummaryField("passCount", baseline, report);
    assertSummaryField("downgradedProfileCount", baseline, report);
    assertSummaryField("manualOverrideProfileCount", baseline, report);
    assertSummaryField("macroPrecision", baseline, report);
    assertSummaryField("macroRecall", baseline, report);
    assertSummaryField("macroF1", baseline, report);
    assertSummaryField("taggingReportHash", baseline, report);
  }

  const expectedProfileIds = Array.isArray(baseline.profiles) ? baseline.profiles.map((profile) => profile.profileId) : undefined;
  if (expectedProfileIds) {
    const actualProfileIds = report.profiles.map((profile) => profile.profileId);
    if (JSON.stringify(expectedProfileIds) !== JSON.stringify(actualProfileIds)) {
      throw new Error(
        `Domain adapter baseline profileId mismatch. expected=${expectedProfileIds.join(",")} actual=${actualProfileIds.join(",")}`,
      );
    }
  }
}

function assertSummaryField(
  key: keyof DomainAdapterBenchmarkReport["summary"],
  baseline: Partial<DomainAdapterBenchmarkReport>,
  report: DomainAdapterBenchmarkReport,
): void {
  const expected = baseline.summary?.[key];
  if (expected !== undefined && JSON.stringify(expected) !== JSON.stringify(report.summary[key])) {
    throw new Error(
      `Domain adapter baseline summary.${key} mismatch. expected=${JSON.stringify(expected)} actual=${JSON.stringify(report.summary[key])}`,
    );
  }
}
