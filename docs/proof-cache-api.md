# Proof cache report API

Deterministic cache-reuse diagnostics for proof dataset generation.

## Endpoint
- `GET /api/proofs/cache-report`

## Query params
- `proofId`: supported proof id (`seed-verity` or `lean-verity-fixture`)
- Full shared config knobs (same parser as other proof query routes):
  - `abstractionLevel`, `complexityLevel`, `maxChildrenPerParent`
  - `audienceLevel`, `language`, `readingLevelTarget`
  - `complexityBandWidth`, `termIntroductionBudget`, `proofDetailMode`

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
    ]
  }
}
```

## Determinism + invalidation
- Persistent cache path is deterministic by `proofId` and `configHash`.
- `sourceFingerprint` is computed from Lean fixture file paths + content hashes.
- On `sourceFingerprint` mismatch, theorem-level canonical leaf deltas are computed:
  - empty delta: cached snapshot is reused (`cache_semantic_hit`) and cache entry is rebased to the new fingerprint;
  - non-empty delta + stable theorem topology (same IDs/dependencies): deterministic affected-ancestor subtree recompute runs with `cache_incremental_subtree_rebuild` diagnostics;
  - non-empty delta + topology/structure change: deterministic topology-aware rebuild runs with `cache_incremental_topology_rebuild`, reusing parent summaries only when child-grounding signatures are unchanged;
  - final fallback remains deterministic full rebuild (`cache_incremental_rebuild`) when topology-aware reuse cannot be applied.
- Cache entry integrity is checked by snapshot/dependency hash validation before reuse.
- On mismatch or invalid entry, the dataset is rebuilt deterministically and cache is overwritten.

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
