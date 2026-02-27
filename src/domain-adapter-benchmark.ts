import { createHash } from "node:crypto";
import {
  classifyDeclarationDomain,
  computeDomainTaggingReportHash,
  evaluateDomainTagging,
  type DomainClassificationInput,
  type DomainClassificationOptions,
  type DomainTag,
  type DomainTaggingReport,
} from "./domain-adapters.js";

export interface DomainAdapterBenchmarkProfile {
  profileId: string;
  input: DomainClassificationInput;
  options?: DomainClassificationOptions;
  expected: {
    adapterId: string;
    downgradedFromAdapterId?: string;
    requiredTags: DomainTag[];
    forbiddenTags?: DomainTag[];
    warningCodes?: Array<"low_confidence_downgrade" | "forced_adapter_missing" | "manual_override_applied">;
  };
}

export interface DomainAdapterBenchmarkProfileResult {
  profileId: string;
  pass: boolean;
  adapterId: string;
  downgradedFromAdapterId?: string;
  confidence: number;
  tags: DomainTag[];
  warningCodes: Array<"low_confidence_downgrade" | "forced_adapter_missing" | "manual_override_applied">;
  missingRequiredTags: DomainTag[];
  presentForbiddenTags: DomainTag[];
  missingWarningCodes: Array<"low_confidence_downgrade" | "forced_adapter_missing" | "manual_override_applied">;
}

export interface DomainAdapterBenchmarkReport {
  schemaVersion: "1.0.0";
  requestHash: string;
  outcomeHash: string;
  summary: {
    profileCount: number;
    passCount: number;
    downgradedProfileCount: number;
    manualOverrideProfileCount: number;
    macroPrecision: number;
    macroRecall: number;
    macroF1: number;
    taggingReportHash: string;
  };
  profiles: DomainAdapterBenchmarkProfileResult[];
  taggingReport: DomainTaggingReport;
}

const DEFAULT_PROFILES: DomainAdapterBenchmarkProfile[] = [
  {
    profileId: "verity_loop_memory",
    input: {
      declarationId: "lean:Verity/Compiler:loop_ok:10:1",
      modulePath: "Verity/Compiler",
      declarationName: "loop_ok",
      theoremKind: "theorem",
      statementText: "if loop invariant holds then compiler preserves memory state",
    },
    expected: {
      adapterId: "verity-edsl",
      requiredTags: [
        "domain:verity/edsl",
        "concept:loop",
        "concept:conditional",
        "concept:memory",
        "concept:state",
        "concept:compiler_correctness",
      ],
    },
  },
  {
    profileId: "generic_theorem",
    input: {
      declarationId: "lean:Math/Core:refl_demo:1:1",
      modulePath: "Math/Core",
      declarationName: "refl_demo",
      theoremKind: "theorem",
      statementText: "forall n, n = n",
    },
    expected: {
      adapterId: "lean-generic",
      requiredTags: ["domain:lean/general", "kind:theorem"],
    },
  },
  {
    profileId: "low_confidence_downgrade",
    input: {
      declarationId: "lean:Verity/Unknown:misc:1:1",
      modulePath: "Verity/Unknown",
      declarationName: "misc",
      theoremKind: "lemma",
      statementText: "trivial statement",
    },
    options: {
      lowConfidenceThreshold: 0.7,
    },
    expected: {
      adapterId: "lean-generic",
      downgradedFromAdapterId: "verity-edsl",
      requiredTags: ["domain:lean/general", "kind:lemma"],
      warningCodes: ["low_confidence_downgrade"],
    },
  },
  {
    profileId: "manual_override",
    input: {
      declarationId: "lean:Verity/Unknown:misc_override:2:1",
      modulePath: "Verity/Unknown",
      declarationName: "misc_override",
      theoremKind: "lemma",
      statementText: "trivial statement",
    },
    options: {
      lowConfidenceThreshold: 0.7,
      override: {
        addTags: ["concept:state"],
        removeTags: ["kind:lemma"],
      },
    },
    expected: {
      adapterId: "lean-generic",
      downgradedFromAdapterId: "verity-edsl",
      requiredTags: ["domain:lean/general", "concept:state"],
      forbiddenTags: ["kind:lemma"],
      warningCodes: ["low_confidence_downgrade", "manual_override_applied"],
    },
  },
];

export function evaluateDomainAdapterBenchmark(
  profiles: DomainAdapterBenchmarkProfile[] = DEFAULT_PROFILES,
): DomainAdapterBenchmarkReport {
  if (!Array.isArray(profiles) || profiles.length === 0) {
    throw new Error("domain adapter benchmark profiles must contain at least one profile");
  }

  const normalizedProfiles = normalizeProfiles(profiles);
  const results = normalizedProfiles.map((profile) => evaluateProfile(profile));
  const passCount = results.filter((result) => result.pass).length;

  const taggingReport = evaluateDomainTagging(
    normalizedProfiles.map((profile, index) => ({
      sampleId: profile.profileId,
      expectedTags: profile.expected.requiredTags,
      predictedTags: results[index]?.tags ?? [],
    })),
  );
  const taggingReportHash = computeDomainTaggingReportHash(taggingReport);

  const requestHash = computeHash({
    schemaVersion: "1.0.0",
    profiles: normalizedProfiles.map((profile) => ({
      profileId: profile.profileId,
      input: profile.input,
      options: profile.options ?? {},
      expected: profile.expected,
    })),
  });

  const summary = {
    profileCount: results.length,
    passCount,
    downgradedProfileCount: results.filter((result) => typeof result.downgradedFromAdapterId === "string").length,
    manualOverrideProfileCount: results.filter((result) => result.warningCodes.includes("manual_override_applied")).length,
    macroPrecision: taggingReport.macroPrecision,
    macroRecall: taggingReport.macroRecall,
    macroF1: taggingReport.macroF1,
    taggingReportHash,
  };

  const outcomeHash = computeHash({
    schemaVersion: "1.0.0",
    summary,
    profiles: results,
  });

  return {
    schemaVersion: "1.0.0",
    requestHash,
    outcomeHash,
    summary,
    profiles: results,
    taggingReport,
  };
}

function evaluateProfile(profile: DomainAdapterBenchmarkProfile): DomainAdapterBenchmarkProfileResult {
  const classification = classifyDeclarationDomain(profile.input, profile.options ?? {});
  const tagSet = new Set(classification.tags);
  const warningCodes = classification.warnings.map((warning) => warning.code).sort((left, right) => left.localeCompare(right));
  const warningCodeSet = new Set(warningCodes);
  const expectedWarnings = profile.expected.warningCodes ?? [];

  const missingRequiredTags = profile.expected.requiredTags.filter((tag) => !tagSet.has(tag));
  const presentForbiddenTags = (profile.expected.forbiddenTags ?? []).filter((tag) => tagSet.has(tag));
  const missingWarningCodes = expectedWarnings.filter((code) => !warningCodeSet.has(code));

  const pass =
    classification.adapterId === profile.expected.adapterId &&
    normalizeOptionalString(classification.downgradedFromAdapterId) ===
      normalizeOptionalString(profile.expected.downgradedFromAdapterId) &&
    missingRequiredTags.length === 0 &&
    presentForbiddenTags.length === 0 &&
    missingWarningCodes.length === 0;

  return {
    profileId: profile.profileId,
    pass,
    adapterId: classification.adapterId,
    downgradedFromAdapterId: normalizeOptionalString(classification.downgradedFromAdapterId),
    confidence: classification.confidence,
    tags: classification.tags,
    warningCodes,
    missingRequiredTags,
    presentForbiddenTags,
    missingWarningCodes,
  };
}

function normalizeProfiles(profiles: DomainAdapterBenchmarkProfile[]): DomainAdapterBenchmarkProfile[] {
  const dedup = new Map<string, DomainAdapterBenchmarkProfile>();
  for (const profile of profiles) {
    if (!profile || typeof profile !== "object") {
      throw new Error("domain adapter benchmark profile must be an object");
    }
    const profileId = profile.profileId.trim();
    if (profileId.length === 0) {
      throw new Error("domain adapter benchmark profileId must be non-empty");
    }
    if (dedup.has(profileId)) {
      throw new Error(`duplicate domain adapter benchmark profileId '${profileId}'`);
    }
    dedup.set(profileId, {
      ...profile,
      profileId,
      expected: {
        ...profile.expected,
        requiredTags: uniqueSortedTags(profile.expected.requiredTags),
        forbiddenTags: uniqueSortedTags(profile.expected.forbiddenTags ?? []),
        warningCodes: uniqueSortedWarnings(profile.expected.warningCodes ?? []),
      },
    });
  }
  return [...dedup.values()].sort((left, right) => left.profileId.localeCompare(right.profileId));
}

function uniqueSortedTags(values: DomainTag[]): DomainTag[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function uniqueSortedWarnings(
  values: Array<"low_confidence_downgrade" | "forced_adapter_missing" | "manual_override_applied">,
): Array<"low_confidence_downgrade" | "forced_adapter_missing" | "manual_override_applied"> {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function computeHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
