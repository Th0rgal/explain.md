# Evaluation harness

Issue #18 introduces deterministic quality scoring for generated explanation trees.

## Goals
- Measure parent-claim support against descendant evidence.
- Track pedagogical quality metrics that are already enforced by the policy engine.
- Emit canonical, hashable reports suitable for CI regression gates.

## API
- `evaluateExplanationTreeQuality(tree, config, options?)`
  - Returns a machine-checkable `TreeQualityReport`.
- `renderTreeQualityReportCanonical(report)`
  - Stable JSON rendering for reproducible artifacts (normalizes `generatedAt`).
- `computeTreeQualityReportHash(report)`
  - SHA-256 hash of canonical report bytes.
- `listQualityBenchmarkPresets()`, `resolveQualityBenchmarkPreset(name)`
  - Deterministic benchmark corpus presets for repeatable CI runs.
  - Presets can include deterministic `configOverrides` (for example `entailmentMode: "strict"`).
- `computeQualityBenchmarkPresetHash(preset)`
  - SHA-256 hash of canonical preset bytes for audit trails.

## Metrics
- `unsupportedParentRate`
  - Parent statements whose lexical claims are weakly supported by descendant vocabulary and allowed new terms.
- `prerequisiteViolationRate`
  - Parents with non-zero prerequisite-order violations from pre-summary policy diagnostics.
- `policyViolationRate`
  - Parents with any policy violation in pre- or post-summary diagnostics.
- `meanComplexitySpread`
  - Mean sibling complexity spread across parents.
- `meanEvidenceCoverage`
  - Mean child-coverage ratio for `evidence_refs`.
- `meanVocabularyContinuity`
  - Mean vocabulary continuity ratio from post-summary diagnostics.
- `meanTermJumpRate`
  - Mean ratio of introduced terms to meaningful parent tokens.

Reports also include per-parent samples and per-depth aggregates.
Reports now also include `repartitionMetrics` to audit how often bounded repartition loops were needed:
- total event count
- split by `pre_summary_policy` and `post_summary_policy`
- per-depth counts and max retry round

## Threshold gating
The evaluator computes a threshold verdict (`thresholdPass`) with machine-readable failures:
- `unsupported_parent_rate`
- `prerequisite_violation_rate`
- `policy_violation_rate`
- `term_jump_rate`
- `complexity_spread_mean`
- `evidence_coverage_mean`
- `vocabulary_continuity_mean`
- `min_repartition_event_rate`
- `repartition_event_rate`
- `repartition_max_round`

Defaults are deterministic and can be overridden in `options.thresholds`.
When `config.entailmentMode` is `strict`, the support-coverage floor is fixed at `1.0` (no unsupported lexical claims).

## Human review rubric
Use this rubric when manually spot-checking parent nodes flagged by the automated report:

1. Entailment
Score `0/1`: every parent claim is explicitly supported by child/descendant statements.
2. Pedagogy progression
Score `0/1`: prerequisite ideas appear before dependent claims in reading order.
3. Complexity smoothness
Score `0/1`: sibling explanations stay within a narrow difficulty band.
4. Terminology discipline
Score `0/1`: parent introduces only minimal new vocabulary relative to children.
5. Source/provenance clarity
Score `0/1`: reviewer can trace claim back to concrete leaves and source locations.

Recommended policy: investigate any sample with rubric score `< 4`.

## Reproducible CLI
Run a full deterministic ingest->tree->quality pipeline:

```bash
npm run eval:quality -- /path/to/lean-project --include=Verity --include=Compiler/ContractSpec.lean
```

Inspect built-in deterministic benchmark presets:

```bash
npm run eval:quality -- --list-presets
```

Run with a deterministic preset and emit an auditable artifact JSON:

```bash
npm run eval:quality -- --preset=fixture-verity-core --out=.explain-md/quality-gate-report-core.json
```

Pressure-focused preset (expects bounded but non-zero repartition pressure):

```bash
npm run eval:quality -- --preset=fixture-verity-pressure --out=.explain-md/quality-gate-report-pressure.json
```

Broader Verity fixture preset (core + loop + invariants + cycle pressure):

```bash
npm run eval:quality -- --preset=fixture-verity-broad --out=.explain-md/quality-gate-report-broad.json
```

Frozen real-Verity snapshot preset (counter example + AST + proofs):

```bash
npm run eval:quality -- --preset=fixture-verity-counter-snapshot --out=.explain-md/quality-gate-report-counter-snapshot.json
```

Strict-entailment variant of the same frozen snapshot:

```bash
npm run eval:quality -- --preset=fixture-verity-counter-snapshot-strict --out=.explain-md/quality-gate-report-counter-snapshot-strict.json
```

Frozen real-Verity snapshot preset (SimpleToken correctness/isolation/supply):

```bash
npm run eval:quality -- --preset=fixture-verity-token-snapshot --out=.explain-md/quality-gate-report-token-snapshot.json
```

Strict-entailment variant of the same frozen SimpleToken snapshot:

```bash
npm run eval:quality -- --preset=fixture-verity-token-snapshot-strict --out=.explain-md/quality-gate-report-token-snapshot-strict.json
```

Optional threshold overrides:

```bash
npm run eval:quality -- /path/to/lean-project \
  --max-unsupported-parent-rate=0.05 \
  --min-vocabulary-continuity-mean=0.70 \
  --min-repartition-event-rate=0.20 \
  --max-repartition-event-rate=0.50 \
  --max-repartition-max-round=1
```

Exit codes:
- `0`: tree validates and thresholds pass.
- `2`: tree validity or threshold gate failed.
- `1`: runtime error.

CLI JSON output includes `repartitionMetrics` so CI and benchmark artifacts can audit rewrite/repartition-loop pressure without re-running tree construction.

## CI quality gate
GitHub Actions runs `.github/workflows/quality-gate.yml` on PRs and `main` pushes:
- `npm ci`
- `npm --prefix apps/web ci`
- `npm run build`
- `npm test`
- `npm run web:lint`
- `npm run web:typecheck`
- `npm run web:test`
- `npm run web:build`
- `npm run web:eval:tree-a11y:ci`
- `npm run web:eval:tree-scale:ci`
- `npm run web:eval:explanation-diff:ci`
- `npm run web:eval:verification-replay:ci`
- `npm run eval:release-gate:ci`

The workflow uploads `.explain-md/quality-gate-report-*.json` as `quality-gate-reports`.
Each report includes:
- `qualityReportHash` (canonical report hash)
- `preset.name` + `preset.hash`
- threshold pass/failure and metrics summary
- a deterministic baseline check artifact at `.explain-md/quality-gate-baseline-check.json`
- a deterministic tree-a11y check artifact at `.explain-md/tree-a11y-evaluation-report.json`
- a deterministic tree-scale check artifact at `.explain-md/tree-scale-evaluation-report.json`
- a deterministic explanation-diff check artifact at `.explain-md/explanation-diff-evaluation-report.json`
- a deterministic verification replay check artifact at `.explain-md/verification-replay-evaluation-report.json`
- a deterministic release-gate artifact at `.explain-md/release-gate-report.json`

CI also runs a deterministic baseline drift gate against committed benchmark expectations:

```bash
npm run eval:quality:baseline
```

The baseline source of truth is:
- `docs/benchmarks/quality-gate-baseline.json`

To intentionally refresh baseline expectations after a reviewed benchmark change:

```bash
node scripts/eval-quality-baseline.mjs \
  --reports=.explain-md/quality-gate-report-pressure.json,.explain-md/quality-gate-report-broad.json,.explain-md/quality-gate-report-counter-snapshot.json,.explain-md/quality-gate-report-counter-snapshot-strict.json,.explain-md/quality-gate-report-token-snapshot.json,.explain-md/quality-gate-report-token-snapshot-strict.json \
  --baseline=docs/benchmarks/quality-gate-baseline.json \
  --write-baseline
```

## Verity benchmark examples
- Loop/arithmetic/conditional-heavy subset:

```bash
npm run eval:quality -- /workspaces/mission-1ee8868c/verity \
  --include=Verity/Proofs/Counter/Correctness.lean \
  --include=Verity/Proofs/SimpleToken/Correctness.lean \
  --include=Verity/Core.lean \
  --include=Compiler/ContractSpec.lean
```
