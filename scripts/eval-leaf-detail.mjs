import path from "node:path";
import process from "node:process";
import {
  buildLeafDetailView,
  buildRecursiveExplanationTree,
  computeLeafDetailHash,
  ingestLeanProject,
  mapLeanIngestionToTheoremLeaves,
  mapTheoremLeavesToTreeLeaves,
  normalizeConfig,
} from "../dist/index.js";

function parseArgs(argv) {
  const args = argv.slice(2);
  const cwd = process.cwd();

  let projectRoot = cwd;
  let leafId;
  const includePaths = [];

  for (const arg of args) {
    if (arg.startsWith("--leaf=")) {
      leafId = arg.slice("--leaf=".length);
      continue;
    }
    if (arg.startsWith("--include=")) {
      includePaths.push(arg.slice("--include=".length));
      continue;
    }
    if (!arg.startsWith("--")) {
      projectRoot = path.resolve(cwd, arg);
    }
  }

  return { projectRoot, includePaths, leafId };
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
  const { projectRoot, includePaths, leafId } = parseArgs(process.argv);
  const ingestion = await ingestLeanProject(projectRoot, {
    includePaths: includePaths.length > 0 ? includePaths : undefined,
  });

  const theoremLeaves = mapLeanIngestionToTheoremLeaves(ingestion);
  const treeLeaves = mapTheoremLeavesToTreeLeaves(theoremLeaves);
  if (treeLeaves.length === 0) {
    throw new Error("No leaves found for evaluation.");
  }

  const config = normalizeConfig({
    maxChildrenPerParent: 5,
    complexityLevel: 3,
    complexityBandWidth: 2,
    termIntroductionBudget: 0,
  });

  const tree = await buildRecursiveExplanationTree(deterministicSummaryProvider(), {
    leaves: treeLeaves,
    config,
  });

  const targetLeafId = leafId ?? tree.leafIds[0];
  const detail = buildLeafDetailView(tree, theoremLeaves, targetLeafId);

  const result = {
    projectRoot,
    includePaths,
    targetLeafId,
    treeRootId: tree.rootId,
    treeNodeCount: Object.keys(tree.nodes).length,
    leafCount: theoremLeaves.length,
    detailOk: detail.ok,
    detailDiagnostics: detail.diagnostics,
    provenanceDepth: detail.view?.provenancePath.length ?? 0,
    hasSourceUrl: Boolean(detail.view?.leaf.sourceUrl),
    verificationJobsBound: detail.view?.verification.summary.totalJobs ?? 0,
    leafDetailHash: detail.view ? computeLeafDetailHash(detail.view) : undefined,
  };

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`eval-leaf-detail failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
