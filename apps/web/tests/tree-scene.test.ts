import { describe, expect, it } from "vitest";
import type { TreeNodeRecord } from "../lib/api-client";
import { buildTreeScene, isWholeTreeLoaded } from "../lib/tree-scene";

function parent(id: string, childIds: string[]): TreeNodeRecord {
  return {
    id,
    kind: "parent",
    statement: `Parent ${id}`,
    depth: 0,
    childIds,
    evidenceRefs: [],
    newTermsIntroduced: [],
  };
}

function leaf(id: string): TreeNodeRecord {
  return {
    id,
    kind: "leaf",
    statement: `Leaf ${id}`,
    depth: 1,
    childIds: [],
    evidenceRefs: [id],
    newTermsIntroduced: [],
  };
}

describe("tree scene transform", () => {
  it("is deterministic for identical tree/config inputs", () => {
    const nodesById = {
      root: parent("root", ["p1", "l1"]),
      p1: parent("p1", ["l2"]),
      l1: leaf("l1"),
      l2: leaf("l2"),
    } satisfies Record<string, TreeNodeRecord>;

    const childrenByParentId = {
      root: { childIds: ["p1", "l1"], totalChildren: 2, hasMore: false },
      p1: { childIds: ["l2"], totalChildren: 1, hasMore: false },
    };

    const first = buildTreeScene({
      rootId: "root",
      nodesById,
      childrenByParentId,
      configHash: "cfg",
      snapshotHash: "snap",
      selectedLeafId: "l2",
      pathNodeIds: ["root", "p1", "l2"],
    });

    const second = buildTreeScene({
      rootId: "root",
      nodesById,
      childrenByParentId,
      configHash: "cfg",
      snapshotHash: "snap",
      selectedLeafId: "l2",
      pathNodeIds: ["root", "p1", "l2"],
    });

    expect(first.sceneHash).toBe(second.sceneHash);
    expect(first.nodes).toEqual(second.nodes);
    expect(first.edges).toEqual(second.edges);
    expect(first.nodeCount).toBe(4);
    expect(first.edgeCount).toBe(3);
  });

  it("maps policy samples to explicit node status", () => {
    const nodesById = {
      root: parent("root", ["violating"]),
      violating: parent("violating", []),
    } satisfies Record<string, TreeNodeRecord>;

    const scene = buildTreeScene({
      rootId: "root",
      nodesById,
      childrenByParentId: {
        root: { childIds: ["violating"], totalChildren: 1, hasMore: false },
        violating: { childIds: [], totalChildren: 0, hasMore: false },
      },
      configHash: "cfg",
      snapshotHash: "snap",
      policyReport: {
        proofId: "seed-verity",
        configHash: "cfg",
        requestHash: "req",
        reportHash: "report",
        report: {
          rootId: "root",
          configHash: "cfg",
          generatedAt: "2026-01-01T00:00:00.000Z",
          metrics: {
            parentCount: 2,
            unsupportedParentCount: 1,
            prerequisiteViolationParentCount: 0,
            policyViolationParentCount: 1,
            introducedTermOverflowParentCount: 0,
            unsupportedParentRate: 0.5,
            prerequisiteViolationRate: 0,
            policyViolationRate: 0.5,
            meanComplexitySpread: 1,
            maxComplexitySpread: 1,
            meanEvidenceCoverage: 1,
            meanVocabularyContinuity: 1,
            meanTermJumpRate: 0,
            supportCoverageFloor: 1,
          },
          thresholds: {
            maxUnsupportedParentRate: 1,
            maxPrerequisiteViolationRate: 1,
            maxPolicyViolationRate: 1,
            maxTermJumpRate: 1,
            maxComplexitySpreadMean: 1,
            minEvidenceCoverageMean: 0,
            minVocabularyContinuityMean: 0,
          },
          thresholdPass: true,
          thresholdFailures: [],
          parentSamples: [
            {
              parentId: "violating",
              depth: 1,
              childCount: 0,
              complexitySpread: 0,
              prerequisiteOrderViolations: 0,
              evidenceCoverageRatio: 1,
              vocabularyContinuityRatio: 1,
              supportedClaimRatio: 0.5,
              introducedTermCount: 0,
              introducedTermRate: 0,
              policyViolationCount: 1,
            },
          ],
          depthMetrics: [],
        },
      },
    });

    const violatingNode = scene.nodes.find((node) => node.id === "violating");
    expect(violatingNode?.status).toBe("unsupported_parent");
    const violatingEdge = scene.edges.find((edge) => edge.to === "violating");
    expect(violatingEdge?.status).toBe("unsupported_parent");
  });

  it("detects incomplete trees when parent children are not fully loaded", () => {
    const nodesById = {
      root: parent("root", ["p1"]),
      p1: parent("p1", []),
    } satisfies Record<string, TreeNodeRecord>;

    expect(
      isWholeTreeLoaded("root", nodesById, {
        root: { childIds: ["p1"], totalChildren: 1, hasMore: false },
      }),
    ).toBe(false);

    expect(
      isWholeTreeLoaded("root", nodesById, {
        root: { childIds: ["p1"], totalChildren: 1, hasMore: false },
        p1: { childIds: [], totalChildren: 0, hasMore: false },
      }),
    ).toBe(true);
  });
});
