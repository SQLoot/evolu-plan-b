# AI Assistant Instructions

> **Full context**: See `.ai/` directory for detailed instructions and active tasks.

## This Repository

**Evolu** - Local-first database fork with sync capabilities.  
Our fork uses **Bun** (not pnpm) and **Biome** (not ESLint).

## Quick Context

| Aspect          | Value                          |
| --------------- | ------------------------------ |
| Package Manager | Bun                            |
| Linter          | Biome                          |
| Current Branch  | feat/finalize-v8               |
| Active Task     | Cherry-pick upstream/common-v8 |

## Where to Look

- `.ai/tasks/active/` - Current work in progress
- `.ai/knowledge/` - Project-specific knowledge
- `package.json` - Dependencies and scripts

## Commands

```bash
bun install     # Install dependencies
bun run build   # Build all packages
bun run test    # Run tests
bun run lint    # Lint with Biome
bun run verify  # Full verification
```

## Global Rules

Organization-level AI rules are in `SQLoot/.ai` repository (TBD).
Key rules:
- Czech for user communication
- English for code/docs
- Bun over npm
- Biome over ESLint
