# Next.js web scaffold

## Goal
Provide a deterministic frontend baseline for explain.md so issue #15 can focus on interaction quality instead of infrastructure setup.

## Implemented in issue #14
- Next.js `App Router` project under `apps/web`.
- Seeded proof API surface that wraps existing provenance contracts:
  - `GET /api/proofs/seed`
  - `POST /api/proofs/view`
  - `POST /api/proofs/diff`
  - `GET /api/proofs/leaves/:leafId`
- `lib/proof-service.ts` for deterministic projection/diff/leaf-detail adapters with canonical request hashes.
- `lib/api-client.ts` for typed client-side fetch wrappers.
- Shell UI with baseline navigation, controls, loading state, and error boundary.

## Implemented in issue #23 (web contract enforcement slice)
- Unified config parser added at `apps/web/lib/config-input.ts`.
- All proof routes (`seed`, `view`, `diff`, `leaf detail`) now parse config through this shared parser.
- Route-local defaults were removed so config inputs remain partial and deterministic before seed merge.
- Full config-contract field coverage is accepted from body/query:
  - tree/pedagogy knobs (`abstractionLevel`, `complexityLevel`, `maxChildrenPerParent`, `language`, `audienceLevel`, `readingLevelTarget`, `complexityBandWidth`, `termIntroductionBudget`, `proofDetailMode`)
  - provider knobs (`modelProvider.*`)
- Invalid config returns machine-checkable diagnostics in `error.details.errors[]` (`path`, `message`).
- Query parameter parsing is prototype-safe (`hasOwn` key checks only), so inherited keys like `constructor` are ignored.
- Integer query fields reject empty-string values (for example `termIntroductionBudget=`) instead of silently coercing to `0`.

## Determinism and provenance
- Seed dataset is fixed (`seed-verity`) and uses core canonical models from `src/`.
- Responses include stable hashes:
  - `configHash`
  - `requestHash`
  - `viewHash` / `diffHash` / `detailHash`
- Config parsing and normalization is deterministic before request hashing.
- Leaf detail panel is backed by provenance path + deterministic sample verification history.

## State management
- Baseline strategy: local React state (`useState`) with deterministic API payloads.
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
