# Proof cache report API

Deterministic cache-reuse diagnostics for proof dataset generation.

## Endpoint
- `GET /api/proofs/cache-report`

## Query params
- `proofId`: supported proof id (`seed-verity` or `lean-verity-fixture`)
- Full shared config knobs (same parser as other proof query routes):
  - `abstractionLevel`, `complexityLevel`, `maxChildrenPerParent`
  - `audienceLevel`, `language`, `readingLevelTarget`
  - `complexityBandWidth`, `termIntroductionBudget`, `proofDetailMode`, `entailmentMode`

## Response
```json
{
  "proofId": "lean-verity-fixture",
  "configHash": "...",
  "requestHash": "...",
  "cache": {
    "layer": "persistent",
    "status": "hit",
    "cacheKey": "lean-verity-fixture:<configHash>:<sourceFingerprint>",
    "sourceFingerprint": "...",
    "cachePath": "/abs/path/.explain-md/web-proof-cache/lean-verity-fixture/<configHash>.json",
    "snapshotHash": "...",
    "cacheEntryHash": "...",
    "diagnostics": [
      {
        "code": "cache_hit",
        "message": "Loaded deterministic Lean fixture dataset from persistent cache.",
        "details": {
          "cachePath": "...",
          "cacheEntryHash": "..."
        }
      }
    ],
    "blockedSubtreePlan": {
      "schemaVersion": "1.0.0",
      "reason": "source_fingerprint_mismatch",
      "changedDeclarationIds": [],
      "addedDeclarationIds": [],
      "removedDeclarationIds": [],
      "topologyShapeChanged": false,
      "blockedDeclarationIds": [],
      "blockedLeafIds": [],
      "unaffectedLeafIds": ["lean:Verity/Core:core_safe:8:1"],
      "executionBatches": [],
      "cyclicBatchCount": 0,
      "fullRebuildRequired": false,
      "planHash": "..."
    }
  }
}
```

## Determinism + invalidation
- Persistent cache path is deterministic by `proofId` and `configHash`.
- Reuse requires a matching `sourceFingerprint` (computed from Lean fixture file paths + content hashes).
- Cache entry integrity is checked by snapshot/dependency hash validation before reuse.
- On source-fingerprint mismatch, the service computes a deterministic blocked-subtree plan:
  - if no declarations are blocked and dependency topology is unchanged, cache reuse is recovered with diagnostic `cache_topology_recovery_hit`.
  - this recovery path rebases snapshot leaves to current ingestion output so source spans/source URLs stay provenance-accurate.
  - if declarations are blocked but topology and cached leaf IDs are still reusable, ancestor parents are recomputed deterministically on cached topology with diagnostic `cache_blocked_subtree_rebuild_hit`.
  - if declaration shape changes (added/removed IDs), deterministic topology regeneration runs with reusable cached parent summaries and emits `cache_topology_regeneration_rebuild_hit` with machine-checkable reuse telemetry:
    - `reusableParentSummaryCount`
    - `reusedParentSummaryCount`
    - `reusedParentSummaryByGroundingCount`
    - `reusedParentSummaryByStatementSignatureCount`
    - `generatedParentSummaryCount`
    - `skippedAmbiguousStatementSignatureReuseCount`
    - `skippedUnrebasableStatementSignatureReuseCount`
    - `regenerationHash`
  - if recovery preconditions fail, `blockedSubtreePlan.fullRebuildRequired=true`; cache diagnostics include `cache_blocked_subtree_full_rebuild` with deterministic fallback reason, and dataset rebuild continues deterministically.
- `blockedSubtreePlan.changedDeclarationIds` is computed from a semantic declaration fingerprint (statement + dependencies + declaration identity), so pure source-span/source-url shifts do not force full rebuild.
- `blockedSubtreePlan.addedDeclarationIds`, `removedDeclarationIds`, and `topologyShapeChanged` make topology-shape deltas explicit and machine-checkable.
- On invalid entry or topology mismatch, the dataset is rebuilt deterministically and cache is overwritten.

## Environment
- `EXPLAIN_MD_WEB_PROOF_CACHE_DIR`
  - overrides persistent cache directory
  - default: `.explain-md/web-proof-cache`
- `EXPLAIN_MD_LEAN_FIXTURE_PROJECT_ROOT`
  - overrides Lean fixture project root lookup used for ingestion/cache fingerprinting
  - useful for deterministic benchmark/invalidation runs on temporary fixture copies

## Benchmark evidence
- Run `npm run web:bench:cache` to generate a machine-checkable benchmark artifact at `docs/benchmarks/proof-cache-benchmark.json`.
- Benchmark command and output contract are documented in [proof-cache-benchmark.md](./proof-cache-benchmark.md).
