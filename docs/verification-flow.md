# Browser-triggered verification flow

Issue: #17

## Scope
- Provide a deterministic backend workflow that browser endpoints can call to verify a selected leaf theorem artifact.
- Track queued/running/success/failure/timeout lifecycle with reproducible metadata.
- Persist verification jobs in a canonical JSON ledger for auditability and leaf-panel queries.

## Core model
- `VerificationWorkflow`:
  - `enqueue({ target, reproducibility, options })`
  - `runNextQueuedJob()`
  - `runJob(jobId)`
  - `listJobs()`
  - `listJobsForLeaf(leafId)`
  - `toLedger()`
- Status enum: `queued | running | success | failure | timeout`
- Reproducibility contract fields:
  - `sourceRevision`
  - `workingDirectory`
  - `command`
  - `args`
  - `env`
  - `toolchain.leanVersion`, optional `toolchain.lakeVersion`

## Deterministic behavior
- Queue order is stable via monotonic `queueSequence`.
- Query APIs return jobs sorted by `(queueSequence, jobId)`.
- Log materialization is deterministic:
  - normalized line splitting
  - stdout/stderr interleaving by line index
  - bounded max log lines with explicit truncation marker
- Canonical render + hash support:
  - `renderVerificationJobCanonical(job)`
  - `computeVerificationJobHash(job)`
- JSON ledger roundtrip is canonicalized:
  - `writeVerificationLedger(path, ledger)`
  - `readVerificationLedger(path)`
  - `canonicalizeVerificationLedger(ledger)`

## Lean helper
- `buildLeanVerificationContract(...)` produces a reproducibility contract for `lake env lean <file>` checks.
- `createVerificationTargetFromLeaf(leaf)` maps theorem leaves to verification targets.

## API integration
- HTTP endpoint adapter is provided in `verification-api.ts`:
  - `startVerificationHttpServer(...)`
  - `createChildProcessVerificationRunner(...)`
- Endpoint contract is documented in `docs/verification-api.md`.
