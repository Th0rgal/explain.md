# Pedagogical Policy Engine (Issue #25)

This module enforces deterministic pedagogy constraints around parent generation.

## Core API
- `evaluatePreSummaryPolicy(children, config)`
- `evaluatePostSummaryPolicy(children, summary, config)`

## Deterministic policy checks
- Pre-summary:
  - bounded sibling complexity spread (`complexityBandWidth`)
  - in-group prerequisite ordering (evaluated in deterministic grouping order, not lexical ID order)
  - cyclic in-group prerequisite edges are detected and waived from strict ordering checks (non-orderable SCC case)
- Post-summary:
  - full evidence coverage (`evidence_refs` must include every child ID)
  - low term-introduction budget (`termIntroductionBudget`)
  - vocabulary continuity floor (deterministic by `audienceLevel` + `proofDetailMode`)

## Integration with tree building
- Tree construction runs pre-summary policy before each parent summary call.
- Parent summary generation retries once with a stricter deterministic system prompt if policy fails.
- If both attempts fail, the builder deterministically repartitions the failing sibling group (bounded rounds, stable order-preserving splits) and retries group synthesis.
- If repartition budget is exhausted, the builder throws `TreePolicyError` with machine-readable diagnostics.
- Successful parent nodes persist diagnostics (`preSummary`, `postSummary`, `retriesUsed`) for UI/evaluation.

## Why this matters
- Prevents unsupported parent drift from propagating upward.
- Makes pedagogy constraints auditable at node level.
- Provides deterministic policy outcomes for fixed config + inputs.
