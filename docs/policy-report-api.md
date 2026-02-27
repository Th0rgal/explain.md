# Policy Report API (Issue #25)

## Goal
Expose deterministic, machine-checkable pedagogy calibration metrics from the tree quality harness to browser/API clients.

## Route
- `GET /api/proofs/policy-report`

## Query contract
Required:
- `proofId`

Shared config knobs (same parser as other proof query routes):
- `abstractionLevel`
- `complexityLevel`
- `maxChildrenPerParent`
- `audienceLevel`
- `language`
- `readingLevelTarget`
- `complexityBandWidth`
- `termIntroductionBudget`
- `proofDetailMode`
- `entailmentMode`

Optional threshold overrides (`[0,1]`):
- `maxUnsupportedParentRate`
- `maxPrerequisiteViolationRate`
- `maxPolicyViolationRate`
- `maxTermJumpRate`
- `maxComplexitySpreadMean`
- `minEvidenceCoverageMean`
- `minVocabularyContinuityMean`
- `minRepartitionEventRate`
- `maxRepartitionEventRate`

Optional threshold overrides (non-negative integer):
- `maxRepartitionMaxRound`

## Response
- `proofId`
- `configHash`
- `requestHash` (canonical hash over `proofId`, `configHash`, threshold override set, and query tag)
- `reportHash` (`sha256(renderTreeQualityReportCanonical(report))`)
- `report` (`evaluateExplanationTreeQuality` payload)
  - includes `repartitionMetrics` derived from `groupingDiagnostics[].repartitionEvents`
  - `repartitionMetrics.depthMetrics[]` is grouped by depth and reports event counts split by `pre_summary_policy` vs `post_summary_policy`
  - `thresholdFailures[].code` is deterministic and currently uses:
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

## Determinism and provenance
- Tree quality report is derived from a deterministic tree snapshot keyed by `proofId + configHash`.
- `reportHash` is stable across runs for equivalent trees/configs because canonical rendering masks non-deterministic timestamps.
- Threshold failures are machine-checkable with comparator semantics (`<=` or `>=`) and explicit `actual/expected` values.
- Repartition metrics are computed from tree diagnostics only (no LLM re-evaluation), so policy-loop audit counts are reproducible under fixed input/config.
