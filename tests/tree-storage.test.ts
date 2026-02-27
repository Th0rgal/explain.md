import { describe, expect, test } from "vitest";
import { normalizeConfig } from "../src/config-contract.js";
import type { TheoremLeafRecord } from "../src/leaf-schema.js";
import {
  computeTreeStorageSnapshotHash,
  createTreeQueryApi,
  exportTreeStorageSnapshot,
  importTreeStorageSnapshot,
  renderTreeStorageSnapshotCanonical,
  validateTreeStorageSnapshot,
  type TreeStorageSnapshot,
} from "../src/tree-storage.js";
import type { ExplanationTree } from "../src/tree-builder.js";

describe("tree storage", () => {
  test("exports deterministic canonical snapshot/hash independent of insertion order", () => {
    const config = normalizeConfig({
      abstractionLevel: 4,
      complexityLevel: 3,
      maxChildrenPerParent: 3,
      language: "en",
      audienceLevel: "intermediate",
      readingLevelTarget: "undergraduate",
      complexityBandWidth: 2,
      termIntroductionBudget: 2,
      proofDetailMode: "balanced",
    });

    const first = exportTreeStorageSnapshot(sampleTree(), {
      proofId: "proof-verity",
      config,
      leaves: sampleLeaves(),
    });

    const second = exportTreeStorageSnapshot(sampleTreeWithScrambledNodeInsertion(), {
      proofId: "proof-verity",
      config,
      leaves: sampleLeaves().slice().reverse(),
    });

    expect(renderTreeStorageSnapshotCanonical(first)).toBe(renderTreeStorageSnapshotCanonical(second));
    expect(computeTreeStorageSnapshotHash(first)).toBe(computeTreeStorageSnapshotHash(second));
  });

  test("query API returns root/children/ancestry and leaf provenance", () => {
    const snapshot = exportTreeStorageSnapshot(sampleTree(), {
      proofId: "proof-verity",
      config: normalizeConfig({}),
      leaves: sampleLeaves(),
    });

    const api = createTreeQueryApi(snapshot);
    const root = api.getRoot();
    expect(root.node?.id).toBe("p-root");
    expect(root.diagnostics.every((diagnostic) => diagnostic.severity !== "error")).toBe(true);

    const childrenPage = api.getChildren("p-root", { limit: 1 });
    expect(childrenPage.totalChildren).toBe(2);
    expect(childrenPage.children.map((node) => node.id)).toEqual(["p-mid"]);
    expect(childrenPage.hasMore).toBe(true);

    const path = api.getAncestryPath("leaf-a");
    expect(path.ok).toBe(true);
    expect(path.path.map((node) => node.id)).toEqual(["p-root", "p-mid", "leaf-a"]);

    const leafDetail = api.getLeafDetail("leaf-a");
    expect(leafDetail.ok).toBe(true);
    expect(leafDetail.leaf?.declarationName).toBe("theoremA");
    expect(leafDetail.provenancePath.map((node) => node.id)).toEqual(["p-root", "p-mid", "leaf-a"]);
    expect(leafDetail.provenanceRecords.length).toBeGreaterThan(0);
    expect(leafDetail.provenanceRecords.some((record) => record.nodeId === "p-mid")).toBe(true);
    expect(root.node?.policyDiagnostics?.preSummary.ok).toBe(true);
  });

  test("import reconstructs tree and emits diagnostics for invalid snapshot", () => {
    const snapshot = exportTreeStorageSnapshot(sampleTree(), {
      proofId: "proof-verity",
      config: normalizeConfig({}),
      leaves: sampleLeaves(),
    });

    const imported = importTreeStorageSnapshot(snapshot);
    expect(imported.tree?.rootId).toBe("p-root");
    expect(imported.tree?.nodes["p-mid"].childIds).toEqual(["leaf-a"]);
    expect(imported.tree?.nodes["p-root"].policyDiagnostics?.postSummary.ok).toBe(true);
    expect(imported.tree?.policyDiagnosticsByParent["p-root"]?.postSummary.ok).toBe(true);
    expect(imported.diagnostics.every((diagnostic) => diagnostic.severity !== "error")).toBe(true);

    const broken: TreeStorageSnapshot = {
      ...snapshot,
      schemaVersion: "0.9.0",
      configSnapshot: {
        ...snapshot.configSnapshot,
        configHash: "invalid",
      },
    };

    const validation = validateTreeStorageSnapshot(broken);
    expect(validation.ok).toBe(false);
    expect(validation.diagnostics.map((diagnostic) => diagnostic.code)).toContain("unsupported_schema_version");
    expect(validation.diagnostics.map((diagnostic) => diagnostic.code)).toContain("invalid_config_hash");

    const importedBroken = importTreeStorageSnapshot(broken);
    expect(importedBroken.tree).toBeUndefined();
  });

  test("leaf detail does not add duplicate or false leaf_not_reachable diagnostics", () => {
    const snapshot = exportTreeStorageSnapshot(sampleTree(), {
      proofId: "proof-verity",
      config: normalizeConfig({}),
      leaves: sampleLeaves(),
    });
    const api = createTreeQueryApi({
      ...snapshot,
      schemaVersion: "0.9.0",
    });

    const detail = api.getLeafDetail("leaf-a");
    const reachabilityErrors = detail.diagnostics.filter(
      (diagnostic) => diagnostic.code === "leaf_not_reachable" && diagnostic.severity === "error",
    );
    expect(reachabilityErrors).toHaveLength(0);
    expect(detail.diagnostics.some((diagnostic) => diagnostic.code === "unsupported_schema_version")).toBe(true);
  });
});

function sampleTree(): ExplanationTree {
  return {
    rootId: "p-root",
    leafIds: ["leaf-a", "leaf-b", "leaf-c"],
    configHash: "cfg-seed",
    groupPlan: [],
    groupingDiagnostics: [],
    policyDiagnosticsByParent: {
      "p-root": {
        depth: 2,
        groupIndex: 0,
        retriesUsed: 0,
        preSummary: {
          ok: true,
          violations: [],
          metrics: {
            complexitySpread: 1,
            prerequisiteOrderViolations: 0,
            introducedTermCount: 0,
            evidenceCoverageRatio: 1,
            vocabularyContinuityRatio: 1,
            vocabularyContinuityFloor: 0.6,
          },
        },
        postSummary: {
          ok: true,
          violations: [],
          metrics: {
            complexitySpread: 1,
            prerequisiteOrderViolations: 0,
            introducedTermCount: 1,
            evidenceCoverageRatio: 1,
            vocabularyContinuityRatio: 0.7,
            vocabularyContinuityFloor: 0.6,
          },
        },
      },
    },
    maxDepth: 2,
    nodes: {
      "p-root": {
        id: "p-root",
        kind: "parent",
        statement: "Root statement",
        childIds: ["p-mid", "leaf-c"],
        depth: 2,
        evidenceRefs: ["leaf-a", "leaf-b", "leaf-c"],
        policyDiagnostics: {
          depth: 2,
          groupIndex: 0,
          retriesUsed: 0,
          preSummary: {
            ok: true,
            violations: [],
            metrics: {
              complexitySpread: 1,
              prerequisiteOrderViolations: 0,
              introducedTermCount: 0,
              evidenceCoverageRatio: 1,
              vocabularyContinuityRatio: 1,
              vocabularyContinuityFloor: 0.6,
            },
          },
          postSummary: {
            ok: true,
            violations: [],
            metrics: {
              complexitySpread: 1,
              prerequisiteOrderViolations: 0,
              introducedTermCount: 1,
              evidenceCoverageRatio: 1,
              vocabularyContinuityRatio: 0.7,
              vocabularyContinuityFloor: 0.6,
            },
          },
        },
      },
      "p-mid": {
        id: "p-mid",
        kind: "parent",
        statement: "Middle statement",
        childIds: ["leaf-a"],
        depth: 1,
        evidenceRefs: ["leaf-a", "leaf-b"],
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
      "leaf-c": {
        id: "leaf-c",
        kind: "leaf",
        statement: "Leaf C",
        childIds: [],
        depth: 0,
        evidenceRefs: ["leaf-c"],
      },
    },
  };
}

function sampleTreeWithScrambledNodeInsertion(): ExplanationTree {
  const tree = sampleTree();
  return {
    ...tree,
    nodes: {
      "leaf-c": tree.nodes["leaf-c"],
      "leaf-a": tree.nodes["leaf-a"],
      "p-root": tree.nodes["p-root"],
      "leaf-b": tree.nodes["leaf-b"],
      "p-mid": tree.nodes["p-mid"],
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
      statementText: "A statement",
      prettyStatement: "A statement",
      sourceSpan: {
        filePath: "Verity/Core.lean",
        startLine: 10,
        startColumn: 1,
        endLine: 11,
        endColumn: 20,
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
      statementText: "B statement",
      prettyStatement: "B statement",
      sourceSpan: {
        filePath: "Verity/Core.lean",
        startLine: 20,
        startColumn: 1,
        endLine: 21,
        endColumn: 20,
      },
      tags: [],
      dependencyIds: ["leaf-a"],
    },
    {
      schemaVersion: "1.0.0",
      id: "leaf-c",
      declarationId: "leaf-c",
      modulePath: "Verity.Loop",
      declarationName: "theoremC",
      theoremKind: "lemma",
      statementText: "C statement",
      prettyStatement: "C statement",
      sourceSpan: {
        filePath: "Verity/Loop.lean",
        startLine: 30,
        startColumn: 1,
        endLine: 31,
        endColumn: 12,
      },
      tags: [],
      dependencyIds: ["leaf-a"],
    },
  ];
}
