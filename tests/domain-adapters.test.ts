import { describe, expect, test } from "vitest";
import {
  classifyDeclarationDomain,
  computeDomainTaggingReportHash,
  evaluateDomainTagging,
  GENERIC_LEAN_ADAPTER_ID,
  renderDomainTaggingReport,
  VERITY_ADAPTER_ID,
} from "../src/domain-adapters.js";

describe("domain adapters", () => {
  test("classifies Verity-like declarations with domain-specific tags", () => {
    const result = classifyDeclarationDomain({
      declarationId: "lean:Verity/Compiler:loop_correct:10:1",
      modulePath: "Verity/Compiler",
      declarationName: "loop_correct",
      theoremKind: "theorem",
      statementText: "if loop invariant holds then compiler preserves memory state",
    });

    expect(result.adapterId).toBe(VERITY_ADAPTER_ID);
    expect(result.tags).toEqual(
      expect.arrayContaining([
        "domain:verity/edsl",
        "concept:loop",
        "concept:conditional",
        "concept:memory",
        "concept:state",
        "concept:compiler_correctness",
      ]),
    );
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
  });

  test("uses generic adapter for non-Verity Lean declarations", () => {
    const result = classifyDeclarationDomain({
      declarationId: "lean:Math/Core:simple:3:1",
      modulePath: "Math/Core",
      declarationName: "simple",
      theoremKind: "theorem",
      statementText: "forall n, n = n",
    });

    expect(result.adapterId).toBe(GENERIC_LEAN_ADAPTER_ID);
    expect(result.tags).toEqual(["domain:lean/general", "kind:theorem"]);
  });

  test("supports low-confidence downgrade and manual tag override", () => {
    const result = classifyDeclarationDomain(
      {
        declarationId: "lean:Verity/Unknown:misc:1:1",
        modulePath: "Verity/Unknown",
        declarationName: "misc",
        theoremKind: "lemma",
        statementText: "trivial statement",
      },
      {
        lowConfidenceThreshold: 0.7,
        override: {
          addTags: ["concept:state"],
          removeTags: ["kind:lemma"],
        },
      },
    );

    expect(result.adapterId).toBe(GENERIC_LEAN_ADAPTER_ID);
    expect(result.downgradedFromAdapterId).toBe(VERITY_ADAPTER_ID);
    expect(result.tags).toContain("concept:state");
    expect(result.tags).not.toContain("kind:lemma");
    expect(result.warnings.map((warning) => warning.code)).toEqual(
      expect.arrayContaining(["low_confidence_downgrade", "manual_override_applied"]),
    );
  });

  test("reports deterministic precision/recall metrics for sampled tags", () => {
    const report = evaluateDomainTagging([
      {
        sampleId: "s1",
        expectedTags: ["domain:verity/edsl", "concept:loop", "concept:memory"],
        predictedTags: ["domain:verity/edsl", "concept:loop"],
      },
      {
        sampleId: "s2",
        expectedTags: ["domain:lean/general", "kind:theorem"],
        predictedTags: ["domain:lean/general", "kind:theorem", "concept:state"],
      },
    ]);

    expect(report.sampleCount).toBe(2);
    expect(report.macroPrecision).toBeGreaterThan(0);
    expect(report.macroRecall).toBeGreaterThan(0);
    expect(report.perTag.find((row) => row.tag === "concept:memory")?.recall).toBe(0);
    const rendered = renderDomainTaggingReport(report);
    expect(rendered).toContain("macro_precision=");
    const hash = computeDomainTaggingReportHash(report);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });
});
