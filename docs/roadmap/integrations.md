# Integrations Roadmap (Detailed)

Snapshot date: `2026-03-03`

## Progress Model

Integration progress is measured by a weighted checklist (`20%` each):

- Adapter/helper package
- Reference example
- Test lane + coverage gate
- Framework guide (README/docs)
- CI smoke/hardening

Current `%` is computed from completed core items only, so values use `0%`, `20%`, `40%`, `60%`, `80%`, or `100%`.

## Baseline Matrix

| Integration | Current % | Priority | Epic Size | Local Status |
| --- | --- | --- | --- | --- |
| Electrobun | 0% | P0 | L | Planned architecture |
| Next.js (App Router) | 40% | P0 | L | Active hardening |
| TanStack Start | 60% | P0 | M | Active hardening |
| Astro | 60% | P0 | M | Active hardening |
| SvelteKit | 20% | P1 | M | Planned |
| Nuxt 3 | 0% | P1 | L | Planned |
| Remix / React Router | 20% | P1 | M | Planned |
| Tauri | 60% | P1 | M | Active hardening |
| Electron | 20% | P1 | M | Planned hardening |
| Capacitor (Ionic) | 20% | P2 | L | Upstream watch + POC |
| Flutter | 0% | P2 | XL | Research |

## Next.js (App Router)

Current `%`: `40%` | Priority: `P0` | Epic size: `L`

- [x] `(P0, M)` Reference app exists (`examples/react-nextjs`)
- [x] `(P0, S)` React web adapter baseline exists (`@evolu/react-web`)
- [ ] `(P0, M)` SSR/client boundary guide for App Router (`"use client"`, provider placement, suspense boundaries)
- [ ] `(P0, S)` Hydration edge-case runbook (owner restore, first sync, offline boot)
- [ ] `(P0, S)` Production deployment runbook (Node runtime constraints, env contracts)
- [ ] `(P0, M)` CI smoke lane (`dev`, `build`, client bootstrap check)

## TanStack Start

Current `%`: `60%` | Priority: `P0` | Epic size: `M`

- [x] `(P0, S)` Helper package exists (`packages/tanstack-start`)
- [x] `(P0, S)` Reference example exists (`examples/tanstack-start`)
- [x] `(P0, S)` Test lane + coverage gate exists (`coverage:lane:tanstack`)
- [ ] `(P0, S)` Official framework guide in docs
- [ ] `(P0, S)` Runtime diagnostics guide (client boundary failures, error code handling)
- [ ] `(P0, S)` CI smoke lane for example app

## Astro

Current `%`: `60%` | Priority: `P0` | Epic size: `M`

- [x] `(P0, S)` Helper package exists (`packages/astro`)
- [x] `(P0, S)` Reference example exists (`examples/astro`)
- [x] `(P0, S)` Test lane + coverage gate exists (`coverage:lane:astro`)
- [ ] `(P0, S)` Astro island boot guide (`client:only`, state hydration)
- [ ] `(P0, S)` Client-only guard cookbook (`ASTRO_CLIENT_ONLY` handling)
- [ ] `(P0, S)` CI smoke lane for Astro example

## SvelteKit

Current `%`: `20%` | Priority: `P1` | Epic size: `M`

- [x] `(P1, S)` Svelte wrapper baseline exists (`@evolu/svelte`)
- [ ] `(P1, M)` Dedicated SvelteKit integration helper/recipe
- [ ] `(P1, M)` Reference SvelteKit example app
- [ ] `(P1, S)` Test lane + CI smoke for SvelteKit runtime boundary
- [ ] `(P1, S)` Troubleshooting guide (client-only initialization + offline lifecycle)

## Nuxt 3

Current `%`: `0%` | Priority: `P1` | Epic size: `L`

- [ ] `(P1, M)` Nuxt client plugin/module integration pattern
- [ ] `(P1, M)` Nuxt reference example app
- [ ] `(P1, S)` SSR-safe initialization recipe
- [ ] `(P1, M)` Test lane + CI smoke for Nuxt app
- [ ] `(P1, S)` Documentation and migration guide from Vue-only usage

## Remix / React Router

Current `%`: `20%` | Priority: `P1` | Epic size: `M`

- [x] `(P1, S)` React web baseline exists (`@evolu/react-web`)
- [ ] `(P1, M)` Route-level client bootstrap pattern for Remix/React Router
- [ ] `(P1, M)` Reference example app
- [ ] `(P1, S)` SSR boundary docs (loader/actions vs client runtime)
- [ ] `(P1, S)` CI smoke lane

## Tauri

Current `%`: `60%` | Priority: `P1` | Epic size: `M`

- [x] `(P1, S)` Helper package exists (`packages/tauri`)
- [x] `(P1, S)` Reference example exists (`examples/tauri`)
- [x] `(P1, S)` Package tests exist (`packages/tauri/test`)
- [ ] `(P1, M)` Renderer/main bridge hardening guide
- [ ] `(P1, S)` Secure storage path guidance
- [ ] `(P1, S)` Tauri build smoke lane in CI
- [ ] `(P1, S)` Offline + sync runbook

## Electron

Current `%`: `20%` | Priority: `P1` | Epic size: `M`

- [x] `(P1, S)` Reference app exists (`examples/react-electron`)
- [ ] `(P1, M)` Dedicated Electron helper package (runtime/process guards)
- [ ] `(P1, M)` Secure preload contract and IPC boundaries
- [ ] `(P1, S)` Packaging smoke lane in CI
- [ ] `(P1, S)` Process-boundary docs (renderer vs main responsibilities)

## Electrobun

Current `%`: `0%` | Priority: `P0` | Epic size: `L`

Phase 1 (`today`, required for first usable integration):

- [ ] `(P0, M)` Create package `@evolu/electrobun` in monorepo
- [ ] `(P0, S)` Bun backend is default (`bun:sqlite`)
- [ ] `(P0, S)` WASM backend is optional via explicit configuration
- [ ] `(P0, M)` RPC bridge is mandatory for Bun backend (typed request/response + lifecycle errors)
- [ ] `(P0, M)` Hybrid renderer selector:
- [ ] `(P0, S)` macOS: native renderer default
- [ ] `(P0, S)` Windows: native renderer default
- [ ] `(P0, S)` Linux: CEF default
- [ ] `(P0, S)` V1 scope guarantees one primary webview/window only

Phase 2 (after V1 stability):

- [ ] `(P1, M)` CI smoke lanes for all renderer defaults (`macOS`, `Windows`, `Linux`)
- [ ] `(P1, S)` Security/hardening guide for bridge and renderer boundary
- [ ] `(P2, M)` Multi-tab support and window orchestration

## Capacitor (Ionic)

Current `%`: `20%` | Priority: `P2` | Epic size: `L`

- [x] `(P2, S)` Local workaround shipped for Android WebView locks gap
- [ ] `(P2, M)` Runtime helper + lifecycle guard package for WebView shells
- [ ] `(P2, M)` Capacitor reference app
- [ ] `(P2, S)` Android WebView regression lane in CI
- [ ] `(P2, S)` Storage and background lifecycle policy docs

## Flutter

Current `%`: `0%` | Priority: `P2` | Epic size: `XL`

- [ ] `(P2, L)` Bridge architecture decision record
- [ ] `(P2, L)` Minimal POC (Dart bridge -> Evolu runtime boundary)
- [ ] `(P2, M)` Protocol contract for bridge transport and serialization
- [ ] `(P2, M)` Risk and maintenance model (ownership + release cadence)
