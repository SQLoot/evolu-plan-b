# Evolu Plan B (Fork)

`Evolu Plan B` is SQLoot's Bun + Biome fork of Evolu.

Primary goals:

- Keep API and protocol compatibility with Evolu upstream.
- Use Bun-first tooling across the monorepo.
- Reduce third-party dependencies where Bun provides native equivalents.
- Keep changes benchmarkable against upstream via `bench-suite`.

Evolu is a TypeScript library and local-first platform.

## Integration Matrix

Coverage snapshot date: `2026-02-27` (from `bun run test:coverage` and `bun run test:coverage:bun`).

| Package | Supported Versions | Implementation Status | Coverage (Statements / Branches) | Notes |
| --- | --- | --- | --- | --- |
| `@evolu/common` | Node `>=24.0.0` | Stable core | `94.47% / 89.67%` | Main engine + local-first protocol/runtime. |
| `@evolu/web` | `@evolu/common ^7.4.1` | Stable | `96.67% / 90.70%` | Browser runtime (Worker/SharedWorker/Web Locks path). |
| `@evolu/nodejs` | Node `>=24.0.0`, `@evolu/common ^7.4.1` | Stable | Worker `100% / 100%`, Sqlite `100% / 87.5%` | Package aggregate is lower due to minimal shim files. |
| `@evolu/react-web` | React `>=19`, React DOM `>=19`, `@evolu/web ^2.4.0` | Stable thin adapter | `100% / 100%` | Thin web integration wrapper. |
| `@evolu/react-native` | React Native `>=0.81`, Expo `>=54`, `@op-engineering/op-sqlite >=12` | Active hardening | `20.65% / 13.11%` | Core adapters are covered; broader suite is backlog. |
| `@evolu/react` | React `>=19` | Wrapper support | `0% / 0%` | Hook wrappers; coverage expansion planned. |
| `@evolu/vue` | Vue `>=3.5.29` | Wrapper support | `0% / 0%` | Composition API wrappers; coverage expansion planned. |
| `@evolu/svelte` | Svelte `>=5.53.3`, `@evolu/web ^2.4.0` | Wrapper support | `0% / 0%` | Store-based wrappers; coverage expansion planned. |
| `@evolu/bun` (private) | `@evolu/common ^7.4.1`, Bun `1.3.x` | Experimental adapter | `100% / 100%` | Measured via Bun coverage runner on `BunDbWorker.ts`. |

## Planned Integrations (Roadmap View)

| Integration | Fit | Priority | Expected Path | Main Risk / Blocker |
| --- | --- | --- | --- | --- |
| TanStack Start | Very high | P0 | Use `@evolu/react` + `@evolu/web`, focus on SSR/client boundary docs and example app. | SSR edge cases (worker lifecycle and hydration boundary). |
| Astro | High | P0 | Client-island integration on top of `@evolu/web`, starter template + docs. | Island hydration timing and worker boot ordering. |
| Tauri | High | P1 | Web runtime in WebView + optional Rust-side relay bridge for desktop sync scenarios. | Packaging/runtime differences across desktop targets. |
| Flutter | Medium/Low | P2 | Separate adapter/SDK (likely not a thin wrapper) or protocol-level bridge. | Different runtime/language model (Dart), no direct reuse of TS hooks. |
| Lynx | Medium/Low | P2 | Feasibility spike first; likely bridge approach instead of direct package reuse. | Ecosystem maturity and compatibility surface still evolving. |
| Valdi (to be clarified) | Unknown | Discovery | Define target runtime first, then evaluate web/node adapter reuse potential. | Ambiguous target platform and unclear integration surface. |

Current recommendation:

- Build first-class examples for `TanStack Start`, `Astro`, and `Tauri`.
- Treat `Flutter` and `Lynx` as separate SDK/bridge efforts, not quick wrappers.
- Keep protocol/API parity first; add adapters only where lifecycle/storage semantics are clear.

## `@evolu/common` Compatibility and Third-Party Dependencies

- Package version: `7.4.1`
- Runtime baseline: Node `>=24.0.0`
- Monorepo toolchain baseline: Bun `1.3.10`

Third-party runtime dependencies used by `@evolu/common`:

| Dependency | Why It Is Used |
| --- | --- |
| `@noble/ciphers` | Audited cryptographic ciphers for encryption flows. |
| `@noble/hashes` | Audited hash primitives used by protocol/auth internals. |
| `@scure/bip39` | Mnemonic handling for owner/account recovery flows. |
| `disposablestack` | Disposable stack compatibility utility for cleanup semantics. |
| `kysely` | Typed SQL query builder integration. |
| `msgpackr` | Binary message serialization for protocol payloads. |
| `zod` | Runtime schema validation and parsing. |

Dependency policy:

- No dependency downgrades in sync waves.
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
> The Evolu monorepo is verified to run under **Bun 1.3.10** in combination with **Node.js >=24.0.0**. This compatibility is explicitly tested in CI.

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
