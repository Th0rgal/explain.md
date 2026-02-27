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
- `termIntroductionBudget`

Optional threshold overrides (`[0,1]`):
- `maxUnsupportedParentRate`
- `maxPrerequisiteViolationRate`
- `maxPolicyViolationRate`
- `maxTermJumpRate`
- `maxComplexitySpreadMean`
- `minEvidenceCoverageMean`
- `minVocabularyContinuityMean`

## Response
- `proofId`
- `configHash`
- `requestHash` (canonical hash over `proofId`, `configHash`, threshold override set, and query tag)
- `reportHash` (`sha256(renderTreeQualityReportCanonical(report))`)
- `report` (`evaluateExplanationTreeQuality` payload)

## Determinism and provenance
- Tree quality report is derived from a deterministic tree snapshot keyed by `proofId + configHash`.
- `reportHash` is stable across runs for equivalent trees/configs because canonical rendering masks non-deterministic timestamps.
- Threshold failures are machine-checkable with comparator semantics (`<=` or `>=`) and explicit `actual/expected` values.
