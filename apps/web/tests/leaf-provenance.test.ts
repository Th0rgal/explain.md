import { describe, expect, it } from "vitest";
import {
  buildLeafSourceProvenanceView,
  describeLeafSourceUrlOrigin,
  formatLeafSourceUrlOrigin,
} from "../lib/leaf-provenance";

describe("leaf provenance helpers", () => {
  it("formats leaf-attested origin deterministically", () => {
    expect(formatLeafSourceUrlOrigin("leaf")).toBe("Leaf-attested URL");
    expect(describeLeafSourceUrlOrigin("leaf")).toBe("The leaf record includes an explicit sourceUrl.");
  });

  it("formats source-span-resolved origin deterministically", () => {
    expect(formatLeafSourceUrlOrigin("source_span")).toBe("Resolved from source span");
    expect(describeLeafSourceUrlOrigin("source_span")).toBe(
      "The link was deterministically derived from sourceBaseUrl plus sourceSpan.",
    );
  });

  it("formats missing origin deterministically", () => {
    expect(formatLeafSourceUrlOrigin("missing")).toBe("Missing source URL");
    expect(describeLeafSourceUrlOrigin("missing")).toBe(
      "No sourceUrl is available for this leaf; deep-link verification is unavailable.",
    );
  });

  it("builds provenance view with deep-link availability", () => {
    const withSourceUrl = buildLeafSourceProvenanceView({
      compact: "leaf-ref",
      markdown: "[leaf-ref](https://example.com/source.lean#L10)",
      sourceUrl: "https://example.com/source.lean#L10",
      sourceUrlOrigin: "source_span",
    });
    expect(withSourceUrl.originLabel).toBe("Resolved from source span");
    expect(withSourceUrl.deepLinkAvailable).toBe(true);

    const withoutSourceUrl = buildLeafSourceProvenanceView({
      compact: "leaf-ref",
      markdown: "`leaf-ref`",
      sourceUrlOrigin: "missing",
    });
    expect(withoutSourceUrl.originLabel).toBe("Missing source URL");
    expect(withoutSourceUrl.deepLinkAvailable).toBe(false);
  });
});
