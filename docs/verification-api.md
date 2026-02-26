# Verification API Service

Issue: #17

## Scope
- Provide browser-callable HTTP endpoints over `VerificationWorkflow`.
- Persist every state transition to a canonical verification ledger.
- Expose deterministic job hashes for provenance/audit UI.

## Startup
- `startVerificationHttpServer({ ledgerPath, host, port, runner, ...workflowOptions })`
- On startup, server loads `ledgerPath` (if present) and resumes queue sequence deterministically.
- `runner` defaults to `createChildProcessVerificationRunner()`.

## Routes
- `GET /health`
  - Returns `{ ok: true, data: { status: "ok" } }`
- `POST /api/verification/jobs`
  - Enqueue one job from `{ target, reproducibility, options? }`
  - Persists ledger immediately
- `GET /api/verification/jobs`
  - List all jobs
  - Optional query `?leafId=<leaf-id>` filters by leaf
- `GET /api/verification/jobs/:jobId`
  - Fetch one job and deterministic `jobHash`
- `POST /api/verification/jobs/:jobId/run`
  - Execute a queued job immediately
  - Conflict errors are returned as status `409`
- `POST /api/verification/run-next`
  - Executes the next queued job (or returns `job: null`)

## Determinism and provenance
- All successful responses include canonical workflow job records.
- Job hashes are computed via `computeVerificationJobHash(job)`.
- Ledger persistence uses `writeVerificationLedger(...)` after enqueue/run transitions.
- Invalid enqueue payloads are explicit `400 invalid_request` responses.

## Local operation
- CLI: `npm run serve:verification`
- Environment knobs:
  - `EXPLAIN_MD_VERIFICATION_HOST` (default `127.0.0.1`)
  - `EXPLAIN_MD_VERIFICATION_PORT` (default `8787`)
  - `EXPLAIN_MD_VERIFICATION_LEDGER` (default `.explain-md/verification-ledger.json`)
  - `EXPLAIN_MD_VERIFICATION_TIMEOUT_MS` (optional positive integer)
