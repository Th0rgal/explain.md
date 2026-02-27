# Multilingual Evaluation (Issue #10)

## Goal
Fail-closed benchmark for deterministic multilingual rendering across the proof explorer contract.

## Command
```bash
npm run web:bench:multilingual
npm run web:eval:multilingual:ci
```

- Baseline artifact: `docs/benchmarks/multilingual-evaluation.json`
- CI report artifact: `.explain-md/multilingual-evaluation-report.json`

## What is validated
For each deterministic profile (`seed-verity`, `lean-verity-fixture`):
- Root/children/path structure stability across `en` and `fr` (same IDs/order).
- Localized node-text deltas across `en` and `fr`.
- Deterministic locale fallback contracts:
  - `fr-CA -> fr`
  - unsupported tag (for example `de`) -> `en`
- Leaf provenance stability across language selection (`leaf.id`, `sourceUrl`).

## Hash contract
The report carries canonical `requestHash` and `outcomeHash`.
- `requestHash`: benchmark inputs (profiles + language matrix)
- `outcomeHash`: deterministic summary + per-profile comparisons

Release gate consumes this artifact through `multilingual_generation_contract`.
