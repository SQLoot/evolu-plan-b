# Evolu Plan B vs Upstream Evolu (High-Level)

This document summarizes the main differences between `SQLoot/evolu-plan-b` and upstream `evoluhq/evolu`.

Scope: high-level product and engineering deltas, not a full commit-by-commit changelog.

## What Is Different

| Area | Plan B Delta | Why |
| --- | --- | --- |
| Tooling baseline | Bun-first monorepo workflows (`bun install`, `bun run ...`) with Turborepo orchestration. | Faster local workflows and a single runtime/tooling story. |
| Formatting and linting | Biome-first formatting/linting policy. | Reduce tooling complexity and keep style/lint fast and consistent. |
| Upstream sync process | Added sync guard tooling and explicit compatibility tracking for `common-v8` sync waves. | Keep upstream parity while avoiding accidental regressions in fork-specific work. |
| Coverage governance | Added file-level coverage gates for critical local-first paths (`Sync`, `Db`, `Worker`, `DbWorker`, etc.). | Enforce reliability on highest-risk runtime paths before merges. |
| Bun runtime adapter | Added Bun-specific worker/db adapter package (`@evolu/bun`, currently private). | Native Bun runtime support and experimentation without changing upstream APIs. |
| Test expansion | Extra tests for sync/worker/sqlite/refactor edge cases, including runtime adapter races (`DbWorker initPromise` cleanup, Relay WS lifecycle/broadcast flows). | Protect against regressions during aggressive sync and refactor work. |

## What Is Intentionally the Same

| Area | Compatibility Target |
| --- | --- |
| Public local-first API | Keep API compatibility with upstream where possible. |
| Protocol and schema direction | Follow upstream `common-v8` refactor direction and naming. |
| Core behavior | Preserve upstream semantics unless explicitly documented as fork-only behavior. |

## What Is Extra in Plan B

- Integration coverage dashboards/gates in fork workflow.
- Bun-focused adapter experiments and tests.
- SQLoot-specific maintenance/docs structure for sync operations.

## Non-Goals

- This fork is not intended to fragment protocol behavior from upstream.
- This file is not a replacement for release notes.
