# Structured Concurrency in Evolu

## Overview
Evolu uses a custom implementation of structured concurrency to manage async operations, resource lifecycles, and cancellation. This replaces "fire and forget" promises with a strict tree structure where no child outlives its parent.

## Core Concepts

### Task
A functional effect description (lazy promise) that requires a `Runner` to execute.

```typescript
type Task<Success, Error = never, Deps = object> = (run: Runner<Deps>) => Promise<Result<Success, Error>>;
```

### Runner
The execution context. It provides:
- Dependency injection (`run.deps`).
- Abort signaling (cancellation propagation).
- Resource management (via `AsyncDisposableStack`).

### Platform-Specific Runners
As of `upstream/common-v8`, runners are platform-aware:

1.  **Web (`packages/web`)**:
    - Hooks into `globalThis` for `error` and `unhandledrejection`.
    - Cleans up listeners on dispose.

2.  **Node.js (`packages/nodejs`)**:
    - Hooks into `process` signals (`SIGINT`, `SIGTERM`, `SIGHUP`).
    - Provides graceful shutdown capabilities via `run.deps.shutdown`.

## Usage Pattern

### Creating a Runner
**DO NOT** use generic `createRunner` directly for app entry points. Use the platform-specific library.

```typescript
// Web
import { createRunner } from "@evolu/web";
// Node
import { createRunner } from "@evolu/nodejs";

const main = async () => {
   await using run = createRunner();
   const result = await run(myTask);
};
```

### AsyncDisposableStack
Resources that need cleanup should implement `AsyncDisposable` or be registered with the runner's stack environment.
