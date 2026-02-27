# 3D explanation tree mode (Issue #47)

## Objective
Add a whole-tree representation that preserves provenance and deterministic behavior while remaining synchronized with list mode.

## UI contract
- New proof explorer mode toggle: `List | 3D Tree`.
- 3D mode is additive, not a replacement for list mode.
- Node selection is shared between modes.
  - Selecting a leaf opens leaf provenance + verification panel.
  - Selecting a parent updates selected node state without synthetic claims.

## Deterministic transform
Implemented in `apps/web/lib/tree-scene.ts`.

Input:
- `rootId`
- loaded node map
- loaded child-page map
- selected node/leaf ids
- selected path node ids
- `configHash`, `snapshotHash`
- optional policy report parent samples

Output:
- stable `nodes[]` with deterministic coordinates
- stable `edges[]` with policy status overlays
- canonical `sceneHash`
- diagnostics for missing root/partial load cases

## Provenance and policy overlays
- Node and edge status is derived from existing machine-checkable artifacts only:
  - parent sample metrics (`supportedClaimRatio`, `prerequisiteOrderViolations`, `policyViolationCount`)
  - per-node policy diagnostics when sample rows are unavailable
- No synthetic entailment claims are generated.

## Whole-tree loading behavior
When entering 3D mode, the explorer incrementally hydrates all parent pages until:
- every reachable parent has a loaded child page,
- `hasMore=false`, and
- `childIds.length === totalChildren`.

Completeness check uses `isWholeTreeLoaded(...)`.

## Performance guardrail
- Dense mode auto-activates for `>=500` scene nodes and suppresses HTML labels.
- Orbit controls remain enabled; node and edge renderings stay deterministic.

## Tests
- `apps/web/tests/tree-scene.test.ts`:
  - transform determinism
  - status mapping from policy samples
  - whole-tree completeness detection
