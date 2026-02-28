# Dependencies & Tooling

## Package Manager

**Bun** (not pnpm/npm)

```bash
bun install          # Install dependencies
bun run <script>     # Run scripts
bunx <package>       # Execute packages
```

## Version Requirements

| Tool       | Minimum  | Current |
| ---------- | -------- | ------- |
| Node.js    | >=24.0.0 | 24 LTS + 25 current |
| Bun        | 1.3.8    | 1.3.10   |
| TypeScript | ^5.9.3   | 5.9.3   |

## Key Dependencies

### Development
- **Turbo** 2.8.9 - Monorepo build orchestration
- **Biome** 2.4.0 - Linting and formatting
- **Vitest** ^4.0.18 - Testing framework
- **TypeDoc** ^0.28.16 - API documentation

### Production
- **React** ^19.2.4
- **Kysely** - SQL query builder
- No external runtime dependencies for core

## Commands

```bash
bun run build        # Build all packages
bun run test         # Run all tests
bun run lint         # Lint with Biome
bun run format       # Format code
bun run verify       # Build + test + lint + monorepo check
bun run clean        # Clean all build artifacts
```

## What NOT to Use

- ❌ pnpm / npm / yarn
- ❌ ESLint / Prettier
- ❌ pnpm-lock.yaml (we have bun.lock)
- ❌ Node.js <24
