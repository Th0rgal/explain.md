import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  computeResearchEvidenceCheckCommandOutcomeHash,
  computeResearchDossierEvidenceHash,
  getRequiredResearchIssueCoverage,
  renderResearchDossierEvidenceCanonical,
  validateResearchDossierEvidenceCommandOutcomes,
  validateResearchDossierEvidenceChecks,
  validateResearchDossierImplementationRefs,
  validateResearchDossierEvidence,
  type ResearchDossierEvidence,
} from "../src/research-dossier.js";

function loadEvidence(): ResearchDossierEvidence {
  const path = resolve("docs/research-dossier-evidence.json");
  const raw = JSON.parse(readFileSync(path, "utf8"));
  const validation = validateResearchDossierEvidence(raw);
  if (!validation.evidence) {
    throw new Error(`research dossier evidence must validate: ${JSON.stringify(validation.issues)}`);
  }
  return validation.evidence;
}

describe("research-dossier evidence contract", () => {
  it("validates and covers all required issues", () => {
    const evidence = loadEvidence();
    const coveredIssues = new Set(evidence.designDecisions.map((decision) => decision.issue));

    for (const requiredIssue of getRequiredResearchIssueCoverage()) {
      expect(coveredIssues.has(requiredIssue)).toBe(true);
    }
  });

  it("produces stable canonical bytes and hash independent of ordering", () => {
    const evidence = loadEvidence();
    const shuffled: ResearchDossierEvidence = {
      ...evidence,
      citations: evidence.citations.slice().reverse(),
      designDecisions: evidence.designDecisions.slice().reverse(),
      openQuestions: evidence.openQuestions.slice().reverse(),
    };

    expect(renderResearchDossierEvidenceCanonical(evidence)).toBe(renderResearchDossierEvidenceCanonical(shuffled));
    expect(computeResearchDossierEvidenceHash(evidence)).toBe(computeResearchDossierEvidenceHash(shuffled));
  });

  it("keeps citation references closed over defined citation ids", () => {
    const evidence = loadEvidence();
    const citationIds = new Set(evidence.citations.map((citation) => citation.id));

    for (const decision of evidence.designDecisions) {
      for (const citationId of decision.citationIds) {
        expect(citationIds.has(citationId)).toBe(true);
      }
    }
  });

  it("fails when an implementation reference path is missing", () => {
    const evidence = loadEvidence();
    const issues = validateResearchDossierImplementationRefs(evidence, () => false);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0]?.message).toContain("does not exist");
  });

  it("validates pinned evidence check artifact hashes", () => {
    const evidence = loadEvidence();
    const issues = validateResearchDossierEvidenceChecks(evidence, (path) => {
      const absolutePath = resolve(path);
      const content = readFileSync(absolutePath);
      return createHash("sha256").update(content).digest("hex");
    });
    expect(issues).toHaveLength(0);
  });

  it("validates pinned evidence-check command outcome hashes", () => {
    const evidence = loadEvidence();
    const issues = validateResearchDossierEvidenceCommandOutcomes(evidence, (check) =>
      computeResearchEvidenceCheckCommandOutcomeHash({
        command: check.command,
        artifactPath: check.artifactPath,
        artifactSha256: check.expectedSha256,
        exitCode: 0,
      }),
    );
    expect(issues).toHaveLength(0);
  });

  it("fails when an evidence check hash does not match", () => {
    const evidence = loadEvidence();
    const issues = validateResearchDossierEvidenceChecks(evidence, () => "0".repeat(64));
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0]?.message).toContain("Expected sha256");
  });

  it("fails when an evidence-check command outcome hash does not match", () => {
    const evidence = loadEvidence();
    const issues = validateResearchDossierEvidenceCommandOutcomes(evidence, () => "0".repeat(64));
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0]?.message).toContain("Expected command outcome sha256");
  });
});
