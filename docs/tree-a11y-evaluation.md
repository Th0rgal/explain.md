# Tree Accessibility Evaluation Harness

This harness provides deterministic, machine-checkable evidence for keyboard and assistive-tech tree behavior in the browser interaction model.

## Command
```bash
npm run web:bench:tree-a11y
```

This writes:
- `docs/benchmarks/tree-a11y-evaluation.json`

## What It Verifies
- Deterministic keyboard transcript across a fixed tree fixture and key sequence.
- Expand/collapse/active transitions via pure `resolveTreeKeyboardIntent` planning.
- Stable ARIA row metadata for active items:
  - `aria-activedescendant`
  - `aria-level`
  - `aria-posinset`
  - `aria-setsize`
- Deterministic render diagnostics per step:
  - `renderMode` (`full`, `windowed`, `virtualized`)
  - `renderedRowCount`
  - `hiddenAboveCount`
  - `hiddenBelowCount`

## Determinism and Auditability
- `requestHash` commits the canonical fixture, key sequence, and rendering settings.
- `outcomeHash` commits stepwise interaction evidence and final state.
- Timing is excluded from hashes to avoid non-deterministic CI noise.

## CI Usage
Use this harness for regression checks when changing:
- keyboard behavior (`tree-keyboard-navigation.ts`)
- tree accessibility semantics (`tree-accessibility.ts`)
- render windowing / virtualization planners
