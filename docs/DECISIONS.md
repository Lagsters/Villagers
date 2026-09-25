# Decyzje projektowe

Każdy wpis: data, decyzja, uzasadnienie.

## 2026-09-25 — M0

- **Tytuł roboczy:** „Osadnicy Doliny”. Zostaje.
- **Jeden `package.json` w korzeniu** zamiast monorepo z workspace'ami. Projekt jest mały, a jeden
  zestaw zależności upraszcza CI i uruchamianie.
- **TypeScript uruchamiany natywnie przez Node ≥ 22.18** (type stripping). Dlatego `erasableSyntaxOnly`
  (bez `enum`, bez parameter properties) i importy z rozszerzeniem `.ts`. Serwer sygnalizacyjny
  i skrypty narzędziowe działają bez kroku kompilacji.
- **Zależności:** `three` (rendering), `ws` (serwer sygnalizacyjny). Dev: `typescript`, `vite`, `vitest`,
  `@playwright/test`, `eslint` + `typescript-eslint` + `@eslint/js` (lint), `@types/*`.
  Wszystkie wymagane przez specyfikację lub niezbędne do typowania.
- **ESLint pilnuje determinizmu:** w `sim/` zakazane są `Math.random`, `Math.sin/cos/sqrt`, `Date.now`,
  `performance.now`, `window`, `document`.
- **`base` Vite** ustawiany zmienną `BASE` (domyślnie `/osadnicy-doliny/`); CI ustawia go na nazwę repozytorium.
- **Brak zdalnego repozytorium:** projekt powstaje lokalnie; utworzenie repozytorium na GitHubie
  i włączenie Pages opisuje `docs/DEPLOY.md` (to krok właściciela, bo publikuje kod).
