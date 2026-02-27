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
    expect(first.report.repartitionMetrics.eventCount).toBeGreaterThanOrEqual(0);
    expect(first.report.repartitionMetrics.depthMetrics.every((entry) => entry.depth >= 1)).toBe(true);
  });

  it("applies threshold overrides with machine-checkable threshold outcomes", async () => {
    const response = await buildProofPolicyReportView({
      proofId: LEAN_FIXTURE_PROOF_ID,
      thresholds: {
        maxComplexitySpreadMean: 0,
        minRepartitionEventRate: 0,
        maxRepartitionEventRate: 1,
        maxRepartitionMaxRound: 3,
      },
    });

    expect(response.report.thresholds.maxComplexitySpreadMean).toBe(0);
    expect(response.report.thresholds.minRepartitionEventRate).toBe(0);
    expect(response.report.thresholds.maxRepartitionEventRate).toBe(1);
    expect(response.report.thresholds.maxRepartitionMaxRound).toBe(3);
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

  it("recovers deterministic cache hit from source-fingerprint mismatch when topology plan has no blocked declarations", async () => {
    const previousCacheDir = process.env.EXPLAIN_MD_WEB_PROOF_CACHE_DIR;
    const previousFixtureRoot = process.env.EXPLAIN_MD_LEAN_FIXTURE_PROJECT_ROOT;
    const tempCacheDir = await fs.mkdtemp(path.join(os.tmpdir(), "explain-md-proof-cache-"));
    const fixtureSourceRoot = await resolveFixtureSourceRootForTests();
    const tempFixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "explain-md-proof-fixture-"));
    process.env.EXPLAIN_MD_WEB_PROOF_CACHE_DIR = tempCacheDir;
    process.env.EXPLAIN_MD_LEAN_FIXTURE_PROJECT_ROOT = tempFixtureRoot;
    await copyDirectory(fixtureSourceRoot, tempFixtureRoot);

    try {
      clearProofDatasetCacheForTests();
      await buildProofCacheReportView({
        proofId: LEAN_FIXTURE_PROOF_ID,
      });

      clearProofDatasetCacheForTests();
      const warm = await buildProofCacheReportView({
        proofId: LEAN_FIXTURE_PROOF_ID,
      });
      expect(warm.cache.status).toBe("hit");
      expect(warm.cache.diagnostics.some((diagnostic) => diagnostic.code === "cache_hit")).toBe(true);

      const corePath = path.join(tempFixtureRoot, "Verity", "Core.lean");
      const coreBefore = await fs.readFile(corePath, "utf8");
      await fs.writeFile(corePath, coreBefore.replace("namespace Verity", "namespace  Verity"), "utf8");

      clearProofDatasetCacheForTests();
      const recovered = await buildProofCacheReportView({
        proofId: LEAN_FIXTURE_PROOF_ID,
      });

      expect(recovered.cache.status).toBe("hit");
      expect(recovered.cache.diagnostics.some((diagnostic) => diagnostic.code === "cache_topology_recovery_hit")).toBe(true);
      expect(recovered.cache.blockedSubtreePlan?.reason).toBe("source_fingerprint_mismatch");
      expect(recovered.cache.blockedSubtreePlan?.fullRebuildRequired).toBe(false);
      expect(recovered.cache.blockedSubtreePlan?.blockedDeclarationIds).toEqual([]);
      expect(recovered.cache.blockedSubtreePlan?.blockedLeafIds).toEqual([]);
      expect(recovered.cache.blockedSubtreePlan?.executionBatches).toEqual([]);
      expect(recovered.cache.blockedSubtreePlan?.planHash).toHaveLength(64);
      expect(recovered.cache.snapshotHash).toBe(warm.cache.snapshotHash);
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

  it("rebases recovered snapshot provenance for source-span-only mutations without full rebuild", async () => {
    const previousCacheDir = process.env.EXPLAIN_MD_WEB_PROOF_CACHE_DIR;
    const previousFixtureRoot = process.env.EXPLAIN_MD_LEAN_FIXTURE_PROJECT_ROOT;
    const tempCacheDir = await fs.mkdtemp(path.join(os.tmpdir(), "explain-md-proof-cache-"));
    const fixtureSourceRoot = await resolveFixtureSourceRootForTests();
    const tempFixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "explain-md-proof-fixture-"));
    process.env.EXPLAIN_MD_WEB_PROOF_CACHE_DIR = tempCacheDir;
    process.env.EXPLAIN_MD_LEAN_FIXTURE_PROJECT_ROOT = tempFixtureRoot;
    await copyDirectory(fixtureSourceRoot, tempFixtureRoot);

    try {
      clearProofDatasetCacheForTests();
      await buildProofCacheReportView({
        proofId: LEAN_FIXTURE_PROOF_ID,
      });

      clearProofDatasetCacheForTests();
      const warm = await buildProofCacheReportView({
        proofId: LEAN_FIXTURE_PROOF_ID,
      });
      expect(warm.cache.status).toBe("hit");

      const corePath = path.join(tempFixtureRoot, "Verity", "Core.lean");
      const coreBefore = await fs.readFile(corePath, "utf8");
      await fs.writeFile(corePath, `${coreBefore.trimEnd()}\n-- trailing provenance-only mutation\n`, "utf8");

      clearProofDatasetCacheForTests();
      const recovered = await buildProofCacheReportView({
        proofId: LEAN_FIXTURE_PROOF_ID,
      });

      expect(recovered.cache.status).toBe("hit");
      expect(recovered.cache.diagnostics.some((diagnostic) => diagnostic.code === "cache_topology_recovery_hit")).toBe(true);
      expect(recovered.cache.blockedSubtreePlan?.fullRebuildRequired).toBe(false);
      expect(recovered.cache.blockedSubtreePlan?.blockedDeclarationIds).toEqual([]);
      expect(recovered.cache.snapshotHash).not.toBe(warm.cache.snapshotHash);
      expect(recovered.cache.cacheEntryHash).not.toBe(warm.cache.cacheEntryHash);
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

  it("recovers deterministic cache hit by recomputing blocked-subtree ancestors on topology-stable semantic mutation", async () => {
    const previousCacheDir = process.env.EXPLAIN_MD_WEB_PROOF_CACHE_DIR;
    const previousFixtureRoot = process.env.EXPLAIN_MD_LEAN_FIXTURE_PROJECT_ROOT;
    const tempCacheDir = await fs.mkdtemp(path.join(os.tmpdir(), "explain-md-proof-cache-"));
    const fixtureSourceRoot = await resolveFixtureSourceRootForTests();
    const tempFixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "explain-md-proof-fixture-"));
    process.env.EXPLAIN_MD_WEB_PROOF_CACHE_DIR = tempCacheDir;
    process.env.EXPLAIN_MD_LEAN_FIXTURE_PROJECT_ROOT = tempFixtureRoot;
    await copyDirectory(fixtureSourceRoot, tempFixtureRoot);

    try {
      clearProofDatasetCacheForTests();
      await buildProofCacheReportView({
        proofId: LEAN_FIXTURE_PROOF_ID,
      });

      clearProofDatasetCacheForTests();
      const warm = await buildProofCacheReportView({
        proofId: LEAN_FIXTURE_PROOF_ID,
      });
      expect(warm.cache.status).toBe("hit");

      const corePath = path.join(tempFixtureRoot, "Verity", "Core.lean");
      const coreBefore = await fs.readFile(corePath, "utf8");
      const semanticMutationTarget = "lemma inc_nonzero (n : Nat) : inc n > 0 := by";
      const semanticMutationReplacement = "lemma inc_nonzero (n : Nat) : inc n >= 1 := by";
      expect(coreBefore.includes(semanticMutationTarget)).toBe(true);
      await fs.writeFile(corePath, coreBefore.replace(semanticMutationTarget, semanticMutationReplacement), "utf8");

      clearProofDatasetCacheForTests();
      const recovered = await buildProofCacheReportView({
        proofId: LEAN_FIXTURE_PROOF_ID,
      });

      expect(recovered.cache.status).toBe("hit");
      expect(recovered.cache.diagnostics.some((diagnostic) => diagnostic.code === "cache_blocked_subtree_rebuild_hit")).toBe(
        true,
      );
      expect(recovered.cache.blockedSubtreePlan?.fullRebuildRequired).toBe(true);
      expect(recovered.cache.blockedSubtreePlan?.topologyShapeChanged).toBe(false);
      expect(recovered.cache.blockedSubtreePlan?.addedDeclarationIds).toEqual([]);
      expect(recovered.cache.blockedSubtreePlan?.removedDeclarationIds).toEqual([]);
      expect((recovered.cache.blockedSubtreePlan?.blockedDeclarationIds.length ?? 0) > 0).toBe(true);
      expect(recovered.cache.snapshotHash).not.toBe(warm.cache.snapshotHash);
      expect(recovered.cache.cacheEntryHash).not.toBe(warm.cache.cacheEntryHash);
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

  it("emits deterministic full-rebuild diagnostic for topology-shape-changing mutations", async () => {
    const previousCacheDir = process.env.EXPLAIN_MD_WEB_PROOF_CACHE_DIR;
    const previousFixtureRoot = process.env.EXPLAIN_MD_LEAN_FIXTURE_PROJECT_ROOT;
    const tempCacheDir = await fs.mkdtemp(path.join(os.tmpdir(), "explain-md-proof-cache-"));
    const fixtureSourceRoot = await resolveFixtureSourceRootForTests();
    const tempFixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "explain-md-proof-fixture-"));
    process.env.EXPLAIN_MD_WEB_PROOF_CACHE_DIR = tempCacheDir;
    process.env.EXPLAIN_MD_LEAN_FIXTURE_PROJECT_ROOT = tempFixtureRoot;
    await copyDirectory(fixtureSourceRoot, tempFixtureRoot);

    try {
      clearProofDatasetCacheForTests();
      await buildProofCacheReportView({
        proofId: LEAN_FIXTURE_PROOF_ID,
      });

      clearProofDatasetCacheForTests();
      const warm = await buildProofCacheReportView({
        proofId: LEAN_FIXTURE_PROOF_ID,
      });
      expect(warm.cache.status).toBe("hit");

      const corePath = path.join(tempFixtureRoot, "Verity", "Core.lean");
      const coreBefore = await fs.readFile(corePath, "utf8");
      const addedTheorem = "\n\ntheorem cache_shape_added : True := by\n  trivial\n";
      await fs.writeFile(corePath, `${coreBefore.trimEnd()}${addedTheorem}`, "utf8");

      clearProofDatasetCacheForTests();
      const rebuilt = await buildProofCacheReportView({
        proofId: LEAN_FIXTURE_PROOF_ID,
      });

      expect(rebuilt.cache.status).toBe("miss");
      expect(rebuilt.cache.diagnostics.some((diagnostic) => diagnostic.code === "cache_miss")).toBe(true);
      expect(rebuilt.cache.diagnostics.some((diagnostic) => diagnostic.code === "cache_blocked_subtree_full_rebuild")).toBe(
        true,
      );
      const fullRebuildDiagnostic = rebuilt.cache.diagnostics.find(
        (diagnostic) => diagnostic.code === "cache_blocked_subtree_full_rebuild",
      );
      expect(fullRebuildDiagnostic?.details?.reason).toBe("topology_shape_changed");
      expect(rebuilt.cache.blockedSubtreePlan?.fullRebuildRequired).toBe(true);
      expect(rebuilt.cache.blockedSubtreePlan?.topologyShapeChanged).toBe(true);
      expect((rebuilt.cache.blockedSubtreePlan?.addedDeclarationIds.length ?? 0) > 0).toBe(true);
      expect(rebuilt.cache.snapshotHash).not.toBe(warm.cache.snapshotHash);
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

async function copyDirectory(sourceDir: string, destinationDir: string): Promise<void> {
  await fs.mkdir(destinationDir, { recursive: true });
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const destinationPath = path.join(destinationDir, entry.name);
    if (entry.isDirectory()) {
      await copyDirectory(sourcePath, destinationPath);
      continue;
    }
    await fs.copyFile(sourcePath, destinationPath);
  }
}

async function resolveFixtureSourceRootForTests(): Promise<string> {
  const candidates = [
    path.resolve(process.cwd(), "tests", "fixtures", "lean-project"),
    path.resolve(process.cwd(), "..", "..", "tests", "fixtures", "lean-project"),
  ];

  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // continue
    }
  }

  throw new Error(`Could not locate lean fixture project for tests. Tried: ${candidates.join(", ")}`);
}
