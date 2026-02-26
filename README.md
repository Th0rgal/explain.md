# explain.md

Inductive explanation trees from Lean specifications (Verity -> Yul case study).

## Implemented slices
- Issue #23: unified configuration contract with deterministic normalization, validation, hashing, cache keys, regeneration planning, and profile-key support.
- Issue #11: OpenAI-compatible provider layer with deterministic retries, timeout handling, streaming SSE support, and typed error taxonomy.

## Local checks
```bash
npm install
npm test
npm run build
```

## Live provider check
```bash
EXPLAIN_MD_LIVE_RPC_API_KEY=... npm run test:live
```

## Spec docs
- [Configuration contract](docs/config-contract.md)
- [Provider layer](docs/openai-provider.md)
