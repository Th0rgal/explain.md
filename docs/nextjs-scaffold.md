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
- Verification state is persisted in a canonical ledger at `.explain-md/web-verification-ledger.json`.
- Leaf detail uses persisted verification jobs from the ledger, so panel metadata is queryable and stable across reloads.
- Verification requests emit deterministic hashes (`requestHash`, `queuedJobHash`, `finalJobHash`) and deterministic sequential job IDs (`job-000001`, ...).

## Determinism and provenance
- Two deterministic datasets are exposed through one contract:
  - `seed-verity` (seed tree)
  - `lean-verity-fixture` (built from `tests/fixtures/lean-project/Verity/*.lean` through `ingestLeanSources -> mapLeanIngestionToTheoremLeaves -> buildRecursiveExplanationTree`)
- Responses include stable hashes:
  - `configHash`
  - `requestHash`
  - `viewHash` / `diffHash` / `detailHash`
- Leaf detail panel is backed by provenance path plus persisted verification history.
- Node/root/path query routes use canonical tree-storage snapshots, enabling stable root/children/ancestry reads for progressive expansion UIs.
- Dependency graph route exposes deterministic SCC/reachability data and per-declaration support closures for browser-side provenance checks.
- Parent nodes include policy diagnostics in tree query payloads so browser views can audit complexity/prerequisite/term-budget compliance.
- Policy report route exposes deterministic quality metrics/threshold outcomes using the evaluation harness, with optional threshold overrides for pedagogy calibration.
- Cache report route exposes deterministic cache-reuse diagnostics (`status`, `cacheKey`, `sourceFingerprint`, `snapshotHash`, `cacheEntryHash`) and theorem-delta-aware outcomes (`cache_semantic_hit`, `cache_incremental_subtree_rebuild`, `cache_incremental_topology_rebuild`, `cache_incremental_rebuild`) with auditable topology reuse counters (stable-id reuse, same-depth child-hash reuse, same-depth child-statement-hash reuse, and ambiguity-skip counters) for reproducible incremental recompute auditing.
- Shared config parsing is centralized in `apps/web/lib/config-input.ts` for route consistency across both query and POST contracts.
- Shared config query parsing now covers the full pedagogy knob surface used by generation and hashing:
  - `abstractionLevel`, `complexityLevel`, `maxChildrenPerParent`
  - `audienceLevel`, `language`, `readingLevelTarget`
  - `complexityBandWidth`, `termIntroductionBudget`, `proofDetailMode`
- Config profiles are persisted/queryable through deterministic API contracts with canonical storage keys, profile `configHash`, and response-level `requestHash` + `ledgerHash`.
- Lean fixture datasets are persisted under `.explain-md/web-proof-cache` (override with `EXPLAIN_MD_WEB_PROOF_CACHE_DIR`) and invalidated by source fingerprint + config hash.
- Lean fixture root lookup can be overridden with `EXPLAIN_MD_LEAN_FIXTURE_PROJECT_ROOT` for deterministic benchmark/invalidation runs against temporary fixture copies.
- Deterministic benchmark artifact generation is available via `npm run web:bench:cache` (writes `docs/benchmarks/proof-cache-benchmark.json`).
- The Lean fixture uses a deterministic summary provider (`temperature=0` behavior with fixed evidence-only synthesis), so parent statements remain child-entailed and reproducible.
- Reproducibility contract for each queued job is derived from the selected theorem leaf:
  - source revision (`EXPLAIN_MD_SOURCE_REVISION` or Vercel commit SHA fallback)
  - Lean command contract (`lake env lean <file>`)
  - working directory (`EXPLAIN_MD_VERIFICATION_PROJECT_ROOT` fallback: repository root)
  - toolchain tags (`EXPLAIN_MD_VERIFICATION_LEAN_VERSION`, optional `EXPLAIN_MD_VERIFICATION_LAKE_VERSION`)

## State management
- Baseline strategy: local React state (`useState`) with deterministic API payloads.
- Proof explorer tree state is incremental and query-driven:
  - root snapshot from `GET /api/proofs/root`
  - per-parent child pages from `GET /api/proofs/nodes/:nodeId/children`
  - ancestry expansion from `GET /api/proofs/nodes/:nodeId/path`
- Sibling complexity remains bounded by `maxChildrenPerParent` during child-page fetches.
- This keeps behavior auditable while issue #15 iterates on richer interaction patterns.

## Local verification
From repository root:

```bash
npm run web:lint
npm run web:typecheck
npm run web:test
npm run web:build
```

From `apps/web` directly:

```bash
npm run dev
```
