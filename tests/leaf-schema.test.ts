import { describe, expect, test } from "vitest";
import {
  THEOREM_LEAF_SCHEMA_VERSION,
  buildSourceUrl,
  mapIngestedDeclarationToLeaf,
  mapIngestedDeclarationsToLeaves,
  mapTheoremLeavesToTreeLeaves,
  migrateTheoremLeafRecord,
  renderTheoremLeafCanonical,
  validateTheoremLeafRecord,
} from "../src/leaf-schema.js";

describe("leaf schema", () => {
  test("maps ingestion record to deterministic theorem leaf with source URL", () => {
    const declaration = {
      modulePath: "Verity/State",
      declarationName: "StateInvariant",
      theoremKind: "theorem",
      statementText: "forall s, invariant s -> safe s",
      prettyStatement: "∀ s, invariant s -> safe s",
      sourceSpan: {
        filePath: "Verity/State.lean",
        startLine: 12,
        startColumn: 3,
        endLine: 14,
        endColumn: 18,
      },
      tags: ["safety", "invariant", "safety"],
      dependencyIds: ["decl_b", "decl_a", "decl_b"],
    };

    const left = mapIngestedDeclarationToLeaf(declaration, {
      sourceBaseUrl: "https://github.com/acme/verity/blob/main",
    });
    const right = mapIngestedDeclarationToLeaf(declaration, {
      sourceBaseUrl: "https://github.com/acme/verity/blob/main",
    });

    expect(left.schemaVersion).toBe(THEOREM_LEAF_SCHEMA_VERSION);
    expect(left.id).toBe(right.id);
    expect(left.tags).toEqual(["invariant", "safety"]);
    expect(left.dependencyIds).toEqual(["decl_a", "decl_b"]);
    expect(left.sourceUrl).toBe(
      "https://github.com/acme/verity/blob/main/Verity/State.lean#L12C3-L14C18",
    );
  });

  test("maps declaration lists and tree leaves in stable id order", () => {
    const leaves = mapIngestedDeclarationsToLeaves([
      {
        declarationId: "decl_2",
        modulePath: "Verity/B",
        declarationName: "B",
        theoremKind: "lemma",
        statementText: "b",
        sourceSpan: { filePath: "Verity/B.lean", startLine: 2, startColumn: 1, endLine: 2, endColumn: 2 },
      },
      {
        declarationId: "decl_1",
        modulePath: "Verity/A",
        declarationName: "A",
        theoremKind: "theorem",
        statementText: "a",
        prettyStatement: "A",
        dependencyIds: ["decl_0"],
        sourceSpan: { filePath: "Verity/A.lean", startLine: 1, startColumn: 1, endLine: 1, endColumn: 2 },
      },
    ]);

    expect(leaves.map((leaf) => leaf.id)).toEqual(["decl_1", "decl_2"]);

    const treeLeaves = mapTheoremLeavesToTreeLeaves(leaves);
    expect(treeLeaves).toEqual([
      { id: "decl_1", statement: "A", prerequisiteIds: ["decl_0"] },
      { id: "decl_2", statement: "b", prerequisiteIds: [] },
    ]);
  });

  test("renders canonical leaf text deterministically", () => {
    const leaf = mapIngestedDeclarationToLeaf({
      declarationId: "decl_render",
      modulePath: "Verity/Render",
      declarationName: "renderDemo",
      theoremKind: "definition",
      statementText: "demo statement",
      prettyStatement: "demo statement",
      sourceSpan: { filePath: "Verity/Render.lean", startLine: 7, startColumn: 2, endLine: 7, endColumn: 15 },
      tags: ["z", "a"],
      dependencyIds: ["decl_b", "decl_a"],
    });

    const rendered = renderTheoremLeafCanonical(leaf);

    expect(rendered).toContain("schema=1.0.0");
    expect(rendered).toContain("dependencies=decl_a,decl_b");
    expect(rendered).toContain("tags=a,z");
    expect(rendered).toContain("span=Verity/Render.lean:7:2-7:15");
  });

  test("migrates legacy v0 leaf fields to v1 schema", () => {
    const migrated = migrateTheoremLeafRecord({
      schemaVersion: "0.2.0",
      id: "decl_old",
      module: "Verity/Legacy",
      name: "legacyLemma",
      kind: "lemma",
      statement: "legacy statement",
      pretty: "legacy statement",
      deps: ["decl_dep"],
      tags: ["legacy"],
      filePath: "Verity/Legacy.lean",
      startLine: 22,
      startColumn: 4,
      endLine: 22,
      endColumn: 20,
    });

    expect(migrated.schemaVersion).toBe("1.0.0");
    expect(migrated.modulePath).toBe("Verity/Legacy");
    expect(migrated.declarationName).toBe("legacyLemma");
    expect(migrated.dependencyIds).toEqual(["decl_dep"]);
  });

  test("validation catches invalid source spans", () => {
    const leaf = mapIngestedDeclarationToLeaf({
      declarationId: "decl_bad",
      modulePath: "Verity/Bad",
      declarationName: "bad",
      theoremKind: "theorem",
      statementText: "bad",
      sourceSpan: { filePath: "Verity/Bad.lean", startLine: 10, startColumn: 3, endLine: 10, endColumn: 9 },
    });

    const invalid = {
      ...leaf,
      sourceSpan: {
        ...leaf.sourceSpan,
        endColumn: 1,
      },
    };

    const result = validateTheoremLeafRecord(invalid);
    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => error.path === "sourceSpan.endColumn")).toBe(true);
  });

  test("buildSourceUrl URL-encodes path segments", () => {
    const url = buildSourceUrl("https://example.test/blob/main/", {
      filePath: "Verity/Spec with spaces.lean",
      startLine: 1,
      startColumn: 1,
      endLine: 2,
      endColumn: 3,
    });

    expect(url).toBe("https://example.test/blob/main/Verity/Spec%20with%20spaces.lean#L1C1-L2C3");
  });
});
