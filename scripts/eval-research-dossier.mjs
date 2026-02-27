#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { existsSync } from "node:fs";

const args = parseArgs(process.argv.slice(2));
const evidencePath = resolve(args.evidence ?? "docs/research-dossier-evidence.json");
const outPath = args.out ? resolve(args.out) : undefined;

const mod = await import("../dist/research-dossier.js");

const rawText = await readFile(evidencePath, "utf8");
const raw = JSON.parse(rawText);

const validation = mod.validateResearchDossierEvidence(raw);
if (!validation.evidence) {
  const report = {
    ok: false,
    evidencePath,
    errors: validation.issues,
  };
  if (outPath) {
    await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }
  console.error(JSON.stringify(report, null, 2));
  process.exitCode = 2;
} else {
  const canonical = mod.renderResearchDossierEvidenceCanonical(validation.evidence);
  const implementationRefIssues = mod.validateResearchDossierImplementationRefs(validation.evidence, (path) =>
    existsSync(resolve(path)),
  );
  if (implementationRefIssues.length > 0) {
    const report = {
      ok: false,
      evidencePath,
      errors: implementationRefIssues,
    };
    if (outPath) {
      await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    }
    console.error(JSON.stringify(report, null, 2));
    process.exitCode = 2;
  } else {
    const report = {
      ok: true,
      evidencePath,
      requiredIssueCoverage: mod.getRequiredResearchIssueCoverage(),
      coveredIssues: Array.from(new Set(validation.evidence.designDecisions.map((entry) => entry.issue))).sort((a, b) => a - b),
      citationCount: validation.evidence.citations.length,
      decisionCount: validation.evidence.designDecisions.length,
      openQuestionCount: validation.evidence.openQuestions.length,
      requestHash: createHash("sha256").update(JSON.stringify({ evidencePath })).digest("hex"),
      outcomeHash: mod.computeResearchDossierEvidenceHash(validation.evidence),
      canonicalHash: createHash("sha256").update(canonical).digest("hex"),
    };
    if (outPath) {
      await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    }
    console.log(JSON.stringify(report, null, 2));
  }
}

function parseArgs(argv) {
  const out = {};
  for (const token of argv) {
    if (!token.startsWith("--")) continue;
    const [key, value] = token.slice(2).split("=", 2);
    if (value === undefined) {
      out[key] = "true";
    } else {
      out[key] = value;
    }
  }
  return out;
}
