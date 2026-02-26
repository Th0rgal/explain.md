import type { ExplanationConfig } from "./config-contract.js";
import type { ChildNodeInput, ParentSummary } from "./summary-pipeline.js";

export type PolicyViolationCode =
  | "sibling_complexity_spread"
  | "prerequisite_order"
  | "term_budget"
  | "evidence_coverage"
  | "vocabulary_continuity";

export interface PolicyViolation {
  code: PolicyViolationCode;
  message: string;
  details?: Record<string, unknown>;
}

export interface PolicyMetrics {
  complexitySpread: number;
  prerequisiteOrderViolations: number;
  introducedTermCount: number;
  evidenceCoverageRatio: number;
  vocabularyContinuityRatio: number;
  vocabularyContinuityFloor: number;
}

export interface PolicyDecision {
  ok: boolean;
  violations: PolicyViolation[];
  metrics: PolicyMetrics;
}

export interface ParentPolicyDiagnostics {
  depth: number;
  groupIndex: number;
  retriesUsed: number;
  preSummary: PolicyDecision;
  postSummary: PolicyDecision;
}

const STOP_WORDS = new Set<string>([
  "about",
  "after",
  "again",
  "because",
  "before",
  "being",
  "between",
  "could",
  "every",
  "first",
  "from",
  "have",
  "into",
  "their",
  "there",
  "these",
  "those",
  "through",
  "under",
  "using",
  "where",
  "which",
  "while",
  "with",
  "without",
  "parent",
  "claim",
  "jointly",
  "entail",
]);

export function evaluatePreSummaryPolicy(children: ChildNodeInput[], config: ExplanationConfig): PolicyDecision {
  const ordered = children.slice().sort((a, b) => a.id.localeCompare(b.id));
  const complexities = ordered.map((child) =>
    typeof child.complexity === "number" && Number.isFinite(child.complexity) ? child.complexity : config.complexityLevel,
  );
  const minComplexity = Math.min(...complexities);
  const maxComplexity = Math.max(...complexities);
  const complexitySpread = maxComplexity - minComplexity;

  const idOrder = new Map(ordered.map((child, index) => [child.id, index]));
  let prerequisiteOrderViolations = 0;

  for (const child of ordered) {
    const childIndex = idOrder.get(child.id) ?? -1;
    const prerequisites = Array.isArray((child as { prerequisiteIds?: string[] }).prerequisiteIds)
      ? ((child as { prerequisiteIds?: string[] }).prerequisiteIds as string[])
      : [];
    for (const prerequisiteId of prerequisites) {
      const prerequisiteIndex = idOrder.get(prerequisiteId);
      if (prerequisiteIndex !== undefined && prerequisiteIndex > childIndex) {
        prerequisiteOrderViolations += 1;
      }
    }
  }

  const violations: PolicyViolation[] = [];
  if (complexitySpread > config.complexityBandWidth) {
    violations.push({
      code: "sibling_complexity_spread",
      message: "Sibling complexity spread exceeds configured complexityBandWidth.",
      details: {
        spread: complexitySpread,
        allowed: config.complexityBandWidth,
      },
    });
  }

  if (prerequisiteOrderViolations > 0) {
    violations.push({
      code: "prerequisite_order",
      message: "At least one child appears before an in-group prerequisite.",
      details: { prerequisiteOrderViolations },
    });
  }

  return {
    ok: violations.length === 0,
    violations,
    metrics: {
      complexitySpread,
      prerequisiteOrderViolations,
      introducedTermCount: 0,
      evidenceCoverageRatio: 1,
      vocabularyContinuityRatio: 1,
      vocabularyContinuityFloor: computeVocabularyContinuityFloor(config),
    },
  };
}

export function evaluatePostSummaryPolicy(
  children: ChildNodeInput[],
  summary: ParentSummary,
  config: ExplanationConfig,
): PolicyDecision {
  const violations: PolicyViolation[] = [];
  const childIds = children.map((child) => child.id).sort((a, b) => a.localeCompare(b));
  const evidenceIds = Array.from(new Set(summary.evidence_refs)).sort((a, b) => a.localeCompare(b));
  const missingEvidenceRefs = childIds.filter((childId) => !evidenceIds.includes(childId));
  const evidenceCoverageRatio = childIds.length === 0 ? 1 : (childIds.length - missingEvidenceRefs.length) / childIds.length;

  if (missingEvidenceRefs.length > 0) {
    violations.push({
      code: "evidence_coverage",
      message: "Parent summary evidence_refs must cover every child in the group.",
      details: {
        missingEvidenceRefs,
      },
    });
  }

  const introducedTermCount = summary.new_terms_introduced.length;
  if (introducedTermCount > config.termIntroductionBudget) {
    violations.push({
      code: "term_budget",
      message: "Parent summary exceeded configured term-introduction budget.",
      details: {
        introducedTermCount,
        budget: config.termIntroductionBudget,
      },
    });
  }

  const vocabularyContinuityFloor = computeVocabularyContinuityFloor(config);
  const vocabularyContinuityRatio = computeVocabularyContinuityRatio(children, summary);
  if (vocabularyContinuityRatio < vocabularyContinuityFloor) {
    violations.push({
      code: "vocabulary_continuity",
      message: "Parent wording introduces unsupported vocabulary drift beyond policy floor.",
      details: {
        ratio: vocabularyContinuityRatio,
        floor: vocabularyContinuityFloor,
      },
    });
  }

  return {
    ok: violations.length === 0,
    violations,
    metrics: {
      complexitySpread: 0,
      prerequisiteOrderViolations: 0,
      introducedTermCount,
      evidenceCoverageRatio,
      vocabularyContinuityRatio,
      vocabularyContinuityFloor,
    },
  };
}

function computeVocabularyContinuityFloor(config: ExplanationConfig): number {
  const baseByAudience: Record<ExplanationConfig["audienceLevel"], number> = {
    novice: 0.72,
    intermediate: 0.62,
    expert: 0.52,
  };
  const detailAdjustment: Record<ExplanationConfig["proofDetailMode"], number> = {
    minimal: -0.04,
    balanced: 0,
    formal: 0.04,
  };
  const floor = baseByAudience[config.audienceLevel] + detailAdjustment[config.proofDetailMode];
  return clamp(floor, 0.4, 0.86);
}

function computeVocabularyContinuityRatio(children: ChildNodeInput[], summary: ParentSummary): number {
  const childTokens = new Set(
    children
      .flatMap((child) => tokenize(child.statement).map(stemToken))
      .filter((token) => isLexicalToken(token) && token.length >= 4 && !STOP_WORDS.has(token)),
  );
  const introducedTokens = new Set(
    summary.new_terms_introduced
      .flatMap((term) => tokenize(term).map(stemToken))
      .filter((token) => isLexicalToken(token)),
  );
  const parentTokens = tokenize(`${summary.parent_statement} ${summary.why_true_from_children}`)
    .map(stemToken)
    .filter((token) => isLexicalToken(token) && token.length >= 5 && !STOP_WORDS.has(token));

  if (parentTokens.length === 0) {
    return 1;
  }

  let covered = 0;
  for (const token of parentTokens) {
    if (childTokens.has(token) || introducedTokens.has(token)) {
      covered += 1;
    }
  }
  return covered / parentTokens.length;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_]+/g)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function stemToken(token: string): string {
  if (token.endsWith("ies") && token.length > 5) {
    return `${token.slice(0, -3)}y`;
  }
  if (token.endsWith("ing") && token.length > 6) {
    return token.slice(0, -3);
  }
  if (token.endsWith("ed") && token.length > 5) {
    return token.slice(0, -2);
  }
  if (token.endsWith("es") && token.length > 5) {
    return token.slice(0, -2);
  }
  if (token.endsWith("s") && token.length > 4) {
    return token.slice(0, -1);
  }
  return token;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function isLexicalToken(token: string): boolean {
  return /^[a-z]+$/.test(token);
}
