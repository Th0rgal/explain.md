export const SUPPORTED_EXPLANATION_LANGUAGES = ["en", "fr"] as const;
export type SupportedExplanationLanguage = (typeof SUPPORTED_EXPLANATION_LANGUAGES)[number];

export const DEFAULT_EXPLANATION_LANGUAGE: SupportedExplanationLanguage = "en";

export interface LanguageResolution {
  requested: string;
  effective: SupportedExplanationLanguage;
  fallbackApplied: boolean;
  fallbackReason: "supported" | "base_match" | "default";
}

export function resolveExplanationLanguage(input: string | undefined | null): LanguageResolution {
  const requested = normalizeLanguageTag(input);
  const exactMatch = SUPPORTED_EXPLANATION_LANGUAGES.find((language) => language === requested);
  if (exactMatch) {
    return {
      requested,
      effective: exactMatch,
      fallbackApplied: false,
      fallbackReason: "supported",
    };
  }

  const baseTag = requested.split("-")[0];
  const baseMatch = SUPPORTED_EXPLANATION_LANGUAGES.find((language) => language === baseTag);
  if (baseMatch) {
    return {
      requested,
      effective: baseMatch,
      fallbackApplied: true,
      fallbackReason: "base_match",
    };
  }

  return {
    requested,
    effective: DEFAULT_EXPLANATION_LANGUAGE,
    fallbackApplied: true,
    fallbackReason: "default",
  };
}

export function normalizeLanguageTag(input: string | undefined | null): string {
  const raw = (input ?? "").trim().toLowerCase().replace(/_/g, "-");
  return raw.length > 0 ? raw : DEFAULT_EXPLANATION_LANGUAGE;
}
