# Parent Summary Pipeline (Issue #8)

This module builds one parent node summary from a set of child nodes using the OpenAI-compatible provider layer, then enforces deterministic critic checks.

## Core API
- `generateParentSummary(provider, { children, config, systemPrompt? })`
- `buildSummaryPromptMessages(children, config, systemPrompt?)`
- `validateParentSummary(summary, children, config)`

## Input Contract
Each child must provide:
- `id` (unique, non-empty)
- `statement` (non-empty)
- optional `complexity`

Children are normalized and sorted by `id` before generation to keep prompt construction deterministic.

## Required Model Output Schema
```json
{
  "parent_statement": "string",
  "why_true_from_children": "string",
  "new_terms_introduced": ["string"],
  "complexity_score": 1,
  "abstraction_score": 1,
  "evidence_refs": ["child_id"],
  "confidence": 0.0
}
```

## Critic Checks
- Schema validity and numeric ranges.
- `evidence_refs` must be non-empty and only cite provided child IDs.
- `new_terms_introduced.length <= termIntroductionBudget`.
- `complexity_score` must lie within
  `[complexityLevel - complexityBandWidth, complexityLevel + complexityBandWidth]` (clamped to 1..5).
- Unsupported term detection:
  - Significant tokens in `parent_statement` are stem-normalized and compared against child + declared term tokens.
  - Coverage floor is deterministic from config:
    - `entailmentMode=strict` => floor `1.0` (no unsupported lexical tokens allowed).
    - `entailmentMode=calibrated` => floor derived from `proofDetailMode`, `audienceLevel`, and `termIntroductionBudget`.
  - If token coverage drops below the configured floor, output is rejected as potential unsupported-claim drift.
- Secret leak detection:
  - raw provider output is scanned for secret-like token patterns before JSON parsing.
  - parsed summary fields are scanned for secret-like token patterns during critic validation.
  - detected leaks fail with `secret_leak` diagnostics.
- Prompt-injection detection:
  - raw provider output is scanned for prompt-injection-like directives before JSON parsing.
  - parsed summary fields are scanned for prompt-injection-like directives during critic validation.
  - detected directives fail with `prompt_injection` diagnostics.

Failures raise `SummaryValidationError` with machine-readable `diagnostics`.

## Determinism and Auditability
- Prompt includes explicit config knobs (language, audience, complexity, abstraction, detail mode, entailment mode).
- Generation runs with `temperature=0`.
- Critic diagnostics enumerate exact failure codes and details.
- JSON can be parsed from plain output or fenced code blocks.

## Prompt Security Boundary
- Child IDs are validated against a safe deterministic pattern (`[A-Za-z0-9._:/-]+`, max length `128`) before prompt construction.
- Child statement text is treated as untrusted data:
  - control characters are stripped
  - secret-like tokens are deterministically redacted to `[REDACTED_SECRET]`
  - prompt-injection-like directives and boundary-marker tokens are deterministically redacted to `[REDACTED_INSTRUCTION]`
- Model output is treated as untrusted:
  - secret-like tokens in raw output or parsed summary fields are rejected deterministically.
  - prompt-injection-like directives in raw output or parsed summary fields are rejected deterministically.
- Prompt includes explicit boundary rules and untrusted payload markers:
  - `UNTRUSTED_CHILDREN_JSON_BEGIN`
  - `UNTRUSTED_CHILDREN_JSON_END`
- Prompt diagnostics include sanitization counters:
  - `sanitization_stripped_control_chars`
  - `sanitization_redacted_secrets`
  - `sanitization_redacted_instructions`

## Live Smoke Check
```bash
EXPLAIN_MD_LIVE_RPC_API_KEY=... npm run test:live:summary
```
