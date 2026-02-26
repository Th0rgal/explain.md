# explain.md

Inductive explanation trees from Lean specifications (Verity -> Yul case study).

## Implemented slices
- Issue #23: unified configuration contract with deterministic normalization, validation, hashing, cache keys, regeneration planning, and profile-key support.
- Issue #11: OpenAI-compatible provider layer with deterministic retries, timeout handling, streaming SSE support, and typed error taxonomy.
- Issue #7: inductive child-grouping algorithm with deterministic prerequisite-aware scheduling and complexity-bounded sibling partitioning.
- Issue #8: parent-summary generation pipeline with strict structured-output schema, deterministic prompting, and critic validation diagnostics.
- Issue #9: recursive single-root tree builder with deterministic layering, structural validity checks, and leaf-preservation guarantees.

## Local checks
```bash
npm install
npm test
npm run build
```

## Live provider check
```bash
EXPLAIN_MD_LIVE_RPC_API_KEY=... npm run test:live
EXPLAIN_MD_LIVE_RPC_API_KEY=... npm run test:live:summary
```

## Spec docs
- [Configuration contract](docs/config-contract.md)
- [Provider layer](docs/openai-provider.md)
- [Inductive child grouping](docs/child-grouping.md)
- [Parent summary pipeline](docs/summary-pipeline.md)
- [Recursive tree builder](docs/tree-builder.md)
