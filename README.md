# Evolu Plan B (Fork)

`Evolu Plan B` is SQLoot's Bun + Biome fork of Evolu.

Primary goals:

- Keep API and protocol compatibility with Evolu upstream.
- Use Bun-first tooling across the monorepo.
- Reduce third-party dependencies where Bun provides native equivalents.
- Keep changes benchmarkable against upstream via `bench-suite`.

Evolu is a TypeScript library and local-first platform.

## 🪴 Project Activity

<p align="center">
  <img src="https://repobeats.axiom.co/api/embed/9dbe31e742524e552a28ac3a7edf1d06e987b2ae.svg" alt="Repobeats analytics image" />
</p>

## Integration Matrix

Coverage snapshot date: `2026-03-01` (from `bun run verify`).

| Package                | Baseline                                | Status               |
| ---------------------- | --------------------------------------- | -------------------- |
| `@evolu/common`        | Node `>=24.0.0`                         | Stable core          |
| `@evolu/web`           | Browser + `@evolu/common ^7.4.1`        | Stable               |
| `@evolu/nodejs`        | Node `>=24.0.0` + `@evolu/common ^7.4.1` | Stable               |
| `@evolu/react-web`     | React `>=19` + `@evolu/web ^2.4.0`      | Thin adapter         |
| `@evolu/react-native`  | RN `>=0.84`, Expo `>=55`                | Lane-gated hardening |
| `@evolu/react`         | React `>=19`                            | Wrapper support      |
| `@evolu/vue`           | Vue `>=3.5.29`                          | Wrapper support      |
| `@evolu/svelte`        | Svelte `>=5.53.3`                       | Wrapper support      |
| `@evolu/bun` (private) | Bun `1.3.x` + `@evolu/common ^7.4.1`    | Experimental adapter |

Coverage notes (Statements / Branches):

- `@evolu/common`: `94.46% / 89.64%`
- `@evolu/web`: `98.90% / 93.30%`
- `@evolu/nodejs`: `95.74% / 85.71%`
- `@evolu/react-native`: `99.32% / 98.17%` + strict `react-native`/`expo` file gates at `100/100/100/100`
- `@evolu/bun` (private): `100% / 100%` (`BunDbWorker.ts`)
- Wrapper packages (`@evolu/react`, `@evolu/vue`, `@evolu/svelte`) are still coverage-expansion candidates.

## Planned Integrations (Roadmap View)

| Integration          | Priority | Focus                                          |
| -------------------- | -------- | ---------------------------------------------- |
| Next.js (App Router) | P0       | Official web guide + SSR/client boundary docs |
| TanStack Start       | P0       | React/web adapter docs + production example    |
| Astro                | P0       | Client-island starter + worker boot guidance   |
| SvelteKit            | P1       | Browser-only init reference app                |
| Nuxt 3               | P1       | Client plugin/module integration path          |
| Remix / React Router | P1       | Explicit browser init in route patterns        |
| Tauri                | P1       | WebView runtime + optional relay bridge        |
| Electron             | P1       | Renderer runtime + optional main-process relay |
| Capacitor (Ionic)    | P2       | WebView-first runtime hardening                |
| Flutter              | P2       | Separate SDK/bridge exploration                |

Main blockers to track:

- SSR/client boundaries and hydration order in framework runtimes.
- Worker lifecycle consistency across browser, edge, and desktop shells.
- Desktop packaging/process boundaries (Electron/Tauri).
- Mobile WebView storage consistency and background lifecycle.

Current recommendation:

- Build first-class examples for `Next.js`, `TanStack Start`, and `Astro`.
- Follow with `SvelteKit`, `Nuxt`, `Remix`, and `Tauri/Electron` runtime guides.
- Treat `Flutter` as a separate SDK/bridge effort, not a quick wrapper.
- Keep protocol/API parity first; add adapters only where lifecycle/storage semantics are clear.

## `@evolu/common` Compatibility and Third-Party Dependencies

- Package version: `7.4.1`
- Runtime baseline: Node `>=24.0.0`
- Monorepo toolchain baseline: Bun `1.3.10`

Third-party runtime dependencies used by `@evolu/common`:

| Dependency        | Why It Is Used                                                |
| ----------------- | ------------------------------------------------------------- |
| `@noble/ciphers`  | Audited cryptographic ciphers for encryption flows.           |
| `@noble/hashes`   | Audited hash primitives used by protocol/auth internals.      |
| `@scure/bip39`    | Mnemonic handling for owner/account recovery flows.           |
| `disposablestack` | Disposable stack compatibility utility for cleanup semantics. |
| `kysely`          | Typed SQL query builder integration.                          |
| `msgpackr`        | Binary message serialization for protocol payloads.           |
| `zod`             | Runtime schema validation and parsing.                        |

Dependency policy:

- No dependency downgrades in sync waves.
- Sync waves are periodic coordinated dependency sync batches across packages and CI lanes.
- Prefer native Bun/runtime APIs where practical.
- Keep API/protocol compatibility with upstream.

## Fork Diff vs Upstream

For a concise overview of what this fork changes, why, and what is intentionally extra, see [UPSTREAM_DIFF.md](./UPSTREAM_DIFF.md).

## Documentation

For detailed information and usage examples, please visit [evolu.dev](https://www.evolu.dev).

## Community & Support

For this fork (`SQLoot/evolu-plan-b`), use GitHub Issues in this repository.

Upstream Evolu community channels are still relevant for shared design topics:

The Evolu community is on [GitHub Discussions](https://github.com/evoluhq/evolu/discussions), where you can ask questions and voice ideas.

To chat with other community members, you can join the [Evolu Discord](https://discord.gg/2J8yyyyxtZ).

[![X](https://img.shields.io/twitter/url/https/x.com/evoluhq.svg?style=social&label=Follow%20%40evoluhq)](https://x.com/evoluhq)

## Developing

Evolu monorepo uses [Bun](https://bun.sh).

> [!NOTE]
> The Evolu monorepo is verified to run under **Bun 1.3.10** with **Node.js 24 (LTS)** and **Node.js 25 (current)** in CI.

Install dependencies:

```
bun install
```

Build scripts

- `bun run build` - Build packages
Start dev

- `bun run dev` - Start development mode for relay
- `bun run ios` - Run iOS example (requires `bun run dev` running)
- `bun run android` - Run Android example (requires `bun run dev` running)

Examples

> **Note**: To work on examples with local packages, run `bun run examples:toggle-deps` first.

- `bun run examples:react-nextjs:dev` - Dev server for React Next.js example
- `bun run examples:react-vite-pwa:dev` - Dev server for React Vite PWA example
- `bun run examples:svelte-vite-pwa:dev` - Dev server for Svelte Vite PWA example
- `bun run examples:vue-vite-pwa:dev` - Dev server for Vue Vite PWA example
- `bun run examples:build` - Build all examples

Linting

- `bun run lint` - Lint code
- `bun run lint-monorepo` - Lint monorepo structure

Testing

- `bun run test` - Run tests
- [Vitest VS Code extension](https://github.com/vitest-dev/vscode)

Release

- `bun run changeset` - Describe changes for release log

Verify

- `bun run verify` - Run all checks (build, lint, test) before commit

## Credit

Huge thanks to [evoluhq](https://github.com/evoluhq) and [@steida](https://github.com/steida) for creating Evolu. Their innovative solution is a massive contribution to the local-first ecosystem.

## Licence

Licensed under [MIT](./LICENSE).

---

<div align="center">
  <a href="https://github.com/enterprises/ownCTRL"><img src="https://img.shields.io/badge/©️_2026-ownCTRL™-333?style=flat&labelColor=ddd" alt="© 2026 ownCTRL™"/></a>
  <a href="https://github.com/miccy"><img src="https://img.shields.io/badge/⚙️_Maintained_with_🩶_by-%40miccy-333?style=flat&labelColor=ddd" alt="Maintained by @miccy"/></a>
</div>
