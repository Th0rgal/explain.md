# Web design system (Issue #46)

## Objective
Unify the proof explorer visual language into one tokenized, high-contrast editorial system inspired by AI-2027 color direction and Ampcode-style information density.

## Token contract
Defined in `apps/web/app/globals.css` under `:root`.

Required semantic token groups:
- Surface: `--color-canvas`, `--color-canvas-elevated`, `--color-canvas-panel`, `--color-canvas-panel-soft`
- Typography: `--color-text-primary`, `--color-text-secondary`, `--color-text-muted`
- Semantics: `--color-accent`, `--color-warn`, `--color-danger`, `--color-success`, `--color-link`
- Borders: `--color-border`, `--color-border-strong`
- 3D scene overlays: `--color-scene-*`

## Layout rules
- `ProofExplorer` uses a two-column editorial grid on desktop (`controls rail + evidence/work area`) and collapses to one column on mobile.
- High-signal controls remain visible; low-frequency knobs are grouped under `<details>`.
- Evidence-bearing surfaces (tree, policy, cache, verification) use shared panel styles and focus states.

## Accessibility constraints
- Focus rings are tokenized and shared (`outline: 2px solid var(--color-accent)`).
- Inputs/buttons/links use the same focus-visible contract.
- Text and panel colors are chosen for high contrast in the primary dark theme.

## Boundaries
- No proof semantics are modified.
- No API contracts are changed by this issue.
