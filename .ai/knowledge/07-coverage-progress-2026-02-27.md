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
| `packages/web/src/local-first/DbWorker.ts` | 95.65% | 92.13% | ✅ |

### P1 target files

| File | Target | Current | Status |
|---|---|---|---|
| `packages/common/src/local-first/LocalAuth.ts` | `>=75 / >=60` | `98.57 / 73.52` | ✅ |
| `packages/web/src/local-first/LocalAuth.ts` | `>=75 / >=60` | `94.18 / 82.69` | ✅ |
| `packages/nodejs/src/Worker.ts` | `>=90 / >=85` | `100.00 / 100.00` | ✅ |
| `packages/nodejs/src/Sqlite.ts` | `>=90 / >=85` | `100.00 / 87.50` | ✅ |

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
- Small runtime hardening:
  - `packages/common/src/String.ts` now guarantees `string` return even when `JSON.stringify` returns `undefined` (`symbol` case).

## Quick-Win Backlog (post P0/P1)

Prioritized by risk + effort for next PR slices:

1. `packages/web/src/Sqlite.ts` (`82.92% / 76.92%`, missing `3/13` branches)
   - Add deterministic mocked init-path tests (`encrypted`/default OPFS and warning filter).
   - Low branch count, high return.
2. `packages/common/src/local-first/LocalAuth.ts` (`98.57% / 73.52%`, missing `9/34`)
   - Focus decrypt-fail/null credential + metadata consistency edge branches.
3. `packages/web/src/local-first/LocalAuth.ts` (`94.18% / 82.69%`, missing `9/52`)
   - Add adapter error/null propagation branches mirroring common LocalAuth cases.
4. `packages/common/src/local-first/Protocol.ts` (`92.93% / 88.83%`, missing `24/215`)
   - Slightly below 90 branch; higher complexity than the three items above.
5. `packages/common/src/Type.ts` (`73.50% / 68.32%`, missing `121/382`)
   - Big-impact but not a quick win; needs dedicated focused campaign.

## Commit Trace (current head segment)

- `71ce2289` `fix(common): guarantee string fallback in safelyStringifyUnknownValue`
- `c18a4777` `test(common): expand schema and error branch coverage`
- `6653d541` `test(common): fix Kysely test import ordering for Biome`
- `27363565` `test(web): cover worker wrappers and deprecated scopes`
- `f283c0c7` `test(common): add coverage for Kysely JSON helpers`
- `27f6d8d9` `test(web): cover evolu adapters and platform reload path`
