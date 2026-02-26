import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  VerificationWorkflow,
  buildLeanVerificationContract,
  canonicalizeVerificationLedger,
  computeVerificationJobHash,
  createVerificationTargetFromLeaf,
  readVerificationLedger,
  renderVerificationJobCanonical,
  writeVerificationLedger,
  type VerificationCommandRunner,
  type VerificationReproducibilityContract,
  type VerificationRunOutput,
} from "../src/verification-flow.js";

class FakeRunner implements VerificationCommandRunner {
  public readonly calls: Array<{ contract: VerificationReproducibilityContract; timeoutMs: number }> = [];

  private readonly outputs: VerificationRunOutput[];

  public constructor(outputs: VerificationRunOutput[]) {
    this.outputs = outputs;
  }

  public async run(contract: VerificationReproducibilityContract, timeoutMs: number): Promise<VerificationRunOutput> {
    this.calls.push({ contract, timeoutMs });
    if (this.outputs.length === 0) {
      throw new Error("No fake outputs left.");
    }
    return this.outputs.shift() as VerificationRunOutput;
  }
}

const BASE_LEAF = {
  schemaVersion: "1.0.0",
  id: "leaf-main",
  declarationId: "decl-main",
  modulePath: "Verity/Core",
  declarationName: "main",
  theoremKind: "theorem" as const,
  statementText: "Main theorem",
  prettyStatement: "Main theorem",
  sourceSpan: {
    filePath: "Verity/Core.lean",
    startLine: 10,
    startColumn: 1,
    endLine: 18,
    endColumn: 8,
  },
  tags: ["verity:state"],
  dependencyIds: ["decl-helper"],
  sourceUrl: "https://example.com/Verity/Core.lean#L10C1-L18C8",
};

let tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.map(async (dir) => {
      await rm(dir, { recursive: true, force: true });
    }),
  );
  tempDirs = [];
});

describe("verification workflow", () => {
  test("queues and runs jobs deterministically with reproducibility metadata", async () => {
    const runner = new FakeRunner([
      {
        exitCode: 0,
        signal: null,
        durationMs: 153,
        timedOut: false,
        stdout: "ok line 1\nok line 2",
        stderr: "",
      },
    ]);

    const stamps = [
      "2026-02-26T22:00:00.000Z",
      "2026-02-26T22:00:01.000Z",
      "2026-02-26T22:00:02.000Z",
    ];

    const workflow = new VerificationWorkflow({
      runner,
      defaultTimeoutMs: 30_000,
      idFactory: () => "job-0001",
      now: () => new Date(stamps.shift() as string),
    });

    const target = createVerificationTargetFromLeaf(BASE_LEAF);
    const reproducibility = buildLeanVerificationContract({
      projectRoot: "/tmp/project",
      sourceRevision: "abc123",
      filePath: "Verity/Core.lean",
      leanVersion: "4.13.0",
      lakeVersion: "5.0.0",
      env: { LEAN_PATH: "/tmp/project/.lake/packages" },
    });

    const queued = workflow.enqueue({
      target,
      reproducibility,
      options: { timeoutMs: 45_000 },
    });

    expect(queued.status).toBe("queued");
    expect(queued.queueSequence).toBe(0);
    expect(queued.reproducibility.env).toEqual({ LEAN_PATH: "/tmp/project/.lake/packages" });

    const completed = await workflow.runNextQueuedJob();
    expect(completed?.status).toBe("success");
    expect(completed?.result?.exitCode).toBe(0);
    expect(completed?.result?.durationMs).toBe(153);
    expect(completed?.logs.map((line) => line.message)).toEqual(["ok line 1", "ok line 2"]);

    expect(runner.calls).toHaveLength(1);
    expect(runner.calls[0].timeoutMs).toBe(45_000);
    expect(runner.calls[0].contract.command).toBe("lake");
    expect(runner.calls[0].contract.args).toEqual(["env", "lean", "Verity/Core.lean"]);

    const noWork = await workflow.runNextQueuedJob();
    expect(noWork).toBeNull();

    const canonical = renderVerificationJobCanonical(completed as NonNullable<typeof completed>);
    expect(canonical).toContain("status=success");
    expect(canonical).toContain("source_revision=abc123");
  });

  test("marks non-zero exit status as failure and timeout flag as timeout", async () => {
    const runner = new FakeRunner([
      {
        exitCode: 1,
        signal: null,
        durationMs: 20,
        timedOut: false,
        stdout: "",
        stderr: "type mismatch",
      },
      {
        exitCode: null,
        signal: "SIGTERM",
        durationMs: 5_000,
        timedOut: true,
        stdout: "",
        stderr: "killed by timeout",
      },
    ]);

    let counter = 0;
    const workflow = new VerificationWorkflow({
      runner,
      idFactory: () => `job-${String(counter += 1).padStart(4, "0")}`,
      now: () => new Date("2026-02-26T22:30:00.000Z"),
    });

    const target = createVerificationTargetFromLeaf(BASE_LEAF);
    const reproducibility = buildLeanVerificationContract({
      projectRoot: "/tmp/project",
      sourceRevision: "rev",
      filePath: "Verity/Core.lean",
      leanVersion: "4.13.0",
    });

    workflow.enqueue({ target, reproducibility });
    const secondLeaf = {
      ...BASE_LEAF,
      id: "leaf-2",
      declarationId: "decl-2",
      declarationName: "aux",
    };
    workflow.enqueue({ target: createVerificationTargetFromLeaf(secondLeaf), reproducibility });

    const first = await workflow.runNextQueuedJob();
    const second = await workflow.runNextQueuedJob();

    expect(first?.status).toBe("failure");
    expect(first?.result?.exitCode).toBe(1);
    expect(first?.logs[0]?.message).toBe("type mismatch");

    expect(second?.status).toBe("timeout");
    expect(second?.result?.signal).toBe("SIGTERM");
    expect(second?.result?.durationMs).toBe(5000);
  });

  test("caps logs and appends deterministic truncation line", async () => {
    const runner = new FakeRunner([
      {
        exitCode: 0,
        signal: null,
        durationMs: 9,
        timedOut: false,
        stdout: "a\nb\nc\nd\ne",
        stderr: "",
      },
    ]);

    const workflow = new VerificationWorkflow({
      runner,
      idFactory: () => "job-truncate",
      now: () => new Date("2026-02-26T23:00:00.000Z"),
      maxLogLinesPerJob: 3,
    });

    workflow.enqueue({
      target: createVerificationTargetFromLeaf(BASE_LEAF),
      reproducibility: buildLeanVerificationContract({
        projectRoot: "/tmp/project",
        sourceRevision: "rev",
        filePath: "Verity/Core.lean",
        leanVersion: "4.13.0",
      }),
    });

    const result = await workflow.runNextQueuedJob();
    expect(result?.status).toBe("success");
    expect(result?.logs).toHaveLength(3);
    expect(result?.logs[2]).toEqual({
      index: 2,
      stream: "system",
      message: "Truncated 3 log lines.",
    });
    expect(result?.result?.logsTruncated).toBe(true);
    expect(result?.result?.logLineCount).toBe(5);
  });

  test("can persist and reload canonical ledger with stable hashes", async () => {
    const runner = new FakeRunner([
      {
        exitCode: 0,
        signal: null,
        durationMs: 12,
        timedOut: false,
        stdout: "ok",
        stderr: "",
      },
    ]);

    const workflow = new VerificationWorkflow({
      runner,
      idFactory: () => "job-save",
      now: () => new Date("2026-02-26T23:30:00.000Z"),
    });

    workflow.enqueue({
      target: createVerificationTargetFromLeaf(BASE_LEAF),
      reproducibility: buildLeanVerificationContract({
        projectRoot: "/tmp/project",
        sourceRevision: "sha-1",
        filePath: "Verity/Core.lean",
        leanVersion: "4.13.0",
      }),
    });

    const completed = await workflow.runNextQueuedJob();
    const beforeHash = computeVerificationJobHash(completed as NonNullable<typeof completed>);

    const tempDir = await mkdtemp(path.join(os.tmpdir(), "explain-md-verification-"));
    tempDirs.push(tempDir);
    const ledgerPath = path.join(tempDir, "verification-ledger.json");

    await writeVerificationLedger(ledgerPath, workflow.toLedger());
    const loaded = await readVerificationLedger(ledgerPath);
    const canonical = canonicalizeVerificationLedger(loaded);

    expect(canonical.jobs).toHaveLength(1);
    const afterHash = computeVerificationJobHash(canonical.jobs[0]);
    expect(afterHash).toBe(beforeHash);
  });

  test("builds per-leaf queries in queue order", async () => {
    const runner = new FakeRunner([]);
    let jobCounter = 0;
    const workflow = new VerificationWorkflow({
      runner,
      idFactory: () => `job-${String(jobCounter += 1).padStart(4, "0")}`,
      now: () => new Date("2026-02-26T23:59:00.000Z"),
    });

    const reproducibility = buildLeanVerificationContract({
      projectRoot: "/tmp/project",
      sourceRevision: "sha",
      filePath: "Verity/Core.lean",
      leanVersion: "4.13.0",
    });

    const leafA = { ...BASE_LEAF, id: "leaf-a", declarationId: "decl-a" };
    const leafB = { ...BASE_LEAF, id: "leaf-b", declarationId: "decl-b" };

    workflow.enqueue({ target: createVerificationTargetFromLeaf(leafA), reproducibility });
    workflow.enqueue({ target: createVerificationTargetFromLeaf(leafB), reproducibility });
    workflow.enqueue({ target: createVerificationTargetFromLeaf(leafA), reproducibility });

    const jobsForLeafA = workflow.listJobsForLeaf("leaf-a");
    expect(jobsForLeafA).toHaveLength(2);
    expect(jobsForLeafA.map((job) => job.queueSequence)).toEqual([0, 2]);
  });
});
