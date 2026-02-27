# Leaf Detail Contract

Issue: #16

## Purpose
`leaf-detail` builds a deterministic, provenance-first view model for a single theorem leaf so UI clients can render:
- exact Lean theorem metadata,
- root-to-leaf provenance path,
- source-link/share references,
- verification history anchored by canonical job hashes.

This module is backend-only and intentionally UI-framework agnostic.

## API

### `buildLeafDetailView(tree, leaves, leafId, options)`
Returns:
- `ok`: `false` only when required data integrity fails (leaf missing/unreachable, missing tree node).
- `diagnostics`: machine-checkable diagnostics with code/severity/details.
- `view`: deterministic leaf-detail payload when available.

`options`:
- `verificationJobs`: optional persisted verification jobs used to bind job history to the target leaf.
- `sourceBaseUrl`: optional deterministic source-link resolver base. When a leaf omits `sourceUrl`, the contract derives
  `sourceUrl = buildSourceUrl(sourceBaseUrl, sourceSpan)`.

### `renderLeafDetailCanonical(view)`
Canonical plain-text rendering with stable ordering for audits.

### `computeLeafDetailHash(view)`
`sha256(renderLeafDetailCanonical(view))`.

## Determinism and provenance guarantees
- Leaf lookup is canonicalized through theorem-leaf normalization.
- Provenance path search is deterministic from `tree.rootId` following stable `childIds` order.
- Verification jobs are filtered by `target.leafId` and sorted by `(queueSequence, jobId)`.
- Every attached verification job includes canonical `jobHash` from verification flow.
- Missing source URL is represented as an explicit warning diagnostic, not silent omission.
- `shareReference.sourceUrlOrigin` is machine-checkable:
  - `leaf`: original leaf already carried a URL.
  - `source_span`: URL resolved deterministically from `sourceBaseUrl` + `sourceSpan`.
  - `missing`: no source URL could be produced.
- Web clients can render this directly as provenance mode without heuristic interpretation:
  - `Leaf-attested URL`
  - `Resolved from source span`
  - `Missing source URL`

## Diagnostics
- `leaf_not_found` (`error`)
- `leaf_not_reachable` (`error`)
- `missing_node` (`error`)
- `missing_source_url` (`warning`)

## Reproducible evaluation command
```bash
npm run eval:leaf-detail -- tests/fixtures/lean-project --include=Verity --leaf=lean:Verity.Core:add_assoc:4:1
```

Output includes `detailOk`, `provenanceDepth`, diagnostics, and `leafDetailHash`.
