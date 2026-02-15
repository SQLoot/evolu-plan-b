# Cherry-pick upstream/common-v8 → feat/finalize-v8

> **Status**: 🔄 In Progress  
> **Last Updated**: 2026-02-01  
> **Branch**: `feat/finalize-v8`

## Summary

Migrating changes from `upstream/common-v8` to our fork, while preserving our stack choices (Bun, Biome).

## Current State

| Metric                    | Value   |
| ------------------------- | ------- |
| Total commits in upstream | ~214    |
| Already cherry-picked     | ~55     |
| Remaining (filtered)      | **158** |
| Skipped (pnpm/ESLint)     | 14      |

## Tooling Updates

| Tool    | Before | After | Status           |
| ------- | ------ | ----- | ---------------- |
| Bun     | 1.3.6  | 1.3.9 | ✅ Done           |
| Biome   | 2.3.15 | 2.4.0 | ✅ Current        |
| Turbo   | 2.8.8  | 2.8.9 | ✅ Current        |
| Node.js | >=24   | >=24  | ✅ LTS 24 correct |

## Commit Categories

| Priority | Category               | ~Count | Status    |
| -------- | ---------------------- | ------ | --------- |
| 🔴 High   | Task/Runner API        | 29     | ⏳ Pending |
| 🔴 High   | Console/Logging        | 10     | ⏳ Pending |
| 🟡 Medium | Concurrency primitives | 15     | ⏳ Pending |
| 🟡 Medium | Test utilities         | 21     | ⏳ Pending |
| 🟡 Medium | Utils/Helpers          | 38     | ⏳ Pending |
| 🟢 Low    | Docs/Refactor          | 45     | ⏳ Pending |

## Skip List (13 commits)

These commits are intentionally skipped:
- `Update pnpm-lock.yaml` (7×) - we use bun.lock
- `Enable evolu ESLint config` - we use Biome
- `Add evolu ESLint plugin` - not needed
- `Add 'out' directory to ESLint ignore` - N/A

## Batch Strategy

1. **Batch 1**: Task/Runner Core (critical APIs)
2. **Batch 2**: Console & Structured Logging  
3. **Batch 3**: Concurrency primitives
4. **Batch 4**: Test utilities
5. **Batch 5**: Utils/Helpers
6. **Batch 6**: Docs/Refactor (optional)

After each batch: `bun run build && bun run test`

## Key Commits to Cherry-pick

### Task/Runner (High Priority)
```
01147fc Migrate storage/protocol to Task-based runner
3c1fbd6 Implement Task-based fetch with abort handling
5dcd295 Refactor createSqlite to Task
6f74ea5 Add Node runMain utility
4e0eba1 Add MainTask type and improve runMain error handling
a551a38 Use task/stack-based lifecycle for relay
4dc2b23 Handle aborted runner; add tests
af3e065 Expose runner.deps and remove task deps param
ee7bf62 Use Ref for runner deps and update addDeps
b7e3bf1 Refactor Runner and Fiber state management
acca39d Refactor WebSocket to Task-based API and update tests  ← NEW
afa8422 Remove legacy OldTask implementation                   ← NEW
37fd12b Force disposal tasks to have no domain errors          ← NEW
```

### Console (High Priority)
```
58a2d78 Refactor Console to structured logging
c3aa766 Refine Console docs and imports
3d2caa0 Use run.console.child for SQLite logging
ca0bffe Use child console in relay main
```

### Concurrency (Medium Priority)
```
f16af10 Add concurrency primitives: Deferred, Gate, Semaphore, Mutex
972bc61 Refactor AbortError to use 'cause' and improve Semaphore
b3387c5 Rename Semaphore and Mutex interfaces to SemaphoreOld and MutexOld
1c1afa8 Rename withConcurrency to parallel and concurrent to pool
```

### Utils/Helpers (Medium Priority) - NEW
```
ecf32ba Add isHermes/isServer flags and tests                  ← NEW
c04d6b0 Add Promise-based setTimeout to Time module            ← NEW
a18a60e Stub WebSocket transport with todo()                   ← NEW
118b193 Use Awaitable/isPromiseLike instead of MaybeAsync      ← NEW
4f2f271 Require capitalized discriminant 'type'                ← NEW
```

### Tests/Docs (Low Priority) - NEW
```
7b65d1a Update TreeShaking test size values                    ← NEW
b0288ea Replace wait() with setTimeout() in Relay tests        ← NEW
2166331 Mark Resources tests as TODO                           ← NEW
0e75984 Update feature copy and adjust test gzip size          ← NEW
f13aac5 Add expectTypeOf examples for todo                     ← NEW
```

## Verification

```bash
bun run build        # TypeScript compilation
bun run test         # Unit tests
bun run lint         # Biome linting
bun run verify       # Full verification
```

## History

| Date       | Action                                  | Commits             |
| ---------- | --------------------------------------- | ------------------- |
| 2026-01-17 | Started cherry-pick                     | Phase 1: 13 commits |
| 2026-01-21 | Merged feat/merge-common-v8-jan21       | Utilities           |
| 2026-01-23 | Created feat/cherrypick-common-v8-jan23 | Phase 2             |
| 2026-02-01 | Merged into feat/finalize-v8            | Consolidation       |
| 2026-02-01 | Updated Bun 1.3.6 → 1.3.8               | Tooling             |
| 2026-02-02 | Added 13 new upstream commits           | Pre-cherrypick      |

## Next Steps

1. [ ] Run `bun install` (resolve tempdir issue)
2. [ ] Cherry-pick Batch 1 (Task/Runner)
3. [ ] Verify build and tests
4. [ ] Continue with remaining batches
