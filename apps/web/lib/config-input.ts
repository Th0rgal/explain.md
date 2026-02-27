import {
  normalizeConfig,
  validateConfig,
  type ExplanationConfig,
  type ExplanationConfigInput,
  type ModelProviderConfig,
  type ValidationError,
} from "../../../dist/config-contract";

const ROOT_FIELDS = new Set([
  "abstractionLevel",
  "complexityLevel",
  "maxChildrenPerParent",
  "language",
  "audienceLevel",
  "readingLevelTarget",
  "complexityBandWidth",
  "termIntroductionBudget",
  "proofDetailMode",
  "modelProvider",
]);

const MODEL_PROVIDER_FIELDS = new Set([
  "provider",
  "endpoint",
  "model",
  "apiKeyEnvVar",
  "timeoutMs",
  "maxRetries",
  "retryBaseDelayMs",
  "temperature",
  "maxOutputTokens",
]);

const QUERY_FIELD_MAP: Record<string, string> = {
  abstractionLevel: "abstractionLevel",
  complexityLevel: "complexityLevel",
  maxChildrenPerParent: "maxChildrenPerParent",
  language: "language",
  audienceLevel: "audienceLevel",
  readingLevelTarget: "readingLevelTarget",
  complexityBandWidth: "complexityBandWidth",
  termIntroductionBudget: "termIntroductionBudget",
  proofDetailMode: "proofDetailMode",
  "modelProvider.provider": "modelProvider.provider",
  "modelProvider.endpoint": "modelProvider.endpoint",
  "modelProvider.model": "modelProvider.model",
  "modelProvider.apiKeyEnvVar": "modelProvider.apiKeyEnvVar",
  "modelProvider.timeoutMs": "modelProvider.timeoutMs",
  "modelProvider.maxRetries": "modelProvider.maxRetries",
  "modelProvider.retryBaseDelayMs": "modelProvider.retryBaseDelayMs",
  "modelProvider.temperature": "modelProvider.temperature",
  "modelProvider.maxOutputTokens": "modelProvider.maxOutputTokens",
};

export class ConfigContractError extends Error {
  readonly details: ValidationError[];

  constructor(message: string, details: ValidationError[]) {
    super(message);
    this.name = "ConfigContractError";
    this.details = details;
  }
}

export function parseConfigFromBody(input: unknown): ExplanationConfigInput {
  if (input === undefined || input === null) {
    return {};
  }

  if (typeof input !== "object" || Array.isArray(input)) {
    throw new ConfigContractError("Config payload must be an object.", [{ path: "config", message: "Expected an object." }]);
  }

  const record = input as Record<string, unknown>;
  const partial: ExplanationConfigInput = {};

  assertKnownFields(record, ROOT_FIELDS, "config");

  if (hasOwn(record, "abstractionLevel")) {
    partial.abstractionLevel = parseInteger(record.abstractionLevel, "config.abstractionLevel") as ExplanationConfig["abstractionLevel"];
  }
  if (hasOwn(record, "complexityLevel")) {
    partial.complexityLevel = parseInteger(record.complexityLevel, "config.complexityLevel") as ExplanationConfig["complexityLevel"];
  }
  if (hasOwn(record, "maxChildrenPerParent")) {
    partial.maxChildrenPerParent = parseInteger(record.maxChildrenPerParent, "config.maxChildrenPerParent");
  }
  if (hasOwn(record, "language")) {
    partial.language = parseString(record.language, "config.language");
  }
  if (hasOwn(record, "audienceLevel")) {
    partial.audienceLevel = parseString(record.audienceLevel, "config.audienceLevel") as ExplanationConfig["audienceLevel"];
  }
  if (hasOwn(record, "readingLevelTarget")) {
    partial.readingLevelTarget = parseString(record.readingLevelTarget, "config.readingLevelTarget") as ExplanationConfig["readingLevelTarget"];
  }
  if (hasOwn(record, "complexityBandWidth")) {
    partial.complexityBandWidth = parseInteger(record.complexityBandWidth, "config.complexityBandWidth");
  }
  if (hasOwn(record, "termIntroductionBudget")) {
    partial.termIntroductionBudget = parseInteger(record.termIntroductionBudget, "config.termIntroductionBudget");
  }
  if (hasOwn(record, "proofDetailMode")) {
    partial.proofDetailMode = parseString(record.proofDetailMode, "config.proofDetailMode") as ExplanationConfig["proofDetailMode"];
  }

  if (hasOwn(record, "modelProvider")) {
    const modelProvider = parseModelProvider(record.modelProvider, "config.modelProvider");
    if (Object.keys(modelProvider).length > 0) {
      partial.modelProvider = modelProvider;
    }
  }

  return validateAndCanonicalizePartial(partial);
}

export function parseConfigFromSearchParams(search: URLSearchParams): ExplanationConfigInput {
  const partial: ExplanationConfigInput = {};
  const modelProvider: Partial<ModelProviderConfig> = {};

  for (const [rawKey, rawValue] of search.entries()) {
    if (!(rawKey in QUERY_FIELD_MAP)) {
      continue;
    }

    const mapped = QUERY_FIELD_MAP[rawKey];
    if (mapped.startsWith("modelProvider.")) {
      const child = mapped.replace("modelProvider.", "");
      if (child === "temperature") {
        modelProvider.temperature = parseNumber(rawValue, rawKey);
      } else if (child === "timeoutMs") {
        modelProvider.timeoutMs = parseInteger(rawValue, rawKey);
      } else if (child === "maxRetries") {
        modelProvider.maxRetries = parseInteger(rawValue, rawKey);
      } else if (child === "retryBaseDelayMs") {
        modelProvider.retryBaseDelayMs = parseInteger(rawValue, rawKey);
      } else if (child === "maxOutputTokens") {
        modelProvider.maxOutputTokens = parseInteger(rawValue, rawKey);
      } else if (child === "provider") {
        modelProvider.provider = parseString(rawValue, rawKey);
      } else if (child === "endpoint") {
        modelProvider.endpoint = parseString(rawValue, rawKey);
      } else if (child === "model") {
        modelProvider.model = parseString(rawValue, rawKey);
      } else if (child === "apiKeyEnvVar") {
        modelProvider.apiKeyEnvVar = parseString(rawValue, rawKey);
      } else {
        throw new ConfigContractError(`Unknown config field '${rawKey}'.`, [{ path: rawKey, message: "Field is not part of the config contract." }]);
      }
      continue;
    }

    switch (mapped) {
      case "abstractionLevel":
        partial.abstractionLevel = parseInteger(rawValue, rawKey) as ExplanationConfig["abstractionLevel"];
        break;
      case "complexityLevel":
        partial.complexityLevel = parseInteger(rawValue, rawKey) as ExplanationConfig["complexityLevel"];
        break;
      case "maxChildrenPerParent":
        partial.maxChildrenPerParent = parseInteger(rawValue, rawKey);
        break;
      case "language":
        partial.language = parseString(rawValue, rawKey);
        break;
      case "audienceLevel":
        partial.audienceLevel = parseString(rawValue, rawKey) as ExplanationConfig["audienceLevel"];
        break;
      case "readingLevelTarget":
        partial.readingLevelTarget = parseString(rawValue, rawKey) as ExplanationConfig["readingLevelTarget"];
        break;
      case "complexityBandWidth":
        partial.complexityBandWidth = parseInteger(rawValue, rawKey);
        break;
      case "termIntroductionBudget":
        partial.termIntroductionBudget = parseInteger(rawValue, rawKey);
        break;
      case "proofDetailMode":
        partial.proofDetailMode = parseString(rawValue, rawKey) as ExplanationConfig["proofDetailMode"];
        break;
      default:
        break;
    }
  }

  if (Object.keys(modelProvider).length > 0) {
    partial.modelProvider = modelProvider;
  }

  return validateAndCanonicalizePartial(partial);
}

function parseModelProvider(input: unknown, path: string): Partial<ModelProviderConfig> {
  if (input === undefined || input === null) {
    return {};
  }
  if (typeof input !== "object" || Array.isArray(input)) {
    throw new ConfigContractError("modelProvider must be an object.", [{ path, message: "Expected an object." }]);
  }

  const record = input as Record<string, unknown>;
  assertKnownFields(record, MODEL_PROVIDER_FIELDS, path);

  const parsed: Partial<ModelProviderConfig> = {};

  if (hasOwn(record, "provider")) {
    parsed.provider = parseString(record.provider, `${path}.provider`);
  }
  if (hasOwn(record, "endpoint")) {
    parsed.endpoint = parseString(record.endpoint, `${path}.endpoint`);
  }
  if (hasOwn(record, "model")) {
    parsed.model = parseString(record.model, `${path}.model`);
  }
  if (hasOwn(record, "apiKeyEnvVar")) {
    const value = parseString(record.apiKeyEnvVar, `${path}.apiKeyEnvVar`);
    parsed.apiKeyEnvVar = value;
  }
  if (hasOwn(record, "timeoutMs")) {
    parsed.timeoutMs = parseInteger(record.timeoutMs, `${path}.timeoutMs`);
  }
  if (hasOwn(record, "maxRetries")) {
    parsed.maxRetries = parseInteger(record.maxRetries, `${path}.maxRetries`);
  }
  if (hasOwn(record, "retryBaseDelayMs")) {
    parsed.retryBaseDelayMs = parseInteger(record.retryBaseDelayMs, `${path}.retryBaseDelayMs`);
  }
  if (hasOwn(record, "temperature")) {
    parsed.temperature = parseNumber(record.temperature, `${path}.temperature`);
  }
  if (hasOwn(record, "maxOutputTokens")) {
    parsed.maxOutputTokens = parseInteger(record.maxOutputTokens, `${path}.maxOutputTokens`);
  }

  return parsed;
}

function validateAndCanonicalizePartial(partial: ExplanationConfigInput): ExplanationConfigInput {
  const normalized = normalizeConfig(partial);
  const validation = validateConfig(normalized);
  if (!validation.ok) {
    throw new ConfigContractError("Config failed contract validation.", validation.errors);
  }

  return canonicalizePartial(partial, normalized);
}

function canonicalizePartial(partial: ExplanationConfigInput, normalized: ExplanationConfig): ExplanationConfigInput {
  const canonical: ExplanationConfigInput = {};

  if (partial.abstractionLevel !== undefined) {
    canonical.abstractionLevel = normalized.abstractionLevel;
  }
  if (partial.complexityLevel !== undefined) {
    canonical.complexityLevel = normalized.complexityLevel;
  }
  if (partial.maxChildrenPerParent !== undefined) {
    canonical.maxChildrenPerParent = normalized.maxChildrenPerParent;
  }
  if (partial.language !== undefined) {
    canonical.language = normalized.language;
  }
  if (partial.audienceLevel !== undefined) {
    canonical.audienceLevel = normalized.audienceLevel;
  }
  if (partial.readingLevelTarget !== undefined) {
    canonical.readingLevelTarget = normalized.readingLevelTarget;
  }
  if (partial.complexityBandWidth !== undefined) {
    canonical.complexityBandWidth = normalized.complexityBandWidth;
  }
  if (partial.termIntroductionBudget !== undefined) {
    canonical.termIntroductionBudget = normalized.termIntroductionBudget;
  }
  if (partial.proofDetailMode !== undefined) {
    canonical.proofDetailMode = normalized.proofDetailMode;
  }

  if (partial.modelProvider) {
    const provider: Partial<ModelProviderConfig> = {};
    if (partial.modelProvider.provider !== undefined) {
      provider.provider = normalized.modelProvider.provider;
    }
    if (partial.modelProvider.endpoint !== undefined) {
      provider.endpoint = normalized.modelProvider.endpoint;
    }
    if (partial.modelProvider.model !== undefined) {
      provider.model = normalized.modelProvider.model;
    }
    if (partial.modelProvider.apiKeyEnvVar !== undefined) {
      provider.apiKeyEnvVar = normalized.modelProvider.apiKeyEnvVar;
    }
    if (partial.modelProvider.timeoutMs !== undefined) {
      provider.timeoutMs = normalized.modelProvider.timeoutMs;
    }
    if (partial.modelProvider.maxRetries !== undefined) {
      provider.maxRetries = normalized.modelProvider.maxRetries;
    }
    if (partial.modelProvider.retryBaseDelayMs !== undefined) {
      provider.retryBaseDelayMs = normalized.modelProvider.retryBaseDelayMs;
    }
    if (partial.modelProvider.temperature !== undefined) {
      provider.temperature = normalized.modelProvider.temperature;
    }
    if (partial.modelProvider.maxOutputTokens !== undefined) {
      provider.maxOutputTokens = normalized.modelProvider.maxOutputTokens;
    }
    if (Object.keys(provider).length > 0) {
      canonical.modelProvider = provider;
    }
  }

  return canonical;
}

function parseInteger(value: unknown, path: string): number {
  const numeric = Number(value);
  if (!Number.isInteger(numeric)) {
    throw new ConfigContractError(`Expected integer for '${path}'.`, [{ path, message: "Must be an integer." }]);
  }
  return numeric;
}

function parseNumber(value: unknown, path: string): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    throw new ConfigContractError(`Expected finite number for '${path}'.`, [{ path, message: "Must be a finite number." }]);
  }
  return numeric;
}

function parseString(value: unknown, path: string): string {
  if (typeof value !== "string") {
    throw new ConfigContractError(`Expected string for '${path}'.`, [{ path, message: "Must be a string." }]);
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new ConfigContractError(`Expected non-empty string for '${path}'.`, [{ path, message: "Must be a non-empty string." }]);
  }

  return trimmed;
}

function assertKnownFields(record: Record<string, unknown>, allowed: Set<string>, path: string): void {
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      throw new ConfigContractError(`Unknown config field '${path}.${key}'.`, [{ path: `${path}.${key}`, message: "Field is not part of the config contract." }]);
    }
  }
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}
