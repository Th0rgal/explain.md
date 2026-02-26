# Lean Ingestion and Declaration Indexer

Issue: #3

This module adds a deterministic Lean 4 ingestion layer that indexes declaration-level artifacts and maps them into the existing leaf + dependency graph pipeline.

## Goals covered
- Load Lean project files (`*.lean`) and emit normalized declaration records.
- Preserve provenance with stable IDs, source spans, and source text hashes.
- Produce machine-checkable diagnostics for unsupported constructs.
- Provide deterministic canonical render/hash for audit trails.

## Public API
- `ingestLeanProject(projectRoot, options?)`
- `ingestLeanSources(projectRoot, sources, options?)`
- `mapLeanIngestionToTheoremLeaves(result)`
- `renderLeanIngestionCanonical(result)`
- `computeLeanIngestionHash(result)`

## Output schema
- `schemaVersion: "1.0.0"`
- `records[]` sorted by `declarationId`
- Each record includes:
  - `declarationId` (stable: `lean:<modulePath>:<name>:<line>:<column>`)
  - `modulePath`, `declarationName`, `theoremKind`
  - `statementText`, `prettyStatement`
  - `sourceSpan` and `sourceTextHash`
  - `dependencyIds` (deterministically recovered from indexed symbol references)
  - `tags` (domain classification tags)
  - `domainClassification` (`adapterId`, `confidence`, `evidence`, warnings)

## Diagnostics
Warnings are deterministic and sorted by `(file, line, column, code)`.

Current warning codes:
- `unsupported_construct` (`mutual`, `opaque`, `macro_rules`, `elab`)
- `duplicate_declaration`
- `parse_fallback`
- `domain_classification` (manual override or low-confidence downgrade provenance)

`strictUnsupported=true` upgrades unsupported-construct warnings to an ingestion error.

## Determinism and auditability
- Files are discovered in sorted lexical order.
- Declarations are parsed and sorted deterministically.
- Canonical renderer + SHA-256 hash allow reproducible snapshots.
- Source hashes (`sourceTextHash`) preserve block-level provenance.

## CLI
```bash
npm run ingest:lean -- /path/to/lean-project
```

Optional flags:
- `--source-base-url=<url>`
- `--strict-unsupported`

This emits normalized JSON to stdout for downstream leaf/tree processing.

## Domain-classification options
`ingestLeanProject` / `ingestLeanSources` accepts:
- `domainClassification.lowConfidenceThreshold`
- `domainClassification.fallbackAdapterId`
- `domainClassification.adapters`
- `domainClassification.overridesByDeclarationId`
