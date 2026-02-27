# Coverage Progress (2026-02-27)

## Context

This note tracks the `P0+P1` coverage hardening wave on top of `origin/main`.
The new file-level gates are implemented by `scripts/coverage-file-gate.mts` and root scripts:

- `bun run coverage:gate:p0`
- `bun run coverage:gate:p1`

## Current Snapshot (from `bun run test:coverage` on branch `test-coverage`)

### P0 target files (target: `>=90% statements` and `>=90% branches`)

| File | Statements | Branches | Status |
|---|---:|---:|---|
| `packages/common/src/local-first/Sync.ts` | 96.83% | 90.83% | ✅ |
| `packages/common/src/local-first/Db.ts` | 99.47% | 91.66% | ✅ |
| `packages/common/src/local-first/Worker.ts` | 95.23% | 100.00% | ✅ |
| `packages/web/src/local-first/DbWorker.ts` | 98.91% | 93.47% | ✅ |

### P1 target files

| File | Target | Current | Status |
|---|---|---|---|
| `packages/common/src/local-first/LocalAuth.ts` | `>=75 / >=60` | `100.00 / 94.11` | ✅ |
| `packages/web/src/local-first/LocalAuth.ts` | `>=75 / >=60` | `100.00 / 92.30` | ✅ |
| `packages/nodejs/src/Worker.ts` | `>=90 / >=85` | `100.00 / 100.00` | ✅ |
| `packages/nodejs/src/Sqlite.ts` | `>=90 / >=85` | `100.00 / 93.75` | ✅ |

Coverage gate status:

- `bun run coverage:gate:p0` ✅
- `bun run coverage:gate:p1` ✅

## Recent Additions (latest wave)

- Adapter/wrapper coverage:
  - `packages/web/test/Evolu.test.ts`
  - `packages/web/test/Worker.test.ts`
  - `packages/react-web/test/local-first/Evolu.test.ts`
  - `packages/nodejs/test/WebPlatform.test.ts`
- Common helper/runtime branch coverage:
  - `packages/common/test/local-first/Kysely.test.ts`
  - `packages/common/test/local-first/Schema.test.ts` (index add/drop, `createQueryBuilder` options, `getEvoluSqliteSchema`)
  - `packages/common/test/Error.test.ts` (`handleGlobalError` branches)
  - `packages/common/test/String.test.ts` (new file)
  - `packages/common/test/local-first/LocalAuth.test.ts` (mnemonic path, missing account, username fallback, unregister without fallback owner)
  - `packages/web/test/LocalAuth.test.ts` (credential throw/missing userHandle/legacy metadata/create-null branches)
  - `packages/common/test/local-first/Relay.test.ts` (zero-byte write path and mutex-abort propagation)
- Small runtime hardening:
  - `packages/common/src/String.ts` now guarantees `string` return even when `JSON.stringify` returns `undefined` (`symbol` case).

## Runtime Adapter Hardening Wave (Relay + DbWorker)

- `packages/nodejs/test/Relay.test.ts`
  - Added deterministic websocket scenarios for `subscribe -> broadcast -> unsubscribe`.
  - Added restart scenario with existing relay DB file.
- `packages/web/test/DbWorker.test.ts`
  - Added failure-race coverage where follower waits on failing shared `initPromise` and later recovery succeeds.
- `packages/web/src/local-first/DbWorker.ts`
  - Added optional test hook `createDriver` into `runWebDbWorkerPortWithOptions` for deterministic init-failure injection (runtime default unchanged).
- `packages/nodejs/src/local-first/Relay.ts`
  - Fixed WS message handling lifecycle to use daemon runner deps (`_run.daemon.addDeps(...)`) so callbacks are not aborted after `startRelay` returns.
  - Kept runtime payload path simple and Bun/Node compatible (`Buffer.from(...)` for outbound binary sends).

## Quick-Win Backlog (post P0/P1)

Prioritized by risk + effort for next PR slices:

1. `packages/web/src/Sqlite.ts` (`82.92% / 76.92%`, missing `3/13` branches)
   - Remaining branches are OPFS init paths in main thread (`encrypted/default`) and warning fallback; deterministic coverage likely needs injectable sqlite-wasm facade.
2. `packages/common/src/local-first/Protocol.ts` (`92.93% / 88.83%`, missing `24/215`)
   - Slightly below 90 branch; higher complexity than the three items above.
3. `packages/common/src/Console.ts` (`84.21% / 84.00%`, missing `8/50`)
   - Moderate complexity; mostly branch-focused unit tests.
4. `packages/common/src/local-first/Relay.ts` (`96.00% / 85.00%`, missing `3/20`)
  - Small remaining branch gap after latest write-path additions.
5. `packages/nodejs/src/local-first/Relay.ts` (`97.77% / 81.25%`, missing `3/16`)
  - Remaining branch gap is now isolated in guarded branches around owner auth and ws event variants; can be closed with focused adapter tests.
6. `packages/common/src/Type.ts` (`73.50% / 68.32%`, missing `121/382`)
  - Big-impact but not a quick win; needs dedicated focused campaign.

## Commit Trace (current head segment)

- `308958f4` `fix(nodejs): use daemon runner for relay ws message handling`
- `e61403e8` `test(web): cover shared initPromise failure cleanup`
- `5e8ac520` `test(nodejs): cover relay subscribe and restart paths`
- `67f34c74` `test(relay): cover zero-byte and mutex-abort write paths`
- `69e3811d` `test(local-auth): expand common and web edge-case coverage`
- `4ddb510c` `docs(ai): refresh coverage progress snapshot and quick-win backlog`
- `71ce2289` `fix(common): guarantee string fallback in safelyStringifyUnknownValue`
- `c18a4777` `test(common): expand schema and error branch coverage`
- `6653d541` `test(common): fix Kysely test import ordering for Biome`
