# Bun Migration & Cleanup & Default Branch

> **Status**: 🔄 In Progress
> **Last Updated**: 2026-02-02
> **Branch**: `main`

## Summary
Complete migration from pnpm/ESLint/Prettier to Bun/Biome across the entire monorepo. This replaces the complex cherry-pick strategy with a "Fresh Start" from `upstream/common-v8`.
Also, set `main` as the default branch on GitHub.

## Tasks

- [ ] **Cleanup Legacy Tooling**
  - [ ] Remove `pnpm`-related files (`pnpm-lock.yaml`, `pnpm-workspace.yaml`, `.npmrc` if any)
  - [ ] Remove `eslint`-related files (`.eslintrc`, `eslint.config.mjs`, `.eslintignore`, etc.)
  - [ ] Remove `prettier`-related files (`.prettierrc`, `.prettierignore`, `prettier.config.mjs`)
  - [ ] Scan and update `package.json` in all packages to remove `eslint`/`prettier` scripts and deps
  - [ ] Run `bun run clean` & `bun install` to ensure clean state
- [ ] **Set Default Branch**
  - [ ] Set `main` as default branch on `origin` (SQLoot/evolu-plan-b) via `gh repo edit`
- [ ] **Verification**
  - [ ] Verify build passes without legacy tools
  - [ ] Verify `lint` command runs Biome only

