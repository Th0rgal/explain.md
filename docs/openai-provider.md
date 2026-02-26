# OpenAI-Compatible Provider Layer (Issue #11)

This module provides a deterministic, auditable RPC client for OpenAI-like `/chat/completions` endpoints.

## Core API
- `createOpenAICompatibleProvider({ config, fetchImpl?, sleepMs? })`
- `provider.generate({ messages, temperature?, maxOutputTokens? })`
- `provider.stream({ messages, temperature?, maxOutputTokens? })`

## Configuration
Uses `ModelProviderConfig` from the shared config contract:
- `provider`
- `endpoint`
- `model`
- `apiKeyEnvVar`
- `timeoutMs`
- `maxRetries`
- `retryBaseDelayMs`
- `temperature`
- `maxOutputTokens`

Secrets are read only from `process.env[apiKeyEnvVar]`.

## Deterministic Retry Policy
- Retryable status codes: `408, 409, 425, 429, 500, 502, 503, 504`
- Retryable network failures and request timeouts.
- Backoff schedule: `retryBaseDelayMs * 2^(attempt-1)` capped at `10000ms`.
- No random jitter (reproducible tests and traces).

## Error Taxonomy
`ProviderError.code` is one of:
- `configuration`
- `authentication`
- `rate_limit`
- `timeout`
- `transient`
- `permanent`
- `invalid_response`

Each error carries `attempt`, `retriable`, and optional HTTP `status`.

## Streaming
`provider.stream(...)` parses SSE `data:` frames and yields `textDelta` chunks.
`[DONE]` terminates the stream. Partial/truncated SSE frames are rejected as `invalid_response`.
