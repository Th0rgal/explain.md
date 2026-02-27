# Next.js web scaffold

## Goal
Provide a deterministic frontend baseline for explain.md so issue #15 can focus on interaction quality instead of infrastructure setup.

## Implemented in issue #14
- Next.js `App Router` project under `apps/web`.
- Seeded proof API surface that wraps existing provenance contracts:
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
- `lib/proof-service.ts` for deterministic projection/diff/leaf-detail adapters with canonical request hashes.
- `lib/api-client.ts` for typed client-side fetch wrappers.
- Shell UI with baseline navigation, controls, loading state, and error boundary.

## Implemented in issue #17 (web integration slice)
- Browser-triggered verification actions are wired in the proof explorer leaf panel.
- New verification routes exposed by the Next.js app:
  - `POST /api/proofs/leaves/:leafId/verify`
  - `GET /api/proofs/leaves/:leafId/verification-jobs`
  - `GET /api/verification/jobs/:jobId`
  - `GET /api/observability/verification-metrics`
  - `GET /api/observability/proof-query-metrics`
  - `GET /api/observability/slo-report`
- Verification state is persisted in a canonical ledger at `.explain-md/web-verification-ledger.json`.
- Leaf detail uses persisted verification jobs from the ledger, so panel metadata is queryable and stable across reloads.
- Verification requests emit deterministic hashes (`requestHash`, `queuedJobHash`, `finalJobHash`) and deterministic sequential job IDs (`job-000001`, ...).
- Verification responses now include deterministic observability metadata with optional parent-trace correlation:
  - request identity: `requestId` (`requestHash`) + `traceId`
  - query identity: `verify_leaf | list_leaf_jobs | get_job`
  - optional `parentTraceId` propagated from UI requests
  - fixed span set: `request_parse`, `workflow_execute`, `response_materialization`
  - metrics: `latencyMs`, queue depth, status counters, returned job count
- Dashboard export contract:
  - `GET /api/observability/verification-metrics`
  - rolling-window aggregates with `requestCount`, `failureCount`, per-query `meanLatencyMs`/`p95LatencyMs`, and canonical `snapshotHash`
- Observability SLO report contract:
  - `GET /api/observability/slo-report`
  - combines proof-query and verification snapshots into deterministic threshold evaluation (`thresholdPass`, `thresholdFailures`, `snapshotHash`)
  - supports threshold override query params: `minProofRequestCount`, `minVerificationRequestCount`, `minProofCacheHitRate`, `minProofUniqueTraceRate`, `maxVerificationFailureRate`, `maxVerificationP95LatencyMs`, `maxVerificationMeanLatencyMs`, `minVerificationParentTraceRate`

## Determinism and provenance
- Two deterministic datasets are exposed through one contract:
  - `seed-verity` (seed tree)
  - `lean-verity-fixture` (built from `tests/fixtures/lean-project/Verity/*.lean` through `ingestLeanSources -> mapLeanIngestionToTheoremLeaves -> buildRecursiveExplanationTree`)
- Responses include stable hashes:
  - `configHash`
  - `requestHash`
  - `viewHash` / `diffHash` / `detailHash`
- Core proof query responses also include deterministic observability blocks for tracing and dashboards:
  - `requestId` (`requestHash`)
  - `query` (`view | diff | leaf-detail | root | children | path | dependency-graph | policy-report | cache-report`)
  - `traceId`
  - fixed span set: `dataset_load`, `query_compute`, `response_materialization`
  - metrics: `cacheLayer`, `cacheStatus`, `leafCount`, `parentCount`, `nodeCount`, `maxDepth`
- Core proof-query observability now has a deterministic aggregate export contract:
  - `GET /api/observability/proof-query-metrics`
  - rolling-window request/correlation/cache aggregates with per-query mean tree sizes and canonical `snapshotHash`
- Leaf detail panel is backed by provenance path plus persisted verification history.
- Node/root/path query routes use canonical tree-storage snapshots, enabling stable root/children/ancestry reads for progressive expansion UIs.
- Dependency graph route exposes deterministic SCC/reachability data and per-declaration support closures for browser-side provenance checks.
- Parent nodes include policy diagnostics in tree query payloads so browser views can audit complexity/prerequisite/term-budget compliance.
- Policy report route exposes deterministic quality metrics/threshold outcomes using the evaluation harness, with optional threshold overrides for pedagogy calibration.
- Cache report route exposes deterministic cache-reuse diagnostics (`status`, `cacheKey`, `sourceFingerprint`, `snapshotHash`, `cacheEntryHash`) and optional `blockedSubtreePlan` evidence for reproducible incremental recompute auditing (`cache_topology_recovery_hit`, `cache_blocked_subtree_rebuild_hit`, `cache_topology_removal_subtree_rebuild_hit`, `cache_topology_addition_subtree_insertion_rebuild_hit`, `cache_topology_addition_subtree_regeneration_rebuild_hit`, `cache_topology_mixed_subtree_regeneration_rebuild_hit`, `cache_topology_regeneration_rebuild_hit`, `cache_blocked_subtree_full_rebuild`). Topology-removal hits include machine-checkable subtree recovery counters and `recoveryHash`; addition-only shape hits include `recoveryMode`, `addedLeafCount`, `insertionFrontierCount`, `insertionAnchorCount`, `insertedParentCount`, and `additionRecoveryHash`; mixed-shape hits include removal + regeneration telemetry and `mixedRecoveryHash`; topology-regeneration hits include reuse-mode counters and `regenerationHash`.
- Shared config parsing is centralized in `apps/web/lib/config-input.ts` for route consistency across both query and POST contracts.
- Shared config query parsing now covers the full pedagogy knob surface used by generation and hashing:
  - `abstractionLevel`, `complexityLevel`, `maxChildrenPerParent`
  - `audienceLevel`, `language`, `readingLevelTarget`
  - `complexityBandWidth`, `termIntroductionBudget`, `proofDetailMode`, `entailmentMode`
- Language handling is deterministic in route parsing + config normalization:
  - supported: `en`, `fr`
  - locale-variant fallback by base tag (`fr-ca` -> `fr`)
  - unsupported fallback to `en`
- Proof Explorer control panel exposes `entailmentMode` directly so strict lexical-entailment runs can be triggered and audited from browser routes.
- Config profiles are persisted/queryable through deterministic API contracts with canonical storage keys, profile `configHash`, and response-level `requestHash` + `ledgerHash`.
- Lean fixture datasets are persisted under `.explain-md/web-proof-cache` (override with `EXPLAIN_MD_WEB_PROOF_CACHE_DIR`) and invalidated by source fingerprint + config hash.
- Lean fixture root lookup can be overridden with `EXPLAIN_MD_LEAN_FIXTURE_PROJECT_ROOT` for deterministic benchmark/invalidation runs against temporary fixture copies.
- Deterministic benchmark artifact generation is available via `npm run web:bench:cache` (writes `docs/benchmarks/proof-cache-benchmark.json`).
- Deterministic assistive-tech interaction benchmark is available via `npm run web:bench:tree-a11y` (writes `docs/benchmarks/tree-a11y-evaluation.json`).
- Deterministic observability SLO benchmark is available via `npm run web:bench:observability-slo` (writes `docs/benchmarks/observability-slo-benchmark.json`).
- CI enforces observability SLO benchmark reproducibility via `npm run web:eval:observability-slo:ci` (baseline-compares request/outcome hashes and emits `.explain-md/observability-slo-benchmark-report.json`).
- Root release gate composes quality baseline and web benchmark evidence via `npm run eval:release-gate:ci` (emits `.explain-md/release-gate-report.json`).
- The Lean fixture uses a deterministic summary provider (`temperature=0` behavior with fixed evidence-only synthesis), so parent statements remain child-entailed and reproducible.
- Reproducibility contract for each queued job is derived from the selected theorem leaf:
  - source revision (`EXPLAIN_MD_SOURCE_REVISION` or Vercel commit SHA fallback)
  - Lean command contract (`lake env lean <file>`)
  - working directory (`EXPLAIN_MD_VERIFICATION_PROJECT_ROOT` fallback: repository root)
  - toolchain tags (`EXPLAIN_MD_VERIFICATION_LEAN_VERSION`, optional `EXPLAIN_MD_VERIFICATION_LAKE_VERSION`)
- Verification job payloads also include deterministic replay artifacts for browser auditability:
  - `jobHash` (full canonical job hash, includes lifecycle/result fields)
  - `reproducibilityHash` (canonical reproducibility-contract hash)
  - `replayCommand` (deterministic shell command string for local replay)

## State management
- Baseline strategy: local React state (`useState`) with deterministic API payloads.
- Proof explorer tree state is incremental and query-driven:
  - root snapshot from `GET /api/proofs/root`
  - per-parent child pages from `GET /api/proofs/nodes/:nodeId/children`
  - ancestry expansion from `GET /api/proofs/nodes/:nodeId/path`
- Large-tree rendering is deterministically windowed in-browser:
  - planner inputs: `totalRowCount`, `anchorRowIndex`, `maxVisibleRows`, `overscanRows`
  - planner outputs: `mode`, `startIndex/endIndex`, `renderedRowCount`, `hiddenAboveCount`, `hiddenBelowCount`
  - tree panel exposes machine-checkable diagnostics via `data-tree-*` attributes
  - for very large trees, deterministic virtualization mode is enabled with fixed row height and spacer rows:
    - mode: `data-tree-render-mode="virtualized"`
    - indices: `data-tree-virtual-start-index`, `data-tree-virtual-end-index`
  - keyboard navigation keeps deterministic tree semantics:
    - `ArrowUp/ArrowDown`, `Home/End`, `PageUp/PageDown` move active row
    - `ArrowRight` expands collapsed parents or enters first visible child
    - `ArrowLeft` collapses expanded parents or moves to ancestor row
  - tree rows expose deterministic accessibility metadata:
    - `aria-level`, `aria-posinset`, `aria-setsize` on each rendered tree item
    - position metadata is derived from stable loaded-child ordering + total child counts
    - `aria-current="true"` identifies keyboard-active row while `aria-selected` is reserved for selected leaves
  - active-row diagnostics remain machine-checkable (`data-tree-active-node-id`, `data-tree-active-row-index`)
  - assistive-tech announcements are deterministic and surfaced on the tree panel as `data-tree-live-message`
  - `Enter` / `Space` applies the active row action (parent expand/collapse, leaf selection)
  - evaluation harness now emits a deterministic multi-step keyboard transcript with ARIA snapshots and render-mode diagnostics:
    - hashes: `requestHash`, `outcomeHash`
    - step contract: `intentKind`, `activeNodeId`, `ariaActivedescendant`, `ariaLevel`, `ariaPosInSet`, `ariaSetSize`, `renderMode`
- Explanation diff panel rendering is deterministic and provenance-auditable:
  - canonical ordering by `key`, then `type`, then `kind`
  - sorted per-change `supportLeafIds`
  - highlighted before/after statement deltas for `changed` entries
  - machine-checkable truncation diagnostics (`data-diff-total-changes`, `data-diff-rendered-changes`, `data-diff-truncated-changes`)
- Sibling complexity remains bounded by `maxChildrenPerParent` during child-page fetches.
- This keeps behavior auditable while issue #15 iterates on richer interaction patterns.

Public env knobs for deterministic window bounds:
- `NEXT_PUBLIC_EXPLAIN_MD_TREE_RENDER_MAX_ROWS` (default `120`)
- `NEXT_PUBLIC_EXPLAIN_MD_TREE_RENDER_OVERSCAN_ROWS` (default `24`)

Public env knobs for deterministic virtualization bounds:
- `NEXT_PUBLIC_EXPLAIN_MD_TREE_VIRTUALIZATION_ENABLED` (default `true`)
- `NEXT_PUBLIC_EXPLAIN_MD_TREE_VIRTUALIZATION_MIN_ROWS` (default `400`)
- `NEXT_PUBLIC_EXPLAIN_MD_TREE_ROW_HEIGHT_PX` (default `36`)
- `NEXT_PUBLIC_EXPLAIN_MD_TREE_VIEWPORT_ROWS` (default `18`)
- `NEXT_PUBLIC_EXPLAIN_MD_TREE_VIRTUALIZATION_OVERSCAN_ROWS` (default `6`)

Public env knob for deterministic diff rendering bounds:
- `NEXT_PUBLIC_EXPLAIN_MD_DIFF_MAX_CHANGES` (default `24`, clamped to `1..200`)

## Local verification
From repository root:

```bash
npm run web:lint
npm run web:typecheck
npm run web:test
npm run web:build
```

`web:typecheck` runs `tsc` against `apps/web/tsconfig.typecheck.json` so it is deterministic from a clean checkout and does not depend on pre-generated `.next/types` files.

From `apps/web` directly:

```bash
npm run dev
```
