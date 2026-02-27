# Explanation Diff Evaluation (Issue #15)

Deterministic benchmark for browser diff-panel correctness and provenance coverage.

## Goal
Verify that config changes regenerate explanation diffs with machine-checkable evidence, bounded panel rendering, and provenance-preserving support-leaf metadata.

## Command
From repository root:

```bash
npm run web:bench:explanation-diff
```

Baseline check in CI:

```bash
npm run web:eval:explanation-diff:ci
```

## Artifact
- baseline: `docs/benchmarks/explanation-diff-evaluation.json`
- CI report: `.explain-md/explanation-diff-evaluation-report.json`

Report fields:
- `requestHash`: hash over proof id, baseline config, candidate profiles, and max panel bound.
- `outcomeHash`: hash over profile comparisons + summary.
- `comparisons[]`: per-profile diff hashes, changed fields, truncation counts, support-leaf coverage counts.
- `summary.coverage`: whether diff evidence covers core config knobs (`abstractionLevel`, `complexityLevel`, `maxChildrenPerParent`, `language`, `audienceLevel`).

## Fail-closed checks
- baseline `requestHash` must match.
- baseline `outcomeHash` must match.
- baseline summary invariants and profile ordering are validated.

This benchmark is wired into the root release gate (`eval:release-gate:ci`) as `explanation_diff_profiles_cover_config_knobs`.
