import { describe, expect, it } from "vitest";
import { normalizeConfig } from "../src/config-contract.js";
import {
  computeTreeQualityReportHash,
  evaluateExplanationTreeQuality,
  renderTreeQualityReportCanonical,
  type TreeQualityReport,
} from "../src/evaluation-harness.js";
import type { ExplanationTree } from "../src/tree-builder.js";

function buildFixtureTree(): ExplanationTree {
  return {
    rootId: "parent:1",
    leafIds: ["leaf:a", "leaf:b"],
    configHash: "config-hash",
    groupPlan: [
      {
        depth: 1,
        index: 0,
        inputNodeIds: ["leaf:a", "leaf:b"],
        outputNodeId: "parent:1",
        complexitySpread: 0,
      },
    ],
    groupingDiagnostics: [
      {
        depth: 1,
        orderedNodeIds: ["leaf:a", "leaf:b"],
        complexitySpreadByGroup: [0],
        warnings: [],
      },
    ],
    policyDiagnosticsByParent: {
      "parent:1": {
        depth: 1,
        groupIndex: 0,
        retriesUsed: 0,
        preSummary: {
          ok: true,
          violations: [],
          metrics: {
            complexitySpread: 0,
            prerequisiteOrderViolations: 0,
            introducedTermCount: 0,
            evidenceCoverageRatio: 1,
            vocabularyContinuityRatio: 1,
            vocabularyContinuityFloor: 0.7,
          },
        },
        postSummary: {
          ok: true,
          violations: [],
          metrics: {
            complexitySpread: 0,
            prerequisiteOrderViolations: 0,
            introducedTermCount: 0,
            evidenceCoverageRatio: 1,
            vocabularyContinuityRatio: 1,
            vocabularyContinuityFloor: 0.7,
          },
        },
      },
    },
    maxDepth: 1,
    nodes: {
      "leaf:a": {
        id: "leaf:a",
        kind: "leaf",
        statement: "loop counter increments",
        childIds: [],
        depth: 0,
        complexityScore: 2,
        evidenceRefs: ["leaf:a"],
      },
      "leaf:b": {
        id: "leaf:b",
        kind: "leaf",
        statement: "counter remains bounded",
        childIds: [],
        depth: 0,
        complexityScore: 2,
        evidenceRefs: ["leaf:b"],
      },
      "parent:1": {
        id: "parent:1",
        kind: "parent",
        statement: "loop counter increments and remains bounded",
        childIds: ["leaf:a", "leaf:b"],
        depth: 1,
        complexityScore: 2,
        abstractionScore: 2,
        confidence: 0.99,
        whyTrueFromChildren: "children imply the parent",
        newTermsIntroduced: [],
        evidenceRefs: ["leaf:a", "leaf:b"],
      },
    },
  };
}

function cloneWithTimestamp(report: TreeQualityReport, timestamp: string): TreeQualityReport {
  return {
    ...report,
    generatedAt: timestamp,
  };
}

describe("evaluation-harness", () => {
  it("produces canonical render and stable hash independent of sample ordering", () => {
    const config = normalizeConfig({ proofDetailMode: "formal", audienceLevel: "expert" });
    const report = evaluateExplanationTreeQuality(buildFixtureTree(), config);

    const shuffled: TreeQualityReport = {
      ...report,
      generatedAt: report.generatedAt,
      parentSamples: report.parentSamples.slice().reverse(),
      depthMetrics: report.depthMetrics.slice().reverse(),
      thresholdFailures: report.thresholdFailures.slice().reverse(),
    };

    expect(renderTreeQualityReportCanonical(report)).toBe(renderTreeQualityReportCanonical(shuffled));
    expect(computeTreeQualityReportHash(report)).toBe(computeTreeQualityReportHash(shuffled));
  });

  it("flags unsupported parent statements when claim tokens are not in descendants", () => {
    const tree = buildFixtureTree();
    tree.nodes["parent:1"].statement = "cryptographic signature guarantees liveness";
    tree.nodes["parent:1"].newTermsIntroduced = [];

    const config = normalizeConfig({ proofDetailMode: "formal", audienceLevel: "expert" });
    const report = evaluateExplanationTreeQuality(tree, config, {
      thresholds: {
        maxUnsupportedParentRate: 0,
      },
    });

    expect(report.metrics.unsupportedParentCount).toBe(1);
    expect(report.metrics.unsupportedParentRate).toBe(1);
    expect(report.thresholdPass).toBe(false);
    expect(report.thresholdFailures.some((failure) => failure.code === "unsupported_parent_rate")).toBe(true);
  });

  it("fails threshold gates for prerequisite and policy violations", () => {
    const tree = buildFixtureTree();
    tree.policyDiagnosticsByParent["parent:1"] = {
      ...tree.policyDiagnosticsByParent["parent:1"],
      preSummary: {
        ...tree.policyDiagnosticsByParent["parent:1"].preSummary,
        ok: false,
        violations: [{ code: "prerequisite_order", message: "ordering failure" }],
        metrics: {
          ...tree.policyDiagnosticsByParent["parent:1"].preSummary.metrics,
          prerequisiteOrderViolations: 1,
          complexitySpread: 3,
        },
      },
      postSummary: {
        ...tree.policyDiagnosticsByParent["parent:1"].postSummary,
        ok: false,
        violations: [{ code: "evidence_coverage", message: "coverage failure" }],
        metrics: {
          ...tree.policyDiagnosticsByParent["parent:1"].postSummary.metrics,
          evidenceCoverageRatio: 0.5,
          vocabularyContinuityRatio: 0.5,
        },
      },
    };

    const config = normalizeConfig({ proofDetailMode: "formal", audienceLevel: "intermediate", complexityBandWidth: 1 });
    const report = evaluateExplanationTreeQuality(tree, config);

    expect(report.metrics.prerequisiteViolationRate).toBe(1);
    expect(report.metrics.policyViolationRate).toBe(1);
    expect(report.metrics.meanComplexitySpread).toBe(3);
    expect(report.metrics.meanEvidenceCoverage).toBe(0.5);
    expect(report.thresholdPass).toBe(false);
    expect(report.thresholdFailures.map((failure) => failure.code)).toContain("prerequisite_violation_rate");
    expect(report.thresholdFailures.map((failure) => failure.code)).toContain("policy_violation_rate");
    expect(report.thresholdFailures.map((failure) => failure.code)).toContain("complexity_spread_mean");
    expect(report.thresholdFailures.map((failure) => failure.code)).toContain("evidence_coverage_mean");
  });

  it("ignores generatedAt in canonical render/hash so report identity is reproducible", () => {
    const config = normalizeConfig();
    const report = evaluateExplanationTreeQuality(buildFixtureTree(), config);

    const left = cloneWithTimestamp(report, "2026-02-26T00:00:00.000Z");
    const right = cloneWithTimestamp(report, "2026-02-27T00:00:00.000Z");

    expect(renderTreeQualityReportCanonical(left)).toBe(renderTreeQualityReportCanonical(right));
    expect(computeTreeQualityReportHash(left)).toBe(computeTreeQualityReportHash(right));
  });
});
