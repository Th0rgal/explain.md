import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildRecursiveExplanationTree,
  computeTreeQualityReportHash,
  evaluateExplanationTreeQuality,
  ingestLeanProject,
  mapLeanIngestionToTheoremLeaves,
  mapTheoremLeavesToTreeLeaves,
  normalizeConfig,
  resolveQualityBenchmarkPreset,
  type ProviderClient,
} from "../src/index.js";

function extractChildren(prompt: string): Array<{ id: string; statement: string }> {
  const lines = prompt.split("\n");
  const children: Array<{ id: string; statement: string }> = [];

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

  return children.sort((left, right) => left.id.localeCompare(right.id));
}

function deterministicSummaryProvider(): ProviderClient {
  return {
    generate: async (request) => {
      const children = extractChildren(request.messages?.[1]?.content ?? "");
      const statement = children.map((child) => `(${child.statement})`).join(" and ");
      return {
        text: JSON.stringify({
          parent_statement: statement,
          why_true_from_children: statement,
          new_terms_introduced: [],
          complexity_score: 3,
          abstraction_score: 3,
          evidence_refs: children.map((child) => child.id),
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

describe("quality verity token snapshot strict preset", () => {
  it("enforces strict entailment floor deterministically on the frozen SimpleToken snapshot corpus", async () => {
    const preset = resolveQualityBenchmarkPreset("fixture-verity-token-snapshot-strict");
    expect(preset).toBeDefined();

    const ingestion = await ingestLeanProject(path.resolve(preset?.projectRoot ?? ""), {
      includePaths: preset?.includePaths,
    });
    const leaves = mapTheoremLeavesToTreeLeaves(mapLeanIngestionToTheoremLeaves(ingestion));
    const config = normalizeConfig({
      maxChildrenPerParent: 5,
      complexityLevel: 3,
      complexityBandWidth: 2,
      termIntroductionBudget: 0,
      proofDetailMode: "formal",
      ...(preset?.configOverrides ?? {}),
    });

    const tree = await buildRecursiveExplanationTree(deterministicSummaryProvider(), { leaves, config });
    const report = evaluateExplanationTreeQuality(tree, config, {
      thresholds: preset?.thresholdOverrides ?? {},
    });
    const secondReport = evaluateExplanationTreeQuality(tree, config, {
      thresholds: preset?.thresholdOverrides ?? {},
    });

    expect(config.entailmentMode).toBe("strict");
    expect(report.metrics.supportCoverageFloor).toBe(1);
    expect(report.metrics.unsupportedParentRate).toBeGreaterThan(0);
    expect(report.thresholdPass).toBe(true);
    expect(computeTreeQualityReportHash(report)).toBe(computeTreeQualityReportHash(secondReport));
  });
});
