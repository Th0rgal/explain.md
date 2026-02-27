import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchLeafVerificationJobs,
  fetchNodeChildren,
  fetchNodePath,
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
      termIntroductionBudget: 1,
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
    expect(requestUrl).toContain("termIntroductionBudget=1");
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
