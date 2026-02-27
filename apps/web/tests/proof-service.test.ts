import { describe, expect, it } from "vitest";
import {
  buildSeedDiff,
  buildSeedLeafDetail,
  buildSeedNodeChildrenView,
  buildSeedNodePathView,
  buildSeedProjection,
  buildSeedRootView,
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
});
