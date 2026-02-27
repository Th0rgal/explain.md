# Verity SimpleToken Snapshot Fixture

This fixture is a frozen snapshot copied from the local `verity` checkout for deterministic CI quality-gate benchmarking.

- Source repository path: `/workspaces/mission-1ee8868c/verity`
- Source revision: `56ab1b777e2c9af997e4fc69a978bbc2341b6add`
- Snapshot date (UTC): 2026-02-27

Included files:
- `Verity/Proofs/SimpleToken/Correctness.lean`
- `Verity/Proofs/SimpleToken/Isolation.lean`
- `Verity/Proofs/SimpleToken/Supply.lean`

Notes:
- Files are copied verbatim to preserve provenance and deterministic ingestion behavior.
- This fixture focuses on invariant/conservation-heavy SimpleToken proofs to complement the counter snapshot.
- This fixture is intentionally CI-safe and self-contained for explain-tree quality regression checks.
