# Evolu Plan B (Fork)

> **Plan B**: The "B" stands for **B**un and **B**iome (fully implemented).
> 
> This fork aims to remove as many third-party dependencies as possible, streamlining the monorepo for maximum efficiency.
> 
> **Goals:**
> - ⚡️ **Bun & Biome**: Fully migrated to modern, fast tools as the foundation (see [Linting](#linting)).
> - 🧹 **Clean Monorepo**: Simplifying structure and reducing dependencies.
> - 🛠️ **Integrations & Tools**: Adding new capabilities and tooling.
> - ♻️ **Refactoring**: Improving efficiency while maintaining compatibility with Evolu.

Evolu is a TypeScript library and local-first platform.

## Documentation

For detailed information and usage examples, please visit [evolu.dev](https://www.evolu.dev).

## Community

The Evolu community is on [GitHub Discussions](https://github.com/evoluhq/evolu/discussions), where you can ask questions and voice ideas.

To chat with other community members, you can join the [Evolu Discord](https://discord.gg/2J8yyyyxtZ).

[![X](https://img.shields.io/twitter/url/https/x.com/evoluhq.svg?style=social&label=Follow%20%40evoluhq)](https://x.com/evoluhq)

## Developing

Evolu monorepo uses [Bun](https://bun.sh).

> [!NOTE]
> The Evolu monorepo is verified to run under **Bun 1.3.9** in combination with **Node.js >=24.0.0**. This compatibility is explicitly tested in CI.

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
