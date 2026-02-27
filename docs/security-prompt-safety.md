# Prompt Security Model

Issue #19 hardening for summary generation focuses on deterministic prompt-boundary safety.

## Threat Model
- Untrusted theorem/source text can contain instruction-like payloads.
- Untrusted text can contain copied secrets (API keys/tokens/private keys).
- Untrusted child IDs can attempt prompt-shape injection via delimiters/control chars.

## Deterministic Defenses
- Child ID gate:
  - regex: `^[A-Za-z0-9._:/-]+$`
  - max length: `128`
  - invalid IDs fail fast before provider calls.
- Untrusted text sanitizer:
  - normalizes line endings
  - strips ASCII control chars except newline/tab
  - redacts secret-like patterns to `[REDACTED_SECRET]`
  - redacts prompt-injection-like directives/marker tokens to `[REDACTED_INSTRUCTION]`
- Prompt boundary isolation:
  - explicit rules that child payload is data, not instructions
  - explicit `UNTRUSTED_CHILDREN_JSON_BEGIN/END` markers
  - deterministic sanitization counters emitted into prompt metadata
  - includes `sanitization_redacted_instructions` for auditability
- Output leak critic:
  - raw provider output is scanned for secret-like token patterns before JSON parsing
  - raw provider output is scanned for configured secret values loaded from sensitive env vars (`*API_KEY*`, `*TOKEN*`, `*SECRET*`, `*PASSWORD*`, `*PRIVATE_KEY*`; length `>= 20`)
  - raw provider output is scanned for prompt-injection-like directives before JSON parsing
  - parsed summary fields are scanned again during schema/critic validation
  - parsed summary fields are scanned for configured secret values using the same env-derived set
  - any detection fails with machine-readable `secret_leak` or `prompt_injection` diagnostics

## Test Coverage
- Adversarial child content with instruction-like text and secret-like tokens is redacted in prompt payload.
- Unsafe child IDs are rejected with deterministic errors.
- Prompt contract includes untrusted boundary markers for auditability.
- Secret-like leakage from model output is rejected deterministically.
- Configured-secret-value leakage from model output is rejected deterministically.
- Prompt-injection-like leakage from model output is rejected deterministically.
