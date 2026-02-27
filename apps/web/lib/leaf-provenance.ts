import type { LeafDetailResponse } from "./api-client";

type LeafShareReference = NonNullable<LeafDetailResponse["view"]>["shareReference"];
export type LeafSourceUrlOrigin = LeafShareReference["sourceUrlOrigin"];

export interface LeafSourceProvenanceView {
  origin: LeafSourceUrlOrigin;
  originLabel: string;
  originDescription: string;
  sourceUrl?: string;
  deepLinkAvailable: boolean;
}

export function buildLeafSourceProvenanceView(shareReference: LeafShareReference): LeafSourceProvenanceView {
  return {
    origin: shareReference.sourceUrlOrigin,
    originLabel: formatLeafSourceUrlOrigin(shareReference.sourceUrlOrigin),
    originDescription: describeLeafSourceUrlOrigin(shareReference.sourceUrlOrigin),
    sourceUrl: shareReference.sourceUrl,
    deepLinkAvailable: Boolean(shareReference.sourceUrl),
  };
}

export function formatLeafSourceUrlOrigin(origin: LeafSourceUrlOrigin): string {
  switch (origin) {
    case "leaf":
      return "Leaf-attested URL";
    case "source_span":
      return "Resolved from source span";
    case "missing":
      return "Missing source URL";
  }
}

export function describeLeafSourceUrlOrigin(origin: LeafSourceUrlOrigin): string {
  switch (origin) {
    case "leaf":
      return "The leaf record includes an explicit sourceUrl.";
    case "source_span":
      return "The link was deterministically derived from sourceBaseUrl plus sourceSpan.";
    case "missing":
      return "No sourceUrl is available for this leaf; deep-link verification is unavailable.";
  }
}
