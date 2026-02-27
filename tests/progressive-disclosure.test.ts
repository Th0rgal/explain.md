import { describe, expect, test } from "vitest";
import { normalizeConfig, type ExplanationConfig } from "../src/config-contract.js";
import {
  buildExplanationDiffReport,
  buildProgressiveDisclosureView,
  computeExplanationDiffHash,
  computeProgressiveDisclosureHash,
  renderExplanationDiffCanonical,
  renderProgressiveDisclosureCanonical,
} from "../src/progressive-disclosure.js";
import type { ExplanationTree } from "../src/tree-builder.js";

describe("progressive disclosure", () => {
  test("projects root-first view and applies per-parent child window", () => {
    const tree = sampleTree();
    const view = buildProgressiveDisclosureView(tree, {
      expandedNodeIds: ["p-root", "p-mid", "unknown", "leaf-c", "p-root"],
      maxChildrenPerExpandedNode: 1,
    });

    expect(view.expandedNodeIds).toEqual(["leaf-c", "p-mid", "p-root", "unknown"]);
    expect(view.visibleNodes.map((node) => node.id)).toEqual(["p-root", "p-mid", "leaf-a"]);

    const rootNode = view.visibleNodes[0];
    expect(rootNode.isExpanded).toBe(true);
    expect(rootNode.visibleChildIds).toEqual(["p-mid"]);
    expect(rootNode.hiddenChildCount).toBe(1);

    const diagnostics = view.diagnostics.map((diagnostic) => diagnostic.code);
    expect(diagnostics).toContain("expanded_node_missing");
    expect(diagnostics).toContain("expanded_node_not_parent");
  });

  test("emits deterministic canonical rendering and hash", () => {
    const tree = sampleTree();
    const first = buildProgressiveDisclosureView(tree, {
      expandedNodeIds: ["p-mid", "p-root"],
      maxChildrenPerExpandedNode: 2,
    });
    const second = buildProgressiveDisclosureView(tree, {
      expandedNodeIds: ["p-root", "p-mid", "p-root"],
      maxChildrenPerExpandedNode: 2,
    });

    expect(renderProgressiveDisclosureCanonical(first)).toBe(renderProgressiveDisclosureCanonical(second));
    expect(computeProgressiveDisclosureHash(first)).toBe(computeProgressiveDisclosureHash(second));
  });

  test("rejects invalid maxChildrenPerExpandedNode", () => {
    expect(() =>
      buildProgressiveDisclosureView(sampleTree(), {
        expandedNodeIds: ["p-root"],
        maxChildrenPerExpandedNode: 0,
      }),
    ).toThrow("maxChildrenPerExpandedNode must be an integer >= 1 when provided.");
  });

  test("returns missing_root diagnostic when root node is absent", () => {
    const tree = sampleTree();
    const broken: ExplanationTree = {
      ...tree,
      nodes: {
        ...tree.nodes,
      },
    };
    delete broken.nodes[broken.rootId];

    const view = buildProgressiveDisclosureView(broken, { expandedNodeIds: ["p-root"] });
    expect(view.visibleNodes).toEqual([]);
    expect(view.diagnostics.some((diagnostic) => diagnostic.code === "missing_root")).toBe(true);
  });
});

describe("explanation diff", () => {
  test("reports deterministic added/removed/changed nodes keyed by support", () => {
    const baseline = sampleTree();
    const candidate = sampleCandidateTree();

    const report = buildExplanationDiffReport(
      baseline,
      candidate,
      baselineConfig(),
      normalizeConfig({ ...baselineConfig(), abstractionLevel: 4 }),
    );

    expect(report.regenerationPlan.scope).toBe("full");
    expect(report.regenerationPlan.changedFields).toContain("abstractionLevel");
    expect(report.summary).toEqual({ total: 5, added: 2, removed: 2, changed: 1 });

    const changed = report.changes.find((change) => change.type === "changed");
    expect(changed?.baselineNodeId).toBe("p-mid");
    expect(changed?.candidateNodeId).toBe("p-mid-v2");
    expect(changed?.supportLeafIds).toEqual(["leaf-a", "leaf-b"]);

    const addedLeaf = report.changes.find(
      (change) => change.type === "added" && change.candidateNodeId === "leaf-d",
    );
    expect(addedLeaf?.kind).toBe("leaf");

    const removedLeaf = report.changes.find(
      (change) => change.type === "removed" && change.baselineNodeId === "leaf-c",
    );
    expect(removedLeaf?.kind).toBe("leaf");
  });

  test("renders and hashes diff deterministically", () => {
    const reportA = buildExplanationDiffReport(
      sampleTree(),
      sampleCandidateTree(),
      baselineConfig(),
      normalizeConfig({ ...baselineConfig(), complexityLevel: 4 }),
    );
    const reportB = buildExplanationDiffReport(
      sampleTreeWithScrambledNodeInsertion(),
      sampleCandidateTreeWithScrambledNodeInsertion(),
      baselineConfig(),
      normalizeConfig({ ...baselineConfig(), complexityLevel: 4 }),
    );

    expect(renderExplanationDiffCanonical(reportA)).toBe(renderExplanationDiffCanonical(reportB));
    expect(computeExplanationDiffHash(reportA)).toBe(computeExplanationDiffHash(reportB));
  });

  test("handles cyclic parent graphs without stack overflow", () => {
    const baseline = sampleCyclicTree();
    const candidate = sampleCyclicTreeVariant();

    const report = buildExplanationDiffReport(
      baseline,
      candidate,
      baselineConfig(),
      normalizeConfig({ ...baselineConfig(), language: "fr" }),
    );

    expect(report.regenerationPlan.scope).toBe("full");
    expect(report.summary.total).toBeGreaterThan(0);
    expect(report.changes.some((change) => change.type === "changed")).toBe(true);
  });
});

function baselineConfig(): ExplanationConfig {
  return normalizeConfig({
    abstractionLevel: 3,
    complexityLevel: 3,
    maxChildrenPerParent: 5,
    language: "en",
    audienceLevel: "intermediate",
    readingLevelTarget: "high_school",
    complexityBandWidth: 1,
    termIntroductionBudget: 2,
    proofDetailMode: "balanced",
  });
}

function sampleTree(): ExplanationTree {
  return {
    rootId: "p-root",
    leafIds: ["leaf-a", "leaf-b", "leaf-c"],
    configHash: "cfg-baseline",
    groupPlan: [],
    groupingDiagnostics: [],
    policyDiagnosticsByParent: {},
    maxDepth: 2,
    nodes: {
      "p-root": {
        id: "p-root",
        kind: "parent",
        statement: "Root explains A,B,C",
        childIds: ["p-mid", "leaf-c"],
        depth: 2,
        evidenceRefs: ["p-mid", "leaf-c"],
      },
      "p-mid": {
        id: "p-mid",
        kind: "parent",
        statement: "Mid explains A and B",
        childIds: ["leaf-a", "leaf-b"],
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
      orphan: {
        id: "orphan",
        kind: "leaf",
        statement: "Orphan leaf",
        childIds: [],
        depth: 0,
        evidenceRefs: ["orphan"],
      },
    },
  };
}

function sampleCandidateTree(): ExplanationTree {
  return {
    rootId: "p-root-v2",
    leafIds: ["leaf-a", "leaf-b", "leaf-d"],
    configHash: "cfg-candidate",
    groupPlan: [],
    groupingDiagnostics: [],
    policyDiagnosticsByParent: {},
    maxDepth: 2,
    nodes: {
      "p-root-v2": {
        id: "p-root-v2",
        kind: "parent",
        statement: "Root explains A,B,D",
        childIds: ["p-mid-v2", "leaf-d"],
        depth: 2,
        evidenceRefs: ["p-mid-v2", "leaf-d"],
      },
      "p-mid-v2": {
        id: "p-mid-v2",
        kind: "parent",
        statement: "Mid explains A and B with tighter abstraction",
        childIds: ["leaf-a", "leaf-b"],
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
      "leaf-d": {
        id: "leaf-d",
        kind: "leaf",
        statement: "Leaf D",
        childIds: [],
        depth: 0,
        evidenceRefs: ["leaf-d"],
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
      orphan: tree.nodes.orphan,
      "p-root": tree.nodes["p-root"],
      "leaf-b": tree.nodes["leaf-b"],
      "p-mid": tree.nodes["p-mid"],
    },
  };
}

function sampleCandidateTreeWithScrambledNodeInsertion(): ExplanationTree {
  const tree = sampleCandidateTree();
  return {
    ...tree,
    nodes: {
      "leaf-d": tree.nodes["leaf-d"],
      "p-mid-v2": tree.nodes["p-mid-v2"],
      "leaf-b": tree.nodes["leaf-b"],
      "p-root-v2": tree.nodes["p-root-v2"],
      "leaf-a": tree.nodes["leaf-a"],
    },
  };
}

function sampleCyclicTree(): ExplanationTree {
  return {
    rootId: "p-root",
    leafIds: ["leaf-a"],
    configHash: "cfg-cycle-a",
    groupPlan: [],
    groupingDiagnostics: [],
    policyDiagnosticsByParent: {},
    maxDepth: 2,
    nodes: {
      "p-root": {
        id: "p-root",
        kind: "parent",
        statement: "Root",
        childIds: ["p-a"],
        depth: 2,
        evidenceRefs: ["p-a"],
      },
      "p-a": {
        id: "p-a",
        kind: "parent",
        statement: "A",
        childIds: ["p-b", "leaf-a"],
        depth: 1,
        evidenceRefs: ["p-b", "leaf-a"],
      },
      "p-b": {
        id: "p-b",
        kind: "parent",
        statement: "B",
        childIds: ["p-a"],
        depth: 1,
        evidenceRefs: ["p-a"],
      },
      "leaf-a": {
        id: "leaf-a",
        kind: "leaf",
        statement: "Leaf A",
        childIds: [],
        depth: 0,
        evidenceRefs: ["leaf-a"],
      },
    },
  };
}

function sampleCyclicTreeVariant(): ExplanationTree {
  const baseline = sampleCyclicTree();
  return {
    ...baseline,
    configHash: "cfg-cycle-b",
    nodes: {
      ...baseline.nodes,
      "p-a": {
        ...baseline.nodes["p-a"],
        statement: "A changed",
      },
    },
  };
}
