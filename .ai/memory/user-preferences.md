# 🧠 Paměť Agenta & Preference

## Uživatelské Preference
- **Jazyk**: Čeština pro chat/plánování. Angličtina pro komentáře v kódu/commity.
- **Package Manager**: `bun` (Striktní preference).
- **Linter**: `Biome`.
- **Filozofie**: "Buď kritický. Neplň jen slepě příkazy, pokud jsou špatně. Navrhuj best practices."

## Specifika Projektu
- **Aktuální stav**: 
- **Kritické Todo**: 

## Sync Pravidla (`upstream/common-v8` -> `evolu-plan-b`)
- **Baseline**: `common-v8` je výchozí architektura/UX/API kompatibilita.
- **Bez wholesale merge**: nikdy neprovádět slepé 1:1 mergnutí celé větve, které vrací odstraněné dependency/tooling.
- **Bun-first/Biome-first**: zachovat `bun` + `biome`, nevracet `pnpm`, `pnpx`, `eslint`, `prettier` ani jejich workflow.
- **Commit-parity workflow**: každou upstream změnu mapovat jako `adopt exact` / `equivalent` / `intentional divergence`.
- **Povinný reporting odchylek předem**: pokud nebude něco implementováno nebo bude řešeno jinak, vždy předem uvést důvod, dopad a návrh.
- **Performance & deps policy**: aktivně hledat náhrady 3rd-party knihoven nativními Bun funkcemi a hlásit je; preferovat méně závislostí a vyšší výkon.
- **No chaos refactors**: nepřesouvat naming/soubory bez jasného přínosu (výkon, stabilita, kompatibilita).
- **Keep local supersets**: pokud máme navíc oproti upstreamu (vyřešený issue, lepší implementace, funkce navíc), nikdy to nerevertovat, pokud je zachovaná upstream kompatibilita.
- **Testy můžou být napřed**: aktivně přidávat/rozšiřovat test coverage i nad rámec upstreamu, pokud to zvyšuje jistotu kompatibility a stability.
- **Escalation style**: při nalezení upstream chyby nebo lepší Bun varianty nejdřív zastavit a dodat stručný report: problém -> dopad -> návrh -> riziko.
