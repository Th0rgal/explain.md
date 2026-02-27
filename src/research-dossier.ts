import { createHash } from "node:crypto";

export interface ResearchCitation {
  id: string;
  title: string;
  authors: string[];
  year: number;
  venue: string;
  url: string;
  relevance: string;
}

export interface ResearchDecision {
  id: string;
  issue: number;
  decision: string;
  rationale: string;
  implementationRefs: string[];
  citationIds: string[];
  evidenceChecks: ResearchEvidenceCheck[];
}

export interface ResearchOpenQuestion {
  id: string;
  question: string;
  risk: string;
  nextCheck: string;
}

export interface ResearchDossierEvidence {
  schemaVersion: string;
  scope: {
    objective: string;
    requiredIssueCoverage: number[];
  };
  citations: ResearchCitation[];
  designDecisions: ResearchDecision[];
  openQuestions: ResearchOpenQuestion[];
}

export interface ResearchDossierValidationIssue {
  path: string;
  message: string;
}

export type ResearchDossierRefExists = (path: string) => boolean;
export type ResearchDossierArtifactHashResolver = (path: string) => string | undefined;
export type ResearchDossierEvidenceCheckOutcomeHashResolver = (check: ResearchEvidenceCheck) => string | undefined;

export interface ResearchEvidenceCheck {
  id: string;
  command: string;
  artifactPath: string;
  expectedSha256: string;
  expectedCommandOutcomeSha256: string;
}

export interface ResearchEvidenceCheckCommandOutcome {
  command: string;
  artifactPath: string;
  artifactSha256: string;
  exitCode: number;
}

const REQUIRED_ISSUE_COVERAGE = [7, 8, 9, 18, 23, 25] as const;

export function getRequiredResearchIssueCoverage(): number[] {
  return Array.from(REQUIRED_ISSUE_COVERAGE);
}

export function validateResearchDossierEvidence(input: unknown): {
  evidence?: ResearchDossierEvidence;
  issues: ResearchDossierValidationIssue[];
} {
  const issues: ResearchDossierValidationIssue[] = [];

  if (!isRecord(input)) {
    return {
      issues: [{ path: "root", message: "Expected a JSON object." }],
    };
  }

  const schemaVersion = asString(input.schemaVersion, "schemaVersion", issues);
  const scope = parseScope(input.scope, issues);
  const citations = parseCitations(input.citations, issues);
  const decisions = parseDecisions(input.designDecisions, issues);
  const openQuestions = parseOpenQuestions(input.openQuestions, issues);

  if (issues.length > 0 || !schemaVersion || !scope) {
    return { issues };
  }

  const evidence: ResearchDossierEvidence = {
    schemaVersion,
    scope,
    citations,
    designDecisions: decisions,
    openQuestions,
  };

  validateCrossReferences(evidence, issues);

  if (issues.length > 0) {
    return { issues };
  }

  return { evidence: canonicalizeResearchDossierEvidence(evidence), issues };
}

export function renderResearchDossierEvidenceCanonical(evidence: ResearchDossierEvidence): string {
  return JSON.stringify(canonicalizeResearchDossierEvidence(evidence));
}

export function computeResearchDossierEvidenceHash(evidence: ResearchDossierEvidence): string {
  return createHash("sha256").update(renderResearchDossierEvidenceCanonical(evidence)).digest("hex");
}

export function validateResearchDossierImplementationRefs(
  evidence: ResearchDossierEvidence,
  refExists: ResearchDossierRefExists,
): ResearchDossierValidationIssue[] {
  const issues: ResearchDossierValidationIssue[] = [];
  for (const decision of evidence.designDecisions) {
    for (const refPath of decision.implementationRefs) {
      if (!refExists(refPath)) {
        issues.push({
          path: `designDecisions.${decision.id}.implementationRefs`,
          message: `Implementation reference '${refPath}' does not exist in repository.`,
        });
      }
    }
  }
  return issues;
}

export function validateResearchDossierEvidenceChecks(
  evidence: ResearchDossierEvidence,
  resolveArtifactHash: ResearchDossierArtifactHashResolver,
): ResearchDossierValidationIssue[] {
  const issues: ResearchDossierValidationIssue[] = [];
  for (const decision of evidence.designDecisions) {
    for (const check of decision.evidenceChecks) {
      const actualHash = resolveArtifactHash(check.artifactPath);
      if (!actualHash) {
        issues.push({
          path: `designDecisions.${decision.id}.evidenceChecks.${check.id}`,
          message: `Evidence artifact '${check.artifactPath}' does not exist or hash resolution failed.`,
        });
        continue;
      }
      if (actualHash !== check.expectedSha256) {
        issues.push({
          path: `designDecisions.${decision.id}.evidenceChecks.${check.id}.expectedSha256`,
          message: `Expected sha256 '${check.expectedSha256}' but resolved '${actualHash}' for '${check.artifactPath}'.`,
        });
      }
    }
  }
  return issues;
}

export function renderResearchEvidenceCheckCommandOutcomeCanonical(
  outcome: ResearchEvidenceCheckCommandOutcome,
): string {
  return JSON.stringify({
    command: outcome.command,
    artifactPath: outcome.artifactPath,
    artifactSha256: outcome.artifactSha256,
    exitCode: outcome.exitCode,
  });
}

export function computeResearchEvidenceCheckCommandOutcomeHash(outcome: ResearchEvidenceCheckCommandOutcome): string {
  return createHash("sha256").update(renderResearchEvidenceCheckCommandOutcomeCanonical(outcome)).digest("hex");
}

export function validateResearchDossierEvidenceCommandOutcomes(
  evidence: ResearchDossierEvidence,
  resolveOutcomeHash: ResearchDossierEvidenceCheckOutcomeHashResolver,
): ResearchDossierValidationIssue[] {
  const issues: ResearchDossierValidationIssue[] = [];
  for (const decision of evidence.designDecisions) {
    for (const check of decision.evidenceChecks) {
      const actualHash = resolveOutcomeHash(check);
      if (!actualHash) {
        issues.push({
          path: `designDecisions.${decision.id}.evidenceChecks.${check.id}.expectedCommandOutcomeSha256`,
          message: `Command outcome hash resolution failed for '${check.command}'.`,
        });
        continue;
      }
      if (actualHash !== check.expectedCommandOutcomeSha256) {
        issues.push({
          path: `designDecisions.${decision.id}.evidenceChecks.${check.id}.expectedCommandOutcomeSha256`,
          message: `Expected command outcome sha256 '${check.expectedCommandOutcomeSha256}' but resolved '${actualHash}' for '${check.command}'.`,
        });
      }
    }
  }
  return issues;
}

function validateCrossReferences(evidence: ResearchDossierEvidence, issues: ResearchDossierValidationIssue[]): void {
  const citationIds = new Set(evidence.citations.map((citation) => citation.id));
  const seenDecisionIds = new Set<string>();
  const seenEvidenceCheckIds = new Set<string>();
  const coveredIssues = new Set<number>();

  const requiredCoverage = uniqueInts(evidence.scope.requiredIssueCoverage).sort((left, right) => left - right);
  if (
    requiredCoverage.length !== REQUIRED_ISSUE_COVERAGE.length ||
    requiredCoverage.some((issue, index) => issue !== REQUIRED_ISSUE_COVERAGE[index])
  ) {
    issues.push({
      path: "scope.requiredIssueCoverage",
      message: `requiredIssueCoverage must exactly match [${REQUIRED_ISSUE_COVERAGE.join(", ")}].`,
    });
  }

  for (const decision of evidence.designDecisions) {
    if (seenDecisionIds.has(decision.id)) {
      issues.push({ path: `designDecisions.${decision.id}`, message: "Decision id must be unique." });
    }
    seenDecisionIds.add(decision.id);
    coveredIssues.add(decision.issue);

    for (const citationId of decision.citationIds) {
      if (!citationIds.has(citationId)) {
        issues.push({
          path: `designDecisions.${decision.id}.citationIds`,
          message: `Citation '${citationId}' is not defined in citations.`,
        });
      }
    }

    for (const check of decision.evidenceChecks) {
      if (seenEvidenceCheckIds.has(check.id)) {
        issues.push({
          path: `designDecisions.${decision.id}.evidenceChecks`,
          message: `Evidence check id '${check.id}' must be globally unique.`,
        });
      }
      seenEvidenceCheckIds.add(check.id);
    }
  }

  for (const issue of REQUIRED_ISSUE_COVERAGE) {
    if (!coveredIssues.has(issue)) {
      issues.push({
        path: "designDecisions",
        message: `Missing required issue coverage for #${issue}.`,
      });
    }
  }
}

function canonicalizeResearchDossierEvidence(evidence: ResearchDossierEvidence): ResearchDossierEvidence {
  return {
    ...evidence,
    scope: {
      ...evidence.scope,
      requiredIssueCoverage: uniqueInts(evidence.scope.requiredIssueCoverage).sort((left, right) => left - right),
    },
    citations: evidence.citations
      .map((citation) => ({
        ...citation,
        authors: uniqueStrings(citation.authors).sort((left, right) => left.localeCompare(right)),
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    designDecisions: evidence.designDecisions
      .map((decision) => ({
        ...decision,
        implementationRefs: uniqueStrings(decision.implementationRefs).sort((left, right) => left.localeCompare(right)),
        citationIds: uniqueStrings(decision.citationIds).sort((left, right) => left.localeCompare(right)),
        evidenceChecks: decision.evidenceChecks
          .slice()
          .sort((left, right) => left.id.localeCompare(right.id))
          .map((check) => ({ ...check })),
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    openQuestions: evidence.openQuestions.slice().sort((left, right) => left.id.localeCompare(right.id)),
  };
}

function parseScope(value: unknown, issues: ResearchDossierValidationIssue[]): ResearchDossierEvidence["scope"] | undefined {
  if (!isRecord(value)) {
    issues.push({ path: "scope", message: "Expected an object." });
    return undefined;
  }

  const objective = asString(value.objective, "scope.objective", issues);
  const requiredIssueCoverage = asIntArray(value.requiredIssueCoverage, "scope.requiredIssueCoverage", issues);

  if (!objective || !requiredIssueCoverage) {
    return undefined;
  }

  return {
    objective,
    requiredIssueCoverage,
  };
}

function parseCitations(value: unknown, issues: ResearchDossierValidationIssue[]): ResearchCitation[] {
  if (!Array.isArray(value)) {
    issues.push({ path: "citations", message: "Expected an array." });
    return [];
  }

  return value
    .map((entry, index): ResearchCitation | undefined => {
      if (!isRecord(entry)) {
        issues.push({ path: `citations.${index}`, message: "Expected an object." });
        return undefined;
      }

      const id = asString(entry.id, `citations.${index}.id`, issues);
      const title = asString(entry.title, `citations.${index}.title`, issues);
      const authors = asStringArray(entry.authors, `citations.${index}.authors`, issues);
      const year = asInt(entry.year, `citations.${index}.year`, issues);
      const venue = asString(entry.venue, `citations.${index}.venue`, issues);
      const url = asString(entry.url, `citations.${index}.url`, issues);
      const relevance = asString(entry.relevance, `citations.${index}.relevance`, issues);

      if (!id || !title || !authors || year === undefined || !venue || !url || !relevance) {
        return undefined;
      }

      if (!url.startsWith("https://")) {
        issues.push({ path: `citations.${index}.url`, message: "Must use https:// URL." });
      }

      return {
        id,
        title,
        authors,
        year,
        venue,
        url,
        relevance,
      };
    })
    .filter((entry): entry is ResearchCitation => entry !== undefined);
}

function parseDecisions(value: unknown, issues: ResearchDossierValidationIssue[]): ResearchDecision[] {
  if (!Array.isArray(value)) {
    issues.push({ path: "designDecisions", message: "Expected an array." });
    return [];
  }

  return value
    .map((entry, index): ResearchDecision | undefined => {
      if (!isRecord(entry)) {
        issues.push({ path: `designDecisions.${index}`, message: "Expected an object." });
        return undefined;
      }

      const id = asString(entry.id, `designDecisions.${index}.id`, issues);
      const issue = asInt(entry.issue, `designDecisions.${index}.issue`, issues);
      const decision = asString(entry.decision, `designDecisions.${index}.decision`, issues);
      const rationale = asString(entry.rationale, `designDecisions.${index}.rationale`, issues);
      const implementationRefs = asStringArray(entry.implementationRefs, `designDecisions.${index}.implementationRefs`, issues);
      const citationIds = asStringArray(entry.citationIds, `designDecisions.${index}.citationIds`, issues);
      const evidenceChecks = parseEvidenceChecks(entry.evidenceChecks, `designDecisions.${index}.evidenceChecks`, issues);

      if (!id || issue === undefined || !decision || !rationale || !implementationRefs || !citationIds || !evidenceChecks) {
        return undefined;
      }

      if (implementationRefs.length === 0) {
        issues.push({
          path: `designDecisions.${index}.implementationRefs`,
          message: "At least one implementation reference is required.",
        });
      }
      if (citationIds.length === 0) {
        issues.push({
          path: `designDecisions.${index}.citationIds`,
          message: "At least one citation is required.",
        });
      }
      if (evidenceChecks.length === 0) {
        issues.push({
          path: `designDecisions.${index}.evidenceChecks`,
          message: "At least one evidence check is required.",
        });
      }

      return {
        id,
        issue,
        decision,
        rationale,
        implementationRefs,
        citationIds,
        evidenceChecks,
      };
    })
    .filter((entry): entry is ResearchDecision => entry !== undefined);
}

function parseEvidenceChecks(
  value: unknown,
  path: string,
  issues: ResearchDossierValidationIssue[],
): ResearchEvidenceCheck[] | undefined {
  if (!Array.isArray(value)) {
    issues.push({ path, message: "Expected an array." });
    return undefined;
  }

  return value
    .map((entry, index): ResearchEvidenceCheck | undefined => {
      if (!isRecord(entry)) {
        issues.push({ path: `${path}.${index}`, message: "Expected an object." });
        return undefined;
      }

      const id = asString(entry.id, `${path}.${index}.id`, issues);
      const command = asString(entry.command, `${path}.${index}.command`, issues);
      const artifactPath = asString(entry.artifactPath, `${path}.${index}.artifactPath`, issues);
      const expectedSha256 = asString(entry.expectedSha256, `${path}.${index}.expectedSha256`, issues);
      const expectedCommandOutcomeSha256 = asString(
        entry.expectedCommandOutcomeSha256,
        `${path}.${index}.expectedCommandOutcomeSha256`,
        issues,
      );

      if (!id || !command || !artifactPath || !expectedSha256 || !expectedCommandOutcomeSha256) {
        return undefined;
      }
      if (!/^[a-f0-9]{64}$/i.test(expectedSha256)) {
        issues.push({ path: `${path}.${index}.expectedSha256`, message: "Must be a 64-character hex sha256 string." });
      }
      if (!/^[a-f0-9]{64}$/i.test(expectedCommandOutcomeSha256)) {
        issues.push({
          path: `${path}.${index}.expectedCommandOutcomeSha256`,
          message: "Must be a 64-character hex sha256 string.",
        });
      }

      return {
        id,
        command,
        artifactPath,
        expectedSha256: expectedSha256.toLowerCase(),
        expectedCommandOutcomeSha256: expectedCommandOutcomeSha256.toLowerCase(),
      };
    })
    .filter((entry): entry is ResearchEvidenceCheck => entry !== undefined);
}

function parseOpenQuestions(value: unknown, issues: ResearchDossierValidationIssue[]): ResearchOpenQuestion[] {
  if (!Array.isArray(value)) {
    issues.push({ path: "openQuestions", message: "Expected an array." });
    return [];
  }

  return value
    .map((entry, index): ResearchOpenQuestion | undefined => {
      if (!isRecord(entry)) {
        issues.push({ path: `openQuestions.${index}`, message: "Expected an object." });
        return undefined;
      }

      const id = asString(entry.id, `openQuestions.${index}.id`, issues);
      const question = asString(entry.question, `openQuestions.${index}.question`, issues);
      const risk = asString(entry.risk, `openQuestions.${index}.risk`, issues);
      const nextCheck = asString(entry.nextCheck, `openQuestions.${index}.nextCheck`, issues);

      if (!id || !question || !risk || !nextCheck) {
        return undefined;
      }

      return {
        id,
        question,
        risk,
        nextCheck,
      };
    })
    .filter((entry): entry is ResearchOpenQuestion => entry !== undefined);
}

function asString(value: unknown, path: string, issues: ResearchDossierValidationIssue[]): string | undefined {
  if (typeof value !== "string") {
    issues.push({ path, message: "Expected a string." });
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    issues.push({ path, message: "Must not be empty." });
    return undefined;
  }
  return trimmed;
}

function asInt(value: unknown, path: string, issues: ResearchDossierValidationIssue[]): number | undefined {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    issues.push({ path, message: "Expected an integer." });
    return undefined;
  }
  return value;
}

function asStringArray(value: unknown, path: string, issues: ResearchDossierValidationIssue[]): string[] | undefined {
  if (!Array.isArray(value)) {
    issues.push({ path, message: "Expected an array." });
    return undefined;
  }
  const out: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const entry = value[index];
    if (typeof entry !== "string") {
      issues.push({ path: `${path}.${index}`, message: "Expected a string." });
      continue;
    }
    const trimmed = entry.trim();
    if (trimmed.length === 0) {
      issues.push({ path: `${path}.${index}`, message: "Must not be empty." });
      continue;
    }
    out.push(trimmed);
  }
  return out;
}

function asIntArray(value: unknown, path: string, issues: ResearchDossierValidationIssue[]): number[] | undefined {
  if (!Array.isArray(value)) {
    issues.push({ path, message: "Expected an array." });
    return undefined;
  }
  const out: number[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const entry = value[index];
    if (typeof entry !== "number" || !Number.isInteger(entry)) {
      issues.push({ path: `${path}.${index}`, message: "Expected an integer." });
      continue;
    }
    out.push(entry);
  }
  return out;
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

function uniqueInts(values: number[]): number[] {
  return Array.from(new Set(values));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
