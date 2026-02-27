import { createHash } from "node:crypto";
import {
  resolveExplanationLanguage,
  SUPPORTED_EXPLANATION_LANGUAGES,
  type SupportedExplanationLanguage,
} from "./language-contract.js";

export type AbstractionLevel = 1 | 2 | 3 | 4 | 5;
export type ComplexityLevel = 1 | 2 | 3 | 4 | 5;
export type AudienceLevel = "novice" | "intermediate" | "expert";
export type ReadingLevelTarget = "elementary" | "middle_school" | "high_school" | "undergraduate" | "graduate";
export type ProofDetailMode = "minimal" | "balanced" | "formal";
export type EntailmentMode = "calibrated" | "strict";

export interface ModelProviderConfig {
  provider: string;
  endpoint: string;
  model: string;
  apiKeyEnvVar?: string;
  timeoutMs: number;
  maxRetries: number;
  retryBaseDelayMs: number;
  temperature: number;
  maxOutputTokens: number;
}

export interface ExplanationConfig {
  abstractionLevel: AbstractionLevel;
  complexityLevel: ComplexityLevel;
  maxChildrenPerParent: number;
  language: SupportedExplanationLanguage;
  audienceLevel: AudienceLevel;
  readingLevelTarget: ReadingLevelTarget;
  complexityBandWidth: number;
  termIntroductionBudget: number;
  proofDetailMode: ProofDetailMode;
  entailmentMode: EntailmentMode;
  modelProvider: ModelProviderConfig;
}

export type ExplanationConfigInput = Omit<Partial<ExplanationConfig>, "modelProvider"> & {
  modelProvider?: Partial<ModelProviderConfig>;
};

export interface ValidationError {
  path: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: ValidationError[];
}

export const DEFAULT_CONFIG: ExplanationConfig = {
  abstractionLevel: 3,
  complexityLevel: 3,
  maxChildrenPerParent: 5,
  language: "en",
  audienceLevel: "intermediate",
  readingLevelTarget: "high_school",
  complexityBandWidth: 1,
  termIntroductionBudget: 2,
  proofDetailMode: "balanced",
  entailmentMode: "calibrated",
  modelProvider: {
    provider: "openai-compatible",
    endpoint: "http://localhost:8080/v1",
    model: "gpt-4.1-mini",
    apiKeyEnvVar: "OPENAI_API_KEY",
    timeoutMs: 30_000,
    maxRetries: 2,
    retryBaseDelayMs: 250,
    temperature: 0,
    maxOutputTokens: 1200,
  },
};

const AUDIENCE_ORDER: Record<AudienceLevel, number> = {
  novice: 1,
  intermediate: 2,
  expert: 3,
};

const READING_MIN_BY_AUDIENCE: Record<AudienceLevel, ReadingLevelTarget> = {
  novice: "elementary",
  intermediate: "middle_school",
  expert: "high_school",
};

const READING_ORDER: Record<ReadingLevelTarget, number> = {
  elementary: 1,
  middle_school: 2,
  high_school: 3,
  undergraduate: 4,
  graduate: 5,
};

export function normalizeConfig(input: ExplanationConfigInput = {}): ExplanationConfig {
  const merged: ExplanationConfig = {
    ...DEFAULT_CONFIG,
    ...input,
    modelProvider: {
      ...DEFAULT_CONFIG.modelProvider,
      ...input.modelProvider,
    },
  };

  return {
    ...merged,
    language: resolveExplanationLanguage(merged.language).effective,
    modelProvider: {
      ...merged.modelProvider,
      provider: merged.modelProvider.provider.trim().toLowerCase(),
      endpoint: merged.modelProvider.endpoint.trim(),
      model: merged.modelProvider.model.trim(),
      apiKeyEnvVar: merged.modelProvider.apiKeyEnvVar?.trim(),
      temperature: roundTo(merged.modelProvider.temperature, 4),
    },
  };
}

function roundTo(value: number, digits: number): number {
  const power = Math.pow(10, digits);
  return Math.round(value * power) / power;
}

export function validateConfig(config: ExplanationConfig): ValidationResult {
  const errors: ValidationError[] = [];

  assertIntBetween(errors, "abstractionLevel", config.abstractionLevel, 1, 5);
  assertIntBetween(errors, "complexityLevel", config.complexityLevel, 1, 5);
  assertIntBetween(errors, "maxChildrenPerParent", config.maxChildrenPerParent, 2, 12);

  if (!SUPPORTED_EXPLANATION_LANGUAGES.includes(config.language)) {
    errors.push({
      path: "language",
      message: `Must resolve to one of: ${SUPPORTED_EXPLANATION_LANGUAGES.join(", ")}.`,
    });
  }

  if (!(config.audienceLevel in AUDIENCE_ORDER)) {
    errors.push({ path: "audienceLevel", message: "Must be one of: novice, intermediate, expert." });
  }

  if (!(config.readingLevelTarget in READING_ORDER)) {
    errors.push({
      path: "readingLevelTarget",
      message: "Must be one of: elementary, middle_school, high_school, undergraduate, graduate.",
    });
  }

  assertIntBetween(errors, "complexityBandWidth", config.complexityBandWidth, 0, 3);
  assertIntBetween(errors, "termIntroductionBudget", config.termIntroductionBudget, 0, 8);

  if (!["minimal", "balanced", "formal"].includes(config.proofDetailMode)) {
    errors.push({ path: "proofDetailMode", message: "Must be one of: minimal, balanced, formal." });
  }
  if (!["calibrated", "strict"].includes(config.entailmentMode)) {
    errors.push({ path: "entailmentMode", message: "Must be one of: calibrated, strict." });
  }

  if (!config.modelProvider.provider) {
    errors.push({ path: "modelProvider.provider", message: "Provider is required." });
  }
  if (!config.modelProvider.endpoint) {
    errors.push({ path: "modelProvider.endpoint", message: "Endpoint is required." });
  }
  if (!config.modelProvider.model) {
    errors.push({ path: "modelProvider.model", message: "Model is required." });
  }
  if (!Number.isFinite(config.modelProvider.temperature) || config.modelProvider.temperature < 0 || config.modelProvider.temperature > 1) {
    errors.push({ path: "modelProvider.temperature", message: "Temperature must be between 0 and 1." });
  }
  assertIntBetween(errors, "modelProvider.timeoutMs", config.modelProvider.timeoutMs, 1000, 120000);
  assertIntBetween(errors, "modelProvider.maxRetries", config.modelProvider.maxRetries, 0, 8);
  assertIntBetween(errors, "modelProvider.retryBaseDelayMs", config.modelProvider.retryBaseDelayMs, 50, 5000);
  assertIntBetween(errors, "modelProvider.maxOutputTokens", config.modelProvider.maxOutputTokens, 128, 16384);

  const minimumReading = READING_MIN_BY_AUDIENCE[config.audienceLevel];
  if (READING_ORDER[config.readingLevelTarget] < READING_ORDER[minimumReading]) {
    errors.push({
      path: "readingLevelTarget",
      message: `Reading target '${config.readingLevelTarget}' is below minimum for audience '${config.audienceLevel}' (${minimumReading}+).`,
    });
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}

function assertIntBetween(errors: ValidationError[], path: string, value: number, min: number, max: number): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    errors.push({ path, message: `Must be an integer between ${min} and ${max}.` });
  }
}

export function stableSerializeConfig(config: ExplanationConfig): string {
  return JSON.stringify(config, stableReplacer);
}

function stableReplacer(_key: string, value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }

  const record = value as Record<string, unknown>;
  return Object.keys(record)
    .sort()
    .reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = record[key];
      return acc;
    }, {});
}

export function computeConfigHash(config: ExplanationConfig): string {
  return sha256(stableSerializeConfig(config));
}

export function computeTreeCacheKey(leafSetHash: string, config: ExplanationConfig): string {
  const configHash = computeConfigHash(config);
  return [leafSetHash, configHash, config.language, config.audienceLevel].join(":");
}

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export interface RegenerationPlan {
  scope: "none" | "partial" | "full";
  changedFields: string[];
  reason: string;
}

export interface ConfigProfileRecord {
  profileId: string;
  projectId: string;
  userId: string;
  name: string;
  config: ExplanationConfig;
  createdAt: string;
  updatedAt: string;
}

const FULL_REGEN_FIELDS = new Set<string>([
  "abstractionLevel",
  "complexityLevel",
  "maxChildrenPerParent",
  "language",
  "audienceLevel",
  "readingLevelTarget",
  "complexityBandWidth",
  "termIntroductionBudget",
  "proofDetailMode",
  "entailmentMode",
  "modelProvider.provider",
  "modelProvider.endpoint",
  "modelProvider.model",
  "modelProvider.temperature",
]);

const PARTIAL_REGEN_FIELDS = new Set<string>([
  "modelProvider.timeoutMs",
  "modelProvider.maxRetries",
  "modelProvider.retryBaseDelayMs",
  "modelProvider.maxOutputTokens",
  "modelProvider.apiKeyEnvVar",
]);

export function planRegeneration(previous: ExplanationConfig, next: ExplanationConfig): RegenerationPlan {
  const changedFields = diffPaths(previous, next);
  if (changedFields.length === 0) {
    return { scope: "none", changedFields, reason: "Configuration unchanged." };
  }

  const hasFull = changedFields.some((field) => FULL_REGEN_FIELDS.has(field));
  if (hasFull) {
    return {
      scope: "full",
      changedFields,
      reason: "Changes impact tree structure or generated language, requiring full regeneration.",
    };
  }

  const hasPartial = changedFields.some((field) => PARTIAL_REGEN_FIELDS.has(field));
  if (hasPartial) {
    return {
      scope: "partial",
      changedFields,
      reason: "Changes affect generation constraints without altering grouping semantics.",
    };
  }

  return {
    scope: "full",
    changedFields,
    reason: "Unknown field changes are treated as full regeneration for safety.",
  };
}

export function buildProfileStorageKey(projectId: string, userId: string, profileId: string): string {
  const project = normalizeKeyComponent(projectId);
  const user = normalizeKeyComponent(userId);
  const profile = normalizeKeyComponent(profileId);
  return `project:${project}:user:${user}:profile:${profile}`;
}

function normalizeKeyComponent(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9-_]/g, "_");
}

function diffPaths(previous: unknown, next: unknown, basePath = ""): string[] {
  if (Object.is(previous, next)) {
    return [];
  }

  if (typeof previous !== "object" || previous === null || typeof next !== "object" || next === null) {
    return [basePath];
  }

  const prevRecord = previous as Record<string, unknown>;
  const nextRecord = next as Record<string, unknown>;

  const keys = new Set([...Object.keys(prevRecord), ...Object.keys(nextRecord)]);
  const changes: string[] = [];
  for (const key of [...keys].sort()) {
    const path = basePath ? `${basePath}.${key}` : key;
    const childChanges = diffPaths(prevRecord[key], nextRecord[key], path);
    changes.push(...childChanges);
  }
  return changes;
}
