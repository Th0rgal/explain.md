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
- Parent IDs are deterministic hashes of `(depth, groupIndex, childIds)`.
- Parent generation runs in deterministic request order.
- Grouping diagnostics are preserved per depth for auditability.
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
  - in-group prerequisite ordering must remain topological
- Post-summary checks:
  - `evidence_refs` must cover all child IDs in the group
  - `new_terms_introduced` must satisfy `termIntroductionBudget`
  - vocabulary continuity ratio must satisfy deterministic audience/detail floor
- Rewrite loop:
  - the builder retries once with a stricter deterministic system prompt
  - if still non-compliant, the builder fails with `TreePolicyError` and machine-readable diagnostics

## Degenerate and boundary cases
- One leaf: returns that leaf as root with depth `0`.
- Very wide input sets: reduced layer-by-layer until one root remains.
- Optional hard stop via `maxDepth` to avoid non-terminating behavior.

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
