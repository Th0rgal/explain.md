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
- Invalidation path (`invalidation`): mutates `Verity/Core.lean` in a temporary fixture copy, then verifies miss-then-hit recovery.

## Determinism and Auditability
- Report includes:
  - `requestHash`: canonical hash of benchmark inputs (`proofId`, `configHash`, iteration counts).
  - `outcomeHash`: canonical hash of machine-checkable outcomes:
    - cold/warm hit-miss status vectors
    - invalidation status transitions and diagnostic codes
- Timing fields are informative but not included in `outcomeHash`, so run-to-run performance jitter does not break reproducibility checks.

## Environment
- `EXPLAIN_MD_WEB_PROOF_CACHE_DIR`
  - persistent cache directory override used by benchmark runs.
- `EXPLAIN_MD_LEAN_FIXTURE_PROJECT_ROOT`
  - Lean fixture project root override (benchmark uses a temporary fixture copy by default).
