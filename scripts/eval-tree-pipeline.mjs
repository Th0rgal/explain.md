import path from "node:path";
import process from "node:process";
import {
  buildRecursiveExplanationTree,
  ingestLeanProject,
  mapLeanIngestionToTheoremLeaves,
  mapTheoremLeavesToTreeLeaves,
  normalizeConfig,
  validateExplanationTree,
} from "../dist/index.js";

function parseArgs(argv) {
  const args = argv.slice(2);
  const cwd = process.cwd();

  let projectRoot = cwd;
  const includePaths = [];
  for (const arg of args) {
    if (arg.startsWith("--include=")) {
      includePaths.push(arg.slice("--include=".length));
      continue;
    }
    if (!arg.startsWith("--")) {
      projectRoot = path.resolve(cwd, arg);
    }
  }

  return { projectRoot, includePaths };
}

function extractChildren(prompt) {
  const lines = prompt.split("\n");
  const children = [];
  for (const line of lines) {
    const match = line.match(/^- id=([^\s]+)(?:\s+complexity=\d+)?\s+statement=(.+)$/);
    if (!match) {
      continue;
    }

    try {
      children.push({ id: match[1], statement: JSON.parse(match[2]) });
    } catch {
      children.push({ id: match[1], statement: match[2] });
    }
  }

  children.sort((left, right) => left.id.localeCompare(right.id));
  return children;
}

function deterministicSummaryProvider() {
  return {
    generate: async (request) => {
      const children = extractChildren(request.messages?.[1]?.content ?? "");
      const evidenceRefs = children.map((child) => child.id);
      const statement = children.map((child) => `(${child.statement})`).join(" and ");

      return {
        text: JSON.stringify({
          parent_statement: statement,
          why_true_from_children: statement,
          new_terms_introduced: [],
          complexity_score: 3,
          abstraction_score: 3,
          evidence_refs: evidenceRefs,
          confidence: 0.99,
        }),
        model: "mock-deterministic",
        finishReason: "stop",
        raw: {},
      };
    },
    stream: async function* () {
      return;
    },
  };
}

async function main() {
  const { projectRoot, includePaths } = parseArgs(process.argv);
  const ingestion = await ingestLeanProject(projectRoot, {
    includePaths: includePaths.length > 0 ? includePaths : undefined,
  });

  const leaves = mapTheoremLeavesToTreeLeaves(mapLeanIngestionToTheoremLeaves(ingestion));
  const config = normalizeConfig({
    maxChildrenPerParent: 5,
    complexityLevel: 3,
    complexityBandWidth: 2,
    termIntroductionBudget: 0,
  });

  const started = Date.now();
  const tree = await buildRecursiveExplanationTree(deterministicSummaryProvider(), {
    leaves,
    config,
  });
  const elapsedMs = Date.now() - started;
  const validation = validateExplanationTree(tree, config.maxChildrenPerParent);
  const parentCount = Object.values(tree.nodes).filter((node) => node.kind === "parent").length;

  const result = {
    projectRoot,
    includePaths,
    ingestionRecords: ingestion.records.length,
    ingestionWarnings: ingestion.warnings.length,
    leafCount: leaves.length,
    nodeCount: Object.keys(tree.nodes).length,
    parentCount,
    maxDepth: tree.maxDepth,
    groupingLayers: tree.groupingDiagnostics.length,
    policyParentCount: Object.keys(tree.policyDiagnosticsByParent).length,
    rootId: tree.rootId,
    treeValidationOk: validation.ok,
    treeValidationIssueCount: validation.issues.length,
    elapsedMs,
  };

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`eval-tree-pipeline failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
