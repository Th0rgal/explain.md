# Recursive tree builder

Issue: #9

## Scope
- Build a single-root explanation tree from normalized leaf nodes.
- Use deterministic inductive grouping with `maxChildrenPerParent` as a hard branching cap.
- Generate each parent node through the validated parent-summary pipeline.
- Enforce pedagogical policy checks before and after each parent summary.
- Validate structural invariants before returning the tree.

## Deterministic behavior
- Leaves are normalized and sorted by `id` before construction.
- Layer grouping uses the `child-grouping` planner (stable topological ordering + deterministic candidate scoring).
- Each sibling group is re-ordered locally by in-group prerequisites before policy checks and parent synthesis.
- If local cycles remain, order is completed with deterministic cycle-break picks (lexical) so downstream dependents still follow released prerequisites.
- Parent IDs are deterministic hashes of `(depth, groupIndex, childIds)`.
- Parent generation runs in deterministic request order.
- Grouping diagnostics are preserved per depth for auditability.
- Grouping diagnostics include deterministic `repartitionEvents` whenever a policy-failing group is split.
- Policy diagnostics are attached per parent (`preSummary`, `postSummary`, `retriesUsed`).

## Tree validity checks
`validateExplanationTree` enforces:
- A root exists in the node map.
- All referenced child IDs resolve to known nodes.
- All nodes are reachable from root (connected rooted DAG view).
- Every declared leaf is reachable from root.
- No parent exceeds `maxChildrenPerParent`.
- Every parent includes policy diagnostics.
- Every parent policy decision is successful (`preSummary.ok` and `postSummary.ok`).

## Pedagogy policy integration (#25)
- Pre-summary checks:
  - sibling complexity spread must stay within `complexityBandWidth`
  - in-group prerequisite ordering must remain topological in the grouping-produced child order
  - cyclic in-group prerequisite edges are treated as prerequisite-order violations
- Post-summary checks:
  - `evidence_refs` must cover all child IDs in the group
  - `new_terms_introduced` must satisfy `termIntroductionBudget`
  - vocabulary continuity ratio must satisfy deterministic audience/detail floor
- Rewrite loop:
  - the builder retries once with a stricter deterministic system prompt
  - if a group remains non-compliant, the builder deterministically repartitions that group into two ordered subgroups and retries
  - repartition is bounded: groups of size `<= 2` cannot be split further and fail fast with `TreePolicyError`
  - every repartition is recorded in `groupingDiagnostics[].repartitionEvents` with reason and violation codes

## Degenerate and boundary cases
- One leaf: returns that leaf as root with depth `0`.
- Very wide input sets: reduced layer-by-layer until one root remains.
- Default depth guard uses a safe upper bound (`<= leafCount`, capped at `2048`) so slow but valid reductions do not fail early.
- If a layer produces no reduction (`nextLayer` size >= `active` size), construction fails fast with an explicit no-progress error.
- Optional hard stop via `maxDepth` still overrides defaults.

## API
- `buildRecursiveExplanationTree(provider, request)`
- `validateExplanationTree(tree, maxChildrenPerParent)`

Request shape:
- `leaves`: `[{ id, statement, complexity? }]`
- `config`: normalized `ExplanationConfig`
- `maxDepth?`: optional explicit depth guard

Output includes:
- `rootId`, `leafIds`, `nodes`, `configHash`, `groupPlan`, `groupingDiagnostics`, `maxDepth`
- `policyDiagnosticsByParent`
