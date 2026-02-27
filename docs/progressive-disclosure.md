# Progressive Disclosure and Config Diff Contract

Issue: #15

## Scope
- Deterministic root-first projection for interactive tree disclosure.
- Deterministic change-report contract between two generated trees/configurations.
- Canonical render + hash functions for auditable UI state and diff payloads.

## Progressive Disclosure API
- `buildProgressiveDisclosureView(tree, request)`
- `renderProgressiveDisclosureCanonical(view)`
- `computeProgressiveDisclosureHash(view)`

Request:
- `expandedNodeIds?: string[]`
- `maxChildrenPerExpandedNode?: number` (integer `>= 1`)

Output:
- `rootId`, `treeConfigHash`
- normalized/sorted `expandedNodeIds`
- `visibleNodes[]` with:
  - `id`, `kind`, `depthFromRoot`, `parentId`
  - `statement`, `evidenceRefs`
  - `isExpanded`, `isExpandable`
  - `childCount`, `visibleChildIds`, `hiddenChildCount`
- `diagnostics[]` with machine-readable codes

## Determinism and Safety Rules
- Expanded IDs are trimmed, deduplicated, and lexicographically sorted.
- Visibility traversal is root-first and follows parent `childIds` order.
- Hidden child windowing is deterministic via `maxChildrenPerExpandedNode`.
- Diagnostics are sorted canonically by `(code, message)` before rendering.
- Unknown/missing/unreachable/non-parent expansion targets become diagnostics, not crashes.

## Diagnostic Codes
- `missing_root`
- `missing_node`
- `cycle_detected`
- `expanded_node_missing`
- `expanded_node_not_reachable`
- `expanded_node_not_parent`

## Explanation Diff API
- `buildExplanationDiffReport(baselineTree, candidateTree, baselineConfig, candidateConfig)`
- `renderExplanationDiffCanonical(report)`
- `computeExplanationDiffHash(report)`

Diff semantics:
- Includes `regenerationPlan` from `planRegeneration(...)`.
- Nodes are compared by deterministic signature:
  - leaf: `leaf:<leaf_id>`
  - parent: `parent:<sorted_support_leaf_ids>`
- Node support set is computed from reachable descendants only.
- Cycles in parent graphs are short-circuited deterministically during support collection (no recursive overflow).
- Changes are classified as `added | removed | changed` and sorted canonically.

`changed` is emitted when signature-matched nodes differ in statement or depth.

## UI Hand-off
- UI can request projection with current expansion state and child cap.
- UI can hash projection (`computeProgressiveDisclosureHash`) for stable cache keys.
- Diff panel can display grouped `changes[]` (`changed`/`added`/`removed`) and `summary` with config-aware `regenerationPlan`.
- Statement-level changed highlights should be derived deterministically from longest common prefix/suffix split of baseline/candidate statements.
