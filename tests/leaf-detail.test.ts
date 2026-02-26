import { describe, expect, test } from "vitest";
import type { TheoremLeafRecord } from "../src/leaf-schema.js";
import {
  buildLeafDetailView,
  computeLeafDetailHash,
  renderLeafDetailCanonical,
  type LeafDetailView,
} from "../src/leaf-detail.js";
import type { ExplanationTree } from "../src/tree-builder.js";
import type { VerificationJob } from "../src/verification-flow.js";

describe("leaf detail", () => {
  test("builds root-to-leaf provenance details with source share reference", () => {
    const result = buildLeafDetailView(sampleTree(), sampleLeaves(), "leaf-a", {
      verificationJobs: sampleVerificationJobs(),
    });

    expect(result.ok).toBe(true);
    expect(result.view).toBeDefined();

    const view = result.view as LeafDetailView;
    expect(view.leaf.id).toBe("leaf-a");
    expect(view.provenancePath.map((node) => node.id)).toEqual(["p-root", "p-mid", "leaf-a"]);
    expect(view.shareReference.compact).toContain("Verity.Core.theoremA@");
    expect(view.shareReference.markdown).toContain("https://github.com/example/verity");
    expect(view.verification.summary.totalJobs).toBe(2);
    expect(view.verification.summary.latestStatus).toBe("success");
    expect(view.verification.jobs[0].jobHash).toHaveLength(64);
  });

  test("returns warning diagnostic when source URL is missing", () => {
    const leaves = sampleLeaves();
    leaves[0] = { ...leaves[0], sourceUrl: undefined };

    const result = buildLeafDetailView(sampleTree(), leaves, "leaf-a");

    expect(result.ok).toBe(true);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain("missing_source_url");
    expect(result.diagnostics.map((diagnostic) => diagnostic.severity)).toContain("warning");
  });

  test("returns error for unknown leaf", () => {
    const result = buildLeafDetailView(sampleTree(), sampleLeaves(), "missing-leaf");
    expect(result.ok).toBe(false);
    expect(result.view).toBeUndefined();
    expect(result.diagnostics[0]?.code).toBe("leaf_not_found");
  });

  test("produces deterministic canonical rendering and hash", () => {
    const first = buildLeafDetailView(sampleTree(), sampleLeaves(), "leaf-a", {
      verificationJobs: sampleVerificationJobs(),
    });
    const second = buildLeafDetailView(sampleTree(), sampleLeaves(), "leaf-a", {
      verificationJobs: sampleVerificationJobs().reverse(),
    });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);

    const firstView = first.view as LeafDetailView;
    const secondView = second.view as LeafDetailView;
    expect(renderLeafDetailCanonical(firstView)).toBe(renderLeafDetailCanonical(secondView));
    expect(computeLeafDetailHash(firstView)).toBe(computeLeafDetailHash(secondView));
  });
});

function sampleTree(): ExplanationTree {
  return {
    rootId: "p-root",
    leafIds: ["leaf-a", "leaf-b"],
    configHash: "cfg",
    groupPlan: [],
    groupingDiagnostics: [],
    policyDiagnosticsByParent: {},
    maxDepth: 2,
    nodes: {
      "p-root": {
        id: "p-root",
        kind: "parent",
        statement: "Root statement",
        childIds: ["p-mid", "leaf-b"],
        depth: 2,
        evidenceRefs: ["p-mid", "leaf-b"],
      },
      "p-mid": {
        id: "p-mid",
        kind: "parent",
        statement: "Intermediate statement",
        childIds: ["leaf-a"],
        depth: 1,
        evidenceRefs: ["leaf-a"],
      },
      "leaf-a": {
        id: "leaf-a",
        kind: "leaf",
        statement: "Leaf A",
        childIds: [],
        depth: 0,
        evidenceRefs: ["leaf-a"],
      },
      "leaf-b": {
        id: "leaf-b",
        kind: "leaf",
        statement: "Leaf B",
        childIds: [],
        depth: 0,
        evidenceRefs: ["leaf-b"],
      },
    },
  };
}

function sampleLeaves(): TheoremLeafRecord[] {
  return [
    {
      schemaVersion: "1.0.0",
      id: "leaf-a",
      declarationId: "leaf-a",
      modulePath: "Verity.Core",
      declarationName: "theoremA",
      theoremKind: "theorem",
      statementText: "theoremA statement",
      prettyStatement: "theoremA statement",
      sourceSpan: {
        filePath: "Verity/Core.lean",
        startLine: 10,
        startColumn: 1,
        endLine: 12,
        endColumn: 10,
      },
      tags: ["verity"],
      dependencyIds: [],
      sourceUrl: "https://github.com/example/verity/blob/main/Verity/Core.lean#L10",
    },
    {
      schemaVersion: "1.0.0",
      id: "leaf-b",
      declarationId: "leaf-b",
      modulePath: "Verity.Core",
      declarationName: "theoremB",
      theoremKind: "theorem",
      statementText: "theoremB statement",
      prettyStatement: "theoremB statement",
      sourceSpan: {
        filePath: "Verity/Core.lean",
        startLine: 20,
        startColumn: 1,
        endLine: 22,
        endColumn: 10,
      },
      tags: [],
      dependencyIds: ["leaf-a"],
    },
  ];
}

function sampleVerificationJobs(): VerificationJob[] {
  return [
    {
      schemaVersion: "1.0.0",
      jobId: "job-2",
      queueSequence: 2,
      status: "success",
      target: {
        leafId: "leaf-a",
        declarationId: "leaf-a",
        modulePath: "Verity.Core",
        declarationName: "theoremA",
        sourceSpan: {
          filePath: "Verity/Core.lean",
          startLine: 10,
          startColumn: 1,
          endLine: 12,
          endColumn: 10,
        },
        sourceUrl: "https://github.com/example/verity/blob/main/Verity/Core.lean#L10",
      },
      reproducibility: {
        sourceRevision: "abc123",
        workingDirectory: "/tmp/verity",
        command: "lake",
        args: ["env", "lean", "Verity/Core.lean"],
        env: {},
        toolchain: {
          leanVersion: "4.15.0",
          lakeVersion: "5.0.0",
        },
      },
      timeoutMs: 1000,
      createdAt: "2026-02-26T10:00:00.000Z",
      updatedAt: "2026-02-26T10:00:02.000Z",
      startedAt: "2026-02-26T10:00:01.000Z",
      finishedAt: "2026-02-26T10:00:02.000Z",
      logs: [],
      result: {
        exitCode: 0,
        signal: null,
        durationMs: 123,
        logsTruncated: false,
        logLineCount: 0,
      },
    },
    {
      schemaVersion: "1.0.0",
      jobId: "job-1",
      queueSequence: 1,
      status: "failure",
      target: {
        leafId: "leaf-a",
        declarationId: "leaf-a",
        modulePath: "Verity.Core",
        declarationName: "theoremA",
        sourceSpan: {
          filePath: "Verity/Core.lean",
          startLine: 10,
          startColumn: 1,
          endLine: 12,
          endColumn: 10,
        },
      },
      reproducibility: {
        sourceRevision: "abc123",
        workingDirectory: "/tmp/verity",
        command: "lake",
        args: ["env", "lean", "Verity/Core.lean"],
        env: {},
        toolchain: {
          leanVersion: "4.15.0",
        },
      },
      timeoutMs: 1000,
      createdAt: "2026-02-26T09:00:00.000Z",
      updatedAt: "2026-02-26T09:00:02.000Z",
      startedAt: "2026-02-26T09:00:01.000Z",
      finishedAt: "2026-02-26T09:00:02.000Z",
      logs: [],
      result: {
        exitCode: 1,
        signal: null,
        durationMs: 122,
        logsTruncated: false,
        logLineCount: 0,
      },
    },
    {
      schemaVersion: "1.0.0",
      jobId: "job-other",
      queueSequence: 3,
      status: "queued",
      target: {
        leafId: "leaf-b",
        declarationId: "leaf-b",
        modulePath: "Verity.Core",
        declarationName: "theoremB",
        sourceSpan: {
          filePath: "Verity/Core.lean",
          startLine: 20,
          startColumn: 1,
          endLine: 22,
          endColumn: 10,
        },
      },
      reproducibility: {
        sourceRevision: "abc123",
        workingDirectory: "/tmp/verity",
        command: "lake",
        args: ["env", "lean", "Verity/Core.lean"],
        env: {},
        toolchain: {
          leanVersion: "4.15.0",
        },
      },
      timeoutMs: 1000,
      createdAt: "2026-02-26T11:00:00.000Z",
      updatedAt: "2026-02-26T11:00:00.000Z",
      logs: [],
    },
  ];
}
