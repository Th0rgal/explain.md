import type { ExplanationConfig } from "./config-contract.js";
import type { ChatMessage, ProviderClient } from "./openai-provider.js";
import { stemToken, tokenizeNormalized } from "./text-normalization.js";

export interface ChildNodeInput {
  id: string;
  statement: string;
  complexity?: number;
}

export interface ParentSummary {
  parent_statement: string;
  why_true_from_children: string;
  new_terms_introduced: string[];
  complexity_score: number;
  abstraction_score: number;
  evidence_refs: string[];
  confidence: number;
}

export interface CriticViolation {
  code: "schema" | "evidence_refs" | "complexity_band" | "term_budget" | "unsupported_terms";
  message: string;
  details?: Record<string, unknown>;
}

export interface SummaryDiagnostics {
  ok: boolean;
  violations: CriticViolation[];
}

export interface SummaryPipelineRequest {
  children: ChildNodeInput[];
  config: ExplanationConfig;
  systemPrompt?: string;
}

export interface SummaryPipelineResult {
  summary: ParentSummary;
  diagnostics: SummaryDiagnostics;
  rawText: string;
  raw: unknown;
}

export class SummaryValidationError extends Error {
  public readonly diagnostics: SummaryDiagnostics;
  public readonly rawText: string;

  public constructor(message: string, diagnostics: SummaryDiagnostics, rawText: string) {
    super(message);
    this.name = "SummaryValidationError";
    this.diagnostics = diagnostics;
    this.rawText = rawText;
  }
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
]);

const MIN_PARENT_TOKEN_COVERAGE = 0.45;
const MIN_PARENT_TOKENS_FOR_COVERAGE_CHECK = 4;

export async function generateParentSummary(
  provider: ProviderClient,
  request: SummaryPipelineRequest,
): Promise<SummaryPipelineResult> {
  const normalizedChildren = normalizeChildren(request.children);
  const messages = buildSummaryPromptMessages(normalizedChildren, request.config, request.systemPrompt);

  const generated = await provider.generate({
    messages,
    temperature: 0,
    maxOutputTokens: request.config.modelProvider.maxOutputTokens,
  });

  const parsed = parseSummaryJson(generated.text);
  const diagnostics = validateParentSummary(parsed, normalizedChildren, request.config);

  if (!diagnostics.ok) {
    throw new SummaryValidationError("Generated parent summary failed critic validation.", diagnostics, generated.text);
  }

  return {
    summary: parsed,
    diagnostics,
    rawText: generated.text,
    raw: generated.raw,
  };
}

export function buildSummaryPromptMessages(
  children: ChildNodeInput[],
  config: ExplanationConfig,
  systemPrompt?: string,
): ChatMessage[] {
  const childLines = children
    .map((child) => {
      const complexityTag = typeof child.complexity === "number" ? ` complexity=${child.complexity}` : "";
      return `- id=${child.id}${complexityTag} statement=${JSON.stringify(child.statement)}`;
    })
    .join("\n");

  const systemContent =
    systemPrompt ??
    "You are a proof-grounded summarizer. Output strict JSON only. Never cite evidence outside provided child IDs.";

  const userContent = [
    "Synthesize one parent explanation from child statements.",
    "Return exactly one JSON object with this schema:",
    '{"parent_statement":string,"why_true_from_children":string,"new_terms_introduced":string[],"complexity_score":number,"abstraction_score":number,"evidence_refs":string[],"confidence":number}',
    "Constraints:",
    `- language=${config.language}`,
    `- target_complexity=${config.complexityLevel}`,
    `- complexity_band_width=${config.complexityBandWidth}`,
    `- target_abstraction=${config.abstractionLevel}`,
    `- audience_level=${config.audienceLevel}`,
    `- reading_level_target=${config.readingLevelTarget}`,
    `- proof_detail_mode=${config.proofDetailMode}`,
    `- term_introduction_budget=${config.termIntroductionBudget}`,
    "- evidence_refs must only contain provided child IDs.",
    "Children:",
    childLines,
  ].join("\n");

  return [
    { role: "system", content: systemContent },
    { role: "user", content: userContent },
  ];
}

export function validateParentSummary(
  summary: ParentSummary,
  children: ChildNodeInput[],
  config: ExplanationConfig,
): SummaryDiagnostics {
  const violations: CriticViolation[] = [];
  const hasValidNewTerms = Array.isArray(summary.new_terms_introduced) && summary.new_terms_introduced.every((term) => typeof term === "string");
  const hasValidEvidenceRefs = Array.isArray(summary.evidence_refs) && summary.evidence_refs.every((ref) => typeof ref === "string");
  const newTermsIntroduced = hasValidNewTerms ? summary.new_terms_introduced : [];
  const evidenceRefs = hasValidEvidenceRefs ? summary.evidence_refs : [];

  if (!summary.parent_statement || !summary.why_true_from_children) {
    violations.push({
      code: "schema",
      message: "parent_statement and why_true_from_children are required non-empty strings.",
    });
  }

  if (!Number.isFinite(summary.complexity_score) || summary.complexity_score < 1 || summary.complexity_score > 5) {
    violations.push({
      code: "schema",
      message: "complexity_score must be a number in [1, 5].",
    });
  }

  if (!Number.isFinite(summary.abstraction_score) || summary.abstraction_score < 1 || summary.abstraction_score > 5) {
    violations.push({
      code: "schema",
      message: "abstraction_score must be a number in [1, 5].",
    });
  }

  if (!Number.isFinite(summary.confidence) || summary.confidence < 0 || summary.confidence > 1) {
    violations.push({
      code: "schema",
      message: "confidence must be a number in [0, 1].",
    });
  }

  if (!hasValidNewTerms) {
    violations.push({
      code: "schema",
      message: "new_terms_introduced must be an array of strings.",
    });
  }

  if (!hasValidEvidenceRefs) {
    violations.push({
      code: "schema",
      message: "evidence_refs must be an array of strings.",
    });
  }

  const childIds = new Set(children.map((child) => child.id));
  const invalidRefs = evidenceRefs.filter((ref) => !childIds.has(ref));
  if (invalidRefs.length > 0 || evidenceRefs.length === 0) {
    violations.push({
      code: "evidence_refs",
      message: "evidence_refs must be non-empty and only include provided child IDs.",
      details: { invalidRefs },
    });
  }

  if (newTermsIntroduced.length > config.termIntroductionBudget) {
    violations.push({
      code: "term_budget",
      message: "new_terms_introduced exceeded configured term introduction budget.",
      details: {
        introduced: newTermsIntroduced.length,
        budget: config.termIntroductionBudget,
      },
    });
  }

  const minComplexity = Math.max(1, config.complexityLevel - config.complexityBandWidth);
  const maxComplexity = Math.min(5, config.complexityLevel + config.complexityBandWidth);
  if (summary.complexity_score < minComplexity || summary.complexity_score > maxComplexity) {
    violations.push({
      code: "complexity_band",
      message: "complexity_score is outside configured complexity band.",
      details: { target: config.complexityLevel, band: config.complexityBandWidth, value: summary.complexity_score },
    });
  }

  const coverage = computeParentTokenCoverage(summary.parent_statement, children, newTermsIntroduced);
  if (coverage.total >= MIN_PARENT_TOKENS_FOR_COVERAGE_CHECK && coverage.ratio < MIN_PARENT_TOKEN_COVERAGE) {
    violations.push({
      code: "unsupported_terms",
      message: "parent_statement has low evidence-term coverage and may introduce unsupported claims.",
      details: {
        coverageRatio: coverage.ratio,
        minimumRequired: MIN_PARENT_TOKEN_COVERAGE,
        unsupported: coverage.unsupported,
      },
    });
  }

  return {
    ok: violations.length === 0,
    violations,
  };
}

function normalizeChildren(children: ChildNodeInput[]): ChildNodeInput[] {
  if (!Array.isArray(children) || children.length === 0) {
    throw new Error("children must contain at least one node.");
  }

  const normalized = children.map((child) => {
    const id = child.id.trim();
    const statement = child.statement.trim();
    if (!id || !statement) {
      throw new Error("Each child requires non-empty id and statement.");
    }
    return {
      id,
      statement,
      complexity: child.complexity,
    };
  });

  const seen = new Set<string>();
  for (const child of normalized) {
    if (seen.has(child.id)) {
      throw new Error(`Duplicate child id: ${child.id}`);
    }
    seen.add(child.id);
  }

  return normalized.sort((a, b) => a.id.localeCompare(b.id));
}

function parseSummaryJson(rawText: string): ParentSummary {
  const candidate = extractFirstJsonObject(rawText);

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    throw new SummaryValidationError(
      "Failed to parse model output as JSON object.",
      {
        ok: false,
        violations: [{ code: "schema", message: "Output was not valid JSON." }],
      },
      rawText,
    );
  }

  if (!parsed || typeof parsed !== "object") {
    throw new SummaryValidationError(
      "Parsed output must be an object.",
      {
        ok: false,
        violations: [{ code: "schema", message: "Output JSON root must be an object." }],
      },
      rawText,
    );
  }

  const candidateSummary = parsed as Partial<ParentSummary>;
  return {
    parent_statement: String(candidateSummary.parent_statement ?? "").trim(),
    why_true_from_children: String(candidateSummary.why_true_from_children ?? "").trim(),
    new_terms_introduced: Array.isArray(candidateSummary.new_terms_introduced)
      ? candidateSummary.new_terms_introduced.map((value) => String(value).trim()).filter((value) => value.length > 0)
      : [],
    complexity_score: Number(candidateSummary.complexity_score),
    abstraction_score: Number(candidateSummary.abstraction_score),
    evidence_refs: Array.isArray(candidateSummary.evidence_refs)
      ? candidateSummary.evidence_refs.map((value) => String(value).trim()).filter((value) => value.length > 0)
      : [],
    confidence: Number(candidateSummary.confidence),
  };
}

function extractFirstJsonObject(rawText: string): string {
  const trimmed = rawText.trim();
  const codeFenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (codeFenceMatch) {
    return codeFenceMatch[1].trim();
  }

  const firstBrace = trimmed.indexOf("{");
  if (firstBrace === -1) {
    return trimmed;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = firstBrace; index < trimmed.length; index += 1) {
    const char = trimmed[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === "{") {
      depth += 1;
    }

    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return trimmed.slice(firstBrace, index + 1);
      }
    }
  }

  return trimmed;
}

function computeParentTokenCoverage(
  statement: string,
  children: ChildNodeInput[],
  introducedTerms: string[],
): { ratio: number; total: number; unsupported: string[] } {
  const childTokens = new Set(
    children
      .flatMap((child) => tokenizeNormalized(child.statement).map(stemToken))
      .filter((token) => token.length >= 4 && !STOP_WORDS.has(token)),
  );
  const introduced = new Set(introducedTerms.flatMap((term) => tokenizeNormalized(term).map(stemToken)));

  const significantTokens = tokenizeNormalized(statement)
    .map(stemToken)
    .filter((token) => token.length >= 5 && !STOP_WORDS.has(token));
  const unsupported = new Set<string>();
  let covered = 0;
  for (const token of significantTokens) {
    if (childTokens.has(token) || introduced.has(token)) {
      covered += 1;
      continue;
    }
    unsupported.add(token);
  }

  const ratio = significantTokens.length === 0 ? 1 : covered / significantTokens.length;
  return { ratio, total: significantTokens.length, unsupported: [...unsupported].sort() };
}
