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
  - Optional threshold overrides: `maxUnsupportedParentRate`, `maxPrerequisiteViolationRate`, `maxPolicyViolationRate`, `maxTermJumpRate`, `maxComplexitySpreadMean`, `minEvidenceCoverageMean`, `minVocabularyContinuityMean`.
- Query deterministic cache reuse diagnostics with `/api/proofs/cache-report` (`status`, `cacheKey`, `sourceFingerprint`, `snapshotHash`, `cacheEntryHash`, plus theorem-delta-aware `cache_semantic_hit`/`cache_incremental_rebuild` codes).
- Run deterministic cache benchmark evidence generation with `npm run benchmark:cache` (writes `docs/benchmarks/proof-cache-benchmark.json` from repo root).
- Use shared config parser (`lib/config-input.ts`) across query routes to keep config semantics consistent.
- Use shared config parser (`lib/config-input.ts`) across both query and POST routes (`/api/proofs/view`, `/api/proofs/diff`) so regeneration and tree-shape semantics do not drift.
- Query/config contracts now expose the full pedagogy controls used by tree generation:
  - `abstractionLevel`, `complexityLevel`, `maxChildrenPerParent`
  - `audienceLevel`, `language`, `readingLevelTarget`
  - `complexityBandWidth`, `termIntroductionBudget`, `proofDetailMode`
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
