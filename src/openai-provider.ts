import type { ModelProviderConfig } from "./config-contract.js";

export type ProviderErrorCode =
  | "configuration"
  | "authentication"
  | "rate_limit"
  | "timeout"
  | "transient"
  | "permanent"
  | "invalid_response";

export class ProviderError extends Error {
  public readonly code: ProviderErrorCode;
  public readonly status?: number;
  public readonly attempt: number;
  public readonly retriable: boolean;

  public constructor(params: {
    code: ProviderErrorCode;
    message: string;
    status?: number;
    attempt: number;
    retriable: boolean;
  }) {
    super(params.message);
    this.name = "ProviderError";
    this.code = params.code;
    this.status = params.status;
    this.attempt = params.attempt;
    this.retriable = params.retriable;
  }
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface GenerateRequest {
  messages: ChatMessage[];
  temperature?: number;
  maxOutputTokens?: number;
}

export interface GenerateResult {
  text: string;
  model: string;
  finishReason: string | null;
  raw: unknown;
}

export interface StreamChunk {
  textDelta: string;
  raw: unknown;
}

export interface ProviderClient {
  generate(request: GenerateRequest): Promise<GenerateResult>;
  stream(request: GenerateRequest): AsyncIterable<StreamChunk>;
}

export interface OpenAIProviderOptions {
  config: ModelProviderConfig;
  fetchImpl?: typeof fetch;
  sleepMs?: (ms: number) => Promise<void>;
}

interface OpenAIErrorBody {
  error?: {
    message?: string;
    type?: string;
    code?: string;
  };
}

interface ChatCompletionChoice {
  finish_reason: string | null;
  message?: {
    content?: string;
  };
  delta?: {
    content?: string;
  };
}

interface ChatCompletionResponse {
  model?: string;
  choices?: ChatCompletionChoice[];
}

const RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

export function createOpenAICompatibleProvider(options: OpenAIProviderOptions): ProviderClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleepMs = options.sleepMs ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const baseUrl = normalizeBaseUrl(options.config.endpoint);

  return {
    generate: async (request) => {
      const response = await executeWithRetry(options.config, sleepMs, async (attempt) => {
        return postChatCompletions({
          fetchImpl,
          config: options.config,
          request,
          stream: false,
          attempt,
          baseUrl,
        });
      });

      const text = response.choices?.[0]?.message?.content;
      if (typeof text !== "string") {
        throw new ProviderError({
          code: "invalid_response",
          message: "Response did not include choices[0].message.content.",
          attempt: 1,
          retriable: false,
        });
      }

      return {
        text,
        model: response.model ?? options.config.model,
        finishReason: response.choices?.[0]?.finish_reason ?? null,
        raw: response,
      };
    },

    stream: async function* (request: GenerateRequest): AsyncIterable<StreamChunk> {
      const res = await executeWithRetry(options.config, sleepMs, async (attempt) => {
        return postRawChatCompletions({
          fetchImpl,
          config: options.config,
          request,
          stream: true,
          attempt,
          baseUrl,
        });
      });

      const body = res.body;
      if (!body) {
        throw new ProviderError({
          code: "invalid_response",
          message: "Streaming response did not include a body.",
          attempt: 1,
          retriable: false,
        });
      }

      const decoder = new TextDecoder();
      let buffer = "";

      for await (const chunk of body) {
        buffer += decoder.decode(chunk, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";

        for (const event of events) {
          const line = event
            .split("\n")
            .map((candidate) => candidate.trim())
            .find((candidate) => candidate.startsWith("data:"));

          if (!line) {
            continue;
          }

          const payload = line.slice(5).trim();
          if (payload === "[DONE]") {
            return;
          }

          let parsed: ChatCompletionResponse;
          try {
            parsed = JSON.parse(payload) as ChatCompletionResponse;
          } catch {
            throw new ProviderError({
              code: "invalid_response",
              message: "Failed to parse streaming SSE payload as JSON.",
              attempt: 1,
              retriable: false,
            });
          }

          const textDelta = parsed.choices?.[0]?.delta?.content;
          if (typeof textDelta === "string" && textDelta.length > 0) {
            yield {
              textDelta,
              raw: parsed,
            };
          }
        }
      }

      if (buffer.trim().length > 0) {
        throw new ProviderError({
          code: "invalid_response",
          message: "Streaming response terminated with partial SSE frame.",
          attempt: 1,
          retriable: false,
        });
      }
    },
  };
}

async function executeWithRetry<T>(
  config: ModelProviderConfig,
  sleepMs: (ms: number) => Promise<void>,
  operation: (attempt: number) => Promise<T>,
): Promise<T> {
  let attempt = 0;
  let lastError: unknown = undefined;

  while (attempt <= config.maxRetries) {
    attempt += 1;
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      if (!(error instanceof ProviderError)) {
        throw error;
      }

      const canRetry = error.retriable && attempt <= config.maxRetries;
      if (!canRetry) {
        throw error;
      }

      const delayMs = computeRetryDelayMs(config.retryBaseDelayMs, attempt);
      await sleepMs(delayMs);
    }
  }

  if (lastError instanceof Error) {
    throw lastError;
  }

  throw new ProviderError({
    code: "transient",
    message: "Request failed after retries.",
    attempt,
    retriable: false,
  });
}

function computeRetryDelayMs(baseDelayMs: number, attempt: number): number {
  const exponent = Math.max(0, attempt - 1);
  return Math.min(baseDelayMs * Math.pow(2, exponent), 10_000);
}

function normalizeBaseUrl(endpoint: string): string {
  return endpoint.endsWith("/") ? endpoint.slice(0, -1) : endpoint;
}

async function postChatCompletions(params: {
  fetchImpl: typeof fetch;
  config: ModelProviderConfig;
  request: GenerateRequest;
  stream: false;
  attempt: number;
  baseUrl: string;
}): Promise<ChatCompletionResponse> {
  const res = await postRawChatCompletions(params);

  let parsed: ChatCompletionResponse;
  try {
    parsed = (await res.json()) as ChatCompletionResponse;
  } catch {
    throw new ProviderError({
      code: "invalid_response",
      message: "Response body was not valid JSON.",
      status: res.status,
      attempt: params.attempt,
      retriable: false,
    });
  }

  return parsed;
}

async function postRawChatCompletions(params: {
  fetchImpl: typeof fetch;
  config: ModelProviderConfig;
  request: GenerateRequest;
  stream: boolean;
  attempt: number;
  baseUrl: string;
}): Promise<Response> {
  const apiKey = resolveApiKey(params.config.apiKeyEnvVar);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), params.config.timeoutMs);

  let res: Response;
  try {
    res = await params.fetchImpl(`${params.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: params.config.model,
        messages: params.request.messages,
        temperature: params.request.temperature ?? params.config.temperature,
        max_tokens: params.request.maxOutputTokens ?? params.config.maxOutputTokens,
        stream: params.stream,
      }),
      signal: controller.signal,
    });
  } catch (error: unknown) {
    clearTimeout(timeout);
    if (error instanceof Error && error.name === "AbortError") {
      throw new ProviderError({
        code: "timeout",
        message: `Provider request timed out after ${params.config.timeoutMs}ms.`,
        attempt: params.attempt,
        retriable: true,
      });
    }

    throw new ProviderError({
      code: "transient",
      message: error instanceof Error ? error.message : "Network request failed.",
      attempt: params.attempt,
      retriable: true,
    });
  }

  clearTimeout(timeout);

  if (!res.ok) {
    throw await toProviderError(res, params.attempt);
  }

  return res;
}

async function toProviderError(res: Response, attempt: number): Promise<ProviderError> {
  const body = await safeJson(res);
  const bodyMessage = body.error?.message?.trim();
  const message = bodyMessage && bodyMessage.length > 0 ? bodyMessage : `Provider request failed with status ${res.status}.`;

  if (res.status === 401 || res.status === 403) {
    return new ProviderError({
      code: "authentication",
      message,
      status: res.status,
      attempt,
      retriable: false,
    });
  }

  if (res.status === 429) {
    return new ProviderError({
      code: "rate_limit",
      message,
      status: res.status,
      attempt,
      retriable: true,
    });
  }

  if (RETRYABLE_STATUS.has(res.status)) {
    return new ProviderError({
      code: "transient",
      message,
      status: res.status,
      attempt,
      retriable: true,
    });
  }

  return new ProviderError({
    code: "permanent",
    message,
    status: res.status,
    attempt,
    retriable: false,
  });
}

async function safeJson(res: Response): Promise<OpenAIErrorBody> {
  try {
    return (await res.json()) as OpenAIErrorBody;
  } catch {
    return {};
  }
}

function resolveApiKey(apiKeyEnvVar: string | undefined): string {
  const envName = apiKeyEnvVar?.trim();
  if (!envName) {
    throw new ProviderError({
      code: "configuration",
      message: "Model provider apiKeyEnvVar must be configured.",
      attempt: 1,
      retriable: false,
    });
  }

  const value = process.env[envName];
  if (!value || value.trim().length === 0) {
    throw new ProviderError({
      code: "configuration",
      message: `Environment variable '${envName}' is not set.`,
      attempt: 1,
      retriable: false,
    });
  }

  return value;
}
