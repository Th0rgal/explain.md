import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { mapIngestedDeclarationsToLeaves, type IngestedDeclarationRecord, type TheoremLeafRecord, type TheoremKind } from "./leaf-schema.js";

export const LEAN_INGESTION_SCHEMA_VERSION = "1.0.0";

const LEAN_FILE_EXTENSION = ".lean";
const NAME_TOKEN = String.raw`(?:«[^»]+»|[A-Za-z_][A-Za-z0-9_']*(?:\.[A-Za-z_][A-Za-z0-9_']*)*)`;

const DECLARATION_LINE_REGEX = new RegExp(
  String.raw`^\s*(?:@[\w\.]+\s+)?(?:private\s+|protected\s+|noncomputable\s+|partial\s+|unsafe\s+)*(theorem|lemma|def|abbrev|axiom|inductive|structure|instance|example)\s+(${NAME_TOKEN})\b`,
);

const TOKEN_REGEX = new RegExp(NAME_TOKEN, "g");

const UNSUPPORTED_PREFIX_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /^\s*mutual\b/, reason: "mutual declarations are not yet expanded by the ingestion parser." },
  { pattern: /^\s*opaque\b/, reason: "opaque declarations are not currently indexed." },
  { pattern: /^\s*macro_rules\b/, reason: "macro_rules are not declaration-level proof artifacts." },
  { pattern: /^\s*elab\b/, reason: "elab declarations are not currently indexed." },
];

export interface LeanSourceInput {
  filePath: string;
  content: string;
  modulePath?: string;
}

export interface LeanIngestionWarning {
  code: "unsupported_construct" | "duplicate_declaration" | "parse_fallback";
  message: string;
  filePath: string;
  line: number;
  column: number;
  snippet: string;
}

export interface LeanIndexedDeclaration extends IngestedDeclarationRecord {
  schemaVersion: string;
  declarationId: string;
  modulePath: string;
  declarationName: string;
  theoremKind: TheoremKind;
  statementText: string;
  prettyStatement: string;
  sourceTextHash: string;
}

export interface LeanIngestionResult {
  schemaVersion: string;
  projectRoot: string;
  records: LeanIndexedDeclaration[];
  warnings: LeanIngestionWarning[];
}

export interface LeanIngestionOptions {
  sourceBaseUrl?: string;
  includePaths?: string[];
  excludeDirectories?: string[];
  strictUnsupported?: boolean;
}

interface ParsedDeclaration {
  declarationId: string;
  filePath: string;
  modulePath: string;
  declarationName: string;
  theoremKind: TheoremKind;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  statementText: string;
  prettyStatement: string;
  blockText: string;
  sourceTextHash: string;
}

export async function ingestLeanProject(
  projectRoot: string,
  options: LeanIngestionOptions = {},
): Promise<LeanIngestionResult> {
  const normalizedRoot = path.resolve(projectRoot);
  const leanFiles = await collectLeanFiles(normalizedRoot, {
    includePaths: options.includePaths,
    excludeDirectories: options.excludeDirectories,
  });

  const sources: LeanSourceInput[] = [];
  for (const filePath of leanFiles) {
    const content = await fs.readFile(filePath, "utf8");
    sources.push({ filePath, content });
  }

  return ingestLeanSources(normalizedRoot, sources, options);
}

export function ingestLeanSources(
  projectRoot: string,
  sources: LeanSourceInput[],
  options: LeanIngestionOptions = {},
): LeanIngestionResult {
  const normalizedRoot = path.resolve(projectRoot);
  const warnings: LeanIngestionWarning[] = [];
  const parsed: ParsedDeclaration[] = [];

  const sortedSources = sources
    .map((source) => ({
      ...source,
      filePath: canonicalizeProjectFilePath(normalizedRoot, source.filePath),
    }))
    .sort((left, right) => left.filePath.localeCompare(right.filePath));

  for (const source of sortedSources) {
    const modulePath =
      source.modulePath ??
      modulePathFromFilePath(normalizedRoot, source.filePath);

    const parsedFile = parseLeanDeclarationsFromSource(source.filePath, modulePath, source.content);
    warnings.push(...parsedFile.warnings);
    parsed.push(...parsedFile.declarations);
  }

  parsed.sort((left, right) => {
    if (left.declarationId !== right.declarationId) {
      return left.declarationId.localeCompare(right.declarationId);
    }
    return left.filePath.localeCompare(right.filePath);
  });

  const unique = new Map<string, ParsedDeclaration>();
  for (const declaration of parsed) {
    const existing = unique.get(declaration.declarationId);
    if (existing) {
      warnings.push({
        code: "duplicate_declaration",
        message: `Duplicate declaration id '${declaration.declarationId}' found.`,
        filePath: declaration.filePath,
        line: declaration.startLine,
        column: declaration.startColumn,
        snippet: declaration.declarationName,
      });
      continue;
    }
    unique.set(declaration.declarationId, declaration);
  }

  const records = [...unique.values()];
  const dependenciesById = computeDeclarationDependencies(records);

  const indexedRecords: LeanIndexedDeclaration[] = records
    .map((declaration) => ({
      schemaVersion: LEAN_INGESTION_SCHEMA_VERSION,
      declarationId: declaration.declarationId,
      modulePath: declaration.modulePath,
      declarationName: declaration.declarationName,
      theoremKind: declaration.theoremKind,
      statementText: declaration.statementText,
      prettyStatement: declaration.prettyStatement,
      sourceSpan: {
        filePath: declaration.filePath,
        startLine: declaration.startLine,
        startColumn: declaration.startColumn,
        endLine: declaration.endLine,
        endColumn: declaration.endColumn,
      },
      sourceTextHash: declaration.sourceTextHash,
      dependencyIds: dependenciesById.get(declaration.declarationId) ?? [],
      tags: [],
      sourceUrl: options.sourceBaseUrl
        ? buildSourceUrl(options.sourceBaseUrl, declaration.filePath, declaration.startLine, declaration.startColumn, declaration.endLine, declaration.endColumn)
        : undefined,
    }))
    .sort((left, right) => left.declarationId.localeCompare(right.declarationId));

  const sortedWarnings = warnings.sort((left, right) => {
    if (left.filePath !== right.filePath) {
      return left.filePath.localeCompare(right.filePath);
    }
    if (left.line !== right.line) {
      return left.line - right.line;
    }
    if (left.column !== right.column) {
      return left.column - right.column;
    }
    return left.code.localeCompare(right.code);
  });

  if (options.strictUnsupported) {
    const unsupportedCount = sortedWarnings.filter((warning) => warning.code === "unsupported_construct").length;
    if (unsupportedCount > 0) {
      throw new Error(`Lean ingestion failed: ${unsupportedCount} unsupported constructs detected.`);
    }
  }

  return {
    schemaVersion: LEAN_INGESTION_SCHEMA_VERSION,
    projectRoot: normalizedRoot,
    records: indexedRecords,
    warnings: sortedWarnings,
  };
}

export function mapLeanIngestionToTheoremLeaves(result: LeanIngestionResult): TheoremLeafRecord[] {
  return mapIngestedDeclarationsToLeaves(result.records);
}

export function renderLeanIngestionCanonical(result: LeanIngestionResult): string {
  const lines: string[] = [
    `schema=${result.schemaVersion}`,
    `project_root=${result.projectRoot}`,
    `records=${result.records.length}`,
    `warnings=${result.warnings.length}`,
  ];

  for (const record of result.records) {
    lines.push(
      [
        `record=${record.declarationId}`,
        `module=${record.modulePath}`,
        `name=${record.declarationName}`,
        `kind=${record.theoremKind}`,
        `span=${record.sourceSpan.filePath}:${record.sourceSpan.startLine}:${record.sourceSpan.startColumn}-${record.sourceSpan.endLine}:${record.sourceSpan.endColumn}`,
        `deps=${record.dependencyIds?.join(",") ?? ""}`,
        `hash=${record.sourceTextHash}`,
      ].join("|"),
    );
  }

  for (const warning of result.warnings) {
    lines.push(
      [
        `warning=${warning.code}`,
        `file=${warning.filePath}`,
        `line=${warning.line}`,
        `column=${warning.column}`,
        `message=${JSON.stringify(warning.message)}`,
      ].join("|"),
    );
  }

  return lines.join("\n");
}

export function computeLeanIngestionHash(result: LeanIngestionResult): string {
  return createHash("sha256").update(renderLeanIngestionCanonical(result)).digest("hex");
}

function parseLeanDeclarationsFromSource(
  filePath: string,
  modulePath: string,
  content: string,
): { declarations: ParsedDeclaration[]; warnings: LeanIngestionWarning[] } {
  const normalizedContent = content.replace(/\r\n?/g, "\n");
  const lines = normalizedContent.split("\n");
  const warnings: LeanIngestionWarning[] = [];

  const declarationStarts: Array<{ line: number; kind: TheoremKind; name: string; column: number }> = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const match = DECLARATION_LINE_REGEX.exec(line);
    DECLARATION_LINE_REGEX.lastIndex = 0;

    if (match) {
      const keyword = match[1] as string;
      const name = normalizeLeanName(match[2] as string);
      declarationStarts.push({
        line: index + 1,
        kind: mapKeywordToTheoremKind(keyword),
        name,
        column: (match.index ?? 0) + 1,
      });
    }

    for (const unsupported of UNSUPPORTED_PREFIX_PATTERNS) {
      if (unsupported.pattern.test(line)) {
        warnings.push({
          code: "unsupported_construct",
          message: unsupported.reason,
          filePath,
          line: index + 1,
          column: firstNonWhitespaceColumn(line),
          snippet: line.trim(),
        });
      }
    }
  }

  const declarations: ParsedDeclaration[] = [];

  for (let i = 0; i < declarationStarts.length; i += 1) {
    const start = declarationStarts[i];
    const next = declarationStarts[i + 1];

    const startIndex = start.line - 1;
    const endIndex = next ? next.line - 2 : lines.length - 1;
    const blockLines = lines.slice(startIndex, endIndex + 1);
    const blockText = blockLines.join("\n");

    const statement = extractStatementText(blockText, start.kind, start.name);
    const firstLine = blockLines[0] ?? "";
    const endLineText = blockLines[blockLines.length - 1] ?? "";

    if (!statement) {
      warnings.push({
        code: "parse_fallback",
        message: "Unable to extract a non-empty statement; using declaration heading fallback.",
        filePath,
        line: start.line,
        column: start.column,
        snippet: firstLine.trim(),
      });
    }

    const statementText = statement || `${start.kind} ${start.name}`;
    const declarationId = buildDeclarationId(modulePath, start.name, start.line, start.column);

    declarations.push({
      declarationId,
      filePath,
      modulePath,
      declarationName: start.name,
      theoremKind: start.kind,
      startLine: start.line,
      startColumn: start.column,
      endLine: endIndex + 1,
      endColumn: Math.max(1, endLineText.length),
      statementText,
      prettyStatement: normalizeWhitespace(statementText),
      blockText,
      sourceTextHash: createHash("sha256").update(blockText).digest("hex"),
    });
  }

  return { declarations, warnings };
}

function computeDeclarationDependencies(records: ParsedDeclaration[]): Map<string, string[]> {
  const byId = new Map<string, ParsedDeclaration>();
  const symbolToIds = new Map<string, string[]>();

  for (const record of records) {
    byId.set(record.declarationId, record);

    const fullName = record.declarationName;
    const shortName = fullName.includes(".") ? fullName.split(".").at(-1) ?? fullName : fullName;

    addSymbol(symbolToIds, fullName, record.declarationId);
    addSymbol(symbolToIds, shortName, record.declarationId);
  }

  const dependencies = new Map<string, string[]>();

  for (const record of records) {
    const found = new Set<string>();
    const tokens = record.blockText.match(TOKEN_REGEX) ?? [];

    for (const token of tokens) {
      const normalized = normalizeLeanName(token);
      const candidates = symbolToIds.get(normalized) ?? [];
      for (const candidateId of candidates) {
        if (candidateId !== record.declarationId && byId.has(candidateId)) {
          found.add(candidateId);
        }
      }
    }

    dependencies.set(record.declarationId, [...found].sort((left, right) => left.localeCompare(right)));
  }

  return dependencies;
}

function addSymbol(symbolToIds: Map<string, string[]>, symbol: string, declarationId: string): void {
  const normalized = normalizeLeanName(symbol);
  const existing = symbolToIds.get(normalized) ?? [];
  existing.push(declarationId);
  existing.sort((left, right) => left.localeCompare(right));
  symbolToIds.set(normalized, existing);
}

async function collectLeanFiles(
  projectRoot: string,
  options: { includePaths?: string[]; excludeDirectories?: string[] },
): Promise<string[]> {
  const includePaths = options.includePaths?.length
    ? options.includePaths.map((entry) => path.resolve(projectRoot, entry))
    : [projectRoot];
  const excluded = new Set(options.excludeDirectories ?? [".git", "node_modules", ".lake", "dist", "build"]);
  const files: string[] = [];

  for (const entry of includePaths) {
    const stats = await fs.stat(entry);
    if (stats.isFile()) {
      if (entry.endsWith(LEAN_FILE_EXTENSION)) {
        files.push(normalizePath(entry));
      }
      continue;
    }

    const stack = [entry];
    while (stack.length > 0) {
      const current = stack.pop() as string;
      const children = await fs.readdir(current, { withFileTypes: true });
      children.sort((left, right) => left.name.localeCompare(right.name));

      for (const child of children) {
        const absolute = path.join(current, child.name);
        if (child.isDirectory()) {
          if (!excluded.has(child.name)) {
            stack.push(absolute);
          }
          continue;
        }

        if (child.isFile() && child.name.endsWith(LEAN_FILE_EXTENSION)) {
          files.push(normalizePath(absolute));
        }
      }
    }
  }

  files.sort((left, right) => left.localeCompare(right));
  return files;
}

function modulePathFromFilePath(projectRoot: string, filePath: string): string {
  const relative = path.isAbsolute(filePath) ? path.relative(projectRoot, filePath) : filePath;
  const normalizedRelative = normalizePath(relative);
  if (normalizedRelative.startsWith("..")) {
    return normalizedRelative.replace(new RegExp(`${LEAN_FILE_EXTENSION}$`), "");
  }

  return normalizedRelative.replace(new RegExp(`${LEAN_FILE_EXTENSION}$`), "");
}

function mapKeywordToTheoremKind(keyword: string): TheoremKind {
  if (keyword === "def" || keyword === "abbrev") {
    return "definition";
  }

  if (keyword === "theorem" || keyword === "lemma" || keyword === "axiom" || keyword === "inductive" || keyword === "structure" || keyword === "instance" || keyword === "example") {
    return keyword;
  }

  return "unknown";
}

function extractStatementText(blockText: string, kind: TheoremKind, declarationName: string): string {
  const lines = blockText.split("\n");
  if (lines.length === 0) {
    return "";
  }

  const firstLine = lines[0] ?? "";
  const headingRegex = new RegExp(
    String.raw`^\s*(?:@[\w\.]+\s+)?(?:private\s+|protected\s+|noncomputable\s+|partial\s+|unsafe\s+)*${kind === "definition" ? "(?:def|abbrev)" : kind}\s+${escapeRegExp(declarationName)}\s*`,
  );

  const remainingLines = [firstLine.replace(headingRegex, ""), ...lines.slice(1)];
  const joined = remainingLines.join("\n");

  const proofStart = findProofDelimiterIndex(joined);
  const sliced = proofStart === -1 ? joined : joined.slice(0, proofStart);

  return normalizeWhitespace(sliced);
}

function findProofDelimiterIndex(value: string): number {
  const candidates = [
    value.indexOf(":="),
    value.indexOf(" :="),
    value.indexOf("\nwhere"),
    value.indexOf(" where"),
    value.indexOf("\nby"),
    value.indexOf(" by"),
  ].filter((index) => index >= 0);

  if (candidates.length === 0) {
    return -1;
  }

  return Math.min(...candidates);
}

function buildDeclarationId(modulePath: string, declarationName: string, line: number, column: number): string {
  return `lean:${modulePath}:${declarationName}:${line}:${column}`;
}

function buildSourceUrl(
  sourceBaseUrl: string,
  filePath: string,
  startLine: number,
  startColumn: number,
  endLine: number,
  endColumn: number,
): string {
  const cleanedBase = sourceBaseUrl.replace(/\/+$/, "");
  const encodedPath = normalizePath(filePath)
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");

  return `${cleanedBase}/${encodedPath}#L${startLine}C${startColumn}-L${endLine}C${endColumn}`;
}

function normalizeWhitespace(value: string): string {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeLeanName(name: string): string {
  return name.trim().replace(/^«|»$/g, "");
}

function firstNonWhitespaceColumn(line: string): number {
  const index = line.search(/\S/);
  if (index < 0) {
    return 1;
  }
  return index + 1;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/");
}

function canonicalizeProjectFilePath(projectRoot: string, filePath: string): string {
  const absolute = path.isAbsolute(filePath) ? filePath : path.resolve(projectRoot, filePath);
  const normalizedAbsolute = normalizePath(path.resolve(absolute));
  const normalizedRoot = normalizePath(path.resolve(projectRoot));
  const relative = normalizePath(path.relative(normalizedRoot, normalizedAbsolute));
  if (!relative.startsWith("..") && !path.isAbsolute(relative)) {
    return relative;
  }
  return normalizePath(filePath);
}
