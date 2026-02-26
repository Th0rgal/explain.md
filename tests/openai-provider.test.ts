import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { AddressInfo } from "node:net";
import { afterEach, describe, expect, test } from "vitest";
import { DEFAULT_CONFIG, normalizeConfig } from "../src/config-contract.js";
import { createOpenAICompatibleProvider, ProviderError } from "../src/openai-provider.js";

interface MockServer {
  url: string;
  close: () => Promise<void>;
}

const ENV_KEY = "TEST_OPENAI_API_KEY";

afterEach(() => {
  delete process.env[ENV_KEY];
});

describe("openai provider", () => {
  test("generates text from non-streaming response", async () => {
    process.env[ENV_KEY] = "token";

    const server = await startMockServer((_req, res) => {
      sendJson(res, 200, {
        model: "test-model",
        choices: [{ finish_reason: "stop", message: { content: "Hello from model" } }],
      });
    });

    try {
      const provider = createOpenAICompatibleProvider({
        config: normalizeConfig({
          modelProvider: {
            ...DEFAULT_CONFIG.modelProvider,
            endpoint: `${server.url}/v1`,
            apiKeyEnvVar: ENV_KEY,
            maxRetries: 0,
          },
        }).modelProvider,
      });

      const result = await provider.generate({
        messages: [{ role: "user", content: "Hi" }],
      });

      expect(result.text).toBe("Hello from model");
      expect(result.finishReason).toBe("stop");
      expect(result.model).toBe("test-model");
    } finally {
      await server.close();
    }
  });

  test("retries transient failures with deterministic backoff", async () => {
    process.env[ENV_KEY] = "token";
    let requestCount = 0;

    const server = await startMockServer((_req, res) => {
      requestCount += 1;
      if (requestCount < 3) {
        sendJson(res, 503, { error: { message: "upstream busy" } });
        return;
      }
      sendJson(res, 200, {
        choices: [{ finish_reason: "stop", message: { content: "Recovered" } }],
      });
    });

    const sleepCalls: number[] = [];

    try {
      const provider = createOpenAICompatibleProvider({
        config: normalizeConfig({
          modelProvider: {
            ...DEFAULT_CONFIG.modelProvider,
            endpoint: `${server.url}/v1`,
            apiKeyEnvVar: ENV_KEY,
            maxRetries: 3,
            retryBaseDelayMs: 100,
          },
        }).modelProvider,
        sleepMs: async (ms) => {
          sleepCalls.push(ms);
        },
      });

      const result = await provider.generate({
        messages: [{ role: "user", content: "Retry please" }],
      });

      expect(result.text).toBe("Recovered");
      expect(requestCount).toBe(3);
      expect(sleepCalls).toEqual([100, 200]);
    } finally {
      await server.close();
    }
  });

  test("does not retry permanent failures", async () => {
    process.env[ENV_KEY] = "token";
    let requestCount = 0;

    const server = await startMockServer((_req, res) => {
      requestCount += 1;
      sendJson(res, 400, { error: { message: "bad request" } });
    });

    try {
      const provider = createOpenAICompatibleProvider({
        config: normalizeConfig({
          modelProvider: {
            ...DEFAULT_CONFIG.modelProvider,
            endpoint: `${server.url}/v1`,
            apiKeyEnvVar: ENV_KEY,
            maxRetries: 5,
          },
        }).modelProvider,
      });

      await expect(provider.generate({ messages: [{ role: "user", content: "bad" }] })).rejects.toMatchObject({
        code: "permanent",
        retriable: false,
        status: 400,
      });
      expect(requestCount).toBe(1);
    } finally {
      await server.close();
    }
  });

  test("parses streaming SSE deltas", async () => {
    process.env[ENV_KEY] = "token";

    const server = await startMockServer(async (_req, res) => {
      res.statusCode = 200;
      res.setHeader("content-type", "text/event-stream");
      res.write('data: {"choices":[{"delta":{"content":"Hello "}}]}\n\n');
      await tick();
      res.write('data: {"choices":[{"delta":{"content":"world"}}]}\n\n');
      res.write("data: [DONE]\n\n");
      res.end();
    });

    try {
      const provider = createOpenAICompatibleProvider({
        config: normalizeConfig({
          modelProvider: {
            ...DEFAULT_CONFIG.modelProvider,
            endpoint: `${server.url}/v1`,
            apiKeyEnvVar: ENV_KEY,
            maxRetries: 0,
          },
        }).modelProvider,
      });

      let text = "";
      for await (const chunk of provider.stream({ messages: [{ role: "user", content: "stream" }] })) {
        text += chunk.textDelta;
      }

      expect(text).toBe("Hello world");
    } finally {
      await server.close();
    }
  });

  test("fails with timeout error after retries exhausted", async () => {
    process.env[ENV_KEY] = "token";
    let requestCount = 0;

    const server = await startMockServer(async (_req, res) => {
      requestCount += 1;
      await delay(50);
      sendJson(res, 200, {
        choices: [{ finish_reason: "stop", message: { content: "late" } }],
      });
    });

    const sleepCalls: number[] = [];

    try {
      const provider = createOpenAICompatibleProvider({
        config: normalizeConfig({
          modelProvider: {
            ...DEFAULT_CONFIG.modelProvider,
            endpoint: `${server.url}/v1`,
            apiKeyEnvVar: ENV_KEY,
            timeoutMs: 5,
            maxRetries: 1,
            retryBaseDelayMs: 20,
          },
        }).modelProvider,
        sleepMs: async (ms) => {
          sleepCalls.push(ms);
        },
      });

      const thrown = await captureError(() => provider.generate({ messages: [{ role: "user", content: "timeout" }] }));
      expect(thrown).toBeInstanceOf(ProviderError);
      expect((thrown as ProviderError).code).toBe("timeout");
      expect((thrown as ProviderError).attempt).toBe(2);
      expect(requestCount).toBeGreaterThanOrEqual(1);
      expect(requestCount).toBeLessThanOrEqual(2);
      expect(sleepCalls).toEqual([20]);
    } finally {
      await server.close();
    }
  });

  test("requires api key env var", async () => {
    const provider = createOpenAICompatibleProvider({
      config: normalizeConfig({
        modelProvider: {
          ...DEFAULT_CONFIG.modelProvider,
          apiKeyEnvVar: ENV_KEY,
          maxRetries: 0,
        },
      }).modelProvider,
    });

    await expect(provider.generate({ messages: [{ role: "user", content: "key" }] })).rejects.toMatchObject({
      code: "configuration",
      retriable: false,
    });
  });
});

async function startMockServer(
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>,
): Promise<MockServer> {
  const server = createServer(async (req, res) => {
    if (req.method !== "POST" || req.url !== "/v1/chat/completions") {
      sendJson(res, 404, { error: { message: "not found" } });
      return;
    }

    await handler(req, res);
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      }),
  };
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(payload));
}

async function captureError(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
    throw new Error("Expected promise to reject.");
  } catch (error) {
    return error;
  }
}

async function tick(): Promise<void> {
  await delay(0);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
