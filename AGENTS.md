# Repository Notes for Contributors

This file is intentionally public-safe and minimal.

## Purpose

`evolu-plan-b` is SQLoot's Bun + Biome fork of Evolu with focus on:

- upstream compatibility,
- measurable CI/benchmark quality,
- practical local-first runtime hardening.

## Development Baseline

- Package manager: `bun`
- Lint/format: `biome`
- TypeScript: strict mode
- Main quality gate: `bun run verify`

## Core Commands

```bash
bun install
bun run build
bun run test
bun run lint
bun run verify
```

## Security

- Never commit secrets or credentials.
- Use responsible disclosure process from `SECURITY.md`.

## Contribution

- Keep changes focused.
- Add/update tests for behavioral changes.
- Update docs when behavior or workflows change.
