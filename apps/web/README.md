# Web App Scaffold (Issue #14)

This Next.js app provides a deterministic frontend scaffold for explain.md.

## Scope
- App Router shell with deterministic proof explorer entrypoint.
- API routes backed by core provenance contracts:
  - `GET /api/proofs/seed`
  - `GET /api/proofs/root`
  - `GET /api/proofs/nodes/:nodeId/children`
  - `GET /api/proofs/nodes/:nodeId/path`
  - `GET /api/proofs/dependency-graph`
  - `GET /api/proofs/policy-report`
  - `GET /api/proofs/cache-report`
  - `GET /api/proofs/config-profiles`
  - `POST /api/proofs/config-profiles`
  - `DELETE /api/proofs/config-profiles/:profileId`
  - `POST /api/proofs/view`
  - `POST /api/proofs/diff`
  - `GET /api/proofs/leaves/:leafId`
  - `POST /api/proofs/leaves/:leafId/verify`
  - `GET /api/proofs/leaves/:leafId/verification-jobs`
  - `GET /api/verification/jobs/:jobId`
- Client API layer in `lib/api-client.ts`.
- Loading and error boundaries (`app/loading.tsx`, `app/error.tsx`).
- Proof datasets:
  - `seed-verity` (hand-authored scaffold seed)
  - `lean-verity-fixture` (parsed from `tests/fixtures/lean-project` via deterministic Lean ingestion + tree build)

## State Management
This scaffold uses local React state + deterministic API payloads as the baseline state strategy.

The tree panel uses incremental root/children/path queries:
- Load root snapshot (`/api/proofs/root`).
- Expand parent nodes with bounded child pages (`/api/proofs/nodes/:nodeId/children`, `limit=maxChildrenPerParent`).
- Resolve selected leaf ancestry (`/api/proofs/nodes/:nodeId/path`) to expand prerequisite parents deterministically.
- Keep leaf-detail and diff panels wired to provenance-aware contracts (`/api/proofs/leaves/:leafId`, `/api/proofs/diff`).
- Query dependency reachability/SCC evidence deterministically with `/api/proofs/dependency-graph`.
- Surface per-parent policy diagnostics (pre/post compliance + metrics) directly in tree rows.
- Query deterministic pedagogy calibration metrics + threshold gates with `/api/proofs/policy-report`.
  - Optional threshold overrides: `maxUnsupportedParentRate`, `maxPrerequisiteViolationRate`, `maxPolicyViolationRate`, `maxTermJumpRate`, `maxComplexitySpreadMean`, `minEvidenceCoverageMean`, `minVocabularyContinuityMean`, `minRepartitionEventRate`, `maxRepartitionEventRate`, `maxRepartitionMaxRound`.
- Query deterministic cache reuse diagnostics with `/api/proofs/cache-report` (`status`, `cacheKey`, `sourceFingerprint`, `snapshotHash`, `cacheEntryHash`) plus optional `blockedSubtreePlan` for topology-recovery auditing (`cache_topology_recovery_hit`, `cache_blocked_subtree_rebuild_hit`, `cache_topology_removal_subtree_rebuild_hit`, `cache_topology_addition_subtree_regeneration_rebuild_hit`, `cache_topology_mixed_subtree_regeneration_rebuild_hit`, `cache_topology_regeneration_rebuild_hit`, `cache_blocked_subtree_full_rebuild`). Topology-removal hits include machine-checkable subtree recovery counters and `recoveryHash`; addition-only shape hits include `addedLeafCount` plus regeneration telemetry and `additionRecoveryHash`; mixed-shape hits include removal + regeneration telemetry and `mixedRecoveryHash`; topology-regeneration hits include reuse-mode counters and `regenerationHash`.
- Run deterministic cache benchmark evidence generation with `npm run benchmark:cache` (writes `docs/benchmarks/proof-cache-benchmark.json` from repo root).
- Use shared config parser (`lib/config-input.ts`) across query routes to keep config semantics consistent.
- Use shared config parser (`lib/config-input.ts`) across both query and POST routes (`/api/proofs/view`, `/api/proofs/diff`) so regeneration and tree-shape semantics do not drift.
- Query/config contracts now expose the full pedagogy controls used by tree generation:
  - `abstractionLevel`, `complexityLevel`, `maxChildrenPerParent`
  - `audienceLevel`, `language`, `readingLevelTarget`
  - `complexityBandWidth`, `termIntroductionBudget`, `proofDetailMode`, `entailmentMode`
- Proof Explorer controls expose an explicit `entailmentMode` selector (`calibrated` vs `strict`) and propagate it through root/tree/policy queries.
- Large trees use deterministic render-window planning to bound DOM row count while preserving root-first ordering.
  - Window diagnostics are surfaced as `data-tree-*` attributes on the tree panel (`mode`, `total`, `rendered`, `hiddenAbove`, `hiddenBelow`).
  - Paging controls (`Show previous rows` / `Show next rows`) shift the window deterministically without mutating proof data.
  - For very large trees, deterministic DOM virtualization is enabled with fixed row height + spacer rows:
    - `data-tree-render-mode="virtualized"`
    - `data-tree-virtual-start-index` / `data-tree-virtual-end-index`
  - Keyboard navigation is deterministic and window-aware:
    - `ArrowUp/ArrowDown`, `Home/End`, and `PageUp/PageDown` move the active tree row.
    - `ArrowRight` expands a collapsed parent, or moves to its first visible child when already expanded.
    - `ArrowLeft` collapses an expanded parent, or moves focus to its parent row.
    - `Enter` / `Space` activate the row action (expand/collapse parent or select leaf).
  - Active-row diagnostics remain machine-checkable via `data-tree-active-node-id` and `data-tree-active-row-index`.
  - Screen-reader activity announcements are deterministic and queryable via `data-tree-live-message`.
- Config profile persistence/query is deterministic and file-backed:
  - per-project/user profile scope
  - canonical storage keys via `buildProfileStorageKey(...)`
  - response hashes: `requestHash`, `ledgerHash`
  - persisted profile `configHash` for auditability
- Proof switching is supported through `/proofs?proofId=<id>` with validation against supported IDs.

## Verification integration
- Leaf panel can trigger server-side verification and render status/log diagnostics.
- Verification history is persisted to `.explain-md/web-verification-ledger.json`.
- Lean fixture proof datasets are persisted to `.explain-md/web-proof-cache` (override with `EXPLAIN_MD_WEB_PROOF_CACHE_DIR`).
- Lean fixture project root can be overridden with `EXPLAIN_MD_LEAN_FIXTURE_PROJECT_ROOT` (used by benchmark/invalidation harness).
- Config profiles are persisted to `.explain-md/web-config-profiles.json` (override with `EXPLAIN_MD_WEB_CONFIG_PROFILE_LEDGER`).
- Tree render window thresholds can be configured with:
  - `NEXT_PUBLIC_EXPLAIN_MD_TREE_RENDER_MAX_ROWS` (default `120`)
  - `NEXT_PUBLIC_EXPLAIN_MD_TREE_RENDER_OVERSCAN_ROWS` (default `24`)
- Tree virtualization thresholds can be configured with:
  - `NEXT_PUBLIC_EXPLAIN_MD_TREE_VIRTUALIZATION_ENABLED` (default `true`)
  - `NEXT_PUBLIC_EXPLAIN_MD_TREE_VIRTUALIZATION_MIN_ROWS` (default `400`)
  - `NEXT_PUBLIC_EXPLAIN_MD_TREE_ROW_HEIGHT_PX` (default `36`)
  - `NEXT_PUBLIC_EXPLAIN_MD_TREE_VIEWPORT_ROWS` (default `18`)
  - `NEXT_PUBLIC_EXPLAIN_MD_TREE_VIRTUALIZATION_OVERSCAN_ROWS` (default `6`)
- Job IDs are deterministic and monotonic (`job-000001`, `job-000002`, ...).
- Reproducibility contract values can be configured with:
  - `EXPLAIN_MD_VERIFICATION_PROJECT_ROOT`
  - `EXPLAIN_MD_SOURCE_REVISION`
  - `EXPLAIN_MD_VERIFICATION_LEAN_VERSION`
  - `EXPLAIN_MD_VERIFICATION_LAKE_VERSION`
  - `EXPLAIN_MD_VERIFICATION_TIMEOUT_MS`

## Local commands
```bash
npm install
npm run dev
npm run typecheck
npm run test
npm run build
```
