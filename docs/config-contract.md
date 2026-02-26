# Unified Configuration Contract (Issue #23)

This module defines a single typed contract shared by backend and frontend for explanation generation.

## Scope
- Tree shape and abstraction controls.
- Pedagogy controls.
- Model/provider controls (endpoint, model, env key, timeout, retries, token budget).
- Deterministic normalization and hashing.
- Regeneration semantics.
- Profile persistence key format.

## Core API
- `normalizeConfig(input)`
- `validateConfig(config)`
- `stableSerializeConfig(config)`
- `computeConfigHash(config)`
- `computeTreeCacheKey(leafSetHash, config)`
- `planRegeneration(previous, next)`
- `buildProfileStorageKey(projectId, userId, profileId)`

## Determinism Rules
- Language and provider are canonicalized to lowercase.
- String fields are trimmed.
- Temperature is rounded to 4 decimals.
- Config serialization sorts object keys before hashing.

## Cache Key Contract
`<leaf_set_hash>:<config_hash>:<language>:<audience_level>`

Example:
`f4d...:6bf...:en:novice`

## Regeneration Semantics
- `none`: no field changed.
- `partial`: only operational generation constraints changed (`modelProvider.timeoutMs`, `modelProvider.maxRetries`, `modelProvider.retryBaseDelayMs`, `modelProvider.maxOutputTokens`, `modelProvider.apiKeyEnvVar`).
- `full`: any semantic/pedagogical/tree-shape/language/model field changed.

Unknown-field diffs default to `full` for safety.

## Validation Highlights
- `abstractionLevel`, `complexityLevel`: integer 1..5.
- `maxChildrenPerParent`: integer 2..12.
- `complexityBandWidth`: integer 0..3.
- `termIntroductionBudget`: integer 0..8.
- `language`: ISO-like tag (`en`, `en-us`).
- Audience/readability compatibility gate is enforced.
- `modelProvider.timeoutMs`: integer `1000..120000`.
- `modelProvider.maxRetries`: integer `0..8`.
- `modelProvider.retryBaseDelayMs`: integer `50..5000`.

## Profile Persistence
`buildProfileStorageKey(projectId, userId, profileId)` returns:
`project:<project>:user:<user>:profile:<profile>`

IDs are normalized to lowercase and non `[a-z0-9-_]` replaced with `_`.
