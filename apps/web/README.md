# Web App Scaffold (Issue #14)

This Next.js app provides a deterministic frontend scaffold for explain.md.

## Scope
- App Router shell with seeded proof explorer entrypoint.
- API routes backed by core provenance contracts:
  - `GET /api/proofs/seed`
  - `POST /api/proofs/view`
  - `POST /api/proofs/diff`
  - `GET /api/proofs/leaves/:leafId`
  - `POST /api/proofs/leaves/:leafId/verify`
  - `GET /api/proofs/leaves/:leafId/verification-jobs`
  - `GET /api/verification/jobs/:jobId`
- Client API layer in `lib/api-client.ts`.
- Loading and error boundaries (`app/loading.tsx`, `app/error.tsx`).

## State Management
This scaffold uses local React state + deterministic API payloads as the baseline state strategy.

## Verification integration
- Leaf panel can trigger server-side verification and render status/log diagnostics.
- Verification history is persisted to `.explain-md/web-verification-ledger.json`.
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
