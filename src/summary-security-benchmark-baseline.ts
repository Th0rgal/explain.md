import type { SummarySecurityBenchmarkReport } from "./summary-security-benchmark.js";

export function assertSummarySecurityBenchmarkBaseline(
  baseline: Partial<SummarySecurityBenchmarkReport>,
  report: SummarySecurityBenchmarkReport,
): void {
  if (typeof baseline.schemaVersion === "string" && baseline.schemaVersion !== report.schemaVersion) {
    throw new Error(
      `Summary security baseline schemaVersion mismatch. expected=${baseline.schemaVersion} actual=${report.schemaVersion}`,
    );
  }

  const expectedRequestHash = typeof baseline.requestHash === "string" ? baseline.requestHash : undefined;
  if (expectedRequestHash !== report.requestHash) {
    throw new Error(
      `Summary security baseline requestHash mismatch. expected=${expectedRequestHash ?? "missing"} actual=${report.requestHash}`,
    );
  }

  const expectedOutcomeHash = typeof baseline.outcomeHash === "string" ? baseline.outcomeHash : undefined;
  if (expectedOutcomeHash !== report.outcomeHash) {
    throw new Error(
      `Summary security baseline outcomeHash mismatch. expected=${expectedOutcomeHash ?? "missing"} actual=${report.outcomeHash}`,
    );
  }

  if (baseline.summary && typeof baseline.summary === "object") {
    assertSummaryField("profileCount", baseline, report);
    assertSummaryField("passCount", baseline, report);
    assertSummaryField("sanitizationProfileCount", baseline, report);
    assertSummaryField("sanitizationPassCount", baseline, report);
    assertSummaryField("rejectionProfileCount", baseline, report);
    assertSummaryField("promptInjectionRejectionCount", baseline, report);
    assertSummaryField("secretLeakRejectionCount", baseline, report);
    assertSummaryField("configuredSecretRejectionCount", baseline, report);
  }

  const expectedProfileIds = Array.isArray(baseline.profiles) ? baseline.profiles.map((profile) => profile.profileId) : undefined;
  if (expectedProfileIds) {
    const actualProfileIds = report.profiles.map((profile) => profile.profileId);
    if (JSON.stringify(expectedProfileIds) !== JSON.stringify(actualProfileIds)) {
      throw new Error(
        `Summary security baseline profileId mismatch. expected=${expectedProfileIds.join(",")} actual=${actualProfileIds.join(",")}`,
      );
    }
  }
}

function assertSummaryField(
  key: keyof SummarySecurityBenchmarkReport["summary"],
  baseline: Partial<SummarySecurityBenchmarkReport>,
  report: SummarySecurityBenchmarkReport,
): void {
  const expected = baseline.summary?.[key];
  if (expected !== undefined && JSON.stringify(expected) !== JSON.stringify(report.summary[key])) {
    throw new Error(
      `Summary security baseline summary.${key} mismatch. expected=${JSON.stringify(expected)} actual=${JSON.stringify(report.summary[key])}`,
    );
  }
}
