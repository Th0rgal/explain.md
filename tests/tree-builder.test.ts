import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";
import { normalizeConfig } from "../src/config-contract.js";
import type { GenerateRequest, GenerateResult, ProviderClient } from "../src/openai-provider.js";
import {
  buildRecursiveExplanationTree,
  TreePolicyError,
  validateExplanationTree,
  type ExplanationTree,
  type ReusableParentSummary,
} from "../src/tree-builder.js";

describe("tree builder", () => {
  test("builds a connected rooted tree from wide leaf set", async () => {
    const config = normalizeConfig({ maxChildrenPerParent: 3, complexityLevel: 3, complexityBandWidth: 2 });

    const tree = await buildRecursiveExplanationTree(deterministicSummaryProvider(), {
      config,
      leaves: [
        { id: "l5", statement: "Fifth theorem preserves state." },
        { id: "l1", statement: "First theorem establishes invariant." },
        { id: "l3", statement: "Third theorem composes transition relation." },
        { id: "l2", statement: "Second theorem preserves invariant." },
        { id: "l4", statement: "Fourth theorem links transition and invariant." },
      ],
    });

    expect(tree.rootId).toMatch(/^p_/);
    expect(tree.leafIds).toEqual(["l1", "l2", "l3", "l4", "l5"]);
    expect(tree.maxDepth).toBeGreaterThan(0);
    expect(tree.groupingDiagnostics.length).toBeGreaterThan(0);
    expect(tree.groupingDiagnostics.every((layer) => layer.complexitySpreadByGroup.every((spread) => spread <= 2))).toBe(true);
    expect(Object.keys(tree.policyDiagnosticsByParent).length).toBeGreaterThan(0);

    const validation = validateExplanationTree(tree, config.maxChildrenPerParent);
    expect(validation.ok).toBe(true);

    const parentNodes = Object.values(tree.nodes).filter((node) => node.kind === "parent");
    expect(parentNodes.length).toBeGreaterThan(0);
    expect(parentNodes.every((node) => node.childIds.length <= 3)).toBe(true);
  });

  test("handles degenerate case with exactly one leaf", async () => {
    const config = normalizeConfig({});

    const tree = await buildRecursiveExplanationTree(deterministicSummaryProvider(), {
      config,
      leaves: [{ id: "l1", statement: "Only theorem." }],
    });

    expect(tree.rootId).toBe("l1");
    expect(tree.maxDepth).toBe(0);
    expect(tree.groupPlan).toHaveLength(0);
    expect(tree.groupingDiagnostics).toHaveLength(0);
    expect(tree.policyDiagnosticsByParent).toEqual({});

    const validation = validateExplanationTree(tree, config.maxChildrenPerParent);
    expect(validation.ok).toBe(true);
  });

  test("is deterministic for same leaves and config", async () => {
    const config = normalizeConfig({ maxChildrenPerParent: 2, complexityLevel: 3, complexityBandWidth: 2 });

    const first = await buildRecursiveExplanationTree(deterministicSummaryProvider(), {
      config,
      leaves: [
        { id: "b", statement: "B statement." },
        { id: "a", statement: "A statement." },
        { id: "c", statement: "C statement." },
      ],
    });

    const second = await buildRecursiveExplanationTree(deterministicSummaryProvider(), {
      config,
      leaves: [
        { id: "c", statement: "C statement." },
        { id: "a", statement: "A statement." },
        { id: "b", statement: "B statement." },
      ],
    });

    expect(first.rootId).toBe(second.rootId);
    expect(first.groupPlan).toEqual(second.groupPlan);
    expect(first.nodes[first.rootId].statement).toBe(second.nodes[second.rootId].statement);
  });

  test("validator reports disconnected leaves", () => {
    const tree: ExplanationTree = {
      rootId: "p1",
      leafIds: ["l1", "l2"],
      configHash: "hash",
      groupPlan: [],
      groupingDiagnostics: [],
      policyDiagnosticsByParent: {},
      maxDepth: 1,
      nodes: {
        p1: {
          id: "p1",
          kind: "parent",
          statement: "root",
          childIds: ["l1"],
          depth: 1,
          evidenceRefs: ["l1"],
        },
        l1: {
          id: "l1",
          kind: "leaf",
          statement: "leaf one",
          childIds: [],
          depth: 0,
          evidenceRefs: ["l1"],
        },
        l2: {
          id: "l2",
          kind: "leaf",
          statement: "leaf two",
          childIds: [],
          depth: 0,
          evidenceRefs: ["l2"],
        },
      },
    };

    const validation = validateExplanationTree(tree, 5);
    expect(validation.ok).toBe(false);
    expect(validation.issues.map((issue) => issue.code)).toContain("leaf_not_preserved");
    expect(validation.issues.map((issue) => issue.code)).toContain("not_connected");
  });

  test("fails with policy error when parent cannot satisfy evidence coverage after retry", async () => {
    const config = normalizeConfig({ maxChildrenPerParent: 2 });
    const provider = nonCompliantEvidenceProvider();

    const thrown = await captureError(() =>
      buildRecursiveExplanationTree(provider, {
        config,
        leaves: [
          { id: "l1", statement: "Invariant holds at initialization." },
          { id: "l2", statement: "Invariant is preserved by transition." },
        ],
      }),
    );

    expect(thrown).toBeInstanceOf(TreePolicyError);
    const diagnostics = (thrown as TreePolicyError).diagnostics;
    expect(diagnostics.postSummary.violations.map((violation) => violation.code)).toContain("evidence_coverage");
  });

  test("builds when prerequisite order is topological but not lexical by id", async () => {
    const config = normalizeConfig({ maxChildrenPerParent: 2, complexityBandWidth: 2 });
    const tree = await buildRecursiveExplanationTree(deterministicSummaryProvider(), {
      config,
      leaves: [
        { id: "a", statement: "A depends on Z.", prerequisiteIds: ["z"] },
        { id: "z", statement: "Z prerequisite theorem." },
      ],
    });

    expect(tree.rootId).toMatch(/^p_/);
    const validation = validateExplanationTree(tree, config.maxChildrenPerParent);
    expect(validation.ok).toBe(true);
  });

  test("builds when two leaves have cyclic prerequisites", async () => {
    const config = normalizeConfig({ maxChildrenPerParent: 2, complexityBandWidth: 2 });
    const tree = await buildRecursiveExplanationTree(deterministicSummaryProvider(), {
      config,
      leaves: [
        { id: "a", statement: "A depends on B.", prerequisiteIds: ["b"] },
        { id: "b", statement: "B depends on A.", prerequisiteIds: ["a"] },
      ],
    });

    expect(tree.rootId).toMatch(/^p_/);
    const validation = validateExplanationTree(tree, config.maxChildrenPerParent);
    expect(validation.ok).toBe(true);
  });

  test("builds when acyclic nodes depend on a cyclic pair", async () => {
    const config = normalizeConfig({ maxChildrenPerParent: 5, complexityBandWidth: 2 });
    const tree = await buildRecursiveExplanationTree(deterministicSummaryProvider(), {
      config,
      leaves: [
        { id: "a", statement: "A depends on B.", prerequisiteIds: ["b"] },
        { id: "b", statement: "B depends on A.", prerequisiteIds: ["a"] },
        { id: "c", statement: "C depends on A and B.", prerequisiteIds: ["a", "b"] },
        { id: "d", statement: "D depends on C.", prerequisiteIds: ["c"] },
      ],
    });

    expect(tree.rootId).toMatch(/^p_/);
    const validation = validateExplanationTree(tree, config.maxChildrenPerParent);
    expect(validation.ok).toBe(true);
  });

  test("rejects invalid maxChildrenPerParent before tree loop", async () => {
    const badConfig = { ...normalizeConfig({}), maxChildrenPerParent: 0 };
    await expect(
      buildRecursiveExplanationTree(deterministicSummaryProvider(), {
        config: badConfig,
        leaves: [
          { id: "l1", statement: "A" },
          { id: "l2", statement: "B" },
        ],
      }),
    ).rejects.toThrow("maxChildrenPerParent");
  });

  test("runs parent summary generation in deterministic bounded batches", async () => {
    const config = normalizeConfig({ maxChildrenPerParent: 2, complexityBandWidth: 2 });
    const tracker = { inFlight: 0, maxInFlight: 0 };

    const tree = await buildRecursiveExplanationTree(concurrencyTrackingProvider(tracker), {
      config,
      summaryBatchSize: 2,
      leaves: [
        { id: "l1", statement: "Leaf one." },
        { id: "l2", statement: "Leaf two." },
        { id: "l3", statement: "Leaf three." },
        { id: "l4", statement: "Leaf four." },
        { id: "l5", statement: "Leaf five." },
        { id: "l6", statement: "Leaf six." },
      ],
    });

    expect(tracker.maxInFlight).toBe(2);
    expect(tree.groupingDiagnostics[0].summaryBatches).toEqual([
      {
        batchIndex: 0,
        groupIndexes: [0, 1],
        groupCount: 2,
        inputNodeCount: 4,
      },
      {
        batchIndex: 1,
        groupIndexes: [2],
        groupCount: 1,
        inputNodeCount: 2,
      },
    ]);
  });

  test("rejects invalid summaryBatchSize", async () => {
    const config = normalizeConfig({});
    await expect(
      buildRecursiveExplanationTree(deterministicSummaryProvider(), {
        config,
        summaryBatchSize: 0,
        leaves: [
          { id: "l1", statement: "A" },
          { id: "l2", statement: "B" },
        ],
      }),
    ).rejects.toThrow("summaryBatchSize");
  });

  test("reuses unchanged parent summaries by stable parent IDs", async () => {
    const config = normalizeConfig({ maxChildrenPerParent: 2, complexityBandWidth: 2 });
    const baselineProvider = countedDeterministicSummaryProvider();
    const originalLeaves = [
      { id: "l1", statement: "Leaf one." },
      { id: "l2", statement: "Leaf two." },
      { id: "l3", statement: "Leaf three." },
      { id: "l4", statement: "Leaf four." },
      { id: "l5", statement: "Leaf five." },
      { id: "l6", statement: "Leaf six." },
    ];

    const previousTree = await buildRecursiveExplanationTree(baselineProvider.provider, {
      config,
      leaves: originalLeaves,
    });
    expect(baselineProvider.counter.count).toBeGreaterThan(0);

    const nextLeaves = [
      ...originalLeaves,
      { id: "l7", statement: "Leaf seven introduces topology change." },
    ];
    const withoutReuseProvider = countedDeterministicSummaryProvider();
    await buildRecursiveExplanationTree(withoutReuseProvider.provider, {
      config,
      leaves: nextLeaves,
    });

    const reusableParentSummaries = buildReusableParentSummaries(previousTree);
    const withReuseProvider = countedDeterministicSummaryProvider();
    const withReuseTree = await buildRecursiveExplanationTree(withReuseProvider.provider, {
      config,
      leaves: nextLeaves,
      reusableParentSummaries,
    });

    expect(withReuseProvider.counter.count).toBeLessThan(withoutReuseProvider.counter.count);
    const reusedGroups = withReuseTree.groupingDiagnostics.flatMap((layer) => layer.summaryReuse?.reusedGroupIndexes ?? []);
    expect(reusedGroups.length).toBeGreaterThan(0);
  });

  test("reuses parent summaries by child hash when reusable parent IDs are reindexed", async () => {
    const config = normalizeConfig({ maxChildrenPerParent: 2, complexityBandWidth: 2 });
    const baselineProvider = countedDeterministicSummaryProvider();
    const leaves = [
      { id: "l1", statement: "Leaf one." },
      { id: "l2", statement: "Leaf two." },
      { id: "l3", statement: "Leaf three." },
      { id: "l4", statement: "Leaf four." },
      { id: "l5", statement: "Leaf five." },
      { id: "l6", statement: "Leaf six." },
    ];

    const previousTree = await buildRecursiveExplanationTree(baselineProvider.provider, {
      config,
      leaves,
    });
    expect(baselineProvider.counter.count).toBeGreaterThan(0);

    const reindexedReusableSummaries = Object.fromEntries(
      Object.entries(buildReusableParentSummaries(previousTree)).map(([parentId, summary]) => [`shifted_${parentId}`, summary]),
    );
    const withReuseProvider = countedDeterministicSummaryProvider();
    const withReuseTree = await buildRecursiveExplanationTree(withReuseProvider.provider, {
      config,
      leaves,
      reusableParentSummaries: reindexedReusableSummaries,
    });

    expect(withReuseProvider.counter.count).toBe(0);
    const reusedByChildHashGroups = withReuseTree.groupingDiagnostics.flatMap(
      (layer) => layer.summaryReuse?.reusedByChildHashGroupIndexes ?? [],
    );
    const reusedByParentIdGroups = withReuseTree.groupingDiagnostics.flatMap(
      (layer) => layer.summaryReuse?.reusedByParentIdGroupIndexes ?? [],
    );
    expect(reusedByChildHashGroups.length).toBeGreaterThan(0);
    expect(reusedByParentIdGroups).toHaveLength(0);
  });

  test("skips child-hash reuse when reusable candidates are ambiguous", async () => {
    const config = normalizeConfig({ maxChildrenPerParent: 2, complexityBandWidth: 2 });
    const baselineProvider = countedDeterministicSummaryProvider();
    const leaves = [
      { id: "l1", statement: "Leaf one." },
      { id: "l2", statement: "Leaf two." },
      { id: "l3", statement: "Leaf three." },
      { id: "l4", statement: "Leaf four." },
      { id: "l5", statement: "Leaf five." },
      { id: "l6", statement: "Leaf six." },
    ];

    const previousTree = await buildRecursiveExplanationTree(baselineProvider.provider, {
      config,
      leaves,
    });
    const duplicatedAmbiguousSummaries = Object.fromEntries(
      Object.entries(buildReusableParentSummaries(previousTree)).flatMap(([parentId, summary]) => [
        [`shifted_a_${parentId}`, summary],
        [`shifted_b_${parentId}`, summary],
      ]),
    );

    const withAmbiguousReuseProvider = countedDeterministicSummaryProvider();
    const rebuilt = await buildRecursiveExplanationTree(withAmbiguousReuseProvider.provider, {
      config,
      leaves,
      reusableParentSummaries: duplicatedAmbiguousSummaries,
    });

    expect(withAmbiguousReuseProvider.counter.count).toBeGreaterThan(0);
    const skippedAmbiguousGroups = rebuilt.groupingDiagnostics.flatMap(
      (layer) => layer.summaryReuse?.skippedAmbiguousChildHashGroupIndexes ?? [],
    );
    const reusedByChildHashGroups = rebuilt.groupingDiagnostics.flatMap(
      (layer) => layer.summaryReuse?.reusedByChildHashGroupIndexes ?? [],
    );
    expect(skippedAmbiguousGroups.length).toBeGreaterThan(0);
    expect(reusedByChildHashGroups).toHaveLength(0);
  });
});

function deterministicSummaryProvider(): ProviderClient {
  return {
    generate: async (request: GenerateRequest): Promise<GenerateResult> => {
      const childIds = extractChildIds(request);
      const parentStatement = `Parent(${childIds.join("+")})`;

      return {
        text: JSON.stringify({
          parent_statement: parentStatement,
          why_true_from_children: `${childIds.join(", ")} jointly entail the parent claim.`,
          new_terms_introduced: [],
          complexity_score: 3,
          abstraction_score: 3,
          evidence_refs: childIds,
          confidence: 0.9,
        }),
        model: "mock",
        finishReason: "stop",
        raw: {},
      };
    },
    stream: async function* () {
      return;
    },
  };
}

function countedDeterministicSummaryProvider(): { provider: ProviderClient; counter: { count: number } } {
  const counter = { count: 0 };
  return {
    counter,
    provider: {
      generate: async (request: GenerateRequest): Promise<GenerateResult> => {
        counter.count += 1;
        const childIds = extractChildIds(request);
        const parentStatement = `Parent(${childIds.join("+")})`;

        return {
          text: JSON.stringify({
            parent_statement: parentStatement,
            why_true_from_children: `${childIds.join(", ")} jointly entail the parent claim.`,
            new_terms_introduced: [],
            complexity_score: 3,
            abstraction_score: 3,
            evidence_refs: childIds,
            confidence: 0.9,
          }),
          model: "mock",
          finishReason: "stop",
          raw: {},
        };
      },
      stream: async function* () {
        return;
      },
    },
  };
}

function buildReusableParentSummaries(tree: ExplanationTree): Record<string, ReusableParentSummary> {
  const summaries: Record<string, ReusableParentSummary> = {};
  for (const node of Object.values(tree.nodes)) {
    if (
      node.kind !== "parent" ||
      node.whyTrueFromChildren === undefined ||
      node.complexityScore === undefined ||
      node.abstractionScore === undefined ||
      node.confidence === undefined
    ) {
      continue;
    }

    const children: Array<{ id: string; statement: string }> = [];
    let missingChild = false;
    for (const childId of node.childIds) {
      const child = tree.nodes[childId];
      if (!child) {
        missingChild = true;
        break;
      }
      children.push({ id: child.id, statement: child.statement });
    }
    if (missingChild) {
      continue;
    }
    summaries[node.id] = {
      childStatementHash: computeChildStatementHash(children),
      summary: {
        parent_statement: node.statement,
        why_true_from_children: node.whyTrueFromChildren,
        new_terms_introduced: (node.newTermsIntroduced ?? []).slice(),
        complexity_score: node.complexityScore,
        abstraction_score: node.abstractionScore,
        evidence_refs: node.evidenceRefs.slice(),
        confidence: node.confidence,
      },
      policyDiagnostics: node.policyDiagnostics,
    };
  }
  return summaries;
}

function computeChildStatementHash(children: Array<{ id: string; statement: string }>): string {
  return createHash("sha256")
    .update(children.map((child) => `${child.id}:${child.statement}`).join("\n"))
    .digest("hex");
}

function extractChildIds(request: GenerateRequest): string[] {
  const prompt = request.messages[1]?.content ?? "";
  const matches = [...prompt.matchAll(/id=([^\s]+)/g)];
  return matches.map((match) => match[1]).sort((a, b) => a.localeCompare(b));
}

function nonCompliantEvidenceProvider(): ProviderClient {
  return {
    generate: async () => ({
      text: JSON.stringify({
        parent_statement: "Parent(l1+l2)",
        why_true_from_children: "l1 entails the claim.",
        new_terms_introduced: [],
        complexity_score: 3,
        abstraction_score: 3,
        evidence_refs: ["l1"],
        confidence: 0.9,
      }),
      model: "mock",
      finishReason: "stop",
      raw: {},
    }),
    stream: async function* () {
      return;
    },
  };
}

function concurrencyTrackingProvider(tracker: { inFlight: number; maxInFlight: number }): ProviderClient {
  return {
    generate: async (request: GenerateRequest): Promise<GenerateResult> => {
      tracker.inFlight += 1;
      tracker.maxInFlight = Math.max(tracker.maxInFlight, tracker.inFlight);

      await new Promise((resolve) => setTimeout(resolve, 5));
      const childIds = extractChildIds(request);

      tracker.inFlight -= 1;
      return {
        text: JSON.stringify({
          parent_statement: `Parent(${childIds.join("+")})`,
          why_true_from_children: `${childIds.join(", ")} jointly entail the parent claim.`,
          new_terms_introduced: [],
          complexity_score: 3,
          abstraction_score: 3,
          evidence_refs: childIds,
          confidence: 0.9,
        }),
        model: "mock",
        finishReason: "stop",
        raw: {},
      };
    },
    stream: async function* () {
      return;
    },
  };
}

async function captureError(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
    throw new Error("Expected rejection.");
  } catch (error) {
    return error;
  }
}
