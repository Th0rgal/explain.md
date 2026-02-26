import { describe, expect, test } from "vitest";
import {
  buildDeclarationDependencyGraph,
  buildDependencyGraphFromTheoremLeaves,
  computeDependencyGraphHash,
  getDirectDependencies,
  getDirectDependents,
  getSupportingDeclarations,
  renderDependencyGraphCanonical,
} from "../src/dependency-graph.js";
import { mapIngestedDeclarationsToLeaves } from "../src/leaf-schema.js";

describe("dependency graph", () => {
  test("builds deterministic graph with external dependencies and support closure", () => {
    const graph = buildDeclarationDependencyGraph([
      { id: "A", dependencyIds: ["B", "C", "X"] },
      { id: "B", dependencyIds: ["D"] },
      { id: "C", dependencyIds: [] },
      { id: "D", dependencyIds: [] },
    ]);

    expect(graph.nodeIds).toEqual(["A", "B", "C", "D", "X"]);
    expect(graph.edgeCount).toBe(4);
    expect(graph.indexedNodeCount).toBe(4);
    expect(graph.externalNodeCount).toBe(1);
    expect(graph.missingDependencyRefs).toEqual([{ declarationId: "A", dependencyId: "X" }]);

    expect(getDirectDependencies(graph, "A")).toEqual(["B", "C", "X"]);
    expect(getDirectDependents(graph, "D")).toEqual(["B"]);
    expect(getSupportingDeclarations(graph, "A")).toEqual(["D", "B", "C", "X"]);
    expect(getSupportingDeclarations(graph, "A", { includeExternal: false })).toEqual(["D", "B", "C"]);

    const leftHash = computeDependencyGraphHash(graph);
    const rightHash = computeDependencyGraphHash(buildDeclarationDependencyGraph([
      { id: "D", dependencyIds: [] },
      { id: "C", dependencyIds: [] },
      { id: "B", dependencyIds: ["D"] },
      { id: "A", dependencyIds: ["X", "C", "B"] },
    ]));

    expect(leftHash).toBe(rightHash);
  });

  test("can drop external nodes while retaining missing-reference diagnostics", () => {
    const graph = buildDeclarationDependencyGraph(
      [
        { id: "A", dependencyIds: ["B", "MISSING"] },
        { id: "B", dependencyIds: [] },
      ],
      { includeExternalNodes: false },
    );

    expect(graph.nodeIds).toEqual(["A", "B"]);
    expect(graph.edgeCount).toBe(1);
    expect(graph.externalNodeCount).toBe(0);
    expect(graph.missingDependencyRefs).toEqual([{ declarationId: "A", dependencyId: "MISSING" }]);
  });

  test("detects SCC cycles including self-loop cycles", () => {
    const graph = buildDeclarationDependencyGraph([
      { id: "A", dependencyIds: ["B"] },
      { id: "B", dependencyIds: ["C"] },
      { id: "C", dependencyIds: ["A"] },
      { id: "D", dependencyIds: ["D"] },
      { id: "E", dependencyIds: [] },
    ]);

    expect(graph.cyclicSccs).toEqual([["A", "B", "C"], ["D"]]);
    expect(getSupportingDeclarations(graph, "A")).toEqual(["C", "B"]);

    const canonical = renderDependencyGraphCanonical(graph);
    expect(canonical).toContain("cyclic_scc[0]=A,B,C");
    expect(canonical).toContain("cyclic_scc[1]=D");
  });

  test("maps theorem leaves into dependency graph", () => {
    const leaves = mapIngestedDeclarationsToLeaves([
      {
        declarationId: "decl_main",
        modulePath: "Verity/Main",
        declarationName: "main",
        theoremKind: "theorem",
        statementText: "main",
        dependencyIds: ["decl_helper"],
        sourceSpan: { filePath: "Verity/Main.lean", startLine: 1, startColumn: 1, endLine: 1, endColumn: 6 },
      },
      {
        declarationId: "decl_helper",
        modulePath: "Verity/Helper",
        declarationName: "helper",
        theoremKind: "lemma",
        statementText: "helper",
        sourceSpan: { filePath: "Verity/Helper.lean", startLine: 2, startColumn: 1, endLine: 2, endColumn: 8 },
      },
    ]);

    const graph = buildDependencyGraphFromTheoremLeaves(leaves);
    expect(graph.nodeIds).toEqual(["decl_helper", "decl_main"]);
    expect(getSupportingDeclarations(graph, "decl_main")).toEqual(["decl_helper"]);
  });

  test("rejects duplicate IDs and unknown query IDs", () => {
    expect(() =>
      buildDeclarationDependencyGraph([
        { id: "dup", dependencyIds: [] },
        { id: "dup", dependencyIds: [] },
      ]),
    ).toThrow("Duplicate declaration id");

    const graph = buildDeclarationDependencyGraph([{ id: "known", dependencyIds: [] }]);
    expect(() => getDirectDependencies(graph, "unknown")).toThrow("not present in dependency graph");
    expect(() => getSupportingDeclarations(graph, "unknown")).toThrow("not present in dependency graph");
  });
});
