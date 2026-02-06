# .ai Directory: evolu-plan-b

AI assistant context and instructions for this repository.

## Purpose

Provides shared context for AI assistants across:
- Different IDEs (Claude, Cursor, Windsurf, Copilot, etc.)
- Different AI models
- Multiple chat sessions

## Structure

```
.ai/
├── README.md           # This file
├── knowledge/          # Project-specific technical docs
│   └── *.md            # Architecture, decisions, etc.
├── tasks/
│   ├── active/         # In-progress tasks (check first!)
│   └── archive/        # Completed tasks
├── workflows/          # Reusable procedures
│   └── cherry-pick.md  # Upstream sync workflow
├── personas/           # Agent role definitions
└── memory/             # Preferences, learned patterns
    └── decisions.md    # Past decisions for consistency
```

## 🚀 Quick Start for AI

1. **Read** `../AGENTS.md` first (repo root)
2. **Check** `tasks/active/` for current work
3. **Reference** `../../knowledge/05-Issues/` for issues
4. **Use** `workflows/` for common procedures

## 📍 Context Priority

When working on this repo, load context in this order:

1. `../AGENTS.md` - Repo overview
2. `tasks/active/*.md` - Current tasks
3. `../../knowledge/05-Issues/roadmap.md` - Priorities
4. `knowledge/*.md` - Technical details

## 🔄 Current Focus

**Milestone**: M0 - Housekeeping  
**Task**: Cherry-pick from upstream/common-v8

See `tasks/active/` for details.

## 🤖 Agent Guidelines

### Code Style
- TypeScript strict mode
- Biome for lint/format (not ESLint)
- Functional patterns where appropriate
- Explicit types over inference

### Commit Messages
```
<type>(<scope>): <description>

Types: feat, fix, refactor, test, docs, chore
Scope: common, web, react, relay, etc.
```

### PR Workflow
1. Create branch from `main`
2. Make changes
3. Run `bun run verify`
4. Create PR with description
5. Reference LOOT issue if applicable

## 🔗 Related

- **Organization KB**: `../../knowledge/`
- **Global AI rules**: `../../.ai/`
- **Bench Suite**: `../../bench-suite/`

---

Maintained by @miccy | SQLoot Organization
