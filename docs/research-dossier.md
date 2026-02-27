# Research Dossier: Inductive Explanation Trees from Formal Proofs

Issue #24 delivers a provenance-first evidence dossier for design decisions behind explain.md's Lean/Verity explanation pipeline.

## Scope and framing
Objective: convert Lean 4 proof artifacts into an inductive explanation tree where:
- parent statements are explicitly entailed by children,
- complexity and pedagogy are bounded by configuration,
- leaves remain browser-verifiable with source-linked provenance,
- evaluation and release gating are deterministic and auditable.

This dossier complements implementation specs with external research evidence and a machine-checkable mapping artifact:
- `docs/research-dossier-evidence.json`
- `npm run eval:research-dossier` fails closed if the evidence schema is invalid, required issue coverage is missing, citations are unresolved, any `implementationRefs` path does not exist in the repository, any pinned `evidenceChecks[].expectedSha256` does not match the referenced artifact, or any replayed `evidenceChecks[].command` does not match `expectedCommandOutcomeSha256`.

Each design decision now includes at least one claim-level `evidenceChecks` record:
- deterministic command to regenerate/validate the evidence,
- pinned artifact path,
- pinned SHA-256 of that artifact,
- pinned SHA-256 of canonical command outcome (`{ command, artifactPath, artifactSha256, exitCode }`).

## Survey: theorem proving and Lean-relevant methods

### Lean-native representation and extraction
- Lean 4's architecture and elaboration model support deterministic extraction of declaration-level artifacts, spans, and dependencies needed for traceable leaves and parent composition (`lean4_cade_2021`).

### Retrieval and benchmark discipline for Lean pipelines
- LeanDojo demonstrates practical Lean-centric benchmark and retrieval workflows that motivate fixture-driven, reproducible evaluation and data provenance tracking (`leandojo_neurips_2023`).

### Deterministic theorem-generation quality controls
- Generative ATP work highlights failure modes of unconstrained generation and the need for strict objective metrics and reproducible benchmark artifacts (`polu_generative_atp_2020`).

## Pedagogy evidence and implication for engine controls

### Scaffolding and prerequisite progression
- Scaffolding theory supports presenting prerequisite ideas before dependent claims and enforcing progression checks (`wood_scaffolding_1976`).

### Cognitive-load limits and bounded complexity
- Cognitive Load Theory supports explicit caps on sibling complexity spread and term-introduction budgets (`sweller_cognitive_load_1988`).

### Worked-example progression
- Worked-example findings support stepwise intermediate parent summaries with explicit traceability to child evidence (`atkinson_worked_examples_2000`).

### Expertise-reversal and audience controls
- Expertise-reversal evidence supports configurable abstraction/detail by audience profile (`kalyuga_expertise_reversal_2003`).

### Graph structure and concept continuity
- Concept-map theory supports explicit hierarchical/graph structure with auditable linkage between concept nodes (`novak_concept_maps_2008`).

### Continuous evaluation loops
- Tutoring-system effectiveness studies support continuous measurement loops and diagnostics instead of one-off subjective inspection (`vanlehn_its_2011`).

## Design-decision evidence map (issues #7, #8, #9, #18, #23, #25)

The canonical mapping lives in `docs/research-dossier-evidence.json` and is validated by `npm run eval:research-dossier`.

| Issue | Decision summary | Implementation anchors | External evidence |
| --- | --- | --- | --- |
| #7 | Deterministic dependency-aware grouping with bounded sibling complexity and prerequisite ordering | `src/child-grouping.ts`, `src/tree-builder.ts`, `docs/child-grouping.md` | `novak_concept_maps_2008`, `sweller_cognitive_load_1988`, `wood_scaffolding_1976` |
| #8 | Structured parent-summary contract with explicit evidence refs and introduced-term accounting | `src/summary-pipeline.ts`, `src/pedagogical-policy.ts`, `docs/summary-pipeline.md` | `atkinson_worked_examples_2000`, `polu_generative_atp_2020` |
| #9 | Recursive single-root induction with deterministic ordering and entailment-preserving composition | `src/tree-builder.ts`, `src/tree-storage.ts`, `docs/tree-builder.md` | `lean4_cade_2021`, `novak_concept_maps_2008` |
| #18 | Deterministic quality harness and hashable CI benchmark artifacts | `src/evaluation-harness.ts`, `src/quality-benchmark-presets.ts`, `docs/evaluation-harness.md` | `leandojo_neurips_2023`, `polu_generative_atp_2020`, `vanlehn_its_2011` |
| #23 | Unified config normalization and hashing for pedagogy/entailment controls | `src/config-contract.ts`, `apps/web/lib/config-input.ts`, `docs/config-contract.md` | `kalyuga_expertise_reversal_2003`, `sweller_cognitive_load_1988` |
| #25 | Fail-fast pedagogy engine with bounded repartition/rewrite loop and strict entailment mode | `src/pedagogical-policy.ts`, `src/tree-builder.ts`, `docs/pedagogical-policy.md` | `atkinson_worked_examples_2000`, `sweller_cognitive_load_1988`, `wood_scaffolding_1976` |

## Practical recommendations for prompt and quality strategy
- Keep parent synthesis strictly schema-bound and evidence-first; treat unsupported lexical additions as policy failures under strict mode.
- Preserve deterministic prompt framing and canonical hashing so any model drift is attributable in CI artifacts.
- Keep pedagogy knobs (audience, detail, complexity, term budget, entailment mode) in the config-hash contract, not ad-hoc UI-only state.
- Continue coupling policy diagnostics to both backend reports and browser payloads so users can inspect why a tree node passed/failed constraints.
- Maintain balanced benchmark presets: pressure-focused fixtures, broad synthetic sets, and frozen real-Verity snapshots under calibrated and strict entailment modes.

## Dataset ideas for evaluation growth
- Add one more pinned real-Verity family with different proof style to reduce overfitting to current counter/token snapshots.
- Add a small adversarial fixture set that targets prerequisite-order ambiguity, vocabulary drift, and strict-entailment edge cases.
- Add audience-stratified evaluation snapshots (novice/intermediate/expert configs) and compare policy-pressure and readability outcomes.
- Add deterministic browser interaction transcripts for large-tree accessibility behavior across multiple rendering thresholds.

## Open questions and tracked risks
- Coverage generalization risk: current real snapshots may under-represent tactic and declaration diversity.
- Pedagogical tradeoff risk: strict entailment can reduce readability for novice settings.
- Browser scale risk: accessibility and virtualization defaults may not transfer to low-power environments.

Canonical open-question records and next checks are tracked in `docs/research-dossier-evidence.json`.

## Citation list
- `lean4_cade_2021`: https://doi.org/10.1007/978-3-030-79876-5_37
- `leandojo_neurips_2023`: https://openreview.net/forum?id=g7OX2sOJtn
- `sweller_cognitive_load_1988`: https://doi.org/10.1207/s15516709cog1202_4
- `wood_scaffolding_1976`: https://doi.org/10.1111/j.1469-7610.1976.tb00381.x
- `atkinson_worked_examples_2000`: https://doi.org/10.3102/00346543070002181
- `kalyuga_expertise_reversal_2003`: https://doi.org/10.1207/S15326985EP3801_4
- `novak_concept_maps_2008`: https://cmap.ihmc.us/docs/theory-of-concept-maps
- `vanlehn_its_2011`: https://doi.org/10.1111/j.1467-9280.2010.02677.x
- `polu_generative_atp_2020`: https://arxiv.org/abs/2009.03393
