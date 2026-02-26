import { createHash } from "node:crypto";
import type { LeafNodeInput } from "./tree-builder.js";

export const THEOREM_LEAF_SCHEMA_VERSION = "1.0.0";

export type TheoremKind =
  | "theorem"
  | "lemma"
  | "definition"
  | "axiom"
  | "inductive"
  | "structure"
  | "instance"
  | "example"
  | "unknown";

const SUPPORTED_KINDS: ReadonlySet<TheoremKind> = new Set<TheoremKind>([
  "theorem",
  "lemma",
  "definition",
  "axiom",
  "inductive",
  "structure",
  "instance",
  "example",
  "unknown",
]);

export interface SourceSpan {
  filePath: string;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

export interface TheoremLeafRecord {
  schemaVersion: string;
  id: string;
  declarationId: string;
  modulePath: string;
  declarationName: string;
  theoremKind: TheoremKind;
  statementText: string;
  prettyStatement: string;
  sourceSpan: SourceSpan;
  tags: string[];
  dependencyIds: string[];
  sourceUrl?: string;
}

export interface IngestedDeclarationRecord {
  declarationId?: string;
  modulePath: string;
  declarationName: string;
  theoremKind?: string;
  statementText: string;
  prettyStatement?: string;
  sourceSpan: SourceSpan;
  tags?: string[];
  dependencyIds?: string[];
}

export interface LeafValidationError {
  path: string;
  message: string;
}

export interface LeafValidationResult {
  ok: boolean;
  errors: LeafValidationError[];
}

export interface LeafMappingOptions {
  sourceBaseUrl?: string;
}

interface LegacyLeafRecordV0 {
  id?: string;
  declarationId?: string;
  module?: string;
  modulePath?: string;
  name?: string;
  declarationName?: string;
  kind?: string;
  theoremKind?: string;
  statement?: string;
  statementText?: string;
  pretty?: string;
  prettyStatement?: string;
  tags?: string[];
  deps?: string[];
  dependencyIds?: string[];
  sourceUrl?: string;
  sourceSpan?: Partial<SourceSpan>;
  filePath?: string;
  startLine?: number;
  startColumn?: number;
  endLine?: number;
  endColumn?: number;
}

export function mapIngestedDeclarationToLeaf(
  declaration: IngestedDeclarationRecord,
  options: LeafMappingOptions = {},
): TheoremLeafRecord {
  const modulePath = normalizeModulePath(declaration.modulePath);
  const declarationName = normalizeRequired(declaration.declarationName, "declarationName");
  const theoremKind = normalizeTheoremKind(declaration.theoremKind);
  const statementText = normalizeRequired(declaration.statementText, "statementText");
  const prettyStatement = normalizeOptional(declaration.prettyStatement) ?? statementText;
  const sourceSpan = normalizeSourceSpan(declaration.sourceSpan);
  const declarationId =
    normalizeOptional(declaration.declarationId) ??
    buildDeclarationId(modulePath, declarationName, theoremKind, sourceSpan);

  const tags = normalizeStringList(declaration.tags);
  const dependencyIds = normalizeStringList(declaration.dependencyIds);

  const leaf: TheoremLeafRecord = {
    schemaVersion: THEOREM_LEAF_SCHEMA_VERSION,
    id: declarationId,
    declarationId,
    modulePath,
    declarationName,
    theoremKind,
    statementText,
    prettyStatement,
    sourceSpan,
    tags,
    dependencyIds,
    sourceUrl: options.sourceBaseUrl ? buildSourceUrl(options.sourceBaseUrl, sourceSpan) : undefined,
  };

  const validation = validateTheoremLeafRecord(leaf);
  if (!validation.ok) {
    throw new Error(`Invalid theorem leaf: ${validation.errors.map((error) => `${error.path}: ${error.message}`).join("; ")}`);
  }

  return leaf;
}

export function mapIngestedDeclarationsToLeaves(
  declarations: IngestedDeclarationRecord[],
  options: LeafMappingOptions = {},
): TheoremLeafRecord[] {
  const mapped = declarations.map((declaration) => mapIngestedDeclarationToLeaf(declaration, options));
  return mapped.sort((left, right) => left.id.localeCompare(right.id));
}

export function mapTheoremLeavesToTreeLeaves(leaves: TheoremLeafRecord[]): LeafNodeInput[] {
  return leaves
    .map((leaf) => ({
      id: leaf.id,
      statement: leaf.prettyStatement,
      prerequisiteIds: leaf.dependencyIds,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function renderTheoremLeafCanonical(leaf: TheoremLeafRecord): string {
  const normalized = canonicalizeTheoremLeafRecord(leaf);
  const span = formatSourceSpan(normalized.sourceSpan);
  const deps = normalized.dependencyIds.length > 0 ? normalized.dependencyIds.join(",") : "none";
  const tags = normalized.tags.length > 0 ? normalized.tags.join(",") : "none";

  return [
    `schema=${normalized.schemaVersion}`,
    `id=${normalized.id}`,
    `module=${normalized.modulePath}`,
    `declaration=${normalized.declarationName}`,
    `kind=${normalized.theoremKind}`,
    `span=${span}`,
    `statement=${JSON.stringify(normalized.statementText)}`,
    `pretty=${JSON.stringify(normalized.prettyStatement)}`,
    `dependencies=${deps}`,
    `tags=${tags}`,
    `source_url=${normalized.sourceUrl ?? "none"}`,
  ].join("\n");
}

export function canonicalizeTheoremLeafRecord(leaf: TheoremLeafRecord): TheoremLeafRecord {
  const canonical: TheoremLeafRecord = {
    schemaVersion: normalizeOptional(leaf.schemaVersion) ?? THEOREM_LEAF_SCHEMA_VERSION,
    id: normalizeRequired(leaf.id, "id"),
    declarationId: normalizeRequired(leaf.declarationId, "declarationId"),
    modulePath: normalizeModulePath(leaf.modulePath),
    declarationName: normalizeRequired(leaf.declarationName, "declarationName"),
    theoremKind: normalizeTheoremKind(leaf.theoremKind),
    statementText: normalizeRequired(leaf.statementText, "statementText"),
    prettyStatement: normalizeRequired(leaf.prettyStatement, "prettyStatement"),
    sourceSpan: normalizeSourceSpan(leaf.sourceSpan),
    tags: normalizeStringList(leaf.tags),
    dependencyIds: normalizeStringList(leaf.dependencyIds),
    sourceUrl: normalizeOptional(leaf.sourceUrl),
  };

  const validation = validateTheoremLeafRecord(canonical);
  if (!validation.ok) {
    throw new Error(`Invalid theorem leaf: ${validation.errors.map((error) => `${error.path}: ${error.message}`).join("; ")}`);
  }

  return canonical;
}

export function validateTheoremLeafRecord(leaf: TheoremLeafRecord): LeafValidationResult {
  const errors: LeafValidationError[] = [];

  if (!leaf.schemaVersion) {
    errors.push({ path: "schemaVersion", message: "schemaVersion is required." });
  }

  if (!leaf.id) {
    errors.push({ path: "id", message: "id is required." });
  }

  if (!leaf.declarationId) {
    errors.push({ path: "declarationId", message: "declarationId is required." });
  }

  if (!leaf.modulePath) {
    errors.push({ path: "modulePath", message: "modulePath is required." });
  }

  if (!leaf.declarationName) {
    errors.push({ path: "declarationName", message: "declarationName is required." });
  }

  if (!SUPPORTED_KINDS.has(leaf.theoremKind)) {
    errors.push({ path: "theoremKind", message: `Unsupported theorem kind '${leaf.theoremKind}'.` });
  }

  if (!leaf.statementText) {
    errors.push({ path: "statementText", message: "statementText is required." });
  }

  if (!leaf.prettyStatement) {
    errors.push({ path: "prettyStatement", message: "prettyStatement is required." });
  }

  if (!Array.isArray(leaf.tags) || !leaf.tags.every((value) => typeof value === "string" && value.trim().length > 0)) {
    errors.push({ path: "tags", message: "tags must be an array of non-empty strings." });
  }

  if (
    !Array.isArray(leaf.dependencyIds) ||
    !leaf.dependencyIds.every((value) => typeof value === "string" && value.trim().length > 0)
  ) {
    errors.push({ path: "dependencyIds", message: "dependencyIds must be an array of non-empty strings." });
  }

  const spanErrors = validateSourceSpan(leaf.sourceSpan);
  errors.push(...spanErrors.map((error) => ({ path: `sourceSpan.${error.path}`, message: error.message })));

  return {
    ok: errors.length === 0,
    errors,
  };
}

export function migrateTheoremLeafRecord(input: unknown): TheoremLeafRecord {
  const value = (input ?? {}) as Partial<TheoremLeafRecord> & LegacyLeafRecordV0;
  const schemaVersion = normalizeOptional(value.schemaVersion);

  if (!schemaVersion || schemaVersion.startsWith("0.")) {
    const sourceSpan = normalizeSourceSpan({
      filePath: value.sourceSpan?.filePath ?? value.filePath ?? "",
      startLine: Number(value.sourceSpan?.startLine ?? value.startLine ?? Number.NaN),
      startColumn: Number(value.sourceSpan?.startColumn ?? value.startColumn ?? Number.NaN),
      endLine: Number(value.sourceSpan?.endLine ?? value.endLine ?? Number.NaN),
      endColumn: Number(value.sourceSpan?.endColumn ?? value.endColumn ?? Number.NaN),
    });

    return canonicalizeTheoremLeafRecord({
      schemaVersion: THEOREM_LEAF_SCHEMA_VERSION,
      id: normalizeOptional(value.id) ?? normalizeOptional(value.declarationId) ?? "",
      declarationId: normalizeOptional(value.declarationId) ?? normalizeOptional(value.id) ?? "",
      modulePath: normalizeOptional(value.modulePath) ?? normalizeOptional(value.module) ?? "",
      declarationName: normalizeOptional(value.declarationName) ?? normalizeOptional(value.name) ?? "",
      theoremKind: normalizeTheoremKind(value.theoremKind ?? value.kind),
      statementText: normalizeOptional(value.statementText) ?? normalizeOptional(value.statement) ?? "",
      prettyStatement:
        normalizeOptional(value.prettyStatement) ??
        normalizeOptional(value.pretty) ??
        normalizeOptional(value.statementText) ??
        normalizeOptional(value.statement) ??
        "",
      sourceSpan,
      tags: normalizeStringList(value.tags),
      dependencyIds: normalizeStringList(value.dependencyIds ?? value.deps),
      sourceUrl: normalizeOptional(value.sourceUrl),
    });
  }

  return canonicalizeTheoremLeafRecord({
    schemaVersion,
    id: normalizeRequired(value.id, "id"),
    declarationId: normalizeRequired(value.declarationId, "declarationId"),
    modulePath: normalizeRequired(value.modulePath, "modulePath"),
    declarationName: normalizeRequired(value.declarationName, "declarationName"),
    theoremKind: normalizeTheoremKind(value.theoremKind),
    statementText: normalizeRequired(value.statementText, "statementText"),
    prettyStatement: normalizeRequired(value.prettyStatement, "prettyStatement"),
    sourceSpan: normalizeSourceSpan(value.sourceSpan as SourceSpan),
    tags: normalizeStringList(value.tags),
    dependencyIds: normalizeStringList(value.dependencyIds),
    sourceUrl: normalizeOptional(value.sourceUrl),
  });
}

export function buildSourceUrl(baseUrl: string, sourceSpan: SourceSpan): string {
  const trimmedBase = normalizeRequired(baseUrl, "baseUrl").replace(/\/+$/, "");
  const normalizedSpan = normalizeSourceSpan(sourceSpan);
  const normalizedPath = normalizedSpan.filePath
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => encodeURIComponent(segment))
    .join("/");

  const path = normalizedPath.length > 0 ? `/${normalizedPath}` : "";
  const anchor = `#L${normalizedSpan.startLine}C${normalizedSpan.startColumn}-L${normalizedSpan.endLine}C${normalizedSpan.endColumn}`;
  return `${trimmedBase}${path}${anchor}`;
}

export function formatSourceSpan(sourceSpan: SourceSpan): string {
  const span = normalizeSourceSpan(sourceSpan);
  return `${span.filePath}:${span.startLine}:${span.startColumn}-${span.endLine}:${span.endColumn}`;
}

function buildDeclarationId(
  modulePath: string,
  declarationName: string,
  theoremKind: TheoremKind,
  sourceSpan: SourceSpan,
): string {
  const canonical = [modulePath, declarationName, theoremKind, formatSourceSpan(sourceSpan)].join("|");
  const digest = createHash("sha256").update(canonical).digest("hex").slice(0, 24);
  return `decl_${digest}`;
}

function normalizeModulePath(value: string): string {
  const normalized = normalizeRequired(value, "modulePath");
  return normalized.replace(/\s+/g, " ");
}

function normalizeTheoremKind(value: string | TheoremKind | undefined): TheoremKind {
  const normalized = normalizeOptional(value)?.toLowerCase();
  if (!normalized) {
    return "unknown";
  }

  if (SUPPORTED_KINDS.has(normalized as TheoremKind)) {
    return normalized as TheoremKind;
  }

  return "unknown";
}

function normalizeSourceSpan(sourceSpan: SourceSpan): SourceSpan {
  const normalized: SourceSpan = {
    filePath: normalizeRequired(sourceSpan.filePath, "sourceSpan.filePath"),
    startLine: Number(sourceSpan.startLine),
    startColumn: Number(sourceSpan.startColumn),
    endLine: Number(sourceSpan.endLine),
    endColumn: Number(sourceSpan.endColumn),
  };

  const errors = validateSourceSpan(normalized);
  if (errors.length > 0) {
    throw new Error(errors.map((error) => `${error.path}: ${error.message}`).join("; "));
  }

  return normalized;
}

function validateSourceSpan(sourceSpan: SourceSpan): LeafValidationError[] {
  const errors: LeafValidationError[] = [];

  if (!sourceSpan.filePath || sourceSpan.filePath.trim().length === 0) {
    errors.push({ path: "filePath", message: "filePath is required." });
  }

  assertPositiveInt(errors, "startLine", sourceSpan.startLine);
  assertPositiveInt(errors, "startColumn", sourceSpan.startColumn);
  assertPositiveInt(errors, "endLine", sourceSpan.endLine);
  assertPositiveInt(errors, "endColumn", sourceSpan.endColumn);

  if (
    Number.isInteger(sourceSpan.startLine) &&
    Number.isInteger(sourceSpan.endLine) &&
    sourceSpan.endLine < sourceSpan.startLine
  ) {
    errors.push({ path: "endLine", message: "endLine must be >= startLine." });
  }

  if (
    Number.isInteger(sourceSpan.startLine) &&
    Number.isInteger(sourceSpan.endLine) &&
    Number.isInteger(sourceSpan.startColumn) &&
    Number.isInteger(sourceSpan.endColumn) &&
    sourceSpan.endLine === sourceSpan.startLine &&
    sourceSpan.endColumn < sourceSpan.startColumn
  ) {
    errors.push({ path: "endColumn", message: "endColumn must be >= startColumn when startLine=endLine." });
  }

  return errors;
}

function assertPositiveInt(errors: LeafValidationError[], path: string, value: number): void {
  if (!Number.isInteger(value) || value <= 0) {
    errors.push({ path, message: "must be a positive integer." });
  }
}

function normalizeRequired(value: string | undefined, field: string): string {
  const normalized = normalizeOptional(value);
  if (!normalized) {
    throw new Error(`${field} is required.`);
  }
  return normalized;
}

function normalizeOptional(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeStringList(values: string[] | undefined): string[] {
  return Array.from(
    new Set(
      (values ?? [])
        .map((value) => normalizeOptional(value))
        .filter((value): value is string => value !== undefined),
    ),
  ).sort((left, right) => left.localeCompare(right));
}
