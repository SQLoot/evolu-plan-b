# @example/react-nextjs

Reference integration app for Evolu in Next.js App Router.

## Scope

- Validates client-only Evolu bootstrap inside App Router (`"use client"` boundaries)
- Serves as baseline for SSR/client boundary hardening tasks in the roadmap
- Mirrors package usage from `@evolu/react` + `@evolu/react-web`

## Run

```bash
bun run examples:react-nextjs:dev
```

Build check:

```bash
cd examples/react-nextjs
bun run build
```

## Integration Notes

- Evolu must initialize in client components only.
- Keep provider and query hooks behind client boundaries.
- Use this app as the canonical repro for hydration/client-order issues.

## Roadmap Link

- `docs/roadmap/integrations.md` -> `Next.js (App Router)`
