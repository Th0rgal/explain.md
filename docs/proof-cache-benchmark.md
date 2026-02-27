# Proof Cache Benchmark Harness

This benchmark provides machine-checkable evidence for deterministic cache behavior on the Lean fixture proof dataset.

## Command
```bash
npm run web:bench:cache
```

By default this writes:
- `docs/benchmarks/proof-cache-benchmark.json`

## What It Measures
- Cold path (`coldNoPersistentCache`): persistent cache removed before each iteration.
- Warm path (`warmPersistentCache`): persistent cache prewarmed, in-memory cache cleared between iterations.
- Invalidation path (`invalidation`): mutates `Verity/Core.lean` in a temporary fixture copy, then verifies deterministic topology-plan evidence plus recovery.
  - benchmark mutation rewrites one declaration statement (topology-stable semantic delta), so `afterChangeTopologyPlan.fullRebuildRequired=true` while recovery can still return `cache_blocked_subtree_rebuild_hit`.
  - expected status flow is `beforeChangeStatus=hit`, `afterChangeStatus=hit`, `recoveryStatus=hit`.
- Topology-shape invalidation path (`topologyShapeInvalidation`): appends a declaration in `Verity/Core.lean` to force declaration-set shape change.
  - expected diagnostics include `cache_topology_regeneration_rebuild_hit`, and `afterChangeTopologyPlan.topologyShapeChanged=true`.
  - `afterChangeRemovalRecovery` is populated only when a shape delta can be recovered via deterministic removal-only subtree recompute (`cache_topology_removal_subtree_rebuild_hit`):
    - `removedLeafCount`
    - `touchedParentCount`
    - `recomputedParentCount`
    - `collapsedParentCount`
    - `droppedParentCount`
    - `recoveryHash`
  - `afterChangeRegenerationRecovery` records deterministic recovery telemetry:
    - `reusableParentSummaryCount`
    - `reusedParentSummaryCount`
    - `reusedParentSummaryByGroundingCount`
    - `reusedParentSummaryByStatementSignatureCount`
    - `generatedParentSummaryCount`
    - `skippedAmbiguousStatementSignatureReuseCount`
    - `skippedUnrebasableStatementSignatureReuseCount`
    - `regenerationHash`
  - expected status flow is `beforeChangeStatus=hit`, `afterChangeStatus=hit`, `recoveryStatus=hit`.

## Determinism and Auditability
- Report includes:
  - `requestHash`: canonical hash of benchmark inputs (`proofId`, `configHash`, iteration counts).
  - `outcomeHash`: canonical hash of machine-checkable outcomes:
    - cold/warm hit-miss status vectors
    - invalidation + topology-shape invalidation status transitions, diagnostic codes, topology-plan summaries, removal-recovery telemetry (when present), and topology-regeneration recovery telemetry
- Timing fields are informative but not included in `outcomeHash`, so run-to-run performance jitter does not break reproducibility checks.

## Environment
- `EXPLAIN_MD_WEB_PROOF_CACHE_DIR`
  - persistent cache directory override used by benchmark runs.
- `EXPLAIN_MD_LEAN_FIXTURE_PROJECT_ROOT`
  - Lean fixture project root override (benchmark uses a temporary fixture copy by default).
