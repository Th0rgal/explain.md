# Web App Scaffold (Issue #14)

This Next.js app provides a deterministic frontend scaffold for explain.md.

## Scope
- App Router shell with seeded proof explorer entrypoint.
- API routes backed by core provenance contracts:
  - `GET /api/proofs/seed`
  - `GET /api/proofs/root`
  - `GET /api/proofs/nodes/:nodeId/children`
  - `GET /api/proofs/nodes/:nodeId/path`
  - `POST /api/proofs/view`
  - `POST /api/proofs/diff`
  - `GET /api/proofs/leaves/:leafId`
- Client API layer in `lib/api-client.ts`.
- Loading and error boundaries (`app/loading.tsx`, `app/error.tsx`).

## State Management
This scaffold uses local React state + deterministic API payloads as the baseline state strategy.

The tree panel now uses incremental root/children/path queries:
- Load root snapshot (`/api/proofs/root`).
- Expand parent nodes with bounded child pages (`/api/proofs/nodes/:nodeId/children`, `limit=maxChildrenPerParent`).
- Resolve selected leaf ancestry (`/api/proofs/nodes/:nodeId/path`) to expand prerequisite parents deterministically.
- Keep leaf-detail and diff panels wired to provenance-aware contracts (`/api/proofs/leaves/:leafId`, `/api/proofs/diff`).

## Local commands
```bash
npm install
npm run dev
npm run typecheck
npm run test
npm run build
```
