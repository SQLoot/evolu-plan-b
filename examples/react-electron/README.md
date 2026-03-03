# @example/react-electron

Reference integration app for Evolu in Electron (renderer + preload + main process split).

## Scope

- Validates Evolu runtime behavior in desktop renderer context
- Serves as baseline for Electron process-boundary hardening
- Demonstrates minimal setup for Vite + Electron + React + Evolu

## Run

```bash
cd examples/react-electron
bun run dev
```

Preview build:

```bash
cd examples/react-electron
bun run preview
```

## Integration Notes

- Keep Evolu runtime in renderer unless explicitly bridged.
- Treat preload and IPC contracts as security boundaries.
- Use this app as the canonical repro for desktop runtime regressions.

## Roadmap Link

- `docs/roadmap/integrations.md` -> `Electron`
