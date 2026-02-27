import os from "node:os";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import type { VerificationCommandRunner } from "../../../dist/verification-flow";
import {
  clearVerificationObservabilityMetricsForTests,
  configureVerificationServiceForTests,
  exportVerificationObservabilityMetrics,
  getVerificationJobById,
  listLeafVerificationJobs,
  resetVerificationServiceForTests,
  verifyLeafProof,
} from "../lib/verification-service";
import { SEED_PROOF_ID } from "../lib/proof-service";

describe("verification service", () => {
  afterEach(() => {
    resetVerificationServiceForTests();
    clearVerificationObservabilityMetricsForTests();
  });

  it("assigns deterministic sequential job ids and hashes", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "explain-md-web-verify-"));
    configureVerificationServiceForTests({
      ledgerPath: path.join(tempDir, "verification-ledger.json"),
      runner: successRunner(),
      sourceRevision: "rev-a",
      leanVersion: "4.12.0",
      now: () => new Date("2026-02-27T00:00:00.000Z"),
    });

    const first = await verifyLeafProof({
      proofId: SEED_PROOF_ID,
      leafId: "Verity.ContractSpec.init_sound",
      autoRun: true,
    });

    const second = await verifyLeafProof({
      proofId: SEED_PROOF_ID,
      leafId: "Verity.ContractSpec.init_sound",
      autoRun: true,
    });

    expect(first.queuedJob.jobId).toBe("job-000001");
    expect(second.queuedJob.jobId).toBe("job-000002");
    expect(first.finalJobHash).toHaveLength(64);
    expect(second.finalJobHash).toHaveLength(64);
    expect(first.queuedJobReplay.reproducibilityHash).toHaveLength(64);
    expect(first.queuedJobReplay.replayCommand).toContain("lake env lean");
    expect(first.finalJobReplay.jobHash).toBe(first.finalJobHash);
  });

  it("resumes ids from persisted ledger after service reset", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "explain-md-web-verify-"));
    const ledgerPath = path.join(tempDir, "verification-ledger.json");

    configureVerificationServiceForTests({
      ledgerPath,
      runner: successRunner(),
      sourceRevision: "rev-a",
      leanVersion: "4.12.0",
      now: () => new Date("2026-02-27T00:00:00.000Z"),
    });

    const first = await verifyLeafProof({
      proofId: SEED_PROOF_ID,
      leafId: "Verity.ContractSpec.loop_preserves",
      autoRun: true,
    });

    expect(first.queuedJob.jobId).toBe("job-000001");

    configureVerificationServiceForTests({
      ledgerPath,
      runner: successRunner(),
      sourceRevision: "rev-a",
      leanVersion: "4.12.0",
      now: () => new Date("2026-02-27T00:00:01.000Z"),
    });

    const second = await verifyLeafProof({
      proofId: SEED_PROOF_ID,
      leafId: "Verity.ContractSpec.loop_preserves",
      autoRun: true,
    });

    expect(second.queuedJob.jobId).toBe("job-000002");

    const jobs = await listLeafVerificationJobs(SEED_PROOF_ID, "Verity.ContractSpec.loop_preserves");
    expect(jobs.jobs).toHaveLength(2);
    expect(jobs.jobHashes).toHaveLength(2);
    expect(jobs.jobReplays).toHaveLength(2);
    expect(jobs.jobReplays[0].reproducibilityHash).toHaveLength(64);
  });

  it("reports timeout status when runner signals timeout", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "explain-md-web-verify-"));
    configureVerificationServiceForTests({
      ledgerPath: path.join(tempDir, "verification-ledger.json"),
      runner: timeoutRunner(),
      sourceRevision: "rev-timeout",
      leanVersion: "4.12.0",
      now: () => new Date("2026-02-27T00:00:00.000Z"),
    });

    const result = await verifyLeafProof({
      proofId: SEED_PROOF_ID,
      leafId: "Verity.ContractSpec.exit_safe",
      autoRun: true,
    });

    expect(result.finalJob.status).toBe("timeout");
    expect(result.finalJob.result?.durationMs).toBe(5000);
  });

  it("propagates parent trace ids and deterministic latency metrics across verification queries", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "explain-md-web-verify-"));
    const timestamps = [1000, 1009, 2000, 2007, 3000, 3011];
    configureVerificationServiceForTests({
      ledgerPath: path.join(tempDir, "verification-ledger.json"),
      runner: successRunner(),
      sourceRevision: "rev-trace",
      leanVersion: "4.12.0",
      now: () => new Date("2026-02-27T00:00:00.000Z"),
      nowMs: () => timestamps.shift() ?? 9999,
    });

    const verify = await verifyLeafProof({
      proofId: SEED_PROOF_ID,
      leafId: "Verity.ContractSpec.init_sound",
      autoRun: true,
      parentTraceId: "trace-parent-a",
    });
    const jobs = await listLeafVerificationJobs(SEED_PROOF_ID, "Verity.ContractSpec.init_sound", {
      parentTraceId: "trace-parent-a",
    });
    const jobDetail = await getVerificationJobById(verify.finalJob.jobId, {
      parentTraceId: "trace-parent-a",
    });

    expect(verify.observability.parentTraceId).toBe("trace-parent-a");
    expect(verify.observability.metrics.latencyMs).toBe(9);
    expect(jobs.observability.parentTraceId).toBe("trace-parent-a");
    expect(jobs.observability.metrics.latencyMs).toBe(7);
    expect(jobDetail?.observability.parentTraceId).toBe("trace-parent-a");
    expect(jobDetail?.observability.metrics.latencyMs).toBe(11);
    expect(verify.observability.traceId).toHaveLength(64);
    expect(jobs.requestHash).toHaveLength(64);
    expect(jobDetail?.requestHash).toHaveLength(64);
    expect(jobDetail?.jobReplay.jobHash).toBe(jobDetail?.jobHash);
    expect(jobDetail?.jobReplay.replayCommand).toContain("lake env lean");
  });

  it("exports dashboard-ready verification observability metrics", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "explain-md-web-verify-"));
    const timestamps = [10, 20, 30, 44, 50, 65];
    configureVerificationServiceForTests({
      ledgerPath: path.join(tempDir, "verification-ledger.json"),
      runner: successRunner(),
      sourceRevision: "rev-metrics",
      leanVersion: "4.12.0",
      now: () => new Date("2026-02-27T00:00:00.000Z"),
      nowMs: () => timestamps.shift() ?? 100,
    });

    await verifyLeafProof({
      proofId: SEED_PROOF_ID,
      leafId: "Verity.ContractSpec.init_sound",
      parentTraceId: "trace-parent-a",
    });
    await listLeafVerificationJobs(SEED_PROOF_ID, "Verity.ContractSpec.init_sound");
    await getVerificationJobById("job-000001", {
      parentTraceId: "trace-parent-a",
    });

    const metrics = exportVerificationObservabilityMetrics();
    const deterministicFirst = exportVerificationObservabilityMetrics({
      generatedAt: "2026-02-27T00:00:00.000Z",
    });
    const deterministicSecond = exportVerificationObservabilityMetrics({
      generatedAt: "2026-02-27T00:00:00.000Z",
    });
    expect(metrics.requestCount).toBe(3);
    expect(metrics.failureCount).toBe(0);
    expect(metrics.correlation.parentTraceProvidedCount).toBe(2);
    expect(metrics.queries).toHaveLength(3);
    expect(metrics.queries.find((entry) => entry.query === "verify_leaf")?.meanLatencyMs).toBe(10);
    expect(metrics.snapshotHash).toHaveLength(64);
    expect(deterministicFirst.snapshotHash).toBe(deterministicSecond.snapshotHash);
  });
});

function successRunner(): VerificationCommandRunner {
  return {
    run: async () => ({
      exitCode: 0,
      signal: null,
      durationMs: 120,
      timedOut: false,
      stdout: "checked theorem",
      stderr: "",
    }),
  };
}

function timeoutRunner(): VerificationCommandRunner {
  return {
    run: async () => ({
      exitCode: null,
      signal: "SIGTERM",
      durationMs: 5000,
      timedOut: true,
      stdout: "",
      stderr: "timeout",
    }),
  };
}
