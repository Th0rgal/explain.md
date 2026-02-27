import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildProofCacheReportView,
  buildProofDependencyGraphView,
  buildProofDiff,
  buildProofNodeChildrenView,
  buildProofNodePathView,
  buildProofPolicyReportView,
  buildProofRootView,
  buildSeedDiff,
  buildSeedLeafDetail,
  buildSeedNodeChildrenView,
  buildSeedNodePathView,
  buildSeedProjection,
  buildSeedRootView,
  clearProofDatasetCacheForTests,
  LEAN_FIXTURE_PROOF_ID,
  listProofs,
  listSeedProofs,
  SEED_PROOF_ID,
  selectMinimalBlockedFrontierExpansion,
} from "../lib/proof-service";

describe("proof service", () => {
  it("returns deterministic projection hash for identical requests", () => {
    const first = buildSeedProjection({
      proofId: SEED_PROOF_ID,
      config: {
        abstractionLevel: 4,
        complexityLevel: 2,
        maxChildrenPerParent: 3,
        audienceLevel: "novice",
      },
      expandedNodeIds: ["p2_root", "p1_invariant"],
      maxChildrenPerExpandedNode: 2,
    });

    const second = buildSeedProjection({
      proofId: SEED_PROOF_ID,
      config: {
        abstractionLevel: 4,
        complexityLevel: 2,
        maxChildrenPerParent: 3,
        audienceLevel: "novice",
      },
      expandedNodeIds: ["p1_invariant", "p2_root"],
      maxChildrenPerExpandedNode: 2,
    });

    expect(first.viewHash).toBe(second.viewHash);
    expect(first.requestHash).toBe(second.requestHash);
    expect(first.view.visibleNodes.length).toBeGreaterThan(1);
  });

  it("selects minimal blocked-group frontier expansion deterministically", () => {
    const selected = selectMinimalBlockedFrontierExpansion({
      blockedGroups: [
        {
          depth: 2,
          groupIndex: 1,
          parentId: "p_2_1_a",
          frontierLeafIds: ["l1", "l2", "l3"],
        },
        {
          depth: 2,
          groupIndex: 0,
          parentId: "p_2_0_b",
          frontierLeafIds: ["l1", "l2"],
        },
      ],
      frontierLeafIdSet: new Set(["l1"]),
      availableLeafIdSet: new Set(["l1", "l2", "l3"]),
    });

    expect(selected).toBeDefined();
    expect(selected?.expandedLeafIds).toEqual(["l2"]);
    expect(selected?.nextFrontierLeafIds).toEqual(["l1", "l2"]);
  });

  it("breaks blocked-group recovery ties by stable metadata order", () => {
    const selected = selectMinimalBlockedFrontierExpansion({
      blockedGroups: [
        {
          depth: 3,
          groupIndex: 2,
          parentId: "p_3_2_z",
          frontierLeafIds: ["l2"],
        },
        {
          depth: 2,
          groupIndex: 9,
          parentId: "p_2_9_a",
          frontierLeafIds: ["l2"],
        },
      ],
      frontierLeafIdSet: new Set<string>(),
      availableLeafIdSet: new Set(["l2"]),
    });

    expect(selected).toBeDefined();
    expect(selected?.expandedLeafIds).toEqual(["l2"]);
    expect(selected?.nextFrontierLeafIds).toEqual(["l2"]);
  });

  it("computes deterministic diff hash and reports config changes", () => {
    const result = buildSeedDiff({
      proofId: SEED_PROOF_ID,
      baselineConfig: {
        abstractionLevel: 2,
        complexityLevel: 2,
      },
      candidateConfig: {
        abstractionLevel: 4,
        complexityLevel: 4,
      },
    });

    expect(result.diffHash).toHaveLength(64);
    expect(result.report.regenerationPlan.scope).toBe("full");
    expect(result.report.summary.total).toBeGreaterThan(0);
  });

  it("returns leaf detail with canonical verification history", () => {
    const detail = buildSeedLeafDetail({
      proofId: SEED_PROOF_ID,
      leafId: "Verity.ContractSpec.init_sound",
    });

    expect(detail.ok).toBe(true);
    expect(detail.detailHash).toHaveLength(64);
    expect(detail.view?.verification.summary.totalJobs).toBe(1);
    expect(detail.view?.shareReference.compact).toContain("init_sound");
    expect(detail.view?.shareReference.sourceUrlOrigin).toBe("leaf");
  });

  it("fails clearly for unsupported proof id", () => {
    expect(() => listSeedProofs({ language: "en" })).not.toThrow();
    expect(() => buildSeedProjection({ proofId: "unknown-proof" })).toThrow(/Unsupported proofId/);
  });

  it("returns deterministic root/children/path query views", () => {
    const root = buildSeedRootView(SEED_PROOF_ID, {
      abstractionLevel: 3,
      complexityLevel: 3,
    });
    expect(root.root.node?.id).toBe("p2_root");
    expect(root.root.node?.policyDiagnostics?.postSummary.ok).toBe(true);
    expect(root.snapshotHash).toHaveLength(64);

    const children = buildSeedNodeChildrenView({
      proofId: SEED_PROOF_ID,
      nodeId: "p2_root",
      limit: 1,
      offset: 0,
    });
    expect(children.children.children.length).toBe(1);
    expect(children.children.totalChildren).toBeGreaterThan(1);

    const path = buildSeedNodePathView({
      proofId: SEED_PROOF_ID,
      nodeId: "Verity.ContractSpec.init_sound",
    });
    expect(path.path.ok).toBe(true);
    expect(path.path.path[0]?.id).toBe("p2_root");
    expect(path.path.path[path.path.path.length - 1]?.id).toBe("Verity.ContractSpec.init_sound");
  });

  it("lists both seed and Lean fixture proofs in catalog", async () => {
    const catalog = await listProofs();
    expect(catalog.map((entry) => entry.proofId)).toContain(SEED_PROOF_ID);
    expect(catalog.map((entry) => entry.proofId)).toContain(LEAN_FIXTURE_PROOF_ID);
  });

  it("serves deterministic root/children/path queries for Lean-ingested fixture proof", async () => {
    const root = await buildProofRootView(LEAN_FIXTURE_PROOF_ID, {
      abstractionLevel: 3,
      complexityLevel: 3,
      maxChildrenPerParent: 3,
    });
    expect(root.root.node?.id).toBeTruthy();
    expect(root.snapshotHash).toHaveLength(64);

    const rootNode = root.root.node;
    expect(rootNode).toBeDefined();

    const children = await buildProofNodeChildrenView({
      proofId: LEAN_FIXTURE_PROOF_ID,
      nodeId: rootNode?.id ?? "",
      limit: 2,
      offset: 0,
    });
    if (rootNode?.kind === "parent") {
      expect(children.children.parent.id).toBe(rootNode.id);
      expect(children.children.totalChildren).toBeGreaterThanOrEqual(children.children.children.length);
    } else {
      expect(children.children.totalChildren).toBe(0);
    }

    const targetNodeId = children.children.children[0]?.id ?? (rootNode?.id ?? "");
    const path = await buildProofNodePathView({
      proofId: LEAN_FIXTURE_PROOF_ID,
      nodeId: targetNodeId,
    });
    expect(path.path.nodeId).toBe(targetNodeId);
    if (path.path.ok) {
      expect(path.path.path[0]?.id).toBe(rootNode?.id);
      expect(path.path.path[path.path.path.length - 1]?.id).toBe(targetNodeId);
    } else {
      expect(path.path.diagnostics.some((diagnostic) => diagnostic.severity === "error")).toBe(true);
    }
  });

  it("computes diff deterministically for Lean-ingested fixture proof", async () => {
    const first = await buildProofDiff({
      proofId: LEAN_FIXTURE_PROOF_ID,
      baselineConfig: { complexityLevel: 2, abstractionLevel: 2 },
      candidateConfig: { complexityLevel: 4, abstractionLevel: 4 },
    });
    const second = await buildProofDiff({
      proofId: LEAN_FIXTURE_PROOF_ID,
      baselineConfig: { complexityLevel: 2, abstractionLevel: 2 },
      candidateConfig: { complexityLevel: 4, abstractionLevel: 4 },
    });

    expect(first.requestHash).toBe(second.requestHash);
    expect(first.diffHash).toBe(second.diffHash);
    expect(first.report.summary.total).toBeGreaterThanOrEqual(0);
  });

  it("returns deterministic dependency graph query views for Lean-ingested fixture proof", async () => {
    const first = await buildProofDependencyGraphView({
      proofId: LEAN_FIXTURE_PROOF_ID,
      declarationId: "lean:Verity/Loop:loop_preserves:3:1",
      includeExternalSupport: true,
    });
    const second = await buildProofDependencyGraphView({
      proofId: LEAN_FIXTURE_PROOF_ID,
      declarationId: "lean:Verity/Loop:loop_preserves:3:1",
      includeExternalSupport: true,
    });

    expect(first.requestHash).toBe(second.requestHash);
    expect(first.dependencyGraphHash).toBe(second.dependencyGraphHash);
    expect(first.graph.nodeCount).toBeGreaterThan(0);
    expect(first.graph.edgeCount).toBeGreaterThan(0);
    expect(first.declaration?.declarationId).toBe("lean:Verity/Loop:loop_preserves:3:1");
    expect(first.declaration?.supportingDeclarations).toContain("lean:Verity/Core:core_safe:8:1");
    expect(first.diagnostics).toEqual([]);
  });

  it("reports machine-checkable diagnostics for unknown dependency declaration ids", async () => {
    const response = await buildProofDependencyGraphView({
      proofId: LEAN_FIXTURE_PROOF_ID,
      declarationId: "unknown.declaration",
    });

    expect(response.declaration).toBeUndefined();
    expect(response.diagnostics).toEqual([
      {
        code: "declaration_not_found",
        severity: "error",
        message: "Declaration 'unknown.declaration' is not present in dependency graph.",
        details: { declarationId: "unknown.declaration" },
      },
    ]);
  });

  it("returns deterministic pedagogy policy report hashes for Lean-ingested fixture proof", async () => {
    const first = await buildProofPolicyReportView({
      proofId: LEAN_FIXTURE_PROOF_ID,
    });
    const second = await buildProofPolicyReportView({
      proofId: LEAN_FIXTURE_PROOF_ID,
    });

    expect(first.requestHash).toBe(second.requestHash);
    expect(first.reportHash).toBe(second.reportHash);
    expect(first.report.metrics.parentCount).toBeGreaterThan(0);
    expect(first.report.thresholdPass).toBe(true);
  });

  it("applies threshold overrides with machine-checkable threshold outcomes", async () => {
    const response = await buildProofPolicyReportView({
      proofId: LEAN_FIXTURE_PROOF_ID,
      thresholds: {
        maxComplexitySpreadMean: 0,
      },
    });

    expect(response.report.thresholds.maxComplexitySpreadMean).toBe(0);
    expect(typeof response.report.thresholdPass).toBe("boolean");
    expect(response.report.thresholdFailures.every((failure) => typeof failure.code === "string")).toBe(true);
  });

  it("reuses persistent Lean fixture cache deterministically for unchanged inputs", async () => {
    const previousCacheDir = process.env.EXPLAIN_MD_WEB_PROOF_CACHE_DIR;
    const tempCacheDir = await fs.mkdtemp(path.join(os.tmpdir(), "explain-md-proof-cache-"));
    process.env.EXPLAIN_MD_WEB_PROOF_CACHE_DIR = tempCacheDir;

    try {
      clearProofDatasetCacheForTests();
      const first = await buildProofCacheReportView({
        proofId: LEAN_FIXTURE_PROOF_ID,
      });
      expect(first.cache.layer).toBe("persistent");
      expect(first.cache.status).toBe("miss");
      expect(first.cache.diagnostics.some((diagnostic) => diagnostic.code === "cache_miss")).toBe(true);
      expect(first.cache.snapshotHash).toHaveLength(64);

      clearProofDatasetCacheForTests();
      const second = await buildProofCacheReportView({
        proofId: LEAN_FIXTURE_PROOF_ID,
      });
      expect(second.cache.layer).toBe("persistent");
      expect(second.cache.status).toBe("hit");
      expect(second.cache.diagnostics.some((diagnostic) => diagnostic.code === "cache_hit")).toBe(true);
      expect(second.cache.sourceFingerprint).toBe(first.cache.sourceFingerprint);
      expect(second.cache.snapshotHash).toBe(first.cache.snapshotHash);
      expect(second.cache.cacheEntryHash).toBe(first.cache.cacheEntryHash);
    } finally {
      clearProofDatasetCacheForTests();
      if (previousCacheDir === undefined) {
        delete process.env.EXPLAIN_MD_WEB_PROOF_CACHE_DIR;
      } else {
        process.env.EXPLAIN_MD_WEB_PROOF_CACHE_DIR = previousCacheDir;
      }
      await fs.rm(tempCacheDir, { recursive: true, force: true });
    }
  });

  it("reuses cached snapshot on source fingerprint mismatch when theorem leaves are unchanged", async () => {
    const previousCacheDir = process.env.EXPLAIN_MD_WEB_PROOF_CACHE_DIR;
    const previousFixtureRoot = process.env.EXPLAIN_MD_LEAN_FIXTURE_PROJECT_ROOT;
    const tempCacheDir = await fs.mkdtemp(path.join(os.tmpdir(), "explain-md-proof-cache-"));
    const sourceFixtureRoot = await resolveFixtureRootForTest();
    const tempFixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "explain-md-proof-fixture-"));
    const sourceCorePath = path.join(sourceFixtureRoot, "Verity", "Core.lean");
    const tempCorePath = path.join(tempFixtureRoot, "Verity", "Core.lean");
    process.env.EXPLAIN_MD_WEB_PROOF_CACHE_DIR = tempCacheDir;
    process.env.EXPLAIN_MD_LEAN_FIXTURE_PROJECT_ROOT = tempFixtureRoot;

    try {
      await fs.cp(sourceFixtureRoot, tempFixtureRoot, { recursive: true });

      clearProofDatasetCacheForTests();
      const first = await buildProofCacheReportView({
        proofId: LEAN_FIXTURE_PROOF_ID,
      });
      expect(first.cache.status).toBe("miss");

      const originalCore = await fs.readFile(sourceCorePath, "utf8");
      await fs.writeFile(tempCorePath, `${originalCore.trimEnd()}\n-- test semantic noop mutation\n`, "utf8");

      clearProofDatasetCacheForTests();
      const second = await buildProofCacheReportView({
        proofId: LEAN_FIXTURE_PROOF_ID,
      });

      expect(second.cache.status).toBe("hit");
      expect(second.cache.sourceFingerprint).not.toBe(first.cache.sourceFingerprint);
      expect(second.cache.diagnostics.some((diagnostic) => diagnostic.code === "cache_semantic_hit")).toBe(true);
      expect(second.cache.diagnostics.some((diagnostic) => diagnostic.code === "cache_incremental_rebuild")).toBe(false);
    } finally {
      clearProofDatasetCacheForTests();
      if (previousCacheDir === undefined) {
        delete process.env.EXPLAIN_MD_WEB_PROOF_CACHE_DIR;
      } else {
        process.env.EXPLAIN_MD_WEB_PROOF_CACHE_DIR = previousCacheDir;
      }
      if (previousFixtureRoot === undefined) {
        delete process.env.EXPLAIN_MD_LEAN_FIXTURE_PROJECT_ROOT;
      } else {
        process.env.EXPLAIN_MD_LEAN_FIXTURE_PROJECT_ROOT = previousFixtureRoot;
      }
      await fs.rm(tempCacheDir, { recursive: true, force: true });
      await fs.rm(tempFixtureRoot, { recursive: true, force: true });
    }
  });

  it("rebuilds only affected parent subtrees when theorem statements change without topology deltas", async () => {
    const previousCacheDir = process.env.EXPLAIN_MD_WEB_PROOF_CACHE_DIR;
    const previousFixtureRoot = process.env.EXPLAIN_MD_LEAN_FIXTURE_PROJECT_ROOT;
    const tempCacheDir = await fs.mkdtemp(path.join(os.tmpdir(), "explain-md-proof-cache-"));
    const sourceFixtureRoot = await resolveFixtureRootForTest();
    const tempFixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "explain-md-proof-fixture-"));
    const tempCorePath = path.join(tempFixtureRoot, "Verity", "Core.lean");
    process.env.EXPLAIN_MD_WEB_PROOF_CACHE_DIR = tempCacheDir;
    process.env.EXPLAIN_MD_LEAN_FIXTURE_PROJECT_ROOT = tempFixtureRoot;

    try {
      await fs.cp(sourceFixtureRoot, tempFixtureRoot, { recursive: true });

      clearProofDatasetCacheForTests();
      const first = await buildProofCacheReportView({
        proofId: LEAN_FIXTURE_PROOF_ID,
      });
      expect(first.cache.status).toBe("miss");

      const originalCore = await fs.readFile(tempCorePath, "utf8");
      const mutatedCore = originalCore.includes("theorem core_safe (n : Nat) : inc n = Nat.succ n := by")
        ? originalCore.replace(
            "theorem core_safe (n : Nat) : inc n = Nat.succ n := by",
            "theorem core_safe (n : Nat) : inc n = Nat.succ (Nat.succ n) := by",
          )
        : `${originalCore.trimEnd()}\ntheorem core_safe (n : Nat) : inc n = Nat.succ (Nat.succ n) := by\n`;
      await fs.writeFile(tempCorePath, mutatedCore, "utf8");

      clearProofDatasetCacheForTests();
      const second = await buildProofCacheReportView({
        proofId: LEAN_FIXTURE_PROOF_ID,
      });

      expect(second.cache.status).toBe("hit");
      expect(second.cache.snapshotHash).not.toBe(first.cache.snapshotHash);
      expect(second.cache.diagnostics.some((diagnostic) => diagnostic.code === "cache_incremental_subtree_rebuild")).toBe(true);
      expect(second.cache.diagnostics.some((diagnostic) => diagnostic.code === "cache_incremental_rebuild")).toBe(false);
      expect(second.cache.diagnostics.some((diagnostic) => diagnostic.code === "cache_incremental_topology_rebuild")).toBe(
        false,
      );
    } finally {
      clearProofDatasetCacheForTests();
      if (previousCacheDir === undefined) {
        delete process.env.EXPLAIN_MD_WEB_PROOF_CACHE_DIR;
      } else {
        process.env.EXPLAIN_MD_WEB_PROOF_CACHE_DIR = previousCacheDir;
      }
      if (previousFixtureRoot === undefined) {
        delete process.env.EXPLAIN_MD_LEAN_FIXTURE_PROJECT_ROOT;
      } else {
        process.env.EXPLAIN_MD_LEAN_FIXTURE_PROJECT_ROOT = previousFixtureRoot;
      }
      await fs.rm(tempCacheDir, { recursive: true, force: true });
      await fs.rm(tempFixtureRoot, { recursive: true, force: true });
    }
  });

  it("rebuilds with deterministic parent-summary reuse when theorem topology changes", async () => {
    const previousCacheDir = process.env.EXPLAIN_MD_WEB_PROOF_CACHE_DIR;
    const previousFixtureRoot = process.env.EXPLAIN_MD_LEAN_FIXTURE_PROJECT_ROOT;
    const tempCacheDir = await fs.mkdtemp(path.join(os.tmpdir(), "explain-md-proof-cache-"));
    const sourceFixtureRoot = await resolveFixtureRootForTest();
    const tempFixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "explain-md-proof-fixture-"));
    const tempLoopPath = path.join(tempFixtureRoot, "Verity", "Loop.lean");
    process.env.EXPLAIN_MD_WEB_PROOF_CACHE_DIR = tempCacheDir;
    process.env.EXPLAIN_MD_LEAN_FIXTURE_PROJECT_ROOT = tempFixtureRoot;

    try {
      await fs.cp(sourceFixtureRoot, tempFixtureRoot, { recursive: true });

      clearProofDatasetCacheForTests();
      const first = await buildProofCacheReportView({
        proofId: LEAN_FIXTURE_PROOF_ID,
      });
      expect(first.cache.status).toBe("miss");

      const originalLoop = await fs.readFile(tempLoopPath, "utf8");
      const topologyMutation = [
        originalLoop.trimEnd(),
        "",
        "theorem loop_bridge (n : Nat) : core_safe n := by",
        "  exact core_safe n",
        "",
      ].join("\n");
      await fs.writeFile(tempLoopPath, topologyMutation, "utf8");

      clearProofDatasetCacheForTests();
      const second = await buildProofCacheReportView({
        proofId: LEAN_FIXTURE_PROOF_ID,
      });

      expect(second.cache.status).toBe("hit");
      expect(second.cache.snapshotHash).not.toBe(first.cache.snapshotHash);
      expect(second.cache.diagnostics.some((diagnostic) => diagnostic.code === "cache_incremental_topology_rebuild")).toBe(
        true,
      );
      expect(second.cache.diagnostics.some((diagnostic) => diagnostic.code === "cache_incremental_rebuild")).toBe(false);
      const topologyDiagnostic = second.cache.diagnostics.find(
        (diagnostic) => diagnostic.code === "cache_incremental_topology_rebuild",
      );
      expect(topologyDiagnostic).toBeDefined();
      expect(typeof topologyDiagnostic?.details?.reusedParentSummaryCount).toBe("number");
      expect(typeof topologyDiagnostic?.details?.generatedParentSummaryCount).toBe("number");
      expect(typeof topologyDiagnostic?.details?.reusedParentNodeCount).toBe("number");
      expect(typeof topologyDiagnostic?.details?.generatedParentNodeCount).toBe("number");
      expect(typeof topologyDiagnostic?.details?.reusedParentByStableIdCount).toBe("number");
      expect(typeof topologyDiagnostic?.details?.reusedParentByChildHashCount).toBe("number");
      expect(typeof topologyDiagnostic?.details?.reusedParentByChildStatementHashCount).toBe("number");
      expect(typeof topologyDiagnostic?.details?.reusedParentByFrontierChildHashCount).toBe("number");
      expect(typeof topologyDiagnostic?.details?.reusedParentByFrontierChildStatementHashCount).toBe("number");
      expect(typeof topologyDiagnostic?.details?.skippedAmbiguousChildHashReuseCount).toBe("number");
      expect(typeof topologyDiagnostic?.details?.skippedAmbiguousChildStatementHashReuseCount).toBe("number");
      expect(typeof topologyDiagnostic?.details?.frontierPartitionLeafCount).toBe("number");
      expect(typeof topologyDiagnostic?.details?.frontierPartitionBlockedGroupCount).toBe("number");
      expect(typeof topologyDiagnostic?.details?.frontierPartitionRecoveredLeafCount).toBe("number");
      expect(typeof topologyDiagnostic?.details?.frontierPartitionRecoveredSummaryCount).toBe("number");
      expect(typeof topologyDiagnostic?.details?.frontierPartitionRecoveryPassCount).toBe("number");
      expect(typeof topologyDiagnostic?.details?.frontierPartitionRecoveryScheduledGroupCount).toBe("number");
      expect(topologyDiagnostic?.details?.frontierPartitionRecoveryStrategy).toBe("minimal_blocked_group");
      expect(typeof topologyDiagnostic?.details?.frontierPartitionFallbackUsed).toBe("boolean");
      expect((topologyDiagnostic?.details?.reusedParentNodeCount as number) >= 0).toBe(true);
      expect((topologyDiagnostic?.details?.generatedParentNodeCount as number) >= 0).toBe(true);
      expect((topologyDiagnostic?.details?.reusedParentByStableIdCount as number) >= 0).toBe(true);
      expect((topologyDiagnostic?.details?.reusedParentByChildHashCount as number) >= 0).toBe(true);
      expect((topologyDiagnostic?.details?.reusedParentByChildStatementHashCount as number) >= 0).toBe(true);
      expect((topologyDiagnostic?.details?.reusedParentByFrontierChildHashCount as number) >= 0).toBe(true);
      expect((topologyDiagnostic?.details?.reusedParentByFrontierChildStatementHashCount as number) >= 0).toBe(true);
      expect((topologyDiagnostic?.details?.skippedAmbiguousChildHashReuseCount as number) >= 0).toBe(true);
      expect((topologyDiagnostic?.details?.skippedAmbiguousChildStatementHashReuseCount as number) >= 0).toBe(true);
      expect((topologyDiagnostic?.details?.frontierPartitionLeafCount as number) >= 0).toBe(true);
      expect((topologyDiagnostic?.details?.frontierPartitionBlockedGroupCount as number) >= 0).toBe(true);
      expect((topologyDiagnostic?.details?.frontierPartitionRecoveredLeafCount as number) >= 0).toBe(true);
      expect((topologyDiagnostic?.details?.frontierPartitionRecoveredSummaryCount as number) >= 0).toBe(true);
      expect((topologyDiagnostic?.details?.frontierPartitionRecoveryPassCount as number) >= 0).toBe(true);
      expect((topologyDiagnostic?.details?.frontierPartitionRecoveryScheduledGroupCount as number) >= 0).toBe(true);
      if ((topologyDiagnostic?.details?.frontierPartitionRecoveryPassCount as number) > 0) {
        expect(topologyDiagnostic?.details?.frontierPartitionRecoveryScheduledGroupCount).toBe(
          topologyDiagnostic?.details?.frontierPartitionRecoveryPassCount,
        );
      }
    } finally {
      clearProofDatasetCacheForTests();
      if (previousCacheDir === undefined) {
        delete process.env.EXPLAIN_MD_WEB_PROOF_CACHE_DIR;
      } else {
        process.env.EXPLAIN_MD_WEB_PROOF_CACHE_DIR = previousCacheDir;
      }
      if (previousFixtureRoot === undefined) {
        delete process.env.EXPLAIN_MD_LEAN_FIXTURE_PROJECT_ROOT;
      } else {
        process.env.EXPLAIN_MD_LEAN_FIXTURE_PROJECT_ROOT = previousFixtureRoot;
      }
      await fs.rm(tempCacheDir, { recursive: true, force: true });
      await fs.rm(tempFixtureRoot, { recursive: true, force: true });
    }
  });
});

async function resolveFixtureRootForTest(): Promise<string> {
  const candidates = [
    path.resolve(process.cwd(), "tests", "fixtures", "lean-project"),
    path.resolve(process.cwd(), "..", "tests", "fixtures", "lean-project"),
    path.resolve(process.cwd(), "..", "..", "tests", "fixtures", "lean-project"),
  ];

  for (const candidate of candidates) {
    try {
      await fs.access(path.join(candidate, "Verity", "Core.lean"));
      return candidate;
    } catch {
      // Continue probing.
    }
  }

  throw new Error(`Unable to resolve fixture root for tests. Tried: ${candidates.join(", ")}`);
}
