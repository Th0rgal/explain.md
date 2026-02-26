# Leaf theorem schema and provenance model (Issue #5)

## Purpose
This contract defines deterministic, versioned leaf records for Lean declarations so downstream grouping, summarization, tree building, and UI verification can consume a single provenance-first representation.

## Schema version
- Current version: `1.0.0`
- Constant: `THEOREM_LEAF_SCHEMA_VERSION`

## `TheoremLeafRecord` fields
- `schemaVersion`: schema version string.
- `id`: stable leaf ID used across the explanation pipeline.
- `declarationId`: declaration identifier (equals `id` in v1 mapping).
- `modulePath`: Lean module path (`Verity/State`, etc.).
- `declarationName`: declaration name.
- `theoremKind`: one of `theorem|lemma|definition|axiom|inductive|structure|instance|example|unknown`.
- `statementText`: source statement text.
- `prettyStatement`: canonical display form (falls back to `statementText`).
- `sourceSpan`:
  - `filePath`
  - `startLine`, `startColumn`, `endLine`, `endColumn`
- `tags`: canonical sorted unique tags.
- `dependencyIds`: canonical sorted unique dependency refs.
- `sourceUrl` (optional): browser-verifiable URL to exact source span.

## Deterministic mapping rules
`mapIngestedDeclarationToLeaf`:
- trims and validates required fields.
- canonicalizes arrays (`tags`, `dependencyIds`) to sorted unique values.
- normalizes unknown theorem kinds to `unknown`.
- computes `declarationId` when missing using SHA-256 over:
  - module path
  - declaration name
  - theorem kind
  - normalized source span
- if `sourceBaseUrl` is configured, derives:
  - `{base}/{url-encoded filePath}#L{startLine}C{startColumn}-L{endLine}C{endColumn}`

`mapIngestedDeclarationsToLeaves`:
- maps all records via the same rules.
- returns leaves sorted by `id` for deterministic ordering.

`mapTheoremLeavesToTreeLeaves`:
- maps leaf statement to `prettyStatement`.
- maps `dependencyIds` to tree `prerequisiteIds`.
- sorts by `id`.

## Canonical rendering
`renderTheoremLeafCanonical` returns a deterministic, line-oriented form for auditing and snapshots:
- schema, id, module, declaration, kind
- span
- statement and pretty statement (JSON-escaped)
- dependency list, tags list
- source URL or `none`

## Validation
`validateTheoremLeafRecord` enforces:
- required identifiers and text fields.
- allowed theorem kind set.
- arrays contain non-empty strings.
- source span integers are positive.
- `endLine >= startLine`.
- if same line, `endColumn >= startColumn`.

## Migration plan (backward compatibility)
`migrateTheoremLeafRecord` supports pre-v1 records (`schemaVersion` missing or `0.x`) by mapping legacy aliases:
- `module -> modulePath`
- `name -> declarationName`
- `kind -> theoremKind`
- `statement -> statementText`
- `pretty -> prettyStatement`
- `deps -> dependencyIds`
- flat source coordinates (`filePath`, `startLine`, ...) or nested `sourceSpan` -> v1 `sourceSpan`

After mapping, migrated records are canonicalized and validated against v1.
