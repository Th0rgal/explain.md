import { createHash } from "node:crypto";
import type { TheoremKind } from "./leaf-schema.js";

export type DomainTag =
  | "domain:lean/general"
  | "domain:verity/edsl"
  | "concept:loop"
  | "concept:arithmetic"
  | "concept:conditional"
  | "concept:memory"
  | "concept:state"
  | "concept:compiler_correctness"
  | `kind:${TheoremKind}`
  | string;

export interface DomainClassificationInput {
  declarationId: string;
  modulePath: string;
  declarationName: string;
  theoremKind: TheoremKind;
  statementText: string;
  prettyStatement?: string;
}

export interface DomainAdapterDecision {
  tags: DomainTag[];
  confidence: number;
  evidence: string[];
}

export interface DomainAdapter {
  adapterId: string;
  classify: (input: DomainClassificationInput) => DomainAdapterDecision;
}

export interface DomainClassificationWarning {
  code: "low_confidence_downgrade" | "forced_adapter_missing" | "manual_override_applied";
  message: string;
  details?: Record<string, unknown>;
}

export interface DomainClassificationOverride {
  forceAdapterId?: string;
  addTags?: DomainTag[];
  removeTags?: DomainTag[];
  minConfidence?: number;
}

export interface DomainClassificationOptions {
  adapters?: DomainAdapter[];
  lowConfidenceThreshold?: number;
  fallbackAdapterId?: string;
  override?: DomainClassificationOverride;
}

export interface DomainClassificationResult {
  adapterId: string;
  confidence: number;
  downgradedFromAdapterId?: string;
  tags: DomainTag[];
  evidence: string[];
  warnings: DomainClassificationWarning[];
}

export interface DomainTaggingSample {
  sampleId: string;
  expectedTags: DomainTag[];
  predictedTags: DomainTag[];
}

export interface DomainTagMetrics {
  tag: DomainTag;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  precision: number;
  recall: number;
  f1: number;
}

export interface DomainTaggingReport {
  sampleCount: number;
  macroPrecision: number;
  macroRecall: number;
  macroF1: number;
  perTag: DomainTagMetrics[];
}

const VERITY_SIGNAL_PATTERNS: Array<{ pattern: RegExp; tag: DomainTag; evidence: string }> = [
  { pattern: /\b(loop|while|for|iterate|invariant)\b/i, tag: "concept:loop", evidence: "loop keyword" },
  { pattern: /\b(add|sub|mul|div|nat|int|arith|plus|minus|succ)\b/i, tag: "concept:arithmetic", evidence: "arithmetic keyword" },
  { pattern: /\b(if|then|else|branch|condition|cond)\b/i, tag: "concept:conditional", evidence: "conditional keyword" },
  { pattern: /\b(memory|heap|store|load|pointer|register|buffer)\b/i, tag: "concept:memory", evidence: "memory keyword" },
  { pattern: /\b(state|st|transition|invariant|preserve)\b/i, tag: "concept:state", evidence: "state keyword" },
  {
    pattern: /\b(compiler|compile|correct|correctness|equiv|equivalence|refine|simulation|preserves?)\b/i,
    tag: "concept:compiler_correctness",
    evidence: "compiler-correctness keyword",
  },
];

export const GENERIC_LEAN_ADAPTER_ID = "lean-generic";
export const VERITY_ADAPTER_ID = "verity-edsl";

export const genericLeanAdapter: DomainAdapter = {
  adapterId: GENERIC_LEAN_ADAPTER_ID,
  classify(input): DomainAdapterDecision {
    const tags: DomainTag[] = ["domain:lean/general", `kind:${input.theoremKind}`];
    const evidence = ["fallback generic Lean adapter"];
    return {
      tags,
      confidence: 0.55,
      evidence,
    };
  },
};

export const verityDomainAdapter: DomainAdapter = {
  adapterId: VERITY_ADAPTER_ID,
  classify(input): DomainAdapterDecision {
    const source = `${input.modulePath}\n${input.declarationName}\n${input.statementText}\n${input.prettyStatement ?? ""}`;
    const matches: DomainTag[] = [];
    const evidence: string[] = [];

    const moduleSignal = /(^|\/)Verity([/\.]|$)/.test(input.modulePath) || /\bverity\b/i.test(input.declarationName);
    if (moduleSignal) {
      matches.push("domain:verity/edsl");
      evidence.push("module/name verity signal");
    }

    for (const signal of VERITY_SIGNAL_PATTERNS) {
      if (signal.pattern.test(source)) {
        matches.push(signal.tag);
        evidence.push(signal.evidence);
      }
    }

    const uniqueTags = uniqueSorted(matches);
    const confidence = clamp(0.1 + (moduleSignal ? 0.35 : 0) + uniqueTags.length * 0.1, 0, 0.95);

    return {
      tags: uniqueTags,
      confidence,
      evidence: uniqueSorted(evidence),
    };
  },
};

export function getDefaultDomainAdapters(): DomainAdapter[] {
  return [verityDomainAdapter, genericLeanAdapter];
}

export function classifyDeclarationDomain(
  input: DomainClassificationInput,
  options: DomainClassificationOptions = {},
): DomainClassificationResult {
  const adapters = options.adapters ?? getDefaultDomainAdapters();
  if (!Array.isArray(adapters) || adapters.length === 0) {
    throw new Error("adapters must contain at least one adapter.");
  }

  const threshold = resolveThreshold(options.lowConfidenceThreshold, options.override?.minConfidence);
  const fallbackAdapterId = options.fallbackAdapterId ?? GENERIC_LEAN_ADAPTER_ID;
  const warnings: DomainClassificationWarning[] = [];

  const normalizedInput = normalizeInput(input);
  const forcedAdapter = options.override?.forceAdapterId ? adapters.find((adapter) => adapter.adapterId === options.override?.forceAdapterId) : undefined;

  let selected: { adapter: DomainAdapter; decision: DomainAdapterDecision };

  if (options.override?.forceAdapterId && !forcedAdapter) {
    warnings.push({
      code: "forced_adapter_missing",
      message: `Forced adapter '${options.override.forceAdapterId}' is unavailable; selecting best adapter instead.`,
      details: { requestedAdapterId: options.override.forceAdapterId },
    });
    selected = selectBestAdapter(adapters, normalizedInput);
  } else if (forcedAdapter) {
    selected = {
      adapter: forcedAdapter,
      decision: normalizeDecision(forcedAdapter.classify(normalizedInput)),
    };
  } else {
    selected = selectBestAdapter(adapters, normalizedInput);
  }

  let adapterId = selected.adapter.adapterId;
  let confidence = selected.decision.confidence;
  let tags = uniqueSorted(selected.decision.tags);
  let evidence = uniqueSorted(selected.decision.evidence);
  let downgradedFromAdapterId: string | undefined;

  if (confidence < threshold) {
    const fallbackAdapter = adapters.find((adapter) => adapter.adapterId === fallbackAdapterId);
    if (fallbackAdapter && fallbackAdapter.adapterId !== adapterId) {
      const fallbackDecision = normalizeDecision(fallbackAdapter.classify(normalizedInput));
      warnings.push({
        code: "low_confidence_downgrade",
        message: `Adapter '${adapterId}' scored below threshold and was downgraded to '${fallbackAdapter.adapterId}'.`,
        details: {
          threshold,
          originalConfidence: confidence,
          originalAdapterId: adapterId,
          fallbackAdapterId: fallbackAdapter.adapterId,
        },
      });
      downgradedFromAdapterId = adapterId;
      adapterId = fallbackAdapter.adapterId;
      confidence = fallbackDecision.confidence;
      tags = uniqueSorted(fallbackDecision.tags);
      evidence = uniqueSorted([...fallbackDecision.evidence, ...evidence]);
    }
  }

  const override = options.override;
  if (override && (override.addTags?.length || override.removeTags?.length)) {
    const addTags = uniqueSorted(override.addTags ?? []);
    const removeTags = new Set(uniqueSorted(override.removeTags ?? []));
    tags = uniqueSorted([...tags, ...addTags]).filter((tag) => !removeTags.has(tag));
    warnings.push({
      code: "manual_override_applied",
      message: "Manual domain-tag override was applied.",
      details: {
        addTags,
        removeTags: [...removeTags],
      },
    });
  }

  return {
    adapterId,
    confidence,
    downgradedFromAdapterId,
    tags,
    evidence,
    warnings,
  };
}

export function evaluateDomainTagging(samples: DomainTaggingSample[]): DomainTaggingReport {
  if (!Array.isArray(samples) || samples.length === 0) {
    throw new Error("samples must contain at least one item.");
  }

  const tagSet = new Set<DomainTag>();
  for (const sample of samples) {
    for (const tag of sample.expectedTags) {
      tagSet.add(tag);
    }
    for (const tag of sample.predictedTags) {
      tagSet.add(tag);
    }
  }

  const tags = [...tagSet].sort((left, right) => left.localeCompare(right));

  const perTag = tags.map((tag) => {
    let truePositives = 0;
    let falsePositives = 0;
    let falseNegatives = 0;

    for (const sample of samples) {
      const expected = new Set(uniqueSorted(sample.expectedTags));
      const predicted = new Set(uniqueSorted(sample.predictedTags));
      const inExpected = expected.has(tag);
      const inPredicted = predicted.has(tag);

      if (inPredicted && inExpected) {
        truePositives += 1;
      } else if (inPredicted && !inExpected) {
        falsePositives += 1;
      } else if (!inPredicted && inExpected) {
        falseNegatives += 1;
      }
    }

    const precision = safeRatio(truePositives, truePositives + falsePositives);
    const recall = safeRatio(truePositives, truePositives + falseNegatives);
    const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);

    return {
      tag,
      truePositives,
      falsePositives,
      falseNegatives,
      precision: round4(precision),
      recall: round4(recall),
      f1: round4(f1),
    };
  });

  const macroPrecision = round4(average(perTag.map((metric) => metric.precision)));
  const macroRecall = round4(average(perTag.map((metric) => metric.recall)));
  const macroF1 = round4(average(perTag.map((metric) => metric.f1)));

  return {
    sampleCount: samples.length,
    macroPrecision,
    macroRecall,
    macroF1,
    perTag,
  };
}

export function renderDomainTaggingReport(report: DomainTaggingReport): string {
  const lines = [
    `samples=${report.sampleCount}`,
    `macro_precision=${report.macroPrecision.toFixed(4)}`,
    `macro_recall=${report.macroRecall.toFixed(4)}`,
    `macro_f1=${report.macroF1.toFixed(4)}`,
  ];

  for (const metric of report.perTag) {
    lines.push(
      `tag=${metric.tag}|tp=${metric.truePositives}|fp=${metric.falsePositives}|fn=${metric.falseNegatives}|precision=${metric.precision.toFixed(4)}|recall=${metric.recall.toFixed(4)}|f1=${metric.f1.toFixed(4)}`,
    );
  }

  return lines.join("\n");
}

export function computeDomainTaggingReportHash(report: DomainTaggingReport): string {
  return createHash("sha256").update(renderDomainTaggingReport(report)).digest("hex");
}

function selectBestAdapter(
  adapters: DomainAdapter[],
  input: DomainClassificationInput,
): { adapter: DomainAdapter; decision: DomainAdapterDecision } {
  const scored = adapters.map((adapter, index) => {
    const decision = normalizeDecision(adapter.classify(input));
    return { adapter, decision, index };
  });

  scored.sort((left, right) => {
    if (right.decision.confidence !== left.decision.confidence) {
      return right.decision.confidence - left.decision.confidence;
    }
    if (left.index !== right.index) {
      return left.index - right.index;
    }
    return left.adapter.adapterId.localeCompare(right.adapter.adapterId);
  });

  return { adapter: scored[0].adapter, decision: scored[0].decision };
}

function resolveThreshold(base?: number, override?: number): number {
  const candidate = override ?? base ?? 0.45;
  if (!Number.isFinite(candidate) || candidate < 0 || candidate > 1) {
    throw new Error("lowConfidenceThreshold must be a finite number in [0, 1].");
  }
  return candidate;
}

function normalizeInput(input: DomainClassificationInput): DomainClassificationInput {
  const declarationId = input.declarationId.trim();
  const modulePath = input.modulePath.trim();
  const declarationName = input.declarationName.trim();
  const statementText = input.statementText.trim();
  const prettyStatement = input.prettyStatement?.trim();

  if (!declarationId || !modulePath || !declarationName || !statementText) {
    throw new Error("DomainClassificationInput requires non-empty declarationId, modulePath, declarationName, and statementText.");
  }

  return {
    declarationId,
    modulePath,
    declarationName,
    theoremKind: input.theoremKind,
    statementText,
    prettyStatement,
  };
}

function normalizeDecision(decision: DomainAdapterDecision): DomainAdapterDecision {
  return {
    tags: uniqueSorted(decision.tags ?? []),
    confidence: round4(clamp(decision.confidence, 0, 1)),
    evidence: uniqueSorted(decision.evidence ?? []),
  };
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))].sort((left, right) =>
    left.localeCompare(right),
  );
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function safeRatio(numerator: number, denominator: number): number {
  if (denominator === 0) {
    return 0;
  }
  return numerator / denominator;
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
