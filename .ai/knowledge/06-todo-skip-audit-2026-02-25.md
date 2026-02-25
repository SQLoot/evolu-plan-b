# TODO and Skipped Tests Audit (2026-02-25)

## Current totals

- `TODO` in `packages/*`: `54` (down from `56`)
- `FIXME` in `packages/*`: `0`
- skipped tests (`test.skip`, `it.skip`, `describe.skip`, `test.todo`, `it.todo`): `7` (down from `9`)

## What changed in this pass

- Unskipped and stabilized:
  - `packages/common/test/Crypto.test.ts`
  - `packages/common/test/Identicon.test.ts`
- Cleaned low-risk TODO stubs:
  - `packages/react-native/src/exports/bare-op-sqlite.ts`
  - `packages/web/src/WebWorker.ts` (commented skeleton)

## Remaining skipped tests (intentional)

1. `packages/common/test/TreeShaking.test.ts:207`
   - Compat lane is intentionally gated by `EVOLU_TREE_SHAKING_COMPAT=1`.
   - Covered by dedicated CI workflow (`tree-shaking-compat.yaml`).

2. `packages/nodejs/test/Sqlite.test.ts:154`
   - Conditional skip when `better-sqlite3` runtime is unavailable.
   - Kept for portability; preflight still verifies Node/Bun native module compatibility.

3. `packages/common/test/Result.test.ts:321`
4. `packages/common/test/Result.test.ts:1210`
   - Performance-only comparisons, not correctness tests.

5. `packages/common/test/local-first/Storage.test.ts:417`
6. `packages/common/test/local-first/Storage.test.ts:448`
   - Long-running stress tests (`1_000_000` scale / large collision experiment).

7. `packages/common/test/Sqlite.test.ts:615`
   - Performance benchmark (commented out), not correctness regression.

## High-value TODO clusters for issue extraction

### A) Sync correctness and scalability

- `packages/common/src/local-first/Sync.ts:467`
  - Per-owner mutex (currently global lock behavior).
- `packages/common/src/local-first/Sync.ts:496`
  - Quota checks for collaborative scenarios.
- `packages/common/src/local-first/Sync.ts:744`
  - Real client `storedBytes` accounting (placeholder currently used).

Recommended scope: **M**

### B) Db worker failover hardening

- `packages/common/src/local-first/Db.ts:291`
  - Parallel stale-leader detection / heartbeat handover.

Recommended scope: **M**

### C) Shared quota/accounting parity

- `packages/common/src/local-first/Db.ts:581`
  - Quota checks for collaborative scenarios.
- `packages/common/src/local-first/Db.ts:831`
  - Proper `storedBytes` tracking for received/sent encrypted payloads.

Recommended scope: **M-L**

## Suggested execution order

1. Sync `storedBytes` + quota checks (A + C).
2. Per-owner mutex in Sync (A).
3. Db stale-leader parallel detection (B).

