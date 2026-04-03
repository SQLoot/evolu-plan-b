# Evolu Plan B vs Upstream Evolu

This document tracks the current upstream sync baseline and the remaining fork
delta for `SQLoot/evolu-plan-b`.

## Canonical References

- upstream baseline: `upstream/main@e201eeb5`
- common-v8 merge anchor in upstream: `5aed29ff`
- current fork main after this sync wave: `origin/main` plus post-wave commits from
  `sync/upstream-main-2026-04-03`

## Post-Merge Upstream Commits Synced In This Wave

- `a3cf8bf3` Rename `@evolu/relay` package to `relay`
- `9143c9f4` Bump changesets schema; remove assemble patch
- `aa5cbbe8` Update `bun.lock`
- `e201eeb5` Create `.changeset/pre.json`

## Current Audit Summary

### Root / Tooling

- `same`: changesets schema/pre mode now match upstream post-merge baseline.
- `merge-both`: relay naming follows upstream `relay`, while Bun-first scripts,
  coverage gates and fork-specific maintenance scripts remain intact.
- `fork-intentional`: sync guard is generalized to `upstream/main`, but the
  legacy `common-v8` command stays as a deprecated alias for one wave.

### Runtime / API Parity

- No post-merge upstream code delta was found in:
  `packages/common`, `packages/nodejs`, `packages/web`, `packages/react`,
  `packages/react-web`, `packages/react-native`, `packages/vue`, `packages/svelte`.
- Result for this wave: no additional runtime/API cherry-picks are required
  before rebasing SQLoot compat metadata to the new upstream baseline.

### Remaining Fork Delta

- `fork-intentional`
  - Bun-first monorepo workflow and dependency policy.
  - Extra coverage gates and compat tree-shaking checks.
  - Bun-specific adapter/runtime experimentation and related tests.
  - SQLoot-facing maintenance/docs structure.
- `fork-suspect`
  - None identified by this post-merge sync sweep in compat-relevant package
    paths.
- `deferred`
  - Broader historical fork-vs-upstream drift outside this post-merge wave is
    still handled by targeted sync work, not by this summary file.

## Maintainer Rules

- Treat `upstream/main` as the canonical semantic baseline.
- Treat `evolu-plan-b/main` as the operational baseline for downstream compat
  consumers.
- If a compat-relevant package diff is not explained by upstream history or an
  explicit fork decision, classify it as `fork-suspect` and fix it in this repo
  before propagating it downstream.
