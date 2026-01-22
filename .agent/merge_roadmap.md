# Roadmapa: Merge upstream/common-v8 do loot/loot-main

## Aktuální stav (2026-01-22)

Branch `feat/merge-common-v8-jan21` obsahuje **13 commitů** přidaných oproti `loot/loot-main`.

### ✅ Dokončeno (Fáze 1-3 + Expo fix)

| Commit | Popis | Status |
|--------|-------|--------|
| `3d6921a6` | **Option module** - Some/None typy pro optional values | ✅ |
| `195ccba9` | **isFunction, isIterable** + vylepšený getProperty typing | ✅ |
| `4f834ebb` | **createArray, ensureArray** utility | ✅ |
| `0c854b94` | **objectFromEntries** utility | ✅ |
| `e4157898` | **Int1To99, Int1To100** numeric literal typy | ✅ |
| `c931bc56` | **assertType** helper pro type assertions | ✅ |
| `646140f5` | **DistributiveOmit** utility type | ✅ |
| `18c679fd` | **Callback** generic type | ✅ |
| `f021f698` | **todo** placeholder + **lazy helpers migration** | ✅ |
| `232f00d7` | Fix: Promise.try → new Promise | ✅ |
| `23f2739e` | Fix: Explicit type annotations in Task.ts | ✅ |
| `3ba6a13b` | Fix: Remove erasableSyntaxOnly from tsconfig | ✅ |
| `b810f089` | Fix: Expo encryption (useSQLCipher casing) | ✅ |

---

## ⏳ Zbývá k integraci (Fáze 4+)

### 🔴 Vysoká priorita - Core Task/Concurrency (RIZIKOVÁ)

Tyto commity přinášejí zásadní změny v core Task infrastruktuře. **Doporučuji full merge nebo velmi opatrný cherry-pick s důkladným review.**

| Commit | Popis | Riziko | Poznámka |
|--------|-------|--------|----------|
| `972bc611` | **Refactor AbortError** - use 'cause', improve Semaphore | 🔴 Vysoké | 20+ konfliktů v Task.ts |
| `b7e3bf14` | **Refactor Runner/Fiber** state management | 🔴 Vysoké | Core changes |
| `aa6111fb` | **Implement all() and withConcurrency** | 🔴 Vysoké | Závisí na předchozích |
| `f16af102` | **Concurrency primitives** - Deferred, Gate, Semaphore, Mutex | 🔴 Vysoké | Nové moduly |

### 🟡 Střední priorita - Utilities a vylepšení

| Commit | Popis | Riziko | Poznámka |
|--------|-------|--------|----------|
| `4025cddc` | Cache ok() result | 🟢 Nízké | Optimalizace |
| `c0ed4acf` | Tests for isOk/isErr | 🟢 Nízké | Jen testy |
| `0e4c79e2` | Add ConsoleDep to TestDeps | 🟢 Nízké | Test helpers |
| `beb6fd0d` | Remove IntentionalNever type | 🟡 Střední | Breaking change |
| `f155910c` | Refactor EvoluSchema to use AnyType | 🟡 Střední | Schema changes |

### ⚪ Nízká priorita / Skip

| Commit | Popis | Akce |
|--------|-------|------|
| `1e095e80` | ESLint arrow function style | ❌ SKIP (používáme Biome) |
| `5751fed8` | Vitest browser config | ❓ REVIEW |
| `f6eac2eb` | Reorder imports | ❌ SKIP (formátování) |
| `c78657ce`, `9b381f84`, `b02fefaf`, `d786ab91` | Update deps / pnpm-lock | ❌ SKIP (používáme Bun) |
| `87780a3e` | Rename lazy helpers | ✅ UŽ HOTOVO (manuálně) |

### 📚 Dokumentace (volitelné)

| Commit | Popis |
|--------|-------|
| `a912d90e` | Update Iterable doc |
| `fcaf9203` | Typedoc link for Omit |
| `63034dcf` | Refactor docs |
| `e01133a7` | Update section heading |
| `c85732d0` | LLM-friendly markdown routes |
| `4cd00329` | Custom TypeDoc plugin |

---

## 🎯 Doporučený postup

### Krátkodobě (nyní)
1. ✅ **Merge branch `feat/merge-common-v8-jan21` do `loot/loot-main`**
   - Obsahuje všechny utility z Fáze 2-3
   - Opravené TypeScript problémy
   - Expo fix

### Střednědobě (příští session)
2. **Cherry-pick low-risk commits:**
   - `4025cddc` Cache ok() result
   - `c0ed4acf` Tests for isOk/isErr
   - `0e4c79e2` Add ConsoleDep to TestDeps

### Dlouhodobě (vyžaduje plánování)
3. **Full merge nebo rebase pro Fázi 4:**
   - Core Task/Concurrency změny jsou příliš propojené
   - Cherry-pick by byl riskantní
   - Doporučuji počkat na stabilizaci upstreamu nebo provést full merge s důkladným review

---

## 📊 Statistiky

- **Celkem commitů v upstream/common-v8 (od 17.1.):** ~50
- **Úspěšně integrováno:** 13 (26%)
- **Zbývá k integraci:** ~37
- **Z toho vyžaduje opatrnost:** 4 core commits

---

## 🔄 Další kroky

1. Spustit `bun run test` pro ověření stability
2. Merge `feat/merge-common-v8-jan21` do `loot/loot-main`
3. Naplánovat session pro Fázi 4 s více času na review
