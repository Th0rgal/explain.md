import { createHash } from "node:crypto";
import type { ExplanationConfigInput } from "../../../src/config-contract";
import { buildExplanationDiffPanelView } from "./explanation-diff-view";
import { buildProofDiff, SEED_PROOF_ID } from "./proof-service";

const SCHEMA_VERSION = "1.0.0";
const DIFF_PANEL_MAX_CHANGES = 2;

const BASELINE_CONFIG: ExplanationConfigInput = {
  abstractionLevel: 3,
  complexityLevel: 3,
  maxChildrenPerParent: 3,
  audienceLevel: "intermediate",
  language: "en",
  readingLevelTarget: "high_school",
  complexityBandWidth: 1,
  termIntroductionBudget: 2,
  proofDetailMode: "balanced",
  entailmentMode: "calibrated",
};

interface DiffProfile {
  profileId: string;
  candidateConfig: ExplanationConfigInput;
}

export interface ExplanationDiffEvaluationComparison {
  profileId: string;
  changedFields: string[];
  regenerationScope: string;
  diffHash: string;
  requestHash: string;
  summary: {
    total: number;
    changed: number;
    added: number;
    removed: number;
    rendered: number;
    truncated: number;
  };
  support: {
    totalSupportLeafRefs: number;
    zeroSupportChangeCount: number;
  };
  sortedOrderingPass: boolean;
}

export interface ExplanationDiffEvaluationReport {
  schemaVersion: string;
  requestHash: string;
  outcomeHash: string;
  parameters: {
    proofId: string;
    maxPanelChanges: number;
    profiles: Array<{
      profileId: string;
      candidateConfig: ExplanationConfigInput;
    }>;
  };
  summary: {
    profileCount: number;
    totalChanges: number;
    changedProfiles: number;
    truncatedProfiles: number;
    provenanceCoveredChanges: number;
    zeroSupportChangeCount: number;
    orderingPassProfiles: number;
    coverage: {
      abstractionLevel: boolean;
      complexityLevel: boolean;
      maxChildrenPerParent: boolean;
      language: boolean;
      audienceLevel: boolean;
    };
  };
  comparisons: ExplanationDiffEvaluationComparison[];
}

export async function runExplanationDiffEvaluation(): Promise<ExplanationDiffEvaluationReport> {
  const profiles = buildProfiles();

  const requestHash = computeHash({
    schemaVersion: SCHEMA_VERSION,
    proofId: SEED_PROOF_ID,
    maxPanelChanges: DIFF_PANEL_MAX_CHANGES,
    baselineConfig: BASELINE_CONFIG,
    profiles,
  });

  const comparisons: ExplanationDiffEvaluationComparison[] = [];
  for (const profile of profiles) {
    const diff = await buildProofDiff({
      proofId: SEED_PROOF_ID,
      baselineConfig: BASELINE_CONFIG,
      candidateConfig: profile.candidateConfig,
    });

    const panelView = buildExplanationDiffPanelView(diff.report, { maxChanges: DIFF_PANEL_MAX_CHANGES });
    const visibleChanges = [...panelView.changed, ...panelView.added, ...panelView.removed];

    const supportLeafCount = visibleChanges.reduce((sum, change) => sum + change.supportLeafCount, 0);
    const zeroSupportChangeCount = visibleChanges.filter((change) => change.supportLeafCount === 0).length;
    const observedKeys = visibleChanges.map((change) => change.key);
    const expectedKeys = observedKeys.slice().sort((left, right) => left.localeCompare(right));

    comparisons.push({
      profileId: profile.profileId,
      changedFields: diff.report.regenerationPlan.changedFields.slice().sort((left, right) => left.localeCompare(right)),
      regenerationScope: diff.report.regenerationPlan.scope,
      diffHash: diff.diffHash,
      requestHash: diff.requestHash,
      summary: {
        total: diff.report.summary.total,
        changed: diff.report.summary.changed,
        added: diff.report.summary.added,
        removed: diff.report.summary.removed,
        rendered: panelView.renderedChanges,
        truncated: panelView.truncatedChangeCount,
      },
      support: {
        totalSupportLeafRefs: supportLeafCount,
        zeroSupportChangeCount,
      },
      sortedOrderingPass: JSON.stringify(observedKeys) === JSON.stringify(expectedKeys),
    });
  }

  const changedFieldSet = new Set(comparisons.flatMap((comparison) => comparison.changedFields));
  const summary: ExplanationDiffEvaluationReport["summary"] = {
    profileCount: comparisons.length,
    totalChanges: comparisons.reduce((sum, comparison) => sum + comparison.summary.total, 0),
    changedProfiles: comparisons.filter((comparison) => comparison.summary.total > 0).length,
    truncatedProfiles: comparisons.filter((comparison) => comparison.summary.truncated > 0).length,
    provenanceCoveredChanges: comparisons.reduce((sum, comparison) => sum + comparison.support.totalSupportLeafRefs, 0),
    zeroSupportChangeCount: comparisons.reduce((sum, comparison) => sum + comparison.support.zeroSupportChangeCount, 0),
    orderingPassProfiles: comparisons.filter((comparison) => comparison.sortedOrderingPass).length,
    coverage: {
      abstractionLevel: changedFieldSet.has("abstractionLevel"),
      complexityLevel: changedFieldSet.has("complexityLevel"),
      maxChildrenPerParent: changedFieldSet.has("maxChildrenPerParent"),
      language: changedFieldSet.has("language"),
      audienceLevel: changedFieldSet.has("audienceLevel"),
    },
  };

  const outcomeHash = computeHash({
    schemaVersion: SCHEMA_VERSION,
    summary,
    comparisons,
  });

  return {
    schemaVersion: SCHEMA_VERSION,
    requestHash,
    outcomeHash,
    parameters: {
      proofId: SEED_PROOF_ID,
      maxPanelChanges: DIFF_PANEL_MAX_CHANGES,
      profiles,
    },
    summary,
    comparisons,
  };
}

function buildProfiles(): DiffProfile[] {
  return [
    {
      profileId: "abstraction-shift",
      candidateConfig: {
        ...BASELINE_CONFIG,
        abstractionLevel: 5,
      },
    },
    {
      profileId: "complexity-shift",
      candidateConfig: {
        ...BASELINE_CONFIG,
        complexityLevel: 1,
        maxChildrenPerParent: 2,
        termIntroductionBudget: 1,
      },
    },
    {
      profileId: "language-audience-shift",
      candidateConfig: {
        ...BASELINE_CONFIG,
        language: "fr",
        audienceLevel: "novice",
        readingLevelTarget: "middle_school",
      },
    },
  ];
}

function computeHash(input: unknown): string {
  const canonical = canonicalize(input);
  return createHash("sha256").update(canonical).digest("hex");
}

function canonicalize(input: unknown): string {
  return JSON.stringify(sortValue(input));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sortValue(entry));
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right));
    return Object.fromEntries(entries.map(([key, entry]) => [key, sortValue(entry)]));
  }

  return value;
}
