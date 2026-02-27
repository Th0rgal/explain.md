import {
  DEFAULT_CONFIG,
  computeConfigHash,
  normalizeConfig,
  type ExplanationConfig,
  type ExplanationConfigInput,
} from "../../../dist/config-contract";
import type { TheoremLeafRecord } from "../../../dist/leaf-schema";

interface SeedTreeNode {
  id: string;
  kind: "leaf" | "parent";
  statement: string;
  childIds: string[];
  depth: number;
  complexityScore?: number;
  abstractionScore?: number;
  confidence?: number;
  whyTrueFromChildren?: string;
  newTermsIntroduced?: string[];
  evidenceRefs: string[];
}

interface SeedTree {
  rootId: string;
  leafIds: string[];
  nodes: Record<string, SeedTreeNode>;
  configHash: string;
  groupPlan: Array<{
    depth: number;
    index: number;
    inputNodeIds: string[];
    outputNodeId: string;
    complexitySpread: number;
  }>;
  groupingDiagnostics: unknown[];
  policyDiagnosticsByParent: Record<string, unknown>;
  maxDepth: number;
}

export const seedConfig: ExplanationConfig = normalizeConfig({
  ...DEFAULT_CONFIG,
  abstractionLevel: 3,
  complexityLevel: 3,
  maxChildrenPerParent: 3,
  audienceLevel: "intermediate",
  termIntroductionBudget: 2,
});

const SEED_LEAVES: TheoremLeafRecord[] = [
  {
    schemaVersion: "1.0.0",
    id: "Verity.ContractSpec.init_sound",
    declarationId: "Verity.ContractSpec.init_sound",
    modulePath: "Verity.ContractSpec",
    declarationName: "init_sound",
    theoremKind: "theorem",
    statementText: "Initialization establishes the storage invariant.",
    prettyStatement: "init_sound: Init -> StorageInvariant",
    sourceSpan: { filePath: "Verity/ContractSpec.lean", startLine: 12, startColumn: 1, endLine: 16, endColumn: 18 },
    tags: ["verity", "init"],
    dependencyIds: [],
    sourceUrl: "https://github.com/Th0rgal/explain.md/blob/main/Verity/ContractSpec.lean#L12",
  },
  {
    schemaVersion: "1.0.0",
    id: "Verity.ContractSpec.loop_preserves",
    declarationId: "Verity.ContractSpec.loop_preserves",
    modulePath: "Verity.ContractSpec",
    declarationName: "loop_preserves",
    theoremKind: "lemma",
    statementText: "Loop transition preserves StorageInvariant.",
    prettyStatement: "loop_preserves: StorageInvariant -> Step -> StorageInvariant",
    sourceSpan: { filePath: "Verity/ContractSpec.lean", startLine: 23, startColumn: 1, endLine: 31, endColumn: 24 },
    tags: ["verity", "loop"],
    dependencyIds: ["Verity.ContractSpec.init_sound"],
    sourceUrl: "https://github.com/Th0rgal/explain.md/blob/main/Verity/ContractSpec.lean#L23",
  },
  {
    schemaVersion: "1.0.0",
    id: "Verity.ContractSpec.exit_safe",
    declarationId: "Verity.ContractSpec.exit_safe",
    modulePath: "Verity.ContractSpec",
    declarationName: "exit_safe",
    theoremKind: "lemma",
    statementText: "Exit condition implies postcondition.",
    prettyStatement: "exit_safe: StorageInvariant -> Exit -> Postcondition",
    sourceSpan: { filePath: "Verity/ContractSpec.lean", startLine: 34, startColumn: 1, endLine: 38, endColumn: 21 },
    tags: ["verity", "exit"],
    dependencyIds: ["Verity.ContractSpec.loop_preserves"],
    sourceUrl: "https://github.com/Th0rgal/explain.md/blob/main/Verity/ContractSpec.lean#L34",
  },
  {
    schemaVersion: "1.0.0",
    id: "Verity.ContractSpec.composition_sound",
    declarationId: "Verity.ContractSpec.composition_sound",
    modulePath: "Verity.ContractSpec",
    declarationName: "composition_sound",
    theoremKind: "theorem",
    statementText: "Composed pipeline is sound end-to-end.",
    prettyStatement: "composition_sound: Init -> ProgramSafe",
    sourceSpan: { filePath: "Verity/ContractSpec.lean", startLine: 41, startColumn: 1, endLine: 47, endColumn: 15 },
    tags: ["verity", "composition"],
    dependencyIds: [
      "Verity.ContractSpec.init_sound",
      "Verity.ContractSpec.loop_preserves",
      "Verity.ContractSpec.exit_safe"
    ],
    sourceUrl: "https://github.com/Th0rgal/explain.md/blob/main/Verity/ContractSpec.lean#L41",
  }
];

const BASE_NODES: SeedTree["nodes"] = {
  "Verity.ContractSpec.init_sound": {
    id: "Verity.ContractSpec.init_sound",
    kind: "leaf",
    statement: "init_sound: Init -> StorageInvariant",
    childIds: [],
    depth: 0,
    complexityScore: 2,
    evidenceRefs: ["Verity.ContractSpec.init_sound"],
  },
  "Verity.ContractSpec.loop_preserves": {
    id: "Verity.ContractSpec.loop_preserves",
    kind: "leaf",
    statement: "loop_preserves: StorageInvariant -> Step -> StorageInvariant",
    childIds: [],
    depth: 0,
    complexityScore: 3,
    evidenceRefs: ["Verity.ContractSpec.loop_preserves"],
  },
  "Verity.ContractSpec.exit_safe": {
    id: "Verity.ContractSpec.exit_safe",
    kind: "leaf",
    statement: "exit_safe: StorageInvariant -> Exit -> Postcondition",
    childIds: [],
    depth: 0,
    complexityScore: 3,
    evidenceRefs: ["Verity.ContractSpec.exit_safe"],
  },
  "Verity.ContractSpec.composition_sound": {
    id: "Verity.ContractSpec.composition_sound",
    kind: "leaf",
    statement: "composition_sound: Init -> ProgramSafe",
    childIds: [],
    depth: 0,
    complexityScore: 4,
    evidenceRefs: ["Verity.ContractSpec.composition_sound"],
  },
  "p1_invariant": {
    id: "p1_invariant",
    kind: "parent",
    statement: "Initialization and loop transition preserve the invariant.",
    childIds: ["Verity.ContractSpec.init_sound", "Verity.ContractSpec.loop_preserves"],
    depth: 1,
    complexityScore: 2,
    abstractionScore: 2,
    confidence: 0.94,
    whyTrueFromChildren: "Child theorems establish base and step preservation.",
    newTermsIntroduced: ["invariant preservation"],
    evidenceRefs: ["Verity.ContractSpec.init_sound", "Verity.ContractSpec.loop_preserves"],
  },
  "p1_safety": {
    id: "p1_safety",
    kind: "parent",
    statement: "Exit and composition arguments imply end-to-end safety.",
    childIds: ["Verity.ContractSpec.exit_safe", "Verity.ContractSpec.composition_sound"],
    depth: 1,
    complexityScore: 3,
    abstractionScore: 3,
    confidence: 0.9,
    whyTrueFromChildren: "Exit safety combines with composition to reach final safety.",
    newTermsIntroduced: ["end-to-end safety"],
    evidenceRefs: ["Verity.ContractSpec.exit_safe", "Verity.ContractSpec.composition_sound"],
  },
  "p2_root": {
    id: "p2_root",
    kind: "parent",
    statement: "Verity contract proof is sound from initialization through termination.",
    childIds: ["p1_invariant", "p1_safety"],
    depth: 2,
    complexityScore: 3,
    abstractionScore: 3,
    confidence: 0.92,
    whyTrueFromChildren: "Invariant and safety branches jointly entail program soundness.",
    newTermsIntroduced: ["program soundness"],
    evidenceRefs: [
      "Verity.ContractSpec.init_sound",
      "Verity.ContractSpec.loop_preserves",
      "Verity.ContractSpec.exit_safe",
      "Verity.ContractSpec.composition_sound"
    ],
  }
};

function audiencePrefix(level: ExplanationConfig["audienceLevel"]): string {
  if (level === "novice") {
    return "Novice framing";
  }
  if (level === "expert") {
    return "Expert framing";
  }
  return "Intermediate framing";
}

export function buildConfiguredSeedTree(input: ExplanationConfigInput = {}): SeedTree {
  const config = normalizeConfig({ ...seedConfig, ...input });
  const nodes = structuredClone(BASE_NODES);
  const prefix = audiencePrefix(config.audienceLevel);

  nodes.p1_invariant.statement = `${prefix}: initialization and loop lemmas maintain the storage invariant.`;
  nodes.p1_safety.statement = `${prefix}: exit and composition lemmas imply safe termination.`;
  nodes.p2_root.statement = `${prefix}: combined branches prove contract soundness with abstraction=${config.abstractionLevel} and complexity=${config.complexityLevel}.`;

  return {
    rootId: "p2_root",
    leafIds: SEED_LEAVES.map((leaf) => leaf.id),
    nodes,
    configHash: computeConfigHash(config),
    groupPlan: [
      {
        depth: 1,
        index: 0,
        inputNodeIds: ["Verity.ContractSpec.init_sound", "Verity.ContractSpec.loop_preserves"],
        outputNodeId: "p1_invariant",
        complexitySpread: 1,
      },
      {
        depth: 1,
        index: 1,
        inputNodeIds: ["Verity.ContractSpec.exit_safe", "Verity.ContractSpec.composition_sound"],
        outputNodeId: "p1_safety",
        complexitySpread: 1,
      },
      {
        depth: 2,
        index: 0,
        inputNodeIds: ["p1_invariant", "p1_safety"],
        outputNodeId: "p2_root",
        complexitySpread: 1,
      },
    ],
    groupingDiagnostics: [],
    policyDiagnosticsByParent: {},
    maxDepth: 2,
  };
}

export function getSeedLeaves(): TheoremLeafRecord[] {
  return SEED_LEAVES.map((leaf) => ({ ...leaf, sourceSpan: { ...leaf.sourceSpan }, tags: [...leaf.tags], dependencyIds: [...leaf.dependencyIds] }));
}
