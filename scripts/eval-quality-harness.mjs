import path from "node:path";
import process from "node:process";
import {
  buildRecursiveExplanationTree,
  computeTreeQualityReportHash,
  evaluateExplanationTreeQuality,
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
  const thresholdOverrides = {};

  for (const arg of args) {
    if (arg.startsWith("--include=")) {
      includePaths.push(arg.slice("--include=".length));
      continue;
    }
    if (arg.startsWith("--max-unsupported-parent-rate=")) {
      thresholdOverrides.maxUnsupportedParentRate = Number.parseFloat(arg.slice("--max-unsupported-parent-rate=".length));
      continue;
    }
    if (arg.startsWith("--max-prerequisite-violation-rate=")) {
      thresholdOverrides.maxPrerequisiteViolationRate = Number.parseFloat(
        arg.slice("--max-prerequisite-violation-rate=".length),
      );
      continue;
    }
    if (arg.startsWith("--max-policy-violation-rate=")) {
      thresholdOverrides.maxPolicyViolationRate = Number.parseFloat(arg.slice("--max-policy-violation-rate=".length));
      continue;
    }
    if (arg.startsWith("--max-term-jump-rate=")) {
      thresholdOverrides.maxTermJumpRate = Number.parseFloat(arg.slice("--max-term-jump-rate=".length));
      continue;
    }
    if (arg.startsWith("--max-complexity-spread-mean=")) {
      thresholdOverrides.maxComplexitySpreadMean = Number.parseFloat(arg.slice("--max-complexity-spread-mean=".length));
      continue;
    }
    if (arg.startsWith("--min-evidence-coverage-mean=")) {
      thresholdOverrides.minEvidenceCoverageMean = Number.parseFloat(arg.slice("--min-evidence-coverage-mean=".length));
      continue;
    }
    if (arg.startsWith("--min-vocabulary-continuity-mean=")) {
      thresholdOverrides.minVocabularyContinuityMean = Number.parseFloat(arg.slice("--min-vocabulary-continuity-mean=".length));
      continue;
    }
    if (arg.startsWith("--max-repartition-event-rate=")) {
      thresholdOverrides.maxRepartitionEventRate = Number.parseFloat(arg.slice("--max-repartition-event-rate=".length));
      continue;
    }
    if (arg.startsWith("--max-repartition-max-round=")) {
      thresholdOverrides.maxRepartitionMaxRound = Number.parseFloat(arg.slice("--max-repartition-max-round=".length));
      continue;
    }
    if (!arg.startsWith("--")) {
      projectRoot = path.resolve(cwd, arg);
    }
  }

  return { projectRoot, includePaths, thresholdOverrides };
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
  const { projectRoot, includePaths, thresholdOverrides } = parseArgs(process.argv);
  const ingestion = await ingestLeanProject(projectRoot, {
    includePaths: includePaths.length > 0 ? includePaths : undefined,
  });

  const leaves = mapTheoremLeavesToTreeLeaves(mapLeanIngestionToTheoremLeaves(ingestion));
  const config = normalizeConfig({
    maxChildrenPerParent: 5,
    complexityLevel: 3,
    complexityBandWidth: 2,
    termIntroductionBudget: 0,
    proofDetailMode: "formal",
  });

  const started = Date.now();
  const tree = await buildRecursiveExplanationTree(deterministicSummaryProvider(), {
    leaves,
    config,
  });
  const elapsedMs = Date.now() - started;

  const validation = validateExplanationTree(tree, config.maxChildrenPerParent);
  const report = evaluateExplanationTreeQuality(tree, config, { thresholds: thresholdOverrides });

  const result = {
    projectRoot,
    includePaths,
    ingestionRecords: ingestion.records.length,
    ingestionWarnings: ingestion.warnings.length,
    leafCount: leaves.length,
    nodeCount: Object.keys(tree.nodes).length,
    parentCount: report.metrics.parentCount,
    maxDepth: tree.maxDepth,
    treeValidationOk: validation.ok,
    treeValidationIssueCount: validation.issues.length,
    thresholdPass: report.thresholdPass,
    thresholdFailureCount: report.thresholdFailures.length,
    qualityReportHash: computeTreeQualityReportHash(report),
    metrics: report.metrics,
    repartitionMetrics: report.repartitionMetrics,
    thresholds: report.thresholds,
    elapsedMs,
  };

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!report.thresholdPass || !validation.ok) {
    process.exitCode = 2;
  }
}

main().catch((error) => {
  process.stderr.write(`eval-quality-harness failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
