# Bitácora de implementación — Feature 86 (landing pública en `/` + dashboard a `/dashboard`)

Rama: `feature/86-landing-publica` · Worktree: `ordenex-f86` · Fecha: 2026-07-17
Rol: frontend_dev. Zona: frontend (única excepción no-UI autorizada por el spec:
la regla de routing en `middleware.ts`).

## Archivos creados

- `components/shared/Logo.tsx` — wordmark textual compartido (T1, R6).
- `app/page.tsx` — landing pública (topbar + hero), Server Component fuera de `(app)` (T3, R2–R5).
- `app/(app)/dashboard/page.tsx` — dashboard reubicado vía `git mv` (cuerpo intacto) (T5, R9/R11).
- `tests/components/Logo.test.tsx` (T2, R6).
- `tests/components/LandingPage.test.tsx` (T4, R2–R5).
- `tests/components/getRedirectTarget.test.ts` (T13, R14/R15).

## Archivos modificados

- `middleware.ts` — regla de `/` por match EXACTO antes de `PUBLIC_ROUTES`: con
  cookie `session` → 307 a `/dashboard`; sin cookie → `next()` (T7, R1/R7/R8/R10/R16).
- `app/login/page.tsx` — `redirect("/")` → `redirect("/dashboard")` (T9, R12).
- `app/recuperar-contrasena/page.tsx` — `redirect("/")` → `redirect("/dashboard")` (T10, R13).
- `app/login/_components/LoginForm.tsx` — `getRedirectTarget`: ambos `return "/"` →
  `return "/dashboard"`; función exportada para su prueba unitaria. Guarda
  open-redirect `startsWith("/") && !startsWith("//")` intacta (T11, R14/R15).
- `tests/components/HomePage.test.tsx`, `HomePageRol.test.tsx`, `HomePageMaestro.test.tsx`
  — import `@/app/(app)/page` → `@/app/(app)/dashboard/page` (T6, R9).
- `tests/unit/auth/middleware.test.ts` — 5 casos nuevos de feature 86 (T8).
- `tests/components/LoginPage.test.tsx` — `NEXT_REDIRECT:/` → `NEXT_REDIRECT:/dashboard` (T12, R12).
- `tests/integration/recuperar-contrasena-page.test.tsx` — idem (T12, R13).
- `tests/components/LoginForm.test.tsx` — 2 aserciones de destino por defecto
  `"/"` → `"/dashboard"` (efecto de R14/R15; el test asertaba el comportamiento viejo).
- `specs/86-landing-publica/tasks.md` — T1–T15 marcadas `[x]`.

## Barrido T14 (referencias residuales a `/` como home)

`grep 'redirect("/")' | 'href="/"' | 'push("/")' | 'href: "/"'` en `app/ lib/
components/` → 0 hallazgos tras los cambios. El Sidebar/menú no enlazaba a `/`
(`lib/auth/menu-visibility.ts` sin `href: "/"`), confirmado. Ninguna referencia
adicional debe apuntar a `/dashboard`.

## Trazabilidad R1–R16 → test

| Req | Test :: caso |
| --- | --- |
| R1  | `tests/unit/auth/middleware.test.ts` :: "/ sin sesion deja pasar (landing publica, 200) (R1)" |
| R2  | `tests/components/LandingPage.test.tsx` :: "R2: el topbar tiene el logo y los enlaces …" |
| R3  | `tests/components/LandingPage.test.tsx` :: "R3: el hero incluye los 2 CTA …" |
| R4  | `tests/components/LandingPage.test.tsx` :: "R4: reutiliza la paleta de marca (navy/brand)" |
| R5  | `tests/components/LandingPage.test.tsx` :: "R5: el único copy descriptivo es … (sin marketing inventado)" |
| R6  | `tests/components/Logo.test.tsx` :: "renderiza el wordmark …" / "aplica una className …" |
| R7  | `tests/unit/auth/middleware.test.ts` :: "/ con sesion redirige (307) a /dashboard (R7)" |
| R8  | `tests/unit/auth/middleware.test.ts` :: "R8: una ruta con prefijo `/` arbitraria … NO se vuelve publica" |
| R9  | `tests/components/HomePage.test.tsx` / `HomePageRol.test.tsx` / `HomePageMaestro.test.tsx` (reapuntados a `@/app/(app)/dashboard/page`) |
| R10 | `tests/unit/auth/middleware.test.ts` :: "/dashboard sin sesion redirige (307) a /login?redirect=%2Fdashboard (R10)" |
| R11 | Estructural: `app/(app)/dashboard/page.tsx` bajo layout `(app)`; cubierto por la suite `(app)` verde + verificación manual |
| R12 | `tests/components/LoginPage.test.tsx` :: "redirige a /dashboard cuando la cookie … es valida" (`NEXT_REDIRECT:/dashboard`) |
| R13 | `tests/integration/recuperar-contrasena-page.test.tsx` :: "redirige a /dashboard cuando la cookie … es valida" |
| R14 | `tests/components/getRedirectTarget.test.ts` :: "R14: sin parámetro … /dashboard"; `LoginForm.test.tsx` :: "R7 … /dashboard cuando no hay redirectParam" |
| R15 | `tests/components/getRedirectTarget.test.ts` :: "R15: `//evil` …" / "R15: `http://x` …"; `LoginForm.test.tsx` :: "R7 … open-redirect '//evil.com'" |
| R16 | `tests/unit/auth/middleware.test.ts` :: "R16 (regresion): /ordenes sin cookie -> 307 …; con cookie -> 200" |

## Verificación (baseline vs final)

Nota de metodología: los HomePage*/guards/repo-walk tests hacen **timeout de
5000ms bajo carga en frío** (flake conocido, no fallo real). Se corrió también con
`--test-timeout=30000` para separar flakes de regresiones.

### `pnpm typecheck`
- Baseline (leader): 0 errores. Final: **0 errores**.

### `pnpm lint`
- Final: **0 errores**, 140 warnings (todos preexistentes; ninguno en archivos de la feature).

### `pnpm test`
- **Baseline (worktree limpio, timeout por defecto 5000ms):** 4 failed | 3118 passed
  (3122). Los 4 fallos son *timeouts de 5000ms* (flakes): `HomePageRol.test.tsx`,
  `no-embalaje.test.ts`, `cierre-detail-inmutable.test.ts` (+1). Ningún fallo de
  aserción de lógica en el baseline.
- **Final (`--test-timeout=30000`, sin flakes de timeout):** 2 failed | 324 passed
  (326 archivos) · 3 tests fallando → tras corregir `LoginForm.test.tsx`: **1
  archivo failing residual = `CierreDiaPage.test.tsx`**.
  - `CierreDiaPage.test.tsx` :: "R1: el rol mensajero ve el módulo …" → **PREEXISTENTE**
    (drift del PR #82). Evidencia: con mis cambios en `git stash`, el archivo
    sigue fallando idéntico (`1 failed | 3 passed`). No es regresión mía.
  - Los 2 fallos de `LoginForm.test.tsx` que aparecieron eran efecto legítimo de
    R14/R15 (el test asertaba el destino viejo `/`); se actualizaron a `/dashboard`
    y ahora pasa **26/26**.
- **Tests de la feature en aislado (`--test-timeout=30000`):**
  `Logo` + `LandingPage` + `middleware` + `getRedirectTarget` + `LoginPage` +
  `recuperar-contrasena-page` → **29 passed (6 files)**. `HomePage*` (3 files) →
  **10 passed** con timeout ampliado.

## Veredicto

Feature 86 implementada según spec: 0 regresiones nuevas (único fallo residual
`CierreDiaPage.test.tsx` = preexistente PR #82, demostrado con `git stash`);
typecheck 0, lint 0 errores.
