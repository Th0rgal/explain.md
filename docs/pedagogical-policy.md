# Pedagogical Policy Engine (Issue #25)

This module enforces deterministic pedagogy constraints around parent generation.

## Core API
- `evaluatePreSummaryPolicy(children, config)`
- `evaluatePostSummaryPolicy(children, summary, config)`

## Deterministic policy checks
- Pre-summary:
  - bounded sibling complexity spread (`complexityBandWidth`)
  - in-group prerequisite ordering (evaluated in deterministic grouping order, not lexical ID order)
  - cyclic in-group prerequisite edges are treated as ordering violations and must be resolved by deterministic repartition
- Post-summary:
  - full evidence coverage (`evidence_refs` must include every child ID)
  - low term-introduction budget (`termIntroductionBudget`)
  - vocabulary continuity floor (deterministic by `audienceLevel` + `proofDetailMode`)

## Integration with tree building
- Tree construction runs pre-summary policy before each parent summary call.
- Parent summary generation retries once with a stricter deterministic system prompt if policy fails.
- If summary compliance still fails, tree building deterministically repartitions the failing child group and retries synthesis on smaller groups.
- Repartition is bounded (`<= 2` nodes cannot be split), and exhaustion fails fast with `TreePolicyError`.
- Repartition actions are captured in `groupingDiagnostics[].repartitionEvents` for auditability.
- Successful parent nodes persist diagnostics (`preSummary`, `postSummary`, `retriesUsed`) for UI/evaluation.

## Why this matters
- Prevents unsupported parent drift from propagating upward.
- Makes pedagogy constraints auditable at node level.
- Provides deterministic policy outcomes for fixed config + inputs.
