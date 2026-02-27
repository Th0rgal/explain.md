# Lean Declaration Dependency Graph

Issue: #4

This module adds a deterministic, provenance-first dependency graph for Lean declaration leaves.

## Goals covered
- Graph model over indexed declarations and optional external references.
- Reachability query for support closure ("what supports theorem X?").
- Cycle handling via deterministic SCC detection.
- Reproducible benchmark command for build/query performance.

## Public API
- `buildDeclarationDependencyGraph(declarations, options?)`
- `buildDependencyGraphFromTheoremLeaves(leaves, options?)`
- `getDirectDependencies(graph, declarationId)`
- `getDirectDependents(graph, declarationId)`
- `getSupportingDeclarations(graph, declarationId, options?)`
- `renderDependencyGraphCanonical(graph)`
- `computeDependencyGraphHash(graph)`

## Determinism and auditability
- IDs and edge lists are normalized and lexicographically sorted.
- Duplicate declaration IDs are rejected.
- Unknown dependencies are captured in `missingDependencyRefs`.
- SCC output is stable (`sccs` and `cyclicSccs` sorted canonically).
- Canonical renderer + SHA-256 hash support snapshot/regression checks.

## Query semantics
- Edge direction is `declaration -> dependency`.
- `getSupportingDeclarations` returns transitive prerequisites in deterministic post-order.
- Cycles are tolerated; queries terminate with visitation-state guards.

## Web API projection
The Next.js web app exposes deterministic graph reads through:

- `GET /api/proofs/dependency-graph`

Supported query parameters:

- `proofId` (required)
- standard config knobs (`abstractionLevel`, `complexityLevel`, `maxChildrenPerParent`, `audienceLevel`, `language`, `termIntroductionBudget`) for hash-stable request context
- `declarationId` (optional): include direct deps/dependents/support closure + SCC membership for one declaration
- `includeExternalSupport` (optional boolean, default `true`): include/exclude `external` nodes from support closure

Response includes:

- `dependencyGraphHash`: canonical graph hash
- graph totals (`nodeCount`, `edgeCount`, `indexedNodeCount`, `externalNodeCount`)
- SCC counts + `cyclicSccs`
- optional per-declaration query block
- machine-checkable diagnostics (for example `declaration_not_found`)

## External dependencies
- By default (`includeExternalNodes=true`), unknown dependency IDs are represented as `external` nodes.
- If disabled, missing dependencies are still recorded in diagnostics but omitted from graph nodes/edges.

## Benchmark
Run:

```bash
npm run bench:dependency-graph
```

Optional size override:

```bash
EXPLAIN_MD_DEP_GRAPH_BENCH_SIZE=20000 npm run bench:dependency-graph
```

Output is JSON with deterministic fields and environment-specific timing values:

```json
{
  "size": 5000,
  "queryId": "decl_04999",
  "nodes": 5000,
  "edges": 6664,
  "cyclicSccs": 0,
  "closureSize": 4999,
  "buildMs": 12.345,
  "queryMs": 3.21
}
```
