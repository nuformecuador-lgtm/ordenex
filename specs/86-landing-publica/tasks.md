# Feature 86 — Tasks

Convención: `[P]` = paralelizable (sin dependencia con otra `[P]` del mismo
bloque). Cada task indica su criterio de «hecho». La suite completa (`pnpm test`)
y `./init.sh` deben quedar en verde al final (regla 5 CLAUDE.md).

## Bloque 0 — Preparación

- [x] **T0. Decisiones del gate F1.4 resueltas (humano, 2026-07-17).**
  Segmento del dashboard: `/dashboard`. Dark mode: NO (esquema fijo navy/brand).
  Tagline: solo «Ordenex» + «Plataforma de logística y entregas».
  **Hecho:** ver «Decisiones del gate F1.4» en `requirements.md`.

## Bloque 1 — Componente compartido

- [ ] **T1 [P]. Crear `components/shared/Logo.tsx`** (R6).
  Encapsula el wordmark textual (`font-heading text-2xl font-semibold
  tracking-tight`, texto «Ordenex»); acepta `className?` opcional.
  **Hecho cuando:** el componente existe, tipa en strict y renderiza «Ordenex».

- [ ] **T2 [P]. Test `tests/components/Logo.test.tsx`** (R6).
  `// @vitest-environment jsdom`; `render(<Logo/>)`; asevera texto «Ordenex» y
  que aplica una `className` pasada por prop.
  Depende de: T1. **Hecho cuando:** el test pasa.

## Bloque 2 — Landing pública

- [ ] **T3. Crear `app/page.tsx`** (R2, R3, R4, R5).
  Server Component público (fuera de `(app)`). Topbar: `<Logo/>` + `<Link
  href="/postulacion">Trabaja con nosotros</Link>` + `<Link
  href="/login">Ingreso</Link>`. Hero: wordmark/claim + los 2 CTA con
  `buttonVariants({ variant: "brand-outline" })`. Reusa el patrón brand-panel
  (`bg-navy` + radial-gradient + `bg-brand`). Copy limitado a «Plataforma de
  logística y entregas Ordenex». Sin secciones de marketing inventadas.
  Depende de: T1.
  **Hecho cuando:** `/` renderiza sin error y el typecheck pasa.

- [ ] **T4. Test `tests/components/LandingPage.test.tsx`** (R2, R3, R4, R5).
  `// @vitest-environment jsdom`; importa la página vía `await
  import("@/app/page")`; asevera: enlace «Trabaja con nosotros» con
  `href="/postulacion"`; enlace/CTA «Ingreso» con `href="/login"`; presencia del
  logo; clases de marca (navy/brand) presentes; ausencia de secciones extra
  (solo el copy permitido).
  Depende de: T3. **Hecho cuando:** el test pasa y cubre R2–R5.

## Bloque 3 — Mover el dashboard a `/dashboard`

- [ ] **T5. Mover `app/(app)/page.tsx` → `app/(app)/dashboard/page.tsx`** (R9, R11).
  `git mv`, SIN modificar el cuerpo de la función `Home` (misma ramificación por
  rol). Sigue dentro de `(app)` (conserva el Sidebar).
  **Hecho cuando:** `/dashboard` sirve el dashboard por rol; `app/(app)/page.tsx`
  ya no existe; `/` no colisiona.

- [ ] **T6. Reapuntar los tests del dashboard** (R9).
  En `tests/components/HomePage.test.tsx`, `HomePageRol.test.tsx`,
  `HomePageMaestro.test.tsx`: cambiar `await import("@/app/(app)/page")` →
  `await import("@/app/(app)/dashboard/page")`.
  Depende de: T5. **Hecho cuando:** los 3 archivos pasan sin otros cambios.

## Bloque 4 — Middleware

- [ ] **T7. Editar `middleware.ts`** (R1, R7, R8, R10, R16).
  Añadir, ANTES del bloque `PUBLIC_ROUTES`, la regla de `/` por match EXACTO:
  con cookie `session` → 307 a `/dashboard`; sin cookie → `next()`. NO añadir `"/"`
  a `PUBLIC_ROUTES`. No tocar el resto del guard.
  **Hecho cuando:** typecheck pasa y el comportamiento de la tabla de contratos
  se cumple.

- [ ] **T8. Ampliar `tests/unit/auth/middleware.test.ts`** (R1, R7, R8, R10, R16).
  Entorno node; helper `buildRequest` ya existe. Casos nuevos:
  `/` sin sesión → 200 sin `location` (R1);
  `/` con sesión → 307 a `https://app.test/dashboard` (R7);
  `/dashboard` sin sesión → 307 a `/login?redirect=%2Fdashboard` (R10);
  regresión: una ruta con prefijo `/` arbitraria sin sesión sigue redirigiendo a
  `/login` (R8); `/ordenes` sin cookie → 307, con cookie → 200 (R16).
  Depende de: T7. **Hecho cuando:** todos los casos pasan.

## Bloque 5 — Redirecciones internas → `/dashboard`

- [ ] **T9 [P]. `app/login/page.tsx`: `redirect("/")` → `redirect("/dashboard")`** (R12).
  **Hecho cuando:** cambio aplicado.

- [ ] **T10 [P]. `app/recuperar-contrasena/page.tsx`: `redirect("/")` →
  `redirect("/dashboard")`** (R13).
  **Hecho cuando:** cambio aplicado.

- [ ] **T11 [P]. `LoginForm.tsx` `getRedirectTarget`: ambos `return "/"` →
  `return "/dashboard"`** (R14, R15). Conservar intacta la guarda open-redirect.
  **Hecho cuando:** cambio aplicado; la lógica `startsWith("/") &&
  !startsWith("//")` permanece.

- [ ] **T12. Actualizar tests de redirect de páginas** (R12, R13).
  `tests/components/LoginPage.test.tsx:62` y
  `tests/integration/recuperar-contrasena-page.test.tsx:57`: cambiar
  `NEXT_REDIRECT:/` → `NEXT_REDIRECT:/dashboard`.
  Depende de: T9, T10. **Hecho cuando:** ambos pasan.

- [ ] **T13. Test de `getRedirectTarget`** (R14, R15).
  Si no existe suite dedicada, extraer/testear el destino por defecto: sin param
  → `/dashboard`; `//evil` → `/dashboard`; `http://x` → `/dashboard`; `/ordenes` →
  `/ordenes`.
  Depende de: T11. **Hecho cuando:** los 4 casos pasan.

## Bloque 6 — Verificación final

- [ ] **T14. Barrido de referencias residuales a `/` como home.**
  Grep `redirect("/")`, `href="/"`, `push("/")` en `app/`, `lib/`,
  `components/`; confirmar que ninguna otra apunta a la home antigua (el sidebar
  ya no enlaza a `/`). Documentar hallazgos.
  Depende de: T5, T7, T9–T11. **Hecho cuando:** no queda referencia a `/` que
  deba ser `/dashboard`.

- [ ] **T15. `./init.sh` + `pnpm test` en verde** (regla 5).
  Depende de: todo lo anterior. **Hecho cuando:** ambos terminan sin fallos y
  cada R1–R16 mapea a un test que pasa (registrar el mapa en
  `progress/impl_86-landing-publica.md`).
