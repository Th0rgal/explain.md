# explain.md

Inductive explanation trees from Lean specifications (Verity -> Yul case study).

## Implemented slices
- Issue #23: unified configuration contract with deterministic normalization, validation, hashing, cache keys, regeneration planning, and profile-key support.
- Issue #5: versioned Lean theorem-leaf provenance schema with deterministic mapping, canonical rendering, source-link generation, and legacy migration.
- Issue #3: deterministic Lean ingestion/indexer with stable declaration IDs, provenance spans/hashes, and unsupported-construct diagnostics.
- Issue #4: deterministic Lean declaration dependency graph with SCC/cycle diagnostics, transitive support queries, and canonical graph hashing.
- Issue #6: deterministic domain-adapter pipeline (Verity specialization + generic fallback), low-confidence downgrade, manual overrides, and sampled precision/recall reporting.
- Issue #11: OpenAI-compatible provider layer with deterministic retries, timeout handling, streaming SSE support, and typed error taxonomy.
- Issue #7: inductive child-grouping algorithm with deterministic prerequisite-aware scheduling and complexity-bounded sibling partitioning.
- Issue #8: parent-summary generation pipeline with strict structured-output schema, deterministic prompting, and critic validation diagnostics.
- Issue #9: recursive single-root tree builder with deterministic layering, structural validity checks, and leaf-preservation guarantees.
- Issue #25: pedagogical policy engine with deterministic pre/post summary checks, node-level diagnostics, and bounded rewrite retry.
- Issue #25 follow-up: prerequisite-order policy now evaluates deterministic grouping order (not lexical IDs) and waives cyclic in-group edges, fixing real Verity SCC compatibility.
- Issue #25 follow-up: tree builder now reorders each group by local prerequisites and uses a safe depth guard with explicit no-progress failure diagnostics for large Lean corpora.
- Issue #17: browser-triggered verification workflow core with deterministic queue/status lifecycle, reproducibility contracts, and canonical ledger persistence.
- Issue #17 follow-up: browser-callable verification HTTP API with deterministic route payloads, persisted ledger-backed job querying, and command-runner integration.
- Issue #16: deterministic leaf-detail/provenance contract for theorem inspection, source linking/share references, and verification-job binding for browser panels.
- Issue #18: deterministic faithfulness/simplicity evaluation harness with per-parent/per-depth quality metrics, threshold gating, and canonical report hashing.
- Issue #15 (backend contract): deterministic progressive-disclosure projection and config-aware explanation diff contract for root-first UI rendering.
- Issue #14: Next.js App Router scaffold with deterministic seeded-proof API adapters, frontend client layer, and accessible loading/error shell.
- Issue #13: deterministic tree storage/query contract with versioned snapshot schema, root/children/ancestry/leaf-provenance reads, and canonical import/export hashing.

## Local checks
```bash
npm install
npm test
npm run build
npm run bench:dependency-graph
npm run ingest:lean -- /path/to/lean-project
npm run eval:domain-adapters
npm run eval:tree-pipeline -- /path/to/lean-project --include=Verity --include=Compiler/ContractSpec.lean
npm run eval:leaf-detail -- /path/to/lean-project --include=Verity --leaf=<leaf-id>
npm run eval:quality -- /path/to/lean-project --include=Verity --include=Compiler/ContractSpec.lean
npm run serve:verification
npm run web:lint
npm run web:typecheck
npm run web:test
npm run web:build
```

## Live provider check
```bash
EXPLAIN_MD_LIVE_RPC_API_KEY=... npm run test:live
EXPLAIN_MD_LIVE_RPC_API_KEY=... npm run test:live:summary
```

## Spec docs
- [Configuration contract](docs/config-contract.md)
- [Leaf theorem schema](docs/leaf-schema.md)
- [Lean ingestion/indexer](docs/lean-ingestion.md)
- [Dependency graph](docs/dependency-graph.md)
- [Domain adapters](docs/domain-adapters.md)
- [Provider layer](docs/openai-provider.md)
- [Inductive child grouping](docs/child-grouping.md)
- [Parent summary pipeline](docs/summary-pipeline.md)
- [Recursive tree builder](docs/tree-builder.md)
- [Evaluation harness](docs/evaluation-harness.md)
- [Pedagogical policy engine](docs/pedagogical-policy.md)
- [Browser-triggered verification flow](docs/verification-flow.md)
- [Verification HTTP API service](docs/verification-api.md)
- [Leaf detail contract](docs/leaf-detail.md)
- [Progressive disclosure + explanation diff](docs/progressive-disclosure.md)
- [Tree storage + query APIs](docs/tree-storage.md)
- [Next.js web scaffold](docs/nextjs-scaffold.md)
