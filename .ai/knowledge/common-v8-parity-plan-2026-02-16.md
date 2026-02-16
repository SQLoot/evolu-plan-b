# Common-v8 Parity Plan (Bun-first)

## Goal

Reach practical `upstream/common-v8` compatibility for architecture/API/behavior while keeping:

- `bun` runtime and package manager
- `biome` instead of eslint/prettier
- reduced dependencies and Bun-native replacements where beneficial

## Hard Rules

- No wholesale merge of upstream branch.
- No return of removed tooling (`pnpm`, `pnpx`, `eslint`, `prettier`).
- Every upstream commit must be classified:
  - `verified-equivalent`
  - `pending-adopt`
  - `intentional-divergence`
- Any divergence must include reason + impact.

## Verification Gates

- `bunx tsc --build packages/common packages/web packages/react-native packages/nodejs`
- `bunx vitest run` for targeted suites around touched areas
- `bun run verify:fast`
- `SYNC_GUARD_MAIN_REF=miccy-dev bun run sync:guard:common-v8:strict`

## Upstream Commit Matrix (Current Snapshot)

Source: `git cherry -v miccy-dev upstream/common-v8`

| Upstream | Subject | Status | Local Note |
|---|---|---|---|
| `fc99998` | Add evoluError tab channel and error handling | `verified-equivalent` | Implemented via local worker/tab error flow (`EvoluTabOutput`, `InitTab`, shared `evoluError` store). |
| `c3e32b0` | Update pnpm-lock.yaml | `intentional-divergence` | Bun lockfile is authoritative. |
| `e62d12a` | Add microtask batch utility | `verified-equivalent` | Present in local fork (`microtask batch` utility + export). |
| `31e07eb` | Implement mutation methods | `pending-adopt` | Needs strict parity check for mutation dispatch/coalescing path. |
| `da75834` | Rename worker module to Shared | `intentional-divergence` | Keep `Worker.ts` naming in fork; behavior parity still required. |
| `019ad76` | Add testCreateWorker and worker tests | `verified-equivalent` | Backported: `testCreateWorker`, `testCreateMessageChannel`, `testCreateMessagePort`, `testCreateSharedWorker` + `packages/common/test/Worker.test.ts`. |
| `b90fae5` | Wire createEvolu to DB worker init | `pending-adopt` | Re-check against current `createEvolu` + DB worker init payload flow. |
| `d4fb5ba` | Wire platform DB workers and worker rename | `pending-adopt` | Port behavior without forced file/module rename. |
| `a986d23` | Add leader lock and worker init wiring | `pending-adopt` | Leader logic exists locally; verify contract and edge-cases against upstream. |
| `cc87fde` | Add canonical test name constants | `verified-equivalent` | `testName`/`testAppName` present locally. |
| `857608f` | Rename common test deps module | `verified-equivalent` | Test helper imports now converge on `_deps.ts`; `_deps.nodejs.ts` left as compatibility re-export shim. |
| `d5e7e3c` | Add React Native leader lock tests | `verified-equivalent` | RN leader lock tests are present and green. |
| `27a34ec` | Add web leader lock browser tests | `verified-equivalent` | Web leader lock browser tests are present and green. |
| `cb1e7e0` | Use store-only worker console output | `verified-equivalent` | Worker bootstrap now uses `createWorkerRun` + store output forwarding path. |
| `f05ec75` | Use Run<D> type for run.daemon | `verified-equivalent` | Already ported in local fork. |
| `af7aca4` | Update TreeShaking.test.ts | `pending-adopt` | Compare fixture/snapshot intent, keep Bun-compatible tooling. |
| `2cc6272` | Sort imports | `intentional-divergence` | Non-functional; handled by Biome formatting policy. |
| `2a585dc` | Centralize deterministic test values | `verified-equivalent` | Already ported. |
| `fb46547` | Use deterministic AppOwner in playground | `verified-equivalent` | Already ported. |
| `fefc8e3` | Refactor db worker init flow | `pending-adopt` | Reconcile with Bun-first worker runtime path. |
| `db759d4` | Broker channel wiring + leader acquired output | `pending-adopt` | Compare contract edges and callbacks end-to-end. |
| `a2a448d` | Typed NativeMessagePort generics | `verified-equivalent` | Already ported. |
| `746ea84` | Refactored local-first worker channel wiring | `verified-equivalent` | Already ported with Bun-first file layout. |
| `0b390f6` | Clarified SharedWorker communication comment | `verified-equivalent` | Doc-level parity covered in local comments/docs. |
| `0bbef0a` | Simplified worker deps + forwarded DbWorker console entries | `verified-equivalent` | Ported behavior; continue regression checks. |
| `57d2390` | Wired DbWorker init payload and worker output flow | `verified-equivalent` | Ported with local worker protocol/wiring. |
| `d4f0e5f` | Wired sqlite driver into React Native deps | `verified-equivalent` | Ported. |
| `096326e` | Documented type aliases for composed deps | `intentional-divergence` | Upstream `apps/web` docs were removed from this fork; docs parity is tracked in `website/apps/docs`. |
| `7f12041` | Refactored DB worker startup to initialize schema/bootstrap clock | `pending-adopt` | Needs selective backport into Bun worker path. |
| `f94006d` | SQLite throw-first semantics + protocol/storage alignment | `verified-equivalent` | Ported in local fork (conflict-resolved variant). |
| `1f7be0d` | Update pnpm-lock.yaml | `intentional-divergence` | Bun lockfile only. |
| `af2e3f6` | Use getOk in SQLite setup paths | `verified-equivalent` | Ported. |
| `717abb4` | Upgrade Biome to v2.4.0 and update config | `verified-equivalent` | Ported via local dependency/config update. |
| `c089ae9` | Queue mutations, add quarantine, rename messages | `pending-adopt` | Major functional gap to finish. |

## Execution Order

1. Worker/runtime parity batch:
   - `a986d23`, `fefc8e3`, `db759d4`, `b90fae5`, `d4fb5ba`, `857608f`, `d5e7e3c`, `27a34ec`, `cb1e7e0`
2. Mutation queue/protocol batch:
   - `31e07eb`, `c089ae9`
3. DB startup/docs batch:
   - `7f12041`, `019ad76`, `af7aca4`, `096326e`

## Bun-native Replacement Opportunities (After Parity)

- Keep `webpack` only where explicitly needed for compatibility snapshots (tree-shaking baseline).
- Add optional Bun-native comparison path (`bun build --minify`) for internal perf tracking, not as baseline replacement.
- Review and remove redundant Node-era tooling wrappers where Bun provides equivalent runtime/build/test behavior.
