# Bun Migration & Cleanup & Default Branch

> **Status**: ✅ Completed
> **Last Updated**: 2026-02-03
> **Branch**: `main`

## Summary
Complete migration from pnpm/ESLint/Prettier to Bun/Biome across the entire monorepo. This replaces the complex cherry-pick strategy with a "Fresh Start" from `upstream/common-v8`.
Also, set `main` as the default branch on GitHub.

## Tasks

- [x] **Cleanup Legacy Tooling**
  - [x] Remove `pnpm`-related files (`pnpm-lock.yaml`, `pnpm-workspace.yaml`, `.npmrc` if any)
  - [x] Remove `eslint`-related files (`.eslintrc`, `eslint.config.mjs`, `.eslintignore`, etc.)
  - [x] Remove `prettier`-related files (`.prettierrc`, `.prettierignore`, `prettier.config.mjs`)
  - [x] Scan and update `package.json` in all packages to remove `eslint`/`prettier` scripts and deps
  - [x] Run `bun run clean` & `bun install` to ensure clean state
- [x] **Set Default Branch**
  - [x] Set `main` as default branch on `origin` (SQLoot/evolu-plan-b)
- [x] **Verification**
  - [x] Verify build passes without legacy tools
  - [x] Verify `lint` command runs Biome only
