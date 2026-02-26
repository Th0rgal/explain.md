import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  LEAN_INGESTION_SCHEMA_VERSION,
  computeLeanIngestionHash,
  ingestLeanProject,
  ingestLeanSources,
  mapLeanIngestionToTheoremLeaves,
  renderLeanIngestionCanonical,
} from "../src/lean-ingestion.js";
import { buildDependencyGraphFromTheoremLeaves, getSupportingDeclarations } from "../src/dependency-graph.js";

describe("lean ingestion", () => {
  test("indexes Lean declarations from project fixtures with deterministic IDs and dependencies", async () => {
    const projectRoot = path.resolve("tests/fixtures/lean-project");

    const result = await ingestLeanProject(projectRoot);

    expect(result.schemaVersion).toBe(LEAN_INGESTION_SCHEMA_VERSION);
    expect(result.records.map((record) => record.declarationId)).toEqual([
      "lean:Verity/Core:core_safe:8:1",
      "lean:Verity/Core:inc_nonzero:5:1",
      "lean:Verity/Core:inc:3:1",
      "lean:Verity/Loop:loop_preserves:3:1",
      "lean:Verity/Loop:unsupported_demo:7:1",
    ]);

    const inc = result.records.find((record) => record.declarationName === "inc");
    const coreSafe = result.records.find((record) => record.declarationName === "core_safe");
    const loopPreserves = result.records.find((record) => record.declarationName === "loop_preserves");

    expect(inc?.declarationId).toBe("lean:Verity/Core:inc:3:1");
    expect(coreSafe?.dependencyIds).toContain("lean:Verity/Core:inc:3:1");
    expect(loopPreserves?.dependencyIds).toContain("lean:Verity/Core:core_safe:8:1");

    const warnings = result.warnings.filter((warning) => warning.code === "unsupported_construct");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.message).toContain("mutual declarations");

    const firstHash = computeLeanIngestionHash(result);
    const secondHash = computeLeanIngestionHash(await ingestLeanProject(projectRoot));
    expect(firstHash).toBe(secondHash);
  });

  test("supports strict unsupported mode", async () => {
    const projectRoot = path.resolve("tests/fixtures/lean-project");
    await expect(() => ingestLeanProject(projectRoot, { strictUnsupported: true })).rejects.toThrow(
      "unsupported constructs",
    );
  });

  test("supports in-memory source ingestion and leaf/graph mapping", () => {
    const result = ingestLeanSources("/virtual", [
      {
        filePath: "/virtual/Verity/Math.lean",
        content: [
          "def base : Nat := 1",
          "",
          "theorem uses_base : base = 1 := by",
          "  rfl",
        ].join("\n"),
      },
    ]);

    const leaves = mapLeanIngestionToTheoremLeaves(result);
    const graph = buildDependencyGraphFromTheoremLeaves(leaves);

    expect(leaves.map((leaf) => leaf.declarationName)).toEqual(["base", "uses_base"]);
    expect(getSupportingDeclarations(graph, "lean:Verity/Math:uses_base:3:1")).toEqual(["lean:Verity/Math:base:1:1"]);

    const canonical = renderLeanIngestionCanonical(result);
    expect(canonical).toContain("schema=1.0.0");
    expect(canonical).toContain("records=2");
  });
});
