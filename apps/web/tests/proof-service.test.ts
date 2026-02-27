import { describe, expect, it } from "vitest";
import {
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
});
