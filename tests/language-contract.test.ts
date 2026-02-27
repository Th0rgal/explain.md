import { describe, expect, it } from "vitest";
import { resolveExplanationLanguage } from "../src/language-contract.js";

describe("language contract", () => {
  it("keeps supported language tags unchanged", () => {
    const resolved = resolveExplanationLanguage("fr");
    expect(resolved.effective).toBe("fr");
    expect(resolved.fallbackApplied).toBe(false);
    expect(resolved.fallbackReason).toBe("supported");
  });

  it("falls back by base tag for locale variants", () => {
    const resolved = resolveExplanationLanguage("fr-CA");
    expect(resolved.requested).toBe("fr-ca");
    expect(resolved.effective).toBe("fr");
    expect(resolved.fallbackApplied).toBe(true);
    expect(resolved.fallbackReason).toBe("base_match");
  });

  it("falls back to default language for unsupported tags", () => {
    const resolved = resolveExplanationLanguage("de");
    expect(resolved.effective).toBe("en");
    expect(resolved.fallbackApplied).toBe(true);
    expect(resolved.fallbackReason).toBe("default");
  });
});
