# Evolu Project Knowledge

## What is Evolu?

Local-first database with sync capabilities for React, React Native, Svelte, and Vue.

## Our Fork vs Upstream

| Aspect          | Upstream (evoluhq/evolu) | Our Fork (SQLoot/EvoLoot) |
| --------------- | ------------------------ | ------------------------- |
| Package manager | pnpm                     | **Bun**                   |
| Linter          | ESLint                   | **Biome**                 |
| Branch          | common-v8                | loot-main                 |
| Focus           | General use              | SQLoot-specific features  |

## Key Architectural Concepts

### Task API
- Functional effect system for async operations
- Replaces raw Promise patterns
- Supports dependency injection via `runner.deps`
- Uses `AsyncDisposableStack` for resource management

### Fiber/Runner
- Execution context for Tasks
- Manages abort signals and cleanup
- Structured concurrency
- Platform-specific implementations (`createRunner` for Node/Web)

### Console (Structured Logging)
- JSON-structured log output
- Console.child for scoped logging
- Independent from Task/Runner

## Package Structure

```
packages/
├── common/        # Core utilities, Effect-like abstractions
├── react/         # React hooks and components
├── react-native/  # React Native bindings
├── react-web/     # Web-specific React features
├── nodejs/        # Node.js server utilities
├── svelte/        # Svelte bindings
├── vue/           # Vue bindings
├── web/           # Web platform utilities
├── biome-config/  # Shared Biome configuration
└── tsconfig/      # Shared TypeScript configuration
```

## Important Files

- `packages/common/src/Task.ts` - Core Task implementation
- `packages/common/src/Console.ts` - Structured logging
- `packages/common/src/Result.ts` - Ok/Err result types
- `turbo.json` - Turborepo configuration
- `biome.json` - Biome linting config
