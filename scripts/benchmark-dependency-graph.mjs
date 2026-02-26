import { performance } from "node:perf_hooks";
import {
  buildDeclarationDependencyGraph,
  getSupportingDeclarations,
} from "../dist/index.js";

function buildSyntheticDeclarations(count) {
  const declarations = [];
  for (let index = 0; index < count; index += 1) {
    const id = `decl_${index.toString().padStart(5, "0")}`;
    const dependencyIds = [];

    if (index >= 1) {
      dependencyIds.push(`decl_${(index - 1).toString().padStart(5, "0")}`);
    }
    if (index >= 5 && index % 3 === 0) {
      dependencyIds.push(`decl_${(index - 5).toString().padStart(5, "0")}`);
    }

    declarations.push({ id, dependencyIds });
  }
  return declarations;
}

const size = Number.parseInt(process.env.EXPLAIN_MD_DEP_GRAPH_BENCH_SIZE ?? "5000", 10);
if (!Number.isInteger(size) || size < 100) {
  throw new Error("EXPLAIN_MD_DEP_GRAPH_BENCH_SIZE must be an integer >= 100.");
}

const declarations = buildSyntheticDeclarations(size);

const buildStart = performance.now();
const graph = buildDeclarationDependencyGraph(declarations);
const buildMs = performance.now() - buildStart;

const queryId = declarations[declarations.length - 1].id;
const queryStart = performance.now();
const closure = getSupportingDeclarations(graph, queryId, { includeExternal: false });
const queryMs = performance.now() - queryStart;

const summary = {
  size,
  queryId,
  nodes: graph.nodeIds.length,
  edges: graph.edgeCount,
  cyclicSccs: graph.cyclicSccs.length,
  closureSize: closure.length,
  buildMs: Number(buildMs.toFixed(3)),
  queryMs: Number(queryMs.toFixed(3)),
};

console.log(JSON.stringify(summary, null, 2));
