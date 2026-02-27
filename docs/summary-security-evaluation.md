# Summary Prompt-Security Evaluation (Issue #19)

Deterministic benchmark for parent-summary prompt-boundary hardening.

## Artifact
- Baseline artifact: `docs/benchmarks/summary-security-evaluation.json`
- CI check artifact: `.explain-md/summary-security-evaluation-report.json`

## Commands
Generate/refresh benchmark artifact:

```bash
npm run eval:summary-security -- --write-baseline --baseline=docs/benchmarks/summary-security-evaluation.json
```

Run fail-closed CI baseline check:

```bash
npm run eval:summary-security:ci
```

## Contract
The benchmark covers deterministic profiles for:
- sanitization redaction of untrusted child payloads
- raw-output prompt-injection rejection
- raw-output secret leak rejection
- configured-secret-value leak rejection
- parsed-summary prompt-injection rejection
- clean-summary acceptance

Each profile emits machine-checkable fields and the report records:
- `requestHash`
- `outcomeHash`
- summary pass/fail counts
- per-profile failure reasons

`eval:summary-security:ci` fails closed on baseline drift (`requestHash`/`outcomeHash` and summary/profile expectations).

This benchmark is wired into the root release gate (`eval:release-gate:ci`) as `summary_prompt_security_contract`.
