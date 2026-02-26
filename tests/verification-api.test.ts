import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  buildLeanVerificationContract,
  createVerificationTargetFromLeaf,
  type VerificationCommandRunner,
  type VerificationReproducibilityContract,
  type VerificationRunOutput,
} from "../src/verification-flow.js";
import { startVerificationHttpServer } from "../src/verification-api.js";

class FakeRunner implements VerificationCommandRunner {
  private readonly outputs: VerificationRunOutput[];

  public constructor(outputs: VerificationRunOutput[]) {
    this.outputs = outputs;
  }

  public async run(_contract: VerificationReproducibilityContract, _timeoutMs: number): Promise<VerificationRunOutput> {
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

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.map(async (directory) => {
      await rm(directory, { recursive: true, force: true });
    }),
  );
});

describe("verification api", () => {
  test("enqueue/run/list/get endpoints persist and reload deterministic ledger", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "explain-md-verification-api-"));
    tempDirs.push(tempDir);
    const ledgerPath = path.join(tempDir, "ledger.json");

    const reproducibility = buildLeanVerificationContract({
      projectRoot: "/tmp/project",
      sourceRevision: "rev-a",
      filePath: "Verity/Core.lean",
      leanVersion: "4.13.0",
      lakeVersion: "5.0.0",
      env: { LEAN_PATH: "/tmp/project/.lake/packages" },
    });
    const target = createVerificationTargetFromLeaf(BASE_LEAF);

    const firstServer = await startVerificationHttpServer({
      ledgerPath,
      runner: new FakeRunner([
        {
          exitCode: 0,
          signal: null,
          durationMs: 42,
          timedOut: false,
          stdout: "proof ok",
          stderr: "",
        },
      ]),
      idFactory: () => "job-0001",
      now: () => new Date("2026-02-27T00:10:00.000Z"),
      port: 0,
    });

    const createResponse = await fetch(`${firstServer.url}/api/verification/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target, reproducibility }),
    });
    expect(createResponse.status).toBe(201);
    const createdPayload = await createResponse.json();
    expect(createdPayload.ok).toBe(true);
    expect(createdPayload.data.job.status).toBe("queued");
    expect(createdPayload.data.jobHash).toMatch(/^[0-9a-f]{64}$/);

    const listQueuedResponse = await fetch(`${firstServer.url}/api/verification/jobs?leafId=leaf-main`);
    expect(listQueuedResponse.status).toBe(200);
    const listQueuedPayload = await listQueuedResponse.json();
    expect(listQueuedPayload.data.jobs).toHaveLength(1);
    expect(listQueuedPayload.data.jobs[0].status).toBe("queued");

    const runResponse = await fetch(`${firstServer.url}/api/verification/jobs/job-0001/run`, { method: "POST" });
    expect(runResponse.status).toBe(200);
    const runPayload = await runResponse.json();
    expect(runPayload.ok).toBe(true);
    expect(runPayload.data.job.status).toBe("success");
    expect(runPayload.data.job.result.exitCode).toBe(0);
    expect(runPayload.data.job.logs[0].message).toBe("proof ok");

    const getResponse = await fetch(`${firstServer.url}/api/verification/jobs/job-0001`);
    expect(getResponse.status).toBe(200);
    const getPayload = await getResponse.json();
    expect(getPayload.data.job.status).toBe("success");
    expect(getPayload.data.jobHash).toBe(runPayload.data.jobHash);

    await firstServer.close();

    const secondServer = await startVerificationHttpServer({
      ledgerPath,
      runner: new FakeRunner([]),
      port: 0,
    });

    const listReloadedResponse = await fetch(`${secondServer.url}/api/verification/jobs`);
    expect(listReloadedResponse.status).toBe(200);
    const listReloadedPayload = await listReloadedResponse.json();
    expect(listReloadedPayload.data.jobs).toHaveLength(1);
    expect(listReloadedPayload.data.jobs[0].status).toBe("success");
    expect(listReloadedPayload.data.jobHashes).toHaveLength(1);
    expect(listReloadedPayload.data.jobHashes[0].jobId).toBe("job-0001");

    const runNextResponse = await fetch(`${secondServer.url}/api/verification/run-next`, { method: "POST" });
    expect(runNextResponse.status).toBe(200);
    const runNextPayload = await runNextResponse.json();
    expect(runNextPayload.data.job).toBeNull();

    await secondServer.close();

    const persistedLedger = JSON.parse(await readFile(ledgerPath, "utf8"));
    expect(persistedLedger.schemaVersion).toBe("1.0.0");
    expect(persistedLedger.jobs).toHaveLength(1);
    expect(persistedLedger.jobs[0].jobId).toBe("job-0001");
    expect(persistedLedger.jobs[0].status).toBe("success");
  });

  test("returns deterministic API errors for invalid payload and unknown routes", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "explain-md-verification-api-"));
    tempDirs.push(tempDir);
    const server = await startVerificationHttpServer({
      ledgerPath: path.join(tempDir, "ledger.json"),
      runner: new FakeRunner([]),
      port: 0,
    });

    const invalidResponse = await fetch(`${server.url}/api/verification/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(invalidResponse.status).toBe(400);
    const invalidPayload = await invalidResponse.json();
    expect(invalidPayload.ok).toBe(false);
    expect(invalidPayload.error.code).toBe("invalid_request");
    expect(invalidPayload.error.message).toContain("target is required");

    const unknownResponse = await fetch(`${server.url}/api/verification/unknown`);
    expect(unknownResponse.status).toBe(404);
    const unknownPayload = await unknownResponse.json();
    expect(unknownPayload.ok).toBe(false);
    expect(unknownPayload.error.code).toBe("not_found");

    await server.close();
  });
});
