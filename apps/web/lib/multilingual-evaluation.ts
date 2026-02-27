import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  buildProofLeafDetail,
  buildProofNodeChildrenView,
  buildProofNodePathView,
  buildProofRootView,
  clearProofDatasetCacheForTests,
  LEAN_FIXTURE_PROOF_ID,
  SEED_PROOF_ID,
} from "./proof-service";

const SCHEMA_VERSION = "1.0.0";

interface ProfileDefinition {
  profileId: string;
  proofId: string;
  expectedLeafId: string;
}

const PROFILES: ProfileDefinition[] = [
  {
    profileId: "seed-verity",
    proofId: SEED_PROOF_ID,
    expectedLeafId: "Verity.ContractSpec.init_sound",
  },
  {
    profileId: "lean-verity-fixture",
    proofId: LEAN_FIXTURE_PROOF_ID,
    expectedLeafId: "lean:Verity/Core:core_safe:8:1",
  },
];

export interface MultilingualEvaluationComparison {
  profileId: string;
  proofId: string;
  rootId: string;
  rootHashes: {
    en: string;
    fr: string;
    frCa: string;
    fallback: string;
  };
  requestHashes: {
    rootEn: string;
    rootFr: string;
    rootFrCa: string;
    rootFallback: string;
    childrenEn: string;
    childrenFr: string;
    pathEn: string;
    pathFr: string;
    leafEn: string;
    leafFr: string;
  };
  checks: {
    rootStructureStable: boolean;
    childrenStructureStable: boolean;
    pathStructureStable: boolean;
    localizedRootStatement: boolean;
    localizedChildStatement: boolean;
    localizedPathStatement: boolean;
    fallbackToEnglish: boolean;
    localeVariantToFrench: boolean;
    leafProvenanceStable: boolean;
  };
}

export interface MultilingualEvaluationReport {
  schemaVersion: string;
  requestHash: string;
  outcomeHash: string;
  parameters: {
    profiles: Array<{
      profileId: string;
      proofId: string;
      expectedLeafId: string;
      languages: string[];
    }>;
  };
  summary: {
    profileCount: number;
    rootStructureStableProfiles: number;
    childrenStructureStableProfiles: number;
    pathStructureStableProfiles: number;
    localizedRootStatementProfiles: number;
    localizedChildStatementProfiles: number;
    localizedPathStatementProfiles: number;
    fallbackProfiles: number;
    localeVariantProfiles: number;
    leafProvenanceStableProfiles: number;
  };
  comparisons: MultilingualEvaluationComparison[];
}

export async function runMultilingualEvaluation(): Promise<MultilingualEvaluationReport> {
  const originalCacheDir = process.env.EXPLAIN_MD_WEB_PROOF_CACHE_DIR;
  const evaluationCacheDir = path.resolve(process.cwd(), ".explain-md", "web-proof-cache-multilingual-evaluation");
  process.env.EXPLAIN_MD_WEB_PROOF_CACHE_DIR = evaluationCacheDir;
  await fs.rm(evaluationCacheDir, { recursive: true, force: true });
  clearProofDatasetCacheForTests();

  try {
    const requestHash = computeHash({
      schemaVersion: SCHEMA_VERSION,
      profiles: PROFILES,
    });

    const comparisons: MultilingualEvaluationComparison[] = [];

    for (const profile of PROFILES) {
    const rootEn = await buildProofRootView(profile.proofId, { language: "en" });
    const rootFr = await buildProofRootView(profile.proofId, { language: "fr" });
    const rootFrCa = await buildProofRootView(profile.proofId, { language: "fr-CA" as unknown as "en" });
    const rootFallback = await buildProofRootView(profile.proofId, { language: "de" as unknown as "en" });

    const rootNodeEn = rootEn.root.node;
    const rootNodeFr = rootFr.root.node;
    const rootNodeFrCa = rootFrCa.root.node;
    const rootNodeFallback = rootFallback.root.node;
    if (!rootNodeEn || !rootNodeFr || !rootNodeFrCa || !rootNodeFallback) {
      throw new Error(`Expected root node for profile '${profile.profileId}'.`);
    }

    const childrenEn = await buildProofNodeChildrenView({
      proofId: profile.proofId,
      nodeId: rootNodeEn.id,
      offset: 0,
      limit: 3,
      config: { language: "en" },
    });
    const childrenFr = await buildProofNodeChildrenView({
      proofId: profile.proofId,
      nodeId: rootNodeFr.id,
      offset: 0,
      limit: 3,
      config: { language: "fr" },
    });

    const targetNodeId = childrenEn.children.children[0]?.id ?? rootNodeEn.id;
    const pathEn = await buildProofNodePathView({
      proofId: profile.proofId,
      nodeId: targetNodeId,
      config: { language: "en" },
    });
    const pathFr = await buildProofNodePathView({
      proofId: profile.proofId,
      nodeId: targetNodeId,
      config: { language: "fr" },
    });

    const leafEn = await buildProofLeafDetail({
      proofId: profile.proofId,
      leafId: profile.expectedLeafId,
      config: { language: "en" },
    });
    const leafFr = await buildProofLeafDetail({
      proofId: profile.proofId,
      leafId: profile.expectedLeafId,
      config: { language: "fr" },
    });

    const pathEnIds = pathEn.path.path.map((node) => node.id);
    const pathFrIds = pathFr.path.path.map((node) => node.id);
    const pathEnStatements = pathEn.path.path.map((node) => node.statement);
    const pathFrStatements = pathFr.path.path.map((node) => node.statement);

    const childrenEnIds = childrenEn.children.children.map((node) => node.id);
    const childrenFrIds = childrenFr.children.children.map((node) => node.id);
    const childrenEnStatements = childrenEn.children.children.map((node) => node.statement);
    const childrenFrStatements = childrenFr.children.children.map((node) => node.statement);

      comparisons.push({
      profileId: profile.profileId,
      proofId: profile.proofId,
      rootId: rootNodeEn.id,
      rootHashes: {
        en: rootEn.snapshotHash,
        fr: rootFr.snapshotHash,
        frCa: rootFrCa.snapshotHash,
        fallback: rootFallback.snapshotHash,
      },
      requestHashes: {
        rootEn: rootEn.requestHash,
        rootFr: rootFr.requestHash,
        rootFrCa: rootFrCa.requestHash,
        rootFallback: rootFallback.requestHash,
        childrenEn: childrenEn.requestHash,
        childrenFr: childrenFr.requestHash,
        pathEn: pathEn.requestHash,
        pathFr: pathFr.requestHash,
        leafEn: leafEn.requestHash,
        leafFr: leafFr.requestHash,
      },
      checks: {
        rootStructureStable:
          rootNodeEn.id === rootNodeFr.id &&
          JSON.stringify(rootNodeEn.childIds) === JSON.stringify(rootNodeFr.childIds),
        childrenStructureStable: JSON.stringify(childrenEnIds) === JSON.stringify(childrenFrIds),
        pathStructureStable: pathEn.path.ok && pathFr.path.ok && JSON.stringify(pathEnIds) === JSON.stringify(pathFrIds),
        localizedRootStatement: rootNodeEn.statement !== rootNodeFr.statement,
        localizedChildStatement:
          (childrenEnStatements.length === 0 && childrenFrStatements.length === 0) ||
          JSON.stringify(childrenEnStatements) !== JSON.stringify(childrenFrStatements),
        localizedPathStatement: JSON.stringify(pathEnStatements) !== JSON.stringify(pathFrStatements),
        fallbackToEnglish: rootNodeFallback.statement === rootNodeEn.statement,
        localeVariantToFrench: rootNodeFrCa.statement === rootNodeFr.statement,
        leafProvenanceStable:
          leafEn.ok === true &&
          leafFr.ok === true &&
          leafEn.view?.leaf.id === leafFr.view?.leaf.id &&
          leafEn.view?.leaf.sourceUrl === leafFr.view?.leaf.sourceUrl,
      },
      });
    }

    const summary: MultilingualEvaluationReport["summary"] = {
      profileCount: comparisons.length,
      rootStructureStableProfiles: comparisons.filter((comparison) => comparison.checks.rootStructureStable).length,
      childrenStructureStableProfiles: comparisons.filter((comparison) => comparison.checks.childrenStructureStable).length,
      pathStructureStableProfiles: comparisons.filter((comparison) => comparison.checks.pathStructureStable).length,
      localizedRootStatementProfiles: comparisons.filter((comparison) => comparison.checks.localizedRootStatement).length,
      localizedChildStatementProfiles: comparisons.filter((comparison) => comparison.checks.localizedChildStatement).length,
      localizedPathStatementProfiles: comparisons.filter((comparison) => comparison.checks.localizedPathStatement).length,
      fallbackProfiles: comparisons.filter((comparison) => comparison.checks.fallbackToEnglish).length,
      localeVariantProfiles: comparisons.filter((comparison) => comparison.checks.localeVariantToFrench).length,
      leafProvenanceStableProfiles: comparisons.filter((comparison) => comparison.checks.leafProvenanceStable).length,
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
        profiles: PROFILES.map((profile) => ({
          profileId: profile.profileId,
          proofId: profile.proofId,
          expectedLeafId: profile.expectedLeafId,
          languages: ["en", "fr", "fr-CA", "de"],
        })),
      },
      summary,
      comparisons,
    };
  } finally {
    clearProofDatasetCacheForTests();
    if (originalCacheDir === undefined) {
      delete process.env.EXPLAIN_MD_WEB_PROOF_CACHE_DIR;
    } else {
      process.env.EXPLAIN_MD_WEB_PROOF_CACHE_DIR = originalCacheDir;
    }
  }
}

function computeHash(input: unknown): string {
  return createHash("sha256").update(canonicalize(input)).digest("hex");
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
