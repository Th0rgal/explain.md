# Release Gate Charter (Issue #1)

This document defines the machine-checkable release gate for explain.md.

## Scope
- Convert Lean/Verity proof leaves into a deterministic inductive explanation tree.
- Preserve provenance: source spans/hashes, canonical request IDs, canonical artifact hashes.
- Enforce pedagogy: bounded complexity, prerequisite ordering, constrained term introduction.
- Expose browser-verifiable leaves and reproducible verification metadata.

## Non-goals
- Replacing Lean kernel proof checking.
- Free-form LLM-only explanations without child entailment evidence.
- Non-deterministic ranking/personalization in the core tree pipeline.

## Glossary
- `leaf theorem`: Source-grounded theorem statement with provenance metadata.
- `parent summary`: LLM-produced aggregation claim constrained by child evidence and policy critics.
- `abstraction level`: Config knob controlling conceptual distance from source statements.
- `complexity level`: Target explanation complexity on 1..5 scale.
- `max branching factor`: `maxChildrenPerParent` cap used by deterministic child grouping.

## End-to-end architecture
`Lean ingest -> dependency graph -> leaf schema -> child grouping -> summary pipeline + policy critics -> tree storage/query -> web API/UI -> verification replay`

## Machine-computable release checks
`npm run eval:release-gate:ci` is the single deterministic release check entrypoint.

It composes benchmark evidence from:
- `docs/benchmarks/quality-gate-baseline.json`
- `docs/benchmarks/tree-a11y-evaluation.json`
- `docs/benchmarks/tree-scale-evaluation.json`
- `docs/benchmarks/explanation-diff-evaluation.json`
- `docs/benchmarks/verification-replay-evaluation.json`
- `docs/benchmarks/proof-cache-benchmark.json`
- `docs/benchmarks/domain-adapter-evaluation.json`
- `docs/benchmarks/observability-slo-benchmark.json`
- `.explain-md/quality-gate-baseline-check.json`
- `.explain-md/explanation-diff-evaluation-report.json`
- `.explain-md/verification-replay-evaluation-report.json`
- `.explain-md/observability-slo-benchmark-report.json`

Gate checks:
- `quality_baseline_consistent`
- `quality_thresholds_pass`
- `strict_entailment_presets_present`
- `tree_a11y_transcript_complete`
- `tree_scale_profiles_cover_modes`
- `explanation_diff_profiles_cover_config_knobs`
- `verification_replay_contract_complete`
- `cache_warm_speedup`
- `cache_recovery_hits`
- `domain_adapter_quality_floor`
- `observability_baseline_consistent`
- `observability_slo_gate`

The gate emits `.explain-md/release-gate-report.json` with:
- `requestHash`
- `outcomeHash`
- per-check pass/fail diagnostics
- aggregate leaf/parent counts

## Remaining scope tracking
Remaining scope is tracked by open core issues and audited through this gate plus issue-level specs.
Current open core issues (as of 2026-02-27): `#1, #10, #15, #19, #20, #21, #22, #24`.
