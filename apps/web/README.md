# Web App Scaffold (Issue #14)

This Next.js app provides a deterministic frontend scaffold for explain.md.

## Scope
- App Router shell with seeded proof explorer entrypoint.
- API routes backed by core provenance contracts:
  - `GET /api/proofs/seed`
  - `POST /api/proofs/view`
  - `POST /api/proofs/diff`
  - `GET /api/proofs/leaves/:leafId`
- Client API layer in `lib/api-client.ts`.
- Loading and error boundaries (`app/loading.tsx`, `app/error.tsx`).

## State Management
This scaffold uses local React state + deterministic API payloads as the baseline state strategy.

## Local commands
```bash
npm install
npm run dev
npm run typecheck
npm run test
npm run build
```
