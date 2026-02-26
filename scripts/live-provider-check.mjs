import { createOpenAICompatibleProvider } from "../dist/openai-provider.js";
import { DEFAULT_CONFIG, normalizeConfig } from "../dist/config-contract.js";

const baseUrl = process.env.EXPLAIN_MD_LIVE_RPC_BASE_URL ?? "https://agent-backend.thomas.md/v1";
const model = process.env.EXPLAIN_MD_LIVE_RPC_MODEL ?? "builtin/smart";
const apiKey = process.env.EXPLAIN_MD_LIVE_RPC_API_KEY;
const apiKeyEnvVar = "EXPLAIN_MD_LIVE_RPC_API_KEY";

if (!apiKey) {
  console.error(`Missing ${apiKeyEnvVar}. Refusing to run live RPC check without explicit credentials.`);
  process.exit(1);
}

const config = normalizeConfig({
  modelProvider: {
    ...DEFAULT_CONFIG.modelProvider,
    endpoint: baseUrl,
    model,
    apiKeyEnvVar,
    timeoutMs: 60_000,
    maxRetries: 1,
    retryBaseDelayMs: 250,
    temperature: 0,
    maxOutputTokens: 200,
  },
}).modelProvider;

const provider = createOpenAICompatibleProvider({ config });

try {
  const result = await provider.generate({
    messages: [
      { role: "system", content: "You are a deterministic integration test assistant." },
      { role: "user", content: "Reply with one short sentence confirming this endpoint is reachable." },
    ],
  });

  if (!result.text || result.text.trim().length === 0) {
    throw new Error("Live check returned empty text.");
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        endpoint: baseUrl,
        modelRequested: model,
        modelServed: result.model,
        finishReason: result.finishReason,
        text: result.text,
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        endpoint: baseUrl,
        modelRequested: model,
        error: error instanceof Error ? { name: error.name, message: error.message } : String(error),
      },
      null,
      2,
    ),
  );
  process.exit(1);
}
