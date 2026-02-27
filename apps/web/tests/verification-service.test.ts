import os from "node:os";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import type { VerificationCommandRunner } from "../../../dist/verification-flow";
import {
  configureVerificationServiceForTests,
  listLeafVerificationJobs,
  resetVerificationServiceForTests,
  verifyLeafProof,
} from "../lib/verification-service";
import { SEED_PROOF_ID } from "../lib/proof-service";

describe("verification service", () => {
  afterEach(() => {
    resetVerificationServiceForTests();
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
