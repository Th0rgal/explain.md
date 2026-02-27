# Verification Replay Evaluation (Issue #15)

This benchmark provides deterministic, browser-verifiable evidence for replay artifact export contracts.

## Generate baseline artifact

```bash
npm run web:bench:verification-replay
```

Output:
- `docs/benchmarks/verification-replay-evaluation.json`

## Run fail-closed CI baseline check

```bash
npm run web:eval:verification-replay:ci
```

Output:
- `.explain-md/verification-replay-evaluation-report.json`

The CI check fails closed if any of these drift:
- `schemaVersion`
- `requestHash`
- `outcomeHash`
- summary fields (`exportFilename`, `requestHash`, `jobHash`, `reproducibilityHash`, `replayCommand`, tree/leaf/path context hashes, `envKeyCount`, `logLineCount`, `jsonLineCount`)

## Current pinned evidence
- `requestHash`: `c38fc29da899af673dbc7bdad5064543dd316bc138d9df0aad839e6fe345d3d2`
- `outcomeHash`: `fc361f0f01027309f6203bfac5ae68f10a58b4645fc17c73d3808cc537cb34c5`
- export filename: `verification-replay-seed-verity-leaf-tx-prover-job-1-ffffffffffff.json`

## Release gate integration
`npm run eval:release-gate:ci` consumes both:
- `docs/benchmarks/verification-replay-evaluation.json`
- `.explain-md/verification-replay-evaluation-report.json`

and enforces `verification_replay_contract_complete`.
