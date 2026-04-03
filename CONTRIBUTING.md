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

- keep compatibility with `upstream/main` unless an explicit fork decision exists
- avoid dependency downgrades during sync work
- keep fork-specific behavior isolated and documented
- always run final sync guards before sync PR:
  - `bun run sync:guard:upstream:strict`
  - `bun run sync:guard:common-v8:strict` (deprecated alias, temporary)
- always run final gate before sync PR: `bun run verify:fast`

## Pull Requests

- keep changes focused by concern
- include tests for behavior changes
- update docs/knowledge when public API or workflow changes
- do not commit secrets, tokens, or local credentials
