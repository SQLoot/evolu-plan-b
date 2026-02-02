# Evolu Plan B (Fork)

> **Plan B**: The "B" stands for **B**un and **B**iome.
> 
> This fork aims to remove as many third-party dependencies as possible, streamlining the monorepo for maximum efficiency.
> 
> **Goals:**
> - ⚡️ **Bun & Biome**: Using modern, fast tools as the foundation.
> - 🧹 **Clean Monorepo**: Simplifying structure and reducing dependencies.
> - 🛠️ **Integrations & Tools**: Adding new capabilities and tooling.
> - ♻️ **Refactoring**: Improving efficiency while maintaining compatibility with Evolu.
> 
> ---
> 
> ❤️ **Credits**: Huge thanks to [evoluhq](https://github.com/evoluhq) and [Daniel Steigerwald](https://github.com/steida) for creating Evolu. Their innovative solution is a massive contribution to the local-first ecosystem.
>
> ⚖️ **License**: Licensed under [MIT](./LICENSE).

Evolu is a TypeScript library and local-first platform.

## Documentation

For detailed information and usage examples, please visit [evolu.dev](https://www.evolu.dev).

## Community

The Evolu community is on [GitHub Discussions](https://github.com/evoluhq/evolu/discussions), where you can ask questions and voice ideas.

To chat with other community members, you can join the [Evolu Discord](https://discord.gg/2J8yyyyxtZ).

[![X](https://img.shields.io/twitter/url/https/x.com/evoluhq.svg?style=social&label=Follow%20%40evoluhq)](https://x.com/evoluhq)

## Developing

Evolu monorepo uses [Bun](https://bun.sh).

Install dependencies:

```
bun install
```

Build scripts

- `bun run build` - Build packages
- `bun run build:web` - Build docs and web

Web build notes

- Uses webpack (`next build --webpack`) because SharedWorker is required.
- Uses `NODE_OPTIONS=--max-old-space-size-percentage=75` to avoid V8 heap OOM on large docs builds.
- On macOS Tahoe, you may need to raise Launch Services limits too (shell `ulimit -n` is not enough):
  - `sudo launchctl limit maxfiles 262144 262144`

Start dev

- `bun run dev` - Start development mode (builds packages, starts web and relay)
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

Release

- `bun run changeset` - Describe changes for release log

Verify

- `bun run verify` - Run all checks (build, lint, test) before commit
