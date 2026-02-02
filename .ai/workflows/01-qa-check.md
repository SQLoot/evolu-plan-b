---
description: Spustit kompletní kontrolu kvality (Lint, Typecheck, Build)
---

# Quality Assurance Workflow

Tento workflow zajišťuje, že kódová základna je zdravá před commitem změn nebo žádostí o review.

## 1. Statická analýza (Biome)
<!-- turbo -->
Kontrola formátování a linting chyb.
```bash
bun run check
```

## 2. Validace TypeScriptu
<!-- turbo -->
Zajištění striktní typové bezpečnosti.
```bash
bun run typecheck
```
*Poznámka: Pokud toto selže, oprav nejprve typy v `src/env.d.ts` nebo props komponent.*

## 3. Test produkčního buildu
<!-- turbo -->
Ověření, že web lze úspěšně sestavit.
```bash
bun run build
```
