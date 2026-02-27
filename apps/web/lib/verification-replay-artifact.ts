import type { VerificationJobResponse } from "./api-client";

export interface VerificationReplayArtifact {
  schemaVersion: "1.1.0";
  proofId: string;
  leafId: string;
  requestHash: string;
  context: {
    treeConfigHash?: string;
    treeSnapshotHash?: string;
    leafDetailRequestHash?: string;
    leafDetailConfigHash?: string;
    leafDetailHash?: string;
    nodePathRequestHash?: string;
    nodePathSnapshotHash?: string;
  };
  job: {
    jobId: string;
    queueSequence: number;
    status: "queued" | "running" | "success" | "failure" | "timeout";
    createdAt: string;
    updatedAt: string;
    startedAt?: string;
    finishedAt?: string;
    result?: {
      exitCode: number | null;
      signal: string | null;
      durationMs: number;
      logsTruncated: boolean;
      logLineCount: number;
    };
    reproducibility: {
      sourceRevision: string;
      workingDirectory: string;
      command: string;
      args: string[];
      env: Record<string, string>;
      toolchain: {
        leanVersion: string;
        lakeVersion?: string;
      };
    };
    logs: Array<{
      index: number;
      stream: "stdout" | "stderr" | "system";
      message: string;
    }>;
  };
  replay: {
    jobHash: string;
    reproducibilityHash: string;
    replayCommand: string;
  };
}

export function buildVerificationReplayArtifact(
  proofId: string,
  leafId: string,
  response: VerificationJobResponse,
  context: {
    treeConfigHash?: string;
    treeSnapshotHash?: string;
    leafDetailRequestHash?: string;
    leafDetailConfigHash?: string;
    leafDetailHash?: string;
    nodePathRequestHash?: string;
    nodePathSnapshotHash?: string;
  } = {},
): VerificationReplayArtifact {
  return {
    schemaVersion: "1.1.0",
    proofId,
    leafId,
    requestHash: response.requestHash,
    context: compactContext(context),
    job: {
      ...response.job,
      logs: [...response.job.logs].sort((left, right) => left.index - right.index),
      reproducibility: {
        ...response.job.reproducibility,
        args: [...response.job.reproducibility.args],
        env: Object.fromEntries(
          Object.entries(response.job.reproducibility.env).sort(([left], [right]) => left.localeCompare(right)),
        ),
      },
    },
    replay: {
      jobHash: response.jobHash,
      reproducibilityHash: response.jobReplay.reproducibilityHash,
      replayCommand: response.jobReplay.replayCommand,
    },
  };
}

export function renderVerificationReplayArtifactJson(artifact: VerificationReplayArtifact): string {
  return `${JSON.stringify(artifact, null, 2)}\n`;
}

export function buildVerificationReplayArtifactFilename(
  proofId: string,
  leafId: string,
  jobId: string,
  reproducibilityHash: string,
): string {
  const normalizedProofId = normalizeArtifactToken(proofId);
  const normalizedLeafId = normalizeArtifactToken(leafId);
  const normalizedJobId = normalizeArtifactToken(jobId);
  const hashPrefix = normalizeArtifactToken(reproducibilityHash).slice(0, 12) || "nohash";
  return `verification-replay-${normalizedProofId}-${normalizedLeafId}-${normalizedJobId}-${hashPrefix}.json`;
}

export function triggerReplayArtifactDownload(filename: string, content: string): void {
  const blob = new Blob([content], { type: "application/json" });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
}

function normalizeArtifactToken(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return normalized.length > 0 ? normalized : "unknown";
}

function compactContext(context: {
  treeConfigHash?: string;
  treeSnapshotHash?: string;
  leafDetailRequestHash?: string;
  leafDetailConfigHash?: string;
  leafDetailHash?: string;
  nodePathRequestHash?: string;
  nodePathSnapshotHash?: string;
}): VerificationReplayArtifact["context"] {
  const entries = Object.entries(context).filter(([, value]) => typeof value === "string" && value.length > 0);
  entries.sort(([left], [right]) => left.localeCompare(right));
  return Object.fromEntries(entries) as VerificationReplayArtifact["context"];
}
