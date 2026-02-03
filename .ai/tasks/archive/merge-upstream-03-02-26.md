# Merge & Integrate Upstream Commits

> **Status**: ✅ Completed
> **Last Updated**: 2026-02-03
> **Branch**: `sync/merge-upstream-03-02-26`

## Summary
Integration of 14 commits from `upstream/common-v8` bringing significant changes to the Task runner architecture and tooling.

## Key Changes
- **Structured Concurrency**:
  - `TaskDisposableStack` -> `AsyncDisposableStack`.
  - `runMain` -> `createRunner` (platform-specific implementations).
  - Web: Uses `globalThis` event listeners for error handling.
  - Node.js: Uses `process` signals (SIGINT, SIGTERM) for graceful shutdown.
- **Relay**: `createNodeJsRelay` -> `startRelay`.
- **Tooling**: Full removal of `pnpm` artifacts, reliance on Bun & Biome.

## Verification
- `bun verify` passes (with caveats, see below).
- Manual confirmation of `createRunner` types export.

## Known Issues
- **TreeShaking Test**: `packages/common/test/TreeShaking.test.ts` shows minor bundle size fluctuations (~9 bytes) between local `bun test` and `bun verify` / CI. This is a known environmental flake.
