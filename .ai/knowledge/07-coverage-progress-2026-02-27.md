# Coverage Progress (2026-02-27)

## Context

This note tracks the `P0+P1` coverage hardening wave on top of `origin/main`.
The new file-level gates are implemented by `scripts/coverage-file-gate.mts` and root scripts:

- `bun run coverage:gate:p0`
- `bun run coverage:gate:p1`

## Current Snapshot (from `bunx vitest run --coverage`)

### P0 target files (target: `>=90% statements` and `>=90% branches`)

| File | Statements | Branches | Status |
|---|---:|---:|---|
| `packages/common/src/local-first/Sync.ts` | 73.98% | 51.85% | ❌ |
| `packages/common/src/local-first/Db.ts` | 91.05% | 68.75% | ❌ (branches) |
| `packages/common/src/local-first/Worker.ts` | 92.85% | 77.77% | ❌ (branches) |
| `packages/web/src/local-first/DbWorker.ts` | 81.91% | 61.85% | ❌ |

### P1 target files

| File | Target | Current | Status |
|---|---|---|---|
| `packages/common/src/local-first/LocalAuth.ts` | `>=75 / >=60` | `98.57 / 73.52` | ✅ |
| `packages/web/src/local-first/LocalAuth.ts` | `>=75 / >=60` | `94.18 / 82.69` | ✅ |
| `packages/nodejs/src/Worker.ts` | `>=90 / >=85` | `88.88 / 62.50` | ❌ |
| `packages/nodejs/src/Sqlite.ts` | `>=90 / >=85` | `90.69 / 75.00` | ❌ (branches) |

## What was added in this wave

- Sync hardening in `Sync.ts`:
  - `validateWriteKey` and `setWriteKey` implemented (no `lazyFalse/lazyVoid` fallback).
  - `evolu_writeKey` table bootstrap added in client storage path.
  - `testCreateClientStorage` helper exported for direct storage-path tests.
- New/expanded tests:
  - `packages/common/test/local-first/Sync.test.ts`
  - `packages/common/test/local-first/Db.internal.test.ts`
  - `packages/common/test/local-first/Worker.test.ts`
  - `packages/common/test/local-first/LocalAuth.test.ts`
  - `packages/web/test/DbWorker.test.ts`
  - `packages/web/test/LocalAuth.test.ts`
  - `packages/nodejs/test/Worker.test.ts`
  - `packages/nodejs/test/Sqlite.test.ts`
- Node SQLite adapter fix:
  - Better-sqlite variadic parameter forwarding corrected (`all/run(...parameters)`).

## Next gap-focused actions

1. `Sync.ts` branch lift:
   - Exercise unresolved protocol-application branches and write/quota/abort edge flows more directly (likely via additional test hooks).
2. `Db.ts` branch lift:
   - Cover remaining request error branches and clock/path edge cases around queued processing.
3. `common Worker.ts` + `web DbWorker.ts` branch lift:
   - Add error/default branch tests and heartbeat race corner cases.
4. `nodejs Worker/Sqlite` branch lift:
   - Explicitly hit transfer/error fallback branches not yet covered in current mocks.
