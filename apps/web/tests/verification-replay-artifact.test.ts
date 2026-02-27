import { describe, expect, it } from "vitest";
import type { VerificationJobResponse } from "../lib/api-client";
import {
  buildVerificationReplayArtifact,
  buildVerificationReplayArtifactFilename,
  renderVerificationReplayArtifactJson,
} from "../lib/verification-replay-artifact";

function createResponseFixture(): VerificationJobResponse {
  return {
    requestHash: "a".repeat(64),
    jobHash: "b".repeat(64),
    jobReplay: {
      jobId: "job 1",
      jobHash: "b".repeat(64),
      reproducibilityHash: "f".repeat(64),
      replayCommand: "cd /tmp/verity && lake env lean Verity/Core.lean",
    },
    job: {
      jobId: "job 1",
      queueSequence: 4,
      status: "success",
      createdAt: "2026-02-27T00:00:00.000Z",
      updatedAt: "2026-02-27T00:00:02.000Z",
      startedAt: "2026-02-27T00:00:01.000Z",
      finishedAt: "2026-02-27T00:00:02.000Z",
      result: {
        exitCode: 0,
        signal: null,
        durationMs: 821,
        logsTruncated: false,
        logLineCount: 2,
      },
      logs: [
        { index: 8, stream: "stderr", message: "second" },
        { index: 3, stream: "stdout", message: "first" },
      ],
      reproducibility: {
        sourceRevision: "main@abc123",
        workingDirectory: "/tmp/verity",
        command: "lake",
        args: ["env", "lean", "Verity/Core.lean"],
        env: {
          ZED: "z",
          ALPHA: "a",
        },
        toolchain: {
          leanVersion: "4.12.0",
          lakeVersion: "5.0.0",
        },
      },
    },
  };
}

describe("verification replay artifact", () => {
  it("builds deterministic canonical replay payload", () => {
    const artifact = buildVerificationReplayArtifact("Seed Verity", "leaf/tx prover", createResponseFixture(), {
      treeSnapshotHash: "1".repeat(64),
      treeConfigHash: "2".repeat(64),
      leafDetailRequestHash: "3".repeat(64),
      leafDetailConfigHash: "4".repeat(64),
      leafDetailHash: "5".repeat(64),
      nodePathRequestHash: "6".repeat(64),
      nodePathSnapshotHash: "7".repeat(64),
    });

    expect(artifact.schemaVersion).toBe("1.1.0");
    expect(artifact.context).toEqual({
      leafDetailConfigHash: "4".repeat(64),
      leafDetailHash: "5".repeat(64),
      leafDetailRequestHash: "3".repeat(64),
      nodePathRequestHash: "6".repeat(64),
      nodePathSnapshotHash: "7".repeat(64),
      treeConfigHash: "2".repeat(64),
      treeSnapshotHash: "1".repeat(64),
    });
    expect(Object.keys(artifact.job.reproducibility.env)).toEqual(["ALPHA", "ZED"]);
    expect(artifact.job.logs.map((entry) => entry.index)).toEqual([3, 8]);
    expect(artifact.replay).toEqual({
      jobHash: "b".repeat(64),
      reproducibilityHash: "f".repeat(64),
      replayCommand: "cd /tmp/verity && lake env lean Verity/Core.lean",
    });
  });

  it("renders stable json with trailing newline", () => {
    const artifact = buildVerificationReplayArtifact("seed-verity", "leaf-a", createResponseFixture());
    const rendered = renderVerificationReplayArtifactJson(artifact);

    expect(rendered.endsWith("\n")).toBe(true);
    expect(JSON.parse(rendered)).toEqual(artifact);
  });

  it("drops undefined context values deterministically", () => {
    const artifact = buildVerificationReplayArtifact("seed-verity", "leaf-a", createResponseFixture(), {
      treeConfigHash: "2".repeat(64),
      treeSnapshotHash: "",
      leafDetailRequestHash: undefined,
      leafDetailHash: "5".repeat(64),
    });

    expect(artifact.context).toEqual({
      leafDetailHash: "5".repeat(64),
      treeConfigHash: "2".repeat(64),
    });
  });

  it("normalizes export filenames deterministically", () => {
    expect(
      buildVerificationReplayArtifactFilename("Seed Verity", "leaf/tx prover", "job 1", "ABCDEF1234567890"),
    ).toBe("verification-replay-seed-verity-leaf-tx-prover-job-1-abcdef123456.json");
  });
});
