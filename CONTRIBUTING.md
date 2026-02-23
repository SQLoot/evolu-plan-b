# Contributing

## Development

Requirements:

- Bun (version pinned in `packageManager`)
- Biome (workspace dependency)

Setup:

```bash
bun install
```

Core checks:

```bash
bun run lint
bun run check-types
bun run test
bun run verify
```

## Upstream Sync Rules

- keep compatibility with `upstream/common-v8` unless an explicit fork decision exists
- avoid dependency downgrades during sync work
- keep fork-specific behavior isolated and documented
- always run final gate before sync PR: `bun verify`

## Pull Requests

- keep changes focused by concern
- include tests for behavior changes
- update docs/knowledge when public API or workflow changes
- do not commit secrets, tokens, or local credentials
