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
- `repartition_event_rate`
- `repartition_max_round`

Defaults are deterministic and can be overridden in `options.thresholds`.

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
npm run eval:quality -- --preset=fixture-verity-core --out=.explain-md/quality-gate-report.json
```

Optional threshold overrides:

```bash
npm run eval:quality -- /path/to/lean-project \
  --max-unsupported-parent-rate=0.05 \
  --min-vocabulary-continuity-mean=0.70 \
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
- `npm run build`
- `npm test`
- `npm run eval:quality:ci`

The workflow uploads `.explain-md/quality-gate-report.json` as `quality-gate-report`.
The report includes:
- `qualityReportHash` (canonical report hash)
- `preset.name` + `preset.hash`
- threshold pass/failure and metrics summary

## Verity benchmark examples
- Loop/arithmetic/conditional-heavy subset:

```bash
npm run eval:quality -- /workspaces/mission-1ee8868c/verity \
  --include=Verity/Proofs/Counter/Correctness.lean \
  --include=Verity/Proofs/SimpleToken/Correctness.lean \
  --include=Verity/Core.lean \
  --include=Compiler/ContractSpec.lean
```
