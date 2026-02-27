import { describe, expect, test } from "vitest";
import { normalizeConfig } from "../src/config-contract.js";
import { evaluatePostSummaryPolicy, evaluatePreSummaryPolicy } from "../src/pedagogical-policy.js";
import type { ParentSummary } from "../src/summary-pipeline.js";

describe("pedagogical policy engine", () => {
  test("passes pre-summary checks for bounded complexity spread and ordered prerequisites", () => {
    const config = normalizeConfig({ complexityBandWidth: 1, complexityLevel: 3 });
    const decision = evaluatePreSummaryPolicy(
      [
        { id: "a", statement: "A", complexity: 2 },
        { id: "b", statement: "B", complexity: 3, prerequisiteIds: ["a"] },
      ],
      config,
    );
    expect(decision.ok).toBe(true);
  });

  test("flags pre-summary prerequisite order violations", () => {
    const config = normalizeConfig({});
    const decision = evaluatePreSummaryPolicy(
      [
        { id: "a", statement: "A", prerequisiteIds: ["b"] },
        { id: "b", statement: "B" },
      ],
      config,
    );
    expect(decision.ok).toBe(false);
    expect(decision.violations.map((violation) => violation.code)).toContain("prerequisite_order");
  });

  test("uses provided child order for prerequisite checks instead of lexical id order", () => {
    const config = normalizeConfig({});
    const decision = evaluatePreSummaryPolicy(
      [
        { id: "z", statement: "Z prerequisite." },
        { id: "a", statement: "A depends on Z.", prerequisiteIds: ["z"] },
      ],
      config,
    );

    expect(decision.ok).toBe(true);
    expect(decision.metrics.prerequisiteOrderViolations).toBe(0);
  });

  test("flags in-group cyclic prerequisite edges during order validation", () => {
    const config = normalizeConfig({});
    const decision = evaluatePreSummaryPolicy(
      [
        { id: "a", statement: "A depends on B.", prerequisiteIds: ["b"] },
        { id: "b", statement: "B depends on A.", prerequisiteIds: ["a"] },
      ],
      config,
    );

    expect(decision.ok).toBe(false);
    expect(decision.metrics.prerequisiteOrderViolations).toBeGreaterThan(0);
    expect(decision.violations.map((violation) => violation.code)).toContain("prerequisite_order");
  });

  test("flags post-summary evidence coverage and vocabulary continuity drift", () => {
    const config = normalizeConfig({ audienceLevel: "novice", termIntroductionBudget: 0 });
    const summary: ParentSummary = {
      parent_statement: "Quantum lattice harmonics optimize entropy gradients.",
      why_true_from_children: "This follows abstractly.",
      new_terms_introduced: [],
      complexity_score: 3,
      abstraction_score: 3,
      evidence_refs: ["a"],
      confidence: 0.8,
    };
    const decision = evaluatePostSummaryPolicy(
      [
        { id: "a", statement: "Storage bounds are preserved by initialization and transitions." },
        { id: "b", statement: "Every transition keeps storage bounds unchanged." },
      ],
      summary,
      config,
    );

    expect(decision.ok).toBe(false);
    expect(decision.violations.map((violation) => violation.code)).toContain("evidence_coverage");
    expect(decision.violations.map((violation) => violation.code)).toContain("vocabulary_continuity");
  });

  test("strict entailment mode raises vocabulary continuity floor to 1", () => {
    const config = normalizeConfig({ entailmentMode: "strict" });
    const summary: ParentSummary = {
      parent_statement: "Storage bounds preserve safety.",
      why_true_from_children: "Derived from c1.",
      new_terms_introduced: [],
      complexity_score: 3,
      abstraction_score: 3,
      evidence_refs: ["c1"],
      confidence: 0.8,
    };

    const decision = evaluatePostSummaryPolicy(
      [{ id: "c1", statement: "Storage bounds are preserved." }],
      summary,
      config,
    );
    expect(decision.metrics.vocabularyContinuityFloor).toBe(1);
    expect(decision.ok).toBe(false);
    expect(decision.violations.map((violation) => violation.code)).toContain("vocabulary_continuity");
  });
});
