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
  - `GET /api/observability/verification-metrics`
  - `GET /api/observability/proof-query-metrics`
  - `GET /api/observability/ui-interaction-metrics`
  - `GET /api/observability/ui-interaction-ledger`
  - `POST /api/observability/ui-interactions`
  - `GET /api/observability/slo-report`
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
  - Diff panel rendering is deterministic and auditable:
    - canonical change ordering by `key/type/kind`
    - sorted `supportLeafIds`
    - highlighted before/after deltas for `changed` statements
    - machine-checkable truncation counters via `data-diff-*` attributes
- Query dependency reachability/SCC evidence deterministically with `/api/proofs/dependency-graph`.
- Surface per-parent policy diagnostics (pre/post compliance + metrics) directly in tree rows.
- Core proof query responses now include deterministic `observability` metadata:
  - `requestId` (equal to canonical `requestHash`)
  - `query` (`view | diff | leaf-detail | root | children | path | dependency-graph | policy-report | cache-report`)
  - `traceId` and fixed span set (`dataset_load`, `query_compute`, `response_materialization`)
  - dashboard-ready metrics (`latencyMs`, `cacheLayer`, `cacheStatus`, `leafCount`, `parentCount`, `nodeCount`, `maxDepth`)
- Core proof-query dashboard export endpoint:
  - `GET /api/observability/proof-query-metrics`
  - deterministic rolling-window aggregates (`requestCount`, unique request/trace counts, cache hit rate, global+per-query latency histograms with fixed buckets `<=5ms`, `<=10ms`, `<=25ms`, `<=50ms`, `>50ms`, per-query latency stats + mean tree sizes) + `snapshotHash`
- UI interaction observability endpoint contracts:
  - `POST /api/observability/ui-interactions`
    - accepted `interaction` values: `config_update`, `tree_expand_toggle`, `tree_load_more`, `tree_select_leaf`, `tree_keyboard`, `verification_run`, `verification_job_select`, `profile_save`, `profile_delete`, `profile_apply`
    - emits deterministic `requestId` and `traceId`
    - keyboard navigation/activation emits `tree_keyboard`; direct tree actions (`tree_expand_toggle`, `tree_select_leaf`) emit only on non-keyboard sources to prevent duplicate request counting and source drift
  - `GET /api/observability/ui-interaction-metrics`
    - deterministic rolling-window aggregates (`requestCount`, `successCount`, `failureCount`, `keyboardActionCount`, `keyboardActionRate`, `uniqueTraceCount`, parent-trace rate, per-interaction `meanDurationMs`/`p95DurationMs`) + `snapshotHash`
  - `GET /api/observability/ui-interaction-ledger`
    - deterministic durable retention snapshot for UI traces (`persistedEventCount`, `rollingWindowRequestCount`, `droppedFromRollingWindowCount`, `appendFailureCount`, `latestRequestId`, retention mode/path hash) + `snapshotHash`
- Observability SLO/alert report endpoint:
  - `GET /api/observability/slo-report`
  - deterministic policy report across proof-query + verification + UI-interaction snapshots with threshold pass/fail diagnostics and `snapshotHash`
  - optional threshold overrides via query params:
    - `minProofRequestCount`
    - `minVerificationRequestCount`
    - `minProofCacheHitRate`
    - `minProofUniqueTraceRate`
    - `maxProofP95LatencyMs`
    - `maxProofMeanLatencyMs`
    - `maxVerificationFailureRate`
    - `maxVerificationP95LatencyMs`
    - `maxVerificationMeanLatencyMs`
    - `minVerificationParentTraceRate`
    - `minUiInteractionRequestCount`
    - `minUiInteractionSuccessRate`
    - `minUiInteractionKeyboardActionRate`
    - `minUiInteractionParentTraceRate`
    - `maxUiInteractionP95DurationMs`
- Query deterministic pedagogy calibration metrics + threshold gates with `/api/proofs/policy-report`.
  - Optional threshold overrides: `maxUnsupportedParentRate`, `maxPrerequisiteViolationRate`, `maxPolicyViolationRate`, `maxTermJumpRate`, `maxComplexitySpreadMean`, `minEvidenceCoverageMean`, `minVocabularyContinuityMean`, `minRepartitionEventRate`, `maxRepartitionEventRate`, `maxRepartitionMaxRound`.
- Query deterministic cache reuse diagnostics with `/api/proofs/cache-report` (`status`, `cacheKey`, `sourceFingerprint`, `snapshotHash`, `cacheEntryHash`) plus optional `blockedSubtreePlan` for topology-recovery auditing (`cache_topology_recovery_hit`, `cache_blocked_subtree_rebuild_hit`, `cache_topology_removal_subtree_rebuild_hit`, `cache_topology_addition_subtree_insertion_rebuild_hit`, `cache_topology_addition_subtree_regeneration_rebuild_hit`, `cache_topology_mixed_subtree_regeneration_rebuild_hit`, `cache_topology_regeneration_rebuild_hit`, `cache_blocked_subtree_full_rebuild`). Topology-removal hits include machine-checkable subtree recovery counters and `recoveryHash`; addition-only shape hits include `recoveryMode`, `addedLeafCount`, `insertedParentCount`, and `additionRecoveryHash`; mixed-shape hits include removal + regeneration telemetry and `mixedRecoveryHash`; topology-regeneration hits include reuse-mode counters and `regenerationHash`.
- Run deterministic cache benchmark evidence generation with `npm run benchmark:cache` (writes `docs/benchmarks/proof-cache-benchmark.json` from repo root).
- Run deterministic assistive-tech interaction benchmark evidence with `npm run benchmark:tree-a11y` (writes `docs/benchmarks/tree-a11y-evaluation.json` from repo root).
- CI enforces assistive-tech benchmark determinism with `npm run benchmark:tree-a11y:ci` (compares against `docs/benchmarks/tree-a11y-evaluation.json` and writes `.explain-md/tree-a11y-evaluation-report.json`).
- Run deterministic large-tree rendering benchmark evidence with `npm run benchmark:tree-scale` (writes `docs/benchmarks/tree-scale-evaluation.json` from repo root).
- CI enforces large-tree rendering benchmark determinism with `npm run benchmark:tree-scale:ci` (compares against `docs/benchmarks/tree-scale-evaluation.json` and writes `.explain-md/tree-scale-evaluation-report.json`).
- Run deterministic explanation-diff benchmark evidence with `npm run benchmark:explanation-diff` (writes `docs/benchmarks/explanation-diff-evaluation.json` from repo root).
- CI enforces explanation-diff benchmark determinism with `npm run benchmark:explanation-diff:ci` (compares against `docs/benchmarks/explanation-diff-evaluation.json` and writes `.explain-md/explanation-diff-evaluation-report.json`).
- Run deterministic verification replay artifact benchmark evidence with `npm run benchmark:verification-replay` (writes `docs/benchmarks/verification-replay-evaluation.json` from repo root).
- CI enforces verification replay benchmark determinism with `npm run benchmark:verification-replay:ci` (compares against `docs/benchmarks/verification-replay-evaluation.json` and writes `.explain-md/verification-replay-evaluation-report.json`).
- Run deterministic multilingual rendering benchmark evidence with `npm run benchmark:multilingual` (writes `docs/benchmarks/multilingual-evaluation.json` from repo root).
- CI enforces multilingual rendering benchmark determinism with `npm run benchmark:multilingual:ci` (compares against `docs/benchmarks/multilingual-evaluation.json` and writes `.explain-md/multilingual-evaluation-report.json`).
- Run deterministic observability SLO benchmark evidence with `npm run benchmark:observability-slo` (writes `docs/benchmarks/observability-slo-benchmark.json` from repo root).
  - Default benchmark profiles are deterministic and include both datasets:
    - `seed-verity`
    - `lean-verity-fixture`
  - Artifact includes aggregate hashes plus per-profile evidence in `parameters.profiles`, `profileReports`, and `evaluation.byProfile`.
- CI enforces observability SLO benchmark determinism with `npm run web:eval:observability-slo:ci` (compares against `docs/benchmarks/observability-slo-benchmark.json` and writes `.explain-md/observability-slo-benchmark-report.json`).
- Root CI release gate composes quality + web + summary-security benchmark evidence with `npm run eval:release-gate:ci` (writes `.explain-md/release-gate-report.json`).
- Use shared config parser (`lib/config-input.ts`) across query routes to keep config semantics consistent.
- Use shared config parser (`lib/config-input.ts`) across both query and POST routes (`/api/proofs/view`, `/api/proofs/diff`) so regeneration and tree-shape semantics do not drift.
- Query/config contracts now expose the full pedagogy controls used by tree generation:
  - `abstractionLevel`, `complexityLevel`, `maxChildrenPerParent`
  - `audienceLevel`, `language`, `readingLevelTarget`
  - `complexityBandWidth`, `termIntroductionBudget`, `proofDetailMode`, `entailmentMode`
- Language resolution is deterministic across API + UI:
  - supported explanation languages: `en`, `fr`
  - locale variants fallback by base tag (`fr-ca` -> `fr`)
  - unsupported tags fallback to `en`
- Proof Explorer language control is an explicit toggle (`English`, `French`) mapped to the same route-level config contract.
- Proof Explorer controls expose an explicit `entailmentMode` selector (`calibrated` vs `strict`) and propagate it through root/tree/policy queries.
  - Strict mode semantics are fail-closed and deterministic:
    - parent `evidenceRefs` must cover all grouped children
    - `newTermsIntroduced` must be empty even if `termIntroductionBudget > 0`
    - unsupported-term checks include both parent statement and entailment rationale
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
  - Row semantics are screen-reader deterministic:
    - each `treeitem` includes `aria-level`, `aria-posinset`, and `aria-setsize`
    - loaded child order and total-child counts are used to keep sibling position metadata stable
    - active-row state is exposed with `aria-current="true"` while selected leaves remain `aria-selected`
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
- Verification routes now emit deterministic observability blocks:
  - `requestId`, `traceId`, `query`, optional `parentTraceId`
  - fixed spans: `request_parse`, `workflow_execute`, `response_materialization`
  - explicit latency and queue/status metrics (`latencyMs`, `queueDepth`, status counters)
- Verification responses now include deterministic replay artifacts per job:
  - `jobHash` (full job canonical hash)
  - `reproducibilityHash` (hash over reproducibility contract only)
  - `replayCommand` (`cd <workingDirectory> && ...`) for browser-visible command replay
- Proof Explorer leaf panel now exports deterministic replay artifacts as JSON:
  - filename contract: `verification-replay-<proof>-<leaf>-<job>-<hash12>.json`
  - payload includes `requestHash`, canonicalized job fields, sorted reproducibility `env`, sorted logs, `jobHash`, `reproducibilityHash`, and `replayCommand`
  - payload also includes tree/leaf query provenance hashes when available:
    - `treeConfigHash`, `treeSnapshotHash`
    - `leafDetailRequestHash`, `leafDetailConfigHash`, `leafDetailHash`
    - `nodePathRequestHash`, `nodePathSnapshotHash`
- Verification routes support trace correlation through `parentTraceId`:
  - `POST /api/proofs/leaves/:leafId/verify` request body
  - `GET /api/proofs/leaves/:leafId/verification-jobs?parentTraceId=<trace>`
  - `GET /api/verification/jobs/:jobId?parentTraceId=<trace>`
- Dashboard export endpoint:
  - `GET /api/observability/verification-metrics`
  - deterministic rolling-window aggregates (`requestCount`, `failureCount`, p95 latency by query) + `snapshotHash`
- Lean fixture proof datasets are persisted to `.explain-md/web-proof-cache` (override with `EXPLAIN_MD_WEB_PROOF_CACHE_DIR`).
- Lean fixture project root can be overridden with `EXPLAIN_MD_LEAN_FIXTURE_PROJECT_ROOT` (used by benchmark/invalidation harness).
- Config profiles are persisted to `.explain-md/web-config-profiles.json` (override with `EXPLAIN_MD_WEB_CONFIG_PROFILE_LEDGER`).
- UI interaction observability ledger defaults to `.explain-md/web-ui-interaction-ledger.ndjson` and can be overridden with `EXPLAIN_MD_UI_INTERACTION_LEDGER_PATH` (test environment defaults to disabled unless set).
- Optional deterministic retention compaction policies:
  - `EXPLAIN_MD_UI_INTERACTION_LEDGER_MAX_EVENTS` keeps only the latest persisted N ledger entries.
  - `EXPLAIN_MD_UI_INTERACTION_LEDGER_TTL_SECONDS` prunes persisted entries older than the configured age.
  - ledger export includes machine-checkable compaction diagnostics: `policy`, `runCount`, `rewriteCount`, `prunedEventCount`, `invalidLineDropCount`, `lastCompactionHash`.
- Tree render window thresholds can be configured with:
  - `NEXT_PUBLIC_EXPLAIN_MD_TREE_RENDER_MAX_ROWS` (default `120`)
  - `NEXT_PUBLIC_EXPLAIN_MD_TREE_RENDER_OVERSCAN_ROWS` (default `24`)
- Tree virtualization thresholds can be configured with:
  - `NEXT_PUBLIC_EXPLAIN_MD_TREE_VIRTUALIZATION_ENABLED` (default `true`)
  - `NEXT_PUBLIC_EXPLAIN_MD_TREE_VIRTUALIZATION_MIN_ROWS` (default `400`)
  - `NEXT_PUBLIC_EXPLAIN_MD_TREE_ROW_HEIGHT_PX` (default `36`)
  - `NEXT_PUBLIC_EXPLAIN_MD_TREE_VIEWPORT_ROWS` (default `18`)
  - `NEXT_PUBLIC_EXPLAIN_MD_TREE_VIRTUALIZATION_OVERSCAN_ROWS` (default `6`)
- Diff panel truncation threshold can be configured with:
  - `NEXT_PUBLIC_EXPLAIN_MD_DIFF_MAX_CHANGES` (default `24`, clamped to `1..200`)
- Tree accessibility benchmark uses a fixed deterministic fixture and key sequence, and records:
  - per-step keyboard intent (`set-active-index`/`expand`/`collapse`/`noop`)
  - active-row ARIA metadata (`aria-activedescendant`, `aria-level`, `aria-posinset`, `aria-setsize`)
  - render-mode diagnostics (`full`/`windowed`/`virtualized`) with hidden row counts
  - canonical `requestHash` and `outcomeHash` for reproducible CI evidence
- Tree scale benchmark replays deterministic active-row sequences across three fixed profiles (`full-small-tree`, `windowed-medium-tree`, `virtualized-large-tree`) and records:
  - effective render mode (`full`/`windowed`/`virtualized`) per sample
  - rendered/hidden row counts and virtual-scroll bounds
  - bounded-row-count pass/fail evidence for each sample
  - canonical `requestHash` and `outcomeHash` for reproducible CI evidence
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

`npm run typecheck` uses `tsconfig.typecheck.json` so checks remain deterministic without requiring generated `.next/types` artifacts.
