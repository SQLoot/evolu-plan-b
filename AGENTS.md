# AI Assistant Instructions: evolu-plan-b

> **Full context**: See `.ai/` directory for detailed instructions and active tasks.

## 🎯 This Repository

**Evolu Plan B** - Fork of [evoluhq/evolu](https://github.com/evoluhq/evolu) with:
- **Bun** as package manager and runtime (not pnpm/Node)
- **Biome** for linting and formatting (not ESLint/Prettier)
- Reduced dependencies
- SQLoot-specific enhancements

## 📊 Quick Context

| Aspect           | Value         |
| ---------------- | ------------- |
| Package Manager  | Bun 1.3.8     |
| Node.js          | >=24.0.0      |
| Linter/Formatter | Biome 2.3.14  |
| Test Framework   | Vitest        |
| Upstream         | evoluhq/evolu |

## 🗂️ Repository Structure

```
evolu-plan-b/
├── apps/
│   ├── relay/          # Sync relay server
│   └── web/            # Documentation (Dan's) - TO BE REMOVED
├── packages/
│   ├── common/         # Core logic, CRDTs, sync
│   ├── web/            # Browser adapter (wa-sqlite)
│   ├── react/          # React bindings
│   ├── react-web/      # React + web combined
│   ├── react-native/   # React Native adapter
│   ├── nodejs/         # Node.js adapter
│   ├── svelte/         # Svelte bindings
│   ├── vue/            # Vue bindings
│   └── tsconfig/       # Shared TS config
├── examples/           # Framework examples - MIGRATING TO bench-suite
└── .ai/                # AI agent context
```

## 🔧 Common Commands

```bash
# Development
bun install              # Install dependencies
bun run dev              # Start dev mode (packages + web + relay)
bun run build            # Build all packages

# Testing
bun run test             # Run tests
bun run test:coverage    # Tests with coverage
bun run test:watch       # Watch mode

# Quality
bun run lint             # Lint with Biome
bun run format           # Format with Biome
bun run verify           # Full verification (build + lint + test)

# Release
bun run changeset        # Add changeset
bun run version          # Bump versions
bun run release          # Publish packages
```

## 🔄 Upstream Sync Strategy

This fork cherry-picks from upstream. Dan (@steida) pushes frequently without warning.

**Branches:**
- `main` - Stable
- `sync/upstream-main` - Tracking upstream/main
- `sync/upstream-common-v8` - Tracking upstream/common-v8 (new Task architecture)
- `feat/*` - Feature branches

**Workflow:**
```bash
git fetch upstream
git cherry-pick <commit>  # Pick specific commits
# Resolve conflicts, especially in lock files and CI
bun run verify
```

## ⚠️ Key Differences from Upstream

1. **Bun over pnpm** - All commands use `bun`
2. **Biome over ESLint** - Single tool for lint + format
3. **No `apps/web`** - Dan's docs site will be removed
4. **Examples migrating** - Moving to `bench-suite` repo

## 📍 Related Resources

| Resource     | Location                            |
| ------------ | ----------------------------------- |
| Issues       | `../knowledge/05-Issues/`           |
| Roadmap      | `../knowledge/01-Vision/ROADMAP.md` |
| Architecture | `../knowledge/02-Architecture/`     |
| Bench Suite  | `../bench-suite/` (sibling repo)    |
| Upstream     | https://github.com/evoluhq/evolu    |

## 🤖 For AI Agents

### Do
- Use Bun for all package operations
- Run `bun run verify` before suggesting PR
- Check `.ai/tasks/active/` for current work
- Reference upstream issues with `upstream#XXX`

### Don't
- Use npm/pnpm/yarn
- Suggest ESLint/Prettier configs
- Modify `apps/web/` (it's going away)
- Add unnecessary dependencies

### Context Priority
1. This file
2. `.ai/README.md`
3. `.ai/tasks/active/*.md`
4. `../knowledge/01-Vision/ROADMAP.md`

---

<div align="center">
  <a href="https://github.com/SQLoot/evolu-plan-b">SQLoot/evolu-plan-b</a>
</div>
