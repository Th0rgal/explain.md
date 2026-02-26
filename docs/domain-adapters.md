# Domain Classification Adapters

Issue: #6

This module defines deterministic domain adapters for classifying Lean declarations, with a first-class Verity EDSL specialization.

## Public API
- `classifyDeclarationDomain(input, options?)`
- `getDefaultDomainAdapters()`
- `evaluateDomainTagging(samples)`
- `renderDomainTaggingReport(report)`
- `computeDomainTaggingReportHash(report)`

## Adapter Contract
Each adapter exposes:
- `adapterId: string`
- `classify(input) -> { tags, confidence, evidence }`

Default built-ins:
- `verity-edsl`
- `lean-generic` (fallback)

Selection is deterministic:
1. Highest confidence wins.
2. Tie-break by adapter order.
3. Final tie-break by `adapterId` lexical order.

## Verity Coverage
The Verity adapter emits ontology tags for:
- loops (`concept:loop`)
- arithmetic (`concept:arithmetic`)
- conditionals (`concept:conditional`)
- memory semantics (`concept:memory`)
- state semantics (`concept:state`)
- compiler-correctness segments (`concept:compiler_correctness`)

It also emits `domain:verity/edsl` when module/name signals indicate Verity.

## Fallback + Overrides
- Low-confidence downgrade path: if selected adapter confidence is below `lowConfidenceThreshold`, classification downgrades to fallback adapter (`lean-generic` by default).
- Manual override mechanism per declaration:
  - `forceAdapterId`
  - `addTags`
  - `removeTags`
  - `minConfidence`

Warnings are machine-checkable (`low_confidence_downgrade`, `forced_adapter_missing`, `manual_override_applied`).

## Ingestion Integration
`ingestLeanSources` now applies domain classification to each indexed declaration and persists:
- `tags` (used downstream by leaf generation)
- `domainClassification.adapterId`
- `domainClassification.confidence`
- `domainClassification.evidence`

So domain tags are part of provenance-bearing leaf records.

## Evaluation Harness
Use sampled precision/recall/F1 report:

```bash
npm run eval:domain-adapters
```

Report format is canonical and hashable for reproducible evaluation snapshots.
