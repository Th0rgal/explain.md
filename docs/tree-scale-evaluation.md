# Tree Scale Evaluation (Issue #15)

This benchmark provides deterministic, machine-checkable evidence that browser tree rendering remains bounded across full, windowed, and virtualized modes.

## Artifact
- `docs/benchmarks/tree-scale-evaluation.json`

## Commands
Generate/refresh benchmark artifact:

```bash
npm run web:bench:tree-scale
```

Run CI baseline check (fail-closed on drift):

```bash
npm run web:eval:tree-scale:ci
```

This writes `.explain-md/tree-scale-evaluation-report.json`.

## Fixed benchmark profiles
- `full-small-tree`
- `windowed-medium-tree`
- `virtualized-large-tree`

Each profile replays a deterministic active-row sequence and records:
- effective render mode (`full`, `windowed`, `virtualized`)
- rendered/hidden row counts
- virtual scroll bounds
- bounded-row-count check results

The report includes canonical `requestHash` and `outcomeHash` for reproducibility checks.
