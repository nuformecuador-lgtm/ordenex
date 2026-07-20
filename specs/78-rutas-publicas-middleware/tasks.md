# Feature 78 — Tasks

Gate F1.4 **resuelta** (2026-07-16): P1 alcance (`/paquete` fuera), P2 (sí al test de
caracterización), P3 (`TODO:` solo en `password-reset.ts`, comentarios sin tocar).
No quedan preguntas abiertas.

Orden general: baseline → test que falla → fix → test que pasa → TODO → manual →
suite. **No invertir T2 y T3**: el valor del test está en verse fallar contra el bug
real.

---

- [ ] **T0 — Medir el baseline en worktree limpio**
  - Depende de: —
  - Antes de tocar nada, en el worktree de la feature ya creado desde `dev`:
    `npm test`, `npm run typecheck`, `npm run lint`.
  - Anotar en `progress/impl_78.md` el conteo exacto (pasan/fallan) y **la lista nominal
    de los tests que ya fallan**. Reejecutar en aislado los que fallen para separar
    flakes reales (timeout 5000ms bajo carga, precedente 72/73/76) de roturas.
  - **NO** citar un baseline de la bitácora: caduca con cualquier PR ajeno.
  - Hecho: `progress/impl_78.md` contiene el baseline medido, con fecha, comando y
    salida real pegada.

- [ ] **T1 — [P] Probar que `NextRequest` instancia en el entorno de test**
  - Depende de: —  (paralelizable con T0)
  - Bloquea: T2.
  - Sonda mínima y desechable: un test que solo haga
    `new NextRequest(new URL("/login", "https://app.test"))`, `cookies.set(...)`,
    `cookies.get("session")`, en entorno node (default de `vitest.config.ts:10`).
  - Hecho: se sabe **cuál de los tres caminos** aplica (node directo → jsdom → doble
    mínimo, en ese orden de preferencia; ver design.md "Riesgo conocido y fallback") y
    queda anotado en `progress/impl_78.md`. La sonda se borra o se convierte en T2.

- [ ] **T2 — Escribir `tests/unit/auth/middleware.test.ts` y verlo FALLAR**
  - Depende de: T1 (patrón confirmado)
  - Primer test de `middleware.ts` del repo. Importar el middleware real vía
    `@/middleware` (nunca reimplementar la lógica). 7 casos de la tabla de design.md
    (R1–R6), con el helper `buildRequest(pathname, session?)`.
  - Nombres que describen comportamiento, no función (`docs/conventions.md`), p. ej.
    `deja pasar /postulacion sin cookie de sesion`.
  - Caso 7 = **caracterización de `/paquete`** (R6): nombre y comentario deben decir que
    fija el estado ACTUAL, no el deseado, y que la feature 79 debe invertirlo a
    propósito. Ver el snippet en design.md.
  - **No** afirmar nada sobre el matching por prefijo (decisión (b): puede endurecerse
    luego). **No** afirmar que la cookie se valida (el middleware solo mira presencia).
  - Hecho: `npm test tests/unit/auth/middleware.test.ts` corre y **los casos 1 y 2
    (`/recuperar-contrasena`, `/postulacion`) FALLAN** con redirección a `/login`;
    los casos 3–7 pasan. Salida pegada en `progress/impl_78.md`. Este fallo es la
    reproducción del bug: si no falla, el test no verifica nada.
  - Commit: `test(78): tests de middleware sobre rutas publicas y guard de sesion`

- [ ] **T3 — Añadir `/recuperar-contrasena` y `/postulacion` a `PUBLIC_ROUTES`**
  - Depende de: T2 (el test debe existir y fallar primero)
  - Único cambio funcional de la feature: `middleware.ts:3`, más el comentario que
    explica qué es la lista y por qué `/paquete` no está (feature 79).
  - **No añadir `/paquete`** (decisión (a)). Tras el cambio, `PUBLIC_ROUTES` tiene 4
    entradas: `/login`, `/api/health`, `/recuperar-contrasena`, `/postulacion` — que
    **no** son "las 4 páginas públicas fuera de `(app)`"; ver la desambiguación de
    design.md antes de tocar la lista.
  - **No tocar**: el guard (`:11-16`), el matcher (`:22`), ni `pathname.startsWith(r)`
    (`:8`, decisión (b)).
  - Hecho: los 7 casos de T2 en verde, **incluido el caso 7** (`/paquete` sigue
    redirigiendo: si se puso verde por haberlo añadido a la lista, el alcance se violó);
    `npm run typecheck` y `npm run lint` en verde.
  - Commit: `fix(78): suma recuperar-contrasena y postulacion a PUBLIC_ROUTES`

- [ ] **T4 — [P] `TODO:` del proveedor de correo**
  - Depende de: — (paralelizable con T2/T3: archivo disjunto, cero solape)
  - **Un solo archivo**: `lib/actions/password-reset.ts:31-38` (donde se instancia
    `StubEmailProvider`, `:35`). Contenido del `TODO:` según R7 / design.md cambio 3,
    incluyendo la nota de que los comentarios de `EmailProvider.ts` y
    `OtpChallengeIssuer.ts` quedan desactualizados **a propósito** hasta la feature 80.
  - **PROHIBIDO** (decisión del humano): tocar `OtpChallengeIssuer.ts:39` (el
    `console.log` del OTP, decisión (c)); tocar los comentarios de
    `OtpChallengeIssuer.ts:27-30` o `EmailProvider.ts:3-9` (se difieren a la 80);
    cablear un proveedor; cambiar cualquier comportamiento.
  - Hecho: `npm run lint` y `npm run typecheck` en verde; `git diff` toca **únicamente**
    `lib/actions/password-reset.ts` y **solo** líneas de comentario. Reviewer confirma R7.
  - Commit: `chore(78): documenta el estado real del proveedor de correo (feature 80)`

- [ ] **T5 — Verificación manual en sesión anónima**
  - Depende de: T3
  - `npm run dev`, ventana privada (sin cookie `session`). Abrir `/recuperar-contrasena`
    y `/postulacion`.
  - Hecho: **ambas CARGAN** (formulario visible), no redirigen a `/login`. Comprobar
    además que `/ordenes` sí redirige a `/login?redirect=%2Fordenes` (no-regresión) y
    que `/recuperar-contrasena` **con** sesión sigue redirigiendo a `/` (guard propio de
    la página, feature 20, no debe haberse roto). Evidencia (capturas o notas de las 4
    comprobaciones) en `progress/impl_78.md`.

- [ ] **T6 — Suite completa y comparación contra el baseline**
  - Depende de: T3, T4, T5
  - `./init.sh` + `npm test` completos.
  - Hecho: el resultado se compara **contra el baseline de T0**, no contra la bitácora.
    Cero regresiones nuevas atribuibles a la feature; cualquier fallo remanente se
    identifica nominalmente como preexistente o flake, reejecutado en aislado. Mapa
    `R<n> → test` completo en `progress/impl_78.md` (R7 marcado como documental,
    verificado por el reviewer).

---

## Paralelizable

- T1 con T0.
- T4 con T2/T3 (archivos disjuntos).

## Ruta crítica

T1 → T2 → T3 → T5 → T6
