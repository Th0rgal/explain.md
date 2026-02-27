# Tree storage and query APIs

Issue: #13

## Scope
Defines a deterministic, versioned storage snapshot for explanation trees and proof leaves, with query APIs designed for root-first UI expansion and provenance inspection.

## Snapshot schema (`tree-storage`)
`TREE_STORAGE_SCHEMA_VERSION = "1.0.0"`

Top-level fields:
- `schemaVersion`
- `proofId`
- `rootId`
- `leafIds`
- `maxDepth`
- `configSnapshot` (`configHash`, optional full `config` snapshot)
- `nodes[]`
- `edges[]`
- `provenance[]`
- `leafRecords[]`

### Node record
Each node stores:
- identity and kind (`leaf`/`parent`)
- statement text
- ordered `childIds`
- `evidenceRefs`
- optional summary metadata (`complexityScore`, `abstractionScore`, `confidence`, `whyTrueFromChildren`, `newTermsIntroduced`)
- optional `policyDiagnostics` (pre/post pedagogy decisions + metrics) for parent-node auditability

### Edge record
Each directed edge stores:
- `parentId`
- `childId`
- stable sibling `order`

### Provenance record
Each record links a node to a concrete Lean declaration leaf:
- `nodeId`, `leafId`
- `declarationId`, `modulePath`, `declarationName`, `theoremKind`
- `sourceSpan`, optional `sourceUrl`

This allows browser/API consumers to inspect parent support and trace each rendered claim to theorem-level declarations.

## Determinism and auditing
- Export canonicalizes nodes/edges/provenance/leaves deterministically.
- Canonical rendering (`renderTreeStorageSnapshotCanonical`) is stable across insertion order.
- Snapshot hash (`computeTreeStorageSnapshotHash`) is SHA-256 over canonical rendering.
- Validation (`validateTreeStorageSnapshot`) enforces:
  - schema version compatibility
  - root/node/edge referential integrity
  - duplicate-edge rejection
  - optional config hash consistency when config snapshot is present

## Query API
`createTreeQueryApi(snapshot)` exposes deterministic read operations:
- `getRoot()`
- `getChildren(nodeId, { offset, limit })`
- `getAncestryPath(nodeId)`
- `getLeafDetail(leafId)`

All query methods return machine-readable diagnostics and stable ordering.

`getLeafDetail(leafId)` behavior is strict:
- no duplicate `leaf_not_reachable` diagnostics
- no false `leaf_not_reachable` when a leaf is reachable but unrelated snapshot-level diagnostics are present

## Import/export portability
- `exportTreeStorageSnapshot(tree, { proofId, leaves, config? })`
- `importTreeStorageSnapshot(snapshot)` reconstructs `ExplanationTree` + canonical theorem leaves when validation passes.

Import never guesses missing structure: if snapshot validation fails, `tree` is omitted and diagnostics explain the exact breakage.
