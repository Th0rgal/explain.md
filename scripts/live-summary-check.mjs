import { DEFAULT_CONFIG, normalizeConfig } from "../dist/config-contract.js";
import { createOpenAICompatibleProvider } from "../dist/openai-provider.js";
import { generateParentSummary } from "../dist/summary-pipeline.js";

const baseUrl = process.env.EXPLAIN_MD_LIVE_RPC_BASE_URL ?? "https://agent-backend.thomas.md/v1";
const model = process.env.EXPLAIN_MD_LIVE_RPC_MODEL ?? "builtin/smart";
const apiKey = process.env.EXPLAIN_MD_LIVE_RPC_API_KEY;
const apiKeyEnvVar = "EXPLAIN_MD_LIVE_RPC_API_KEY";

if (!apiKey) {
  console.error(`Missing ${apiKeyEnvVar}. Refusing to run live summary check without explicit credentials.`);
  process.exit(1);
}

const config = normalizeConfig({
  language: "en",
  complexityLevel: 3,
  complexityBandWidth: 1,
  termIntroductionBudget: 3,
  modelProvider: {
    ...DEFAULT_CONFIG.modelProvider,
    endpoint: baseUrl,
    model,
    apiKeyEnvVar,
    timeoutMs: 60_000,
    maxRetries: 1,
    retryBaseDelayMs: 250,
    temperature: 0,
    maxOutputTokens: 1400,
  },
});

const provider = createOpenAICompatibleProvider({ config: config.modelProvider });

try {
  const result = await generateParentSummary(provider, {
    config,
    children: [
      { id: "c1", statement: "Initialization establishes storage bounds for all tracked accounts." },
      { id: "c2", statement: "Each update step preserves storage bounds and keeps account totals consistent." },
      { id: "c3", statement: "Composed execution of bounded updates preserves the system invariant." },
    ],
  });

  console.log(
    JSON.stringify(
      {
        ok: result.diagnostics.ok,
        endpoint: baseUrl,
        modelRequested: model,
        evidenceRefs: result.summary.evidence_refs,
        complexity: result.summary.complexity_score,
        abstraction: result.summary.abstraction_score,
        confidence: result.summary.confidence,
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
