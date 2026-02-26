import { describe, expect, test } from "vitest";
import {
  DEFAULT_CONFIG,
  buildProfileStorageKey,
  computeConfigHash,
  computeTreeCacheKey,
  normalizeConfig,
  planRegeneration,
  stableSerializeConfig,
  validateConfig,
} from "../src/config-contract.js";

describe("config contract", () => {
  test("normalization is deterministic for equivalent input", () => {
    const a = normalizeConfig({
      language: "EN",
      modelProvider: { provider: " OpenAI-Compatible ", endpoint: " http://localhost:8080/v1 ", model: " gpt-4.1-mini " },
    });

    const b = normalizeConfig({
      modelProvider: { model: "gpt-4.1-mini", endpoint: "http://localhost:8080/v1", provider: "openai-compatible" },
      language: "en",
    });

    expect(stableSerializeConfig(a)).toBe(stableSerializeConfig(b));
    expect(computeConfigHash(a)).toBe(computeConfigHash(b));
  });

  test("cache key includes leaf hash + config hash + language + audience", () => {
    const config = normalizeConfig({});
    const key = computeTreeCacheKey("leafhash123", config);
    expect(key).toMatch(/^leafhash123:[a-f0-9]{64}:en:intermediate$/);
  });

  test("invalid config returns clear errors", () => {
    const config = normalizeConfig({
      maxChildrenPerParent: 1,
      language: "english",
      modelProvider: { temperature: 2 },
      audienceLevel: "expert",
      readingLevelTarget: "elementary",
    });

    const result = validateConfig(config);
    expect(result.ok).toBe(false);
    expect(result.errors.map((e) => e.path)).toContain("maxChildrenPerParent");
    expect(result.errors.map((e) => e.path)).toContain("language");
    expect(result.errors.map((e) => e.path)).toContain("modelProvider.temperature");
    expect(result.errors.map((e) => e.path)).toContain("readingLevelTarget");
  });

  test("full regeneration when structure/semantics fields change", () => {
    const prev = normalizeConfig({});
    const next = normalizeConfig({ maxChildrenPerParent: prev.maxChildrenPerParent + 1 });

    const plan = planRegeneration(prev, next);
    expect(plan.scope).toBe("full");
    expect(plan.changedFields).toContain("maxChildrenPerParent");
  });

  test("partial regeneration when only token budget changes", () => {
    const prev = normalizeConfig({});
    const next = normalizeConfig({ modelProvider: { maxOutputTokens: prev.modelProvider.maxOutputTokens + 200 } });

    const plan = planRegeneration(prev, next);
    expect(plan.scope).toBe("partial");
    expect(plan.changedFields).toContain("modelProvider.maxOutputTokens");
  });

  test("no regeneration when configs are identical", () => {
    const prev = normalizeConfig(DEFAULT_CONFIG);
    const next = normalizeConfig(DEFAULT_CONFIG);

    const plan = planRegeneration(prev, next);
    expect(plan.scope).toBe("none");
    expect(plan.changedFields).toEqual([]);
  });

  test("profile storage key is normalized and deterministic", () => {
    const key = buildProfileStorageKey(" Verity/Case ", "Alice@example.com", "Default Profile");
    expect(key).toBe("project:verity_case:user:alice_example_com:profile:default_profile");
  });
});
