# Inductive child grouping

Issue: #7

## Scope
- Deterministically group child nodes before parent-summary synthesis.
- Respect hard branching cap (`maxChildrenPerParent`).
- Enforce sibling complexity spread bound from config (`complexityBandWidth`).
- Preserve prerequisite ordering using stable topological scheduling.

## Algorithm
1. Normalize nodes (trim, validate, sort by `id`, deduplicate prerequisites).
2. Compute deterministic topological order from `prerequisiteIds`.
3. Build each group greedily from that order with these constraints:
   - prerequisites for each added node must already be assigned or inside the same group,
   - resulting group size must stay `<= maxChildrenPerParent`,
   - resulting complexity spread (`max - min`) must stay `<= complexityBandWidth`.
4. Resolve candidate ties using deterministic score ordering:
   - higher semantic token overlap with current group,
   - lower complexity delta,
   - lower target-complexity delta,
   - earlier topological order.

## Determinism and provenance
- Same inputs/config always produce the same `groups` and `orderedNodeIds`.
- Diagnostics include complexity spread per group and explicit warnings:
  - `missing_complexity`: complexity defaulted to target complexity.
  - `cycle_detected`: prerequisite cycle fallback used lexical order.

## API
- `groupChildrenDeterministically(request)`

Request fields:
- `nodes`: `[{ id, statement, complexity?, prerequisiteIds? }]`
- `maxChildrenPerParent`: integer `>= 2`
- `targetComplexity`: number in `[1, 5]`
- `complexityBandWidth`: integer in `[0, 3]`

Response fields:
- `groups`: ordered array of child-id arrays
- `diagnostics.orderedNodeIds`: deterministic topological order
- `diagnostics.complexitySpreadByGroup`: per-group spread
- `diagnostics.warnings`: machine-checkable fallbacks
