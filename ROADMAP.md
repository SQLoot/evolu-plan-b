# Roadmap

## Phase 1: Cherry-pick common-v8 (Completed)
- [x] Integrate `all`, `withConcurrency` (aa6111fb)
- [x] Integrate `allSettled`, `forEach`, `any` (a4656957)
- [x] Documentation updates
- [x] Strict build fixes (Test.ts, Task.test.ts)

## Phase 2: Refactoring (Upcoming)
- [ ] `arrayFrom` refactor (Commit `e013cfd0`)
    - **Breaking Change**: Replace `createArray`/`ensureArray` with `arrayFrom`.
    - Requires updates across all packages.

## Phase 3: Future
- [ ] Further common-v8 synchronizations.
