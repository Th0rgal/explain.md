import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchCacheReport,
  fetchConfigProfiles,
  fetchDiff,
  fetchDependencyGraph,
  removeConfigProfile,
  saveConfigProfile,
  fetchLeafVerificationJobs,
  fetchNodeChildren,
  fetchNodePath,
  fetchPolicyReport,
  fetchRoot,
  fetchVerificationJob,
  verifyLeaf,
} from "../lib/api-client";

interface MockResponsePayload<T> {
  ok: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}

describe("api client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("builds deterministic root query params", async () => {
    const fetchMock = vi.fn(async (input: string) =>
      buildMockResponse({
        ok: true,
        data: {
          proofId: "seed-verity",
          configHash: "abc",
          requestHash: "def",
          snapshotHash: "ghi",
          root: { node: undefined, diagnostics: [] },
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await fetchRoot("seed-verity", {
      abstractionLevel: 2,
      complexityLevel: 4,
      maxChildrenPerParent: 6,
      audienceLevel: "expert",
      language: "en",
      readingLevelTarget: "undergraduate",
      complexityBandWidth: 2,
      termIntroductionBudget: 1,
      proofDetailMode: "formal",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requestUrl = String(fetchMock.mock.calls[0]?.[0]);
    expect(requestUrl).toContain("/api/proofs/root?");
    expect(requestUrl).toContain("proofId=seed-verity");
    expect(requestUrl).toContain("abstractionLevel=2");
    expect(requestUrl).toContain("complexityLevel=4");
    expect(requestUrl).toContain("maxChildrenPerParent=6");
    expect(requestUrl).toContain("audienceLevel=expert");
    expect(requestUrl).toContain("language=en");
    expect(requestUrl).toContain("readingLevelTarget=undergraduate");
    expect(requestUrl).toContain("complexityBandWidth=2");
    expect(requestUrl).toContain("termIntroductionBudget=1");
    expect(requestUrl).toContain("proofDetailMode=formal");
  });

  it("encodes node id and pagination for children queries", async () => {
    const fetchMock = vi.fn(async (input: string) =>
      buildMockResponse({
        ok: true,
        data: {
          proofId: "seed-verity",
          configHash: "abc",
          requestHash: "def",
          snapshotHash: "ghi",
          children: {
            parent: {
              id: "p2_root",
              kind: "parent",
              statement: "root",
              depth: 0,
              childIds: [],
              evidenceRefs: [],
              newTermsIntroduced: [],
            },
            totalChildren: 1,
            offset: 0,
            limit: 1,
            hasMore: false,
            children: [],
            diagnostics: [],
          },
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await fetchNodeChildren("seed-verity", "node/with spaces", { maxChildrenPerParent: 3 }, { offset: 4, limit: 2 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requestUrl = String(fetchMock.mock.calls[0]?.[0]);
    expect(requestUrl).toContain("/api/proofs/nodes/node%2Fwith%20spaces/children?");
    expect(requestUrl).toContain("proofId=seed-verity");
    expect(requestUrl).toContain("maxChildrenPerParent=3");
    expect(requestUrl).toContain("offset=4");
    expect(requestUrl).toContain("limit=2");
  });

  it("surfaces API error payloads for path queries", async () => {
    const fetchMock = vi.fn(async () =>
      buildMockResponse(
        {
          ok: false,
          error: {
            code: "invalid_request",
            message: "nodeId must be non-empty",
          },
        },
        400,
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchNodePath("seed-verity", "", {})).rejects.toThrow("nodeId must be non-empty");
  });

  it("posts verification requests with deterministic payload", async () => {
    const fetchMock = vi.fn(async (_input: string, init?: RequestInit) =>
      buildMockResponse({
        ok: true,
        data: {
          requestHash: "req",
          queuedJob: {
            jobId: "job-000001",
            queueSequence: 0,
            status: "queued",
            createdAt: "2026-02-27T00:00:00.000Z",
            updatedAt: "2026-02-27T00:00:00.000Z",
            logs: [],
          },
          queuedJobHash: "a".repeat(64),
          finalJob: {
            jobId: "job-000001",
            queueSequence: 0,
            status: "success",
            createdAt: "2026-02-27T00:00:00.000Z",
            updatedAt: "2026-02-27T00:00:01.000Z",
            logs: [],
          },
          finalJobHash: "b".repeat(64),
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await verifyLeaf("seed-verity", "leaf/with spaces", true);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requestUrl = String(fetchMock.mock.calls[0]?.[0]);
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(requestUrl).toContain("/api/proofs/leaves/leaf%2Fwith%20spaces/verify");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ proofId: "seed-verity", autoRun: true }));
  });

  it("posts diff payloads with the full config knob contract", async () => {
    const fetchMock = vi.fn(async (_input: string, _init?: RequestInit) =>
      buildMockResponse({
        ok: true,
        data: {
          proofId: "seed-verity",
          requestHash: "req",
          diffHash: "diff",
          report: {
            summary: {
              total: 0,
              added: 0,
              removed: 0,
              changed: 0,
            },
            changes: [],
          },
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await fetchDiff({
      proofId: "seed-verity",
      baselineConfig: {
        abstractionLevel: 2,
        complexityLevel: 2,
        maxChildrenPerParent: 3,
        audienceLevel: "novice",
        language: "en",
        readingLevelTarget: "high_school",
        complexityBandWidth: 1,
        termIntroductionBudget: 1,
        proofDetailMode: "minimal",
      },
      candidateConfig: {
        abstractionLevel: 4,
        complexityLevel: 4,
        maxChildrenPerParent: 5,
        audienceLevel: "expert",
        language: "fr",
        readingLevelTarget: "graduate",
        complexityBandWidth: 2,
        termIntroductionBudget: 3,
        proofDetailMode: "formal",
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(init.body).toBe(
      JSON.stringify({
        proofId: "seed-verity",
        baselineConfig: {
          abstractionLevel: 2,
          complexityLevel: 2,
          maxChildrenPerParent: 3,
          audienceLevel: "novice",
          language: "en",
          readingLevelTarget: "high_school",
          complexityBandWidth: 1,
          termIntroductionBudget: 1,
          proofDetailMode: "minimal",
        },
        candidateConfig: {
          abstractionLevel: 4,
          complexityLevel: 4,
          maxChildrenPerParent: 5,
          audienceLevel: "expert",
          language: "fr",
          readingLevelTarget: "graduate",
          complexityBandWidth: 2,
          termIntroductionBudget: 3,
          proofDetailMode: "formal",
        },
      }),
    );
  });

  it("encodes verification history and job-detail urls", async () => {
    const fetchMock = vi.fn(async (input: string) => {
      if (input.includes("/verification-jobs")) {
        return buildMockResponse({
          ok: true,
          data: {
            proofId: "seed-verity",
            leafId: "leaf id",
            jobs: [],
            jobHashes: [],
          },
        });
      }
      return buildMockResponse({
        ok: true,
        data: {
          job: {
            jobId: "job id",
            queueSequence: 0,
            status: "queued",
            createdAt: "2026-02-27T00:00:00.000Z",
            updatedAt: "2026-02-27T00:00:00.000Z",
            logs: [],
          },
          jobHash: "c".repeat(64),
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await fetchLeafVerificationJobs("seed-verity", "leaf id");
    await fetchVerificationJob("job id");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      "/api/proofs/leaves/leaf%20id/verification-jobs?proofId=seed-verity",
    );
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("/api/verification/jobs/job%20id");
  });

  it("encodes dependency graph query contract deterministically", async () => {
    const fetchMock = vi.fn(async (_input: string) =>
      buildMockResponse({
        ok: true,
        data: {
          proofId: "lean-verity-fixture",
          configHash: "a".repeat(64),
          requestHash: "b".repeat(64),
          dependencyGraphHash: "c".repeat(64),
          graph: {
            schemaVersion: "1.0.0",
            nodeCount: 5,
            edgeCount: 3,
            indexedNodeCount: 5,
            externalNodeCount: 0,
            missingDependencyRefs: [],
            sccCount: 5,
            cyclicSccCount: 0,
            cyclicSccs: [],
          },
          diagnostics: [],
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await fetchDependencyGraph(
      "lean-verity-fixture",
      { abstractionLevel: 2, complexityLevel: 4, maxChildrenPerParent: 3 },
      {
        declarationId: "lean:Verity/Loop:loop_preserves:3:1",
        includeExternalSupport: false,
      },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requestUrl = String(fetchMock.mock.calls[0]?.[0]);
    expect(requestUrl).toContain("/api/proofs/dependency-graph?");
    expect(requestUrl).toContain("proofId=lean-verity-fixture");
    expect(requestUrl).toContain("abstractionLevel=2");
    expect(requestUrl).toContain("complexityLevel=4");
    expect(requestUrl).toContain("maxChildrenPerParent=3");
    expect(requestUrl).toContain("declarationId=lean%3AVerity%2FLoop%3Aloop_preserves%3A3%3A1");
    expect(requestUrl).toContain("includeExternalSupport=false");
  });

  it("encodes policy report query contract with threshold overrides", async () => {
    const fetchMock = vi.fn(async (_input: string) =>
      buildMockResponse({
        ok: true,
        data: {
          proofId: "lean-verity-fixture",
          configHash: "a".repeat(64),
          requestHash: "b".repeat(64),
          reportHash: "c".repeat(64),
          report: {
            rootId: "root",
            configHash: "d".repeat(64),
            generatedAt: "2026-02-27T00:00:00.000Z",
            metrics: {
              parentCount: 1,
              unsupportedParentCount: 0,
              prerequisiteViolationParentCount: 0,
              policyViolationParentCount: 0,
              introducedTermOverflowParentCount: 0,
              unsupportedParentRate: 0,
              prerequisiteViolationRate: 0,
              policyViolationRate: 0,
              meanComplexitySpread: 0,
              maxComplexitySpread: 0,
              meanEvidenceCoverage: 1,
              meanVocabularyContinuity: 1,
              meanTermJumpRate: 0,
              supportCoverageFloor: 0.4,
            },
            thresholds: {
              maxUnsupportedParentRate: 0,
              maxPrerequisiteViolationRate: 0,
              maxPolicyViolationRate: 0,
              maxTermJumpRate: 0.35,
              maxComplexitySpreadMean: 1,
              minEvidenceCoverageMean: 1,
              minVocabularyContinuityMean: 1,
              minRepartitionEventRate: 0,
              maxRepartitionEventRate: 1,
              maxRepartitionMaxRound: 3,
            },
            thresholdPass: true,
            thresholdFailures: [],
            parentSamples: [],
            depthMetrics: [],
            repartitionMetrics: {
              eventCount: 1,
              preSummaryEventCount: 0,
              postSummaryEventCount: 1,
              maxRound: 1,
              depthMetrics: [
                {
                  depth: 2,
                  eventCount: 1,
                  preSummaryEventCount: 0,
                  postSummaryEventCount: 1,
                  maxRound: 1,
                },
              ],
            },
          },
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await fetchPolicyReport(
      "lean-verity-fixture",
      { abstractionLevel: 2, complexityLevel: 4, maxChildrenPerParent: 3 },
      {
        maxPolicyViolationRate: 0,
        minEvidenceCoverageMean: 1,
        minVocabularyContinuityMean: 1,
        minRepartitionEventRate: 0.2,
        maxRepartitionEventRate: 0.5,
        maxRepartitionMaxRound: 1,
      },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requestUrl = String(fetchMock.mock.calls[0]?.[0]);
    expect(requestUrl).toContain("/api/proofs/policy-report?");
    expect(requestUrl).toContain("proofId=lean-verity-fixture");
    expect(requestUrl).toContain("abstractionLevel=2");
    expect(requestUrl).toContain("complexityLevel=4");
    expect(requestUrl).toContain("maxChildrenPerParent=3");
    expect(requestUrl).toContain("maxPolicyViolationRate=0");
    expect(requestUrl).toContain("minEvidenceCoverageMean=1");
    expect(requestUrl).toContain("minVocabularyContinuityMean=1");
    expect(requestUrl).toContain("minRepartitionEventRate=0.2");
    expect(requestUrl).toContain("maxRepartitionEventRate=0.5");
    expect(requestUrl).toContain("maxRepartitionMaxRound=1");
  });

  it("encodes cache report query contract deterministically", async () => {
    const fetchMock = vi.fn(async (_input: string) =>
      buildMockResponse({
        ok: true,
        data: {
          proofId: "lean-verity-fixture",
          configHash: "a".repeat(64),
          requestHash: "b".repeat(64),
          cache: {
            layer: "persistent",
            status: "hit",
            cacheKey: "lean-verity-fixture:key",
            sourceFingerprint: "fingerprint",
            snapshotHash: "c".repeat(64),
            cacheEntryHash: "d".repeat(64),
            diagnostics: [],
          },
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await fetchCacheReport("lean-verity-fixture", {
      abstractionLevel: 2,
      complexityLevel: 4,
      maxChildrenPerParent: 3,
      audienceLevel: "expert",
      language: "en",
      readingLevelTarget: "undergraduate",
      complexityBandWidth: 2,
      termIntroductionBudget: 1,
      proofDetailMode: "formal",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requestUrl = String(fetchMock.mock.calls[0]?.[0]);
    expect(requestUrl).toContain("/api/proofs/cache-report?");
    expect(requestUrl).toContain("proofId=lean-verity-fixture");
    expect(requestUrl).toContain("abstractionLevel=2");
    expect(requestUrl).toContain("complexityLevel=4");
    expect(requestUrl).toContain("maxChildrenPerParent=3");
    expect(requestUrl).toContain("audienceLevel=expert");
    expect(requestUrl).toContain("language=en");
    expect(requestUrl).toContain("readingLevelTarget=undergraduate");
    expect(requestUrl).toContain("complexityBandWidth=2");
    expect(requestUrl).toContain("termIntroductionBudget=1");
    expect(requestUrl).toContain("proofDetailMode=formal");
  });

  it("encodes config profile list query parameters", async () => {
    const fetchMock = vi.fn(async (_input: string) =>
      buildMockResponse({
        ok: true,
        data: {
          projectId: "seed-verity",
          userId: "local-user",
          requestHash: "a".repeat(64),
          ledgerHash: "b".repeat(64),
          profiles: [],
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await fetchConfigProfiles("seed-verity", "local-user");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requestUrl = String(fetchMock.mock.calls[0]?.[0]);
    expect(requestUrl).toContain("/api/proofs/config-profiles?");
    expect(requestUrl).toContain("projectId=seed-verity");
    expect(requestUrl).toContain("userId=local-user");
  });

  it("posts and deletes config profile payloads deterministically", async () => {
    const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        return buildMockResponse({
          ok: true,
          data: {
            projectId: "seed-verity",
            userId: "local-user",
            profileId: "focused",
            requestHash: "a".repeat(64),
            ledgerHash: "b".repeat(64),
            profile: {
              storageKey: "project:seed-verity:user:local-user:profile:focused",
              profileId: "focused",
              projectId: "seed-verity",
              userId: "local-user",
              name: "Focused",
              config: {},
              configHash: "c".repeat(64),
              createdAt: "2026-02-27T00:00:00.000Z",
              updatedAt: "2026-02-27T00:00:00.000Z",
            },
            regenerationPlan: {
              scope: "full",
              changedFields: ["profile.create"],
              reason: "new profile",
            },
          },
        });
      }

      expect(init?.method).toBe("DELETE");
      return buildMockResponse({
        ok: true,
        data: {
          projectId: "seed-verity",
          userId: "local-user",
          profileId: "focused",
          requestHash: "d".repeat(64),
          ledgerHash: "e".repeat(64),
          deleted: true,
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await saveConfigProfile({
      projectId: "seed-verity",
      userId: "local-user",
      profileId: "focused",
      name: "Focused",
      config: {
        abstractionLevel: 4,
        complexityLevel: 2,
      },
    });
    await removeConfigProfile("seed-verity", "local-user", "focused");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const saveCallUrl = String(fetchMock.mock.calls[0]?.[0]);
    const saveCallInit = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(saveCallUrl).toBe("/api/proofs/config-profiles");
    expect(saveCallInit.method).toBe("POST");
    expect(saveCallInit.body).toBe(
      JSON.stringify({
        projectId: "seed-verity",
        userId: "local-user",
        profileId: "focused",
        name: "Focused",
        config: {
          abstractionLevel: 4,
          complexityLevel: 2,
        },
      }),
    );

    const deleteCallUrl = String(fetchMock.mock.calls[1]?.[0]);
    expect(deleteCallUrl).toContain("/api/proofs/config-profiles/focused?");
    expect(deleteCallUrl).toContain("projectId=seed-verity");
    expect(deleteCallUrl).toContain("userId=local-user");
  });
});

function buildMockResponse<T>(payload: MockResponsePayload<T>, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return payload;
    },
  } as Response;
}
