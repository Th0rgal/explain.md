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
- Parent generation runs in deterministic batch order (`summaryBatchSize`, default `4`) while preserving stable `groupIndex` ordering.
- Grouping diagnostics are preserved per depth for auditability.
- Grouping diagnostics include `summaryBatches[]` with batch/group cardinalities for reproducible batching audits.
- Grouping diagnostics include `summaryReuse` with generated vs reused group indexes when reusable parent summaries are provided.
- `summaryReuse` also reports deterministic reuse origin:
  - `reusedByParentIdGroupIndexes` when stable parent IDs match.
  - `reusedByChildHashGroupIndexes` when parent IDs changed but same-depth child-grounding hashes still match.
  - `reusedByChildStatementHashGroupIndexes` when parent IDs and child IDs changed but same-depth ordered child statements still match.
  - `reusedByFrontierChildHashGroupIndexes` when child-hash fallback was ambiguous and deterministically resolved by ordered descendant-leaf frontier hash.
  - `reusedByFrontierChildStatementHashGroupIndexes` when child-statement-hash fallback was ambiguous and deterministically resolved by ordered descendant-leaf frontier hash.
  - `skippedAmbiguousChildHashGroupIndexes` when child-hash fallback has multiple deterministic candidates at a depth and reuse is intentionally skipped.
  - `skippedAmbiguousChildStatementHashGroupIndexes` when child-statement-hash fallback has multiple deterministic candidates at a depth and reuse is intentionally skipped.
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
  - cyclic in-group prerequisite edges are deterministically waived as non-orderable
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
- `summaryBatchSize?`: optional integer `1..32` controlling max concurrent parent summaries per depth
- `reusableParentSummaries?`: optional map keyed by deterministic parent id (`p_<depth>_<groupIndex>_<digest>`) for stable-id parent reuse
  - each entry includes `childStatementHash`, optional `childStatementTextHash`, optional frontier hashes (`frontierLeafIdHash`, `frontierLeafStatementHash`), and previously validated summary payload
  - reuse is accepted only when the current child statement hash matches and post-summary policy still passes
  - when stable IDs do not match (for example after deterministic topology reindexing), reuse falls back first to deterministic same-depth child-grounding hash matching, then to same-depth child-statement hash matching
  - statement-hash fallback deterministically re-bases `evidence_refs` to current child IDs before policy validation
  - ambiguous fallback matches are deterministically resolved only when ordered descendant-leaf frontier hashes uniquely identify one candidate; otherwise reuse is skipped
- `generationFrontierLeafIds?`: optional deterministic generation frontier (leaf IDs)
  - when set, parent-summary generation is allowed only for groups whose descendant leaf frontier intersects this set
  - groups outside the frontier must reuse an existing parent summary or the build fails fast with `TreeFrontierPartitionError`
  - `TreeFrontierPartitionError.blockedGroups[]` includes deterministic blocked group metadata (`depth`, `groupIndex`, `parentId`, `frontierLeafIds`) for caller-side frontier expansion/retry scheduling
  - `TreeFrontierPartitionError.reusableParentSummaries` includes deterministic reusable summaries captured from already-built layers in the blocked attempt, enabling caller-side retry warm-start without regenerating those parents
  - this enables minimal-subtree topology recompute scheduling with explicit fallback control in callers

Output includes:
- `rootId`, `leafIds`, `nodes`, `configHash`, `groupPlan`, `groupingDiagnostics`, `maxDepth`
- `policyDiagnosticsByParent`
