# TODO and Skipped Tests Audit (2026-02-25)

## Current totals

- `TODO` in `packages/*`: `44` (down from `56`)
- `FIXME` in `packages/*`: `0`
- skipped tests (`test.skip`, `it.skip`, `describe.skip`, `test.todo`, `it.todo`): `5` (down from `9`)

## What changed in this pass

- Unskipped and stabilized:
  - `packages/common/test/Crypto.test.ts`
  - `packages/common/test/Identicon.test.ts`
- Cleaned low-risk TODO stubs:
  - `packages/react-native/src/exports/bare-op-sqlite.ts`
  - `packages/web/src/WebWorker.ts` (commented skeleton)
- Removed storedBytes placeholders and added cumulative accounting:
  - `packages/common/src/local-first/Sync.ts`
  - `packages/common/src/local-first/Db.ts`
  - shared helper: `packages/common/src/local-first/Storage.ts`
- Added client-side quota checks in Sync receive path:
  - `packages/common/src/local-first/Sync.ts`
- Replaced global Sync mutex with per-owner mutexes:
  - `packages/common/src/local-first/Sync.ts`
- Removed stale heartbeat TODOs already covered by implemented failover logic:
  - `packages/common/src/local-first/Db.ts`
  - `packages/common/src/local-first/Shared.ts`
- Removed unused `Db` client-storage stub (including obsolete collaborative quota TODO):
  - `packages/common/src/local-first/Db.ts`
- Removed stale Sync TODO stubs/comments and added baseline Sync tests:
  - `packages/common/src/local-first/Sync.ts`
  - `packages/common/test/local-first/Sync.test.ts`

## Remaining skipped tests (intentional)

1. `packages/common/test/Result.test.ts:321`
2. `packages/common/test/Result.test.ts:1210`
   - Performance-only comparisons, not correctness tests.

3. `packages/common/test/local-first/Storage.test.ts:425`
4. `packages/common/test/local-first/Storage.test.ts:456`
   - Long-running stress tests (`1_000_000` scale / large collision experiment).

5. `packages/common/test/Sqlite.test.ts:615`
   - Performance benchmark (commented out), not correctness regression.

## High-value TODO clusters for issue extraction

### A) Sync transport wiring

- `packages/common/src/local-first/Sync.ts:209`
  - `createResource` still returns `todo()` for WebSocket transport creation.
  - Current tests cover no-transport local apply path, but live transport path remains intentionally stubbed.

Recommended scope: **M**

## Suggested execution order

1. Sync transport wiring completion (A).
