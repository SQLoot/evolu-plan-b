# TODO and Skipped Tests Audit (2026-02-25)

## Current totals

- `TODO` in `packages/*`: `52` (down from `56`)
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

### A) Sync correctness and scalability

- `packages/common/src/local-first/Sync.ts:484`
  - Per-owner mutex (currently global lock behavior).
- `packages/common/src/local-first/Sync.ts:513`
  - Quota checks for collaborative scenarios.
- `packages/common/src/local-first/Sync.ts:808`
  - Insert timestamp path marked for refactor/rethink.

Recommended scope: **M**

### B) Db worker failover hardening

- `packages/common/src/local-first/Db.ts:300`
  - Parallel stale-leader detection / heartbeat handover.

Recommended scope: **M**

### C) Shared quota/accounting parity

- `packages/common/src/local-first/Db.ts:590`
  - Quota checks for collaborative scenarios.

Recommended scope: **M**

## Suggested execution order

1. Quota checks (A + C).
2. Per-owner mutex in Sync (A).
3. Db stale-leader parallel detection (B).
