import { createHash } from "node:crypto";
import type { VerificationJobResponse } from "./api-client";
import {
  buildVerificationReplayArtifact,
  buildVerificationReplayArtifactFilename,
  renderVerificationReplayArtifactJson,
} from "./verification-replay-artifact";

const SCHEMA_VERSION = "1.0.0";

export interface VerificationReplayEvaluationReport {
  schemaVersion: string;
  requestHash: string;
  outcomeHash: string;
  parameters: {
    proofId: string;
    leafId: string;
    jobId: string;
    contextFieldCount: number;
  };
  summary: {
    exportFilename: string;
    requestHash: string;
    jobHash: string;
    reproducibilityHash: string;
    replayCommand: string;
    treeConfigHash?: string;
    treeSnapshotHash?: string;
    leafDetailRequestHash?: string;
    leafDetailConfigHash?: string;
    leafDetailHash?: string;
    nodePathRequestHash?: string;
    nodePathSnapshotHash?: string;
    envKeyCount: number;
    logLineCount: number;
    jsonLineCount: number;
  };
}

export function runVerificationReplayEvaluation(): VerificationReplayEvaluationReport {
  const fixture = buildFixture();
  const artifact = buildVerificationReplayArtifact(fixture.proofId, fixture.leafId, fixture.response, fixture.context);
  const exportFilename = buildVerificationReplayArtifactFilename(
    fixture.proofId,
    fixture.leafId,
    fixture.response.job.jobId,
    fixture.response.jobReplay.reproducibilityHash,
  );
  const renderedArtifact = renderVerificationReplayArtifactJson(artifact);

  const requestHash = computeHash({
    schemaVersion: SCHEMA_VERSION,
    proofId: fixture.proofId,
    leafId: fixture.leafId,
    response: fixture.response,
  });

  const summary = {
    exportFilename,
    requestHash: artifact.requestHash,
    jobHash: artifact.replay.jobHash,
    reproducibilityHash: artifact.replay.reproducibilityHash,
    replayCommand: artifact.replay.replayCommand,
    treeConfigHash: artifact.context.treeConfigHash,
    treeSnapshotHash: artifact.context.treeSnapshotHash,
    leafDetailRequestHash: artifact.context.leafDetailRequestHash,
    leafDetailConfigHash: artifact.context.leafDetailConfigHash,
    leafDetailHash: artifact.context.leafDetailHash,
    nodePathRequestHash: artifact.context.nodePathRequestHash,
    nodePathSnapshotHash: artifact.context.nodePathSnapshotHash,
    envKeyCount: Object.keys(artifact.job.reproducibility.env).length,
    logLineCount: artifact.job.logs.length,
    jsonLineCount: renderedArtifact.split("\n").filter((line) => line.length > 0).length,
  };

  const outcomeHash = computeHash({
    schemaVersion: SCHEMA_VERSION,
    summary,
    artifact,
  });

  return {
    schemaVersion: SCHEMA_VERSION,
    requestHash,
    outcomeHash,
    parameters: {
      proofId: fixture.proofId,
      leafId: fixture.leafId,
      jobId: fixture.response.job.jobId,
      contextFieldCount: Object.keys(artifact.context).length,
    },
    summary,
  };
}

function buildFixture(): {
  proofId: string;
  leafId: string;
  response: VerificationJobResponse;
  context: {
    treeConfigHash: string;
    treeSnapshotHash: string;
    leafDetailRequestHash: string;
    leafDetailConfigHash: string;
    leafDetailHash: string;
    nodePathRequestHash: string;
    nodePathSnapshotHash: string;
  };
} {
  return {
    proofId: "seed-verity",
    leafId: "leaf/tx prover",
    context: {
      treeConfigHash: "c".repeat(64),
      treeSnapshotHash: "d".repeat(64),
      leafDetailRequestHash: "e".repeat(64),
      leafDetailConfigHash: "1".repeat(64),
      leafDetailHash: "2".repeat(64),
      nodePathRequestHash: "3".repeat(64),
      nodePathSnapshotHash: "4".repeat(64),
    },
    response: {
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
    },
  };
}

function computeHash(input: unknown): string {
  const canonical = canonicalize(input);
  return createHash("sha256").update(canonical).digest("hex");
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
