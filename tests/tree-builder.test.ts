import { describe, expect, test } from "vitest";
import { normalizeConfig } from "../src/config-contract.js";
import type { GenerateRequest, GenerateResult, ProviderClient } from "../src/openai-provider.js";
import {
  buildRecursiveExplanationTree,
  validateExplanationTree,
  type ExplanationTree,
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

function extractChildIds(request: GenerateRequest): string[] {
  const prompt = request.messages[1]?.content ?? "";
  const matches = [...prompt.matchAll(/id=([^\s]+)/g)];
  return matches.map((match) => match[1]).sort((a, b) => a.localeCompare(b));
}
