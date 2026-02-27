# Config Profile API (Issue #23 follow-up)

Deterministic web contract for persisted per-project/per-user explanation config profiles.

## Routes
- `GET /api/proofs/config-profiles?projectId=<id>&userId=<id>`
- `POST /api/proofs/config-profiles`
- `DELETE /api/proofs/config-profiles/:profileId?projectId=<id>&userId=<id>`

## Request Contracts
`GET` query params:
- `projectId` (default: `default-project`)
- `userId` (default: `anonymous`)

`POST` JSON body:
- `projectId` (default: `default-project`)
- `userId` (default: `anonymous`)
- `profileId` (required, canonicalized for storage)
- `name` (required)
- `config` (same normalized knob contract as all proof routes)

`DELETE`:
- `profileId` path parameter
- `projectId`, `userId` query params (same defaults)

## Determinism + Provenance
- Profile configs are normalized with the shared contract (`normalizeConfigInput` -> `normalizeConfig` + `validateConfig`).
- Each persisted profile includes `configHash`.
- Route responses include:
  - `requestHash` (canonical hash of operation input)
  - `ledgerHash` (canonical hash of persisted profile ledger state)
- Profile storage key is derived from the canonical contract helper:
  - `buildProfileStorageKey(projectId, userId, profileId)`
- Ledger file path is deterministic and configurable:
  - default: `.explain-md/web-config-profiles.json`
  - override: `EXPLAIN_MD_WEB_CONFIG_PROFILE_LEDGER`

## Regeneration Semantics
`POST` returns a machine-checkable `regenerationPlan`:
- On create: deterministic `full` scope with `changedFields = ["profile.create"]`.
- On update: derived from `planRegeneration(previous, next)`.

## Diagnostics
Invalid config/profile inputs fail with `400 invalid_request` and explicit validation messages.
