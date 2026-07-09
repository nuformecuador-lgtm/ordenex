# Tasks — login(home)

> Todas las tasks: `frontend_dev`, salvo indicación contraria. `[P]` =
> paralelizable respecto a las tareas de su mismo bloque de dependencia.
> Ninguna task modifica `lib/actions/auth.ts`, `lib/types/auth.ts` ni
> `db/schema.prisma` (contrato de la feature `login`, ya cerrado).

## Bloque 0 — Setup de UI (frontend_dev)

- [x] T001 [P] Inicializar shadcn/ui en el proyecto (`npx shadcn init` o
  equivalente, generando `components.json` acorde a la config de Tailwind v4
  existente). **Hecho cuando:** `components.json` existe y
  `pnpm run typecheck` / `pnpm run lint` siguen en verde.
  Depende de: ninguna.
- [x] T002 [P] Agregar primitivas necesarias: `npx shadcn add button input
  label card alert`. **Hecho cuando:** los archivos generados existen bajo
  `components/ui/` y compilan en `strict`. Depende de: T001.

## Bloque 1 — Página `/login` (Server Component) (frontend_dev)

- [x] T003 Crear `app/login/page.tsx` como Server Component: lee
  `searchParams.redirect` (si existe) y lo pasa como prop de solo lectura al
  formulario cliente; no contiene lógica de negocio pesada. Implementa la
  redirección de sesión activa (R24): lee la cookie `session` vía `cookies()`
  y, si hay sesión válida según `SessionRepository.findValidById`, ejecuta
  `redirect("/")` antes de renderizar el formulario. **Hecho cuando:** la
  ruta `/login` renderiza sin error, compila en `strict`, y un test cubre:
  cookie válida → redirige a `/`; sin cookie / sesión expirada → renderiza el
  formulario. Depende de: T002.
  **Verificado (2026-07-08):** `tests/components/LoginPage.test.tsx` → los
  3 casos de `app/login/page.tsx - sesion activa (R24)`.

## Bloque 2 — Formulario de credenciales (Client Component) (frontend_dev)

- [x] T004 Crear `app/login/_components/login-form.tsx` (`'use client'`) con
  campos email/password usando `Input`/`Label` de `components/ui/`,
  cumpliendo R1, R2, R19. **Hecho cuando:** test de componente confirma
  labels asociadas (`htmlFor`/`id`) y presencia del botón "Iniciar sesión".
  Depende de: T002, T003.
  **Verificado (2026-07-08):** `tests/components/LoginForm.test.tsx` →
  `LoginForm — render de campos (R1, R2, R19) > renderiza email, password y
  el boton de envio con labels asociadas`.
- [x] T005 Implementar validación de cliente (zod, mismos criterios que
  `lib/types/auth.ts`: email válido, password no vacía) que bloquea el envío
  y muestra error inline (R3, R4). **Hecho cuando:** test de componente
  verifica que un email/password inválido muestra error y NO invoca `login`
  (spy con 0 llamadas). Depende de: T004.
  **Verificado (2026-07-08):** `tests/components/LoginForm.test.tsx` →
  casos `R3: bloquea el envio...` y `R4: bloquea el envio...` (con
  `noValidate` agregado a los `<form>` para que la validación de cliente
  real, zod, sea la que se ejecute y no la validación HTML5 nativa).
- [x] T006 Conectar el submit a la Server Action `login` importada de
  `@/lib/actions/auth` (R5), con estado `isPending`/disabled del botón
  durante la invocación y bloqueo de doble-submit (R6, R6a). **Hecho cuando:**
  test de componente con mock de `login` verifica una sola invocación con
  `{ email, password }` y que el botón está `disabled` mientras la promesa
  está pendiente. Depende de: T005.
  **Verificado (2026-07-08):** `tests/components/LoginForm.test.tsx` →
  casos `R5: invoca login exactamente una vez...` y `R6, R6a: deshabilita
  el boton...`.
- [x] T007 Manejar cada `status` de `LoginResult` devuelto por `login`:
  `ok` → redirección (R7); `invalid_credentials` (R8); `account_unavailable`
  (R9); `account_locked` con `retryAfterMinutes` (R10); `validation_error`
  con `fieldErrors` por campo (R11); `challenge_required` → transición de
  fase (R12). **Hecho cuando:** un test de componente por cada `status`
  (6 casos) verifica el mensaje/estado/transición esperado, mockeando
  `login`. Depende de: T006.
  **Verificado (2026-07-08):** `tests/components/LoginForm.test.tsx` →
  casos `R7` (x3), `R8`, `R9`, `R10`, `R11`, `R12`.
- [x] T008 [P] Implementar el cálculo de `redirectTarget` (usa el prop
  `redirect` si empieza con `/` y no con `//`; en su defecto `/`) y la
  llamada a `router.push` en caso `ok` (R7). **Hecho cuando:** test de
  componente cubre: `redirect` válido, `redirect` ausente, `redirect` con
  `//` (rechazado, usa `/`). Depende de: T004.
  **Verificado (2026-07-08):** `tests/components/LoginForm.test.tsx` →
  los 3 casos `R7: status ok redirige...`.

## Bloque 3 — Verificación de challenge OTP (frontend_dev)

- [x] T009 Implementar la fase `challenge` en `login-form.tsx` (o subcomponente
  `challenge-fields.tsx`): campo de código con label asociada, conservando
  `challengeId` recibido en T007 (R12, R13). **Hecho cuando:** test de
  componente confirma que tras `challenge_required` se renderiza el campo de
  código con su label. Depende de: T007.
  **Verificado (2026-07-08):** `tests/components/LoginForm.test.tsx` →
  casos `R12: challenge_required transiciona...` y `R13: renderiza el
  campo de codigo con label...`.
- [x] T010 Validación de cliente del código (exactamente 6 dígitos numéricos)
  que bloquea el envío y muestra error inline (R14). **Hecho cuando:** test
  de componente verifica que un código inválido no invoca `verifyChallenge`.
  Depende de: T009.
  **Verificado (2026-07-08):** `tests/components/LoginForm.test.tsx` →
  caso `R14: bloquea el envio si el codigo no son 6 digitos...`.
- [x] T011 Conectar el submit del código a `verifyChallenge` con
  `{ challengeId, code }` (R15), reusando el mecanismo de `isPending`/disabled
  de T006 para este segundo formulario (R6, R6a aplicado a esta fase).
  **Hecho cuando:** test de componente con mock verifica una sola invocación
  con el payload correcto. Depende de: T010.
  **Verificado (2026-07-08):** `tests/components/LoginForm.test.tsx` →
  caso `R15: invoca verifyChallenge con { challengeId, code }...`.
- [x] T012 Manejar cada `status` de `LoginResult` devuelto por
  `verifyChallenge`: `ok` → redirección (R16, reusa T008);
  `otp_invalid` → error, se mantiene fase/challengeId (R17);
  `validation_error` → error bajo el campo de código (R18). **Hecho cuando:**
  test de componente por cada `status` (3 casos) verifica el comportamiento
  esperado. Depende de: T011, T008.
  **Verificado (2026-07-08):** `tests/components/LoginForm.test.tsx` →
  casos `R16`, `R17`, `R18`.

## Bloque 4 — Accesibilidad (frontend_dev)

- [x] T013 [P] Asociar cada mensaje de error (R8, R9, R10, R11, R14, R17,
  R18) a su contenedor con `role="alert"` o `aria-live="polite"`, y a su
  campo con `aria-describedby` (R20). Garantizar además que los mensajes de
  los distintos casos de error sean distinguibles entre sí y que
  `account_locked` incluya `retryAfterMinutes` (R27). **Hecho cuando:** test
  de componente (con RTL + jest-axe o assertions manuales de atributos)
  confirma rol/aria en cada mensaje renderizado y que dos casos distintos no
  producen el mismo texto. Depende de: T007, T012.
  **Verificado (2026-07-08):** `tests/components/LoginForm.test.tsx` →
  caso `R20: los errores se anuncian con role=alert...` (más asserts de
  `aria-describedby` en R11/R18) y caso `R27: presenta un texto distinto
  por cada status de error y account_locked incluye los minutos`.
- [x] T014 [P] Foco inicial en el campo de correo al montar `/login` (R21) y
  movimiento de foco al primer campo con error tras un intento de envío
  inválido (R22). **Hecho cuando:** test de componente simula montaje y
  verifica `document.activeElement`; simula submit inválido y verifica el
  cambio de foco. Depende de: T005, T010.
  **Verificado (2026-07-08) + defecto corregido:** `LoginForm.test.tsx` →
  caso `R21: coloca el foco inicial...`. R22 tenía un defecto real (foco
  leído de state stale, y foco fijo en email aun con error solo de
  password); corregido en `LoginForm.tsx` (`passwordRef` + variable local
  `errors`). Cubierto por los 2 casos `R22: ...` del mismo archivo, que se
  demostró fallan con el código anterior al fix (ver
  `progress/impl_login-home.md`).
- [x] T015 [P] Verificar operabilidad completa por teclado: orden de
  tabulación lógico (email → password → submit; código → submit) y envío con
  Enter (R23). **Hecho cuando:** test de componente (o E2E con
  `page.keyboard`) confirma que Enter dentro de los campos dispara el submit
  correspondiente. Depende de: T007, T012.
  **Verificado (2026-07-08):** `LoginForm.test.tsx` → casos `R23: Enter
  dentro del campo de contraseña...` y `R23: el orden de tabulacion...`.

## Bloque 5 — Botón mínimo de logout en la home (frontend_dev)

> Decisión cerrada #1 de `requirements.md` (aprobada por el humano
> 2026-07-08). Alcance: botón mínimo, no dashboard.

- [x] T016 En `app/page.tsx` (única ruta protegida hoy por `middleware.ts`),
  chequear la sesión server-side (`SessionRepository.findValidById`) y
  renderizar un botón "Cerrar sesión" solo cuando la sesión es válida (R25);
  el botón invoca la Server Action `logout()` de `@/lib/actions/auth` y
  redirige a `/login` tras completar (R26). Incluir un comentario explícito
  indicando que es una afordancia mínima para destrabar el E2E de T021 de
  `specs/login/tasks.md`, no una feature de dashboard. **Hecho cuando:** con
  sesión válida se muestra el botón y sin ella no; al hacer clic se invoca
  `logout()` y la navegación siguiente a una ruta protegida vuelve a
  redirigir a `/login` (cookie de sesión eliminada). Depende de: T003.
  **Verificado (2026-07-08):** `tests/components/HomePage.test.tsx` → los
  3 casos de `app/page.tsx - boton de cerrar sesion (R25)` (visibilidad
  condicional) y `tests/components/LogoutButton.test.tsx` → `LogoutButton
  (R26) > al hacer click invoca la Server Action logout y luego navega a
  /login`. El efecto real de "cookie de sesion eliminada / ruta protegida
  vuelve a /login" con backend real solo se cierra con `e2e/auth.spec.ts`
  (T017, ejecución diferida).

## Bloque 6 — E2E (Playwright) — cierra T021 de `specs/login/tasks.md`

- [~] T017 Escribir `e2e/auth.spec.ts` cubriendo los 4 caminos críticos que
  `specs/login/tasks.md` (T021) dejó diferidos explícitamente a esta
  feature: (a) login exitoso (credenciales válidas, sin challenge, redirige
  fuera de `/login`); (b) credenciales inválidas (mensaje de error genérico,
  permanece en `/login`); (c) cuenta bloqueada tras superar
  `MAX_FAILED_ATTEMPTS` intentos fallidos consecutivos (mensaje con minutos
  de espera); (d) logout (usando el botón "Cerrar sesión" de T016 en la home;
  tras cerrar sesión, visitar una ruta protegida vuelve a redirigir a
  `/login`). **Hecho cuando:** `pnpm run
  test:e2e` pasa en verde ejercitando los 4 caminos contra la UI real
  (requiere DB de prueba con al menos un usuario seed y control del reloj o
  de intentos para forzar el bloqueo; si el entorno de este agente no tiene
  `.env`/DB disponible, se documenta explícitamente como diferido de
  ejecución (no de escritura del test) en `progress/impl_login-home.md`,
  igual que T020 de la feature `login`). Depende de: T007, T012, T016.
  **Esta task es la que cierra el diferimiento T021 de
  `specs/login/tasks.md`; sin ella, ni `login(home)` ni `login` pueden pasar
  a `done` (CLAUDE.md, regla de trazabilidad).**

## Bloque 7 — Verificación final (frontend_dev)

- [x] T018 Correr `pnpm run typecheck`, `pnpm run lint` y `pnpm test` (unit
  de componente) en verde. **Hecho cuando:** todos pasan y la salida se
  registra en `progress/impl_login-home.md` junto con el mapa R1..R27
  (incluidos R6a) → test. Depende de: T001–T017.
  **Reverificado (2026-07-08) tras el rechazo del reviewer:** typecheck
  VERDE, lint VERDE, test VERDE — 18 archivos / 110 tests (incluye los 4
  archivos nuevos de componente que reemplazan el test falso previamente
  rechazado). Salida completa y mapa R1..R27 → test real en
  `progress/impl_login-home.md`.
- [~] T019 Correr `./init.sh` completo y confirmar verde. **Hecho cuando:**
  `./init.sh` termina en verde y se añade la entrada correspondiente a
  `progress/history.md`. Depende de: T017, T018.
  **Corrección (2026-07-08):** la redacción original de esta task afirmaba
  que `./init.sh` "incluye test:e2e"; es inexacto — `init.sh` solo corre
  typecheck/lint/test (unit+componente), nunca `test:e2e`. Queda en `[~]`
  porque, aunque `./init.sh` está en verde, esa evidencia NO cubre el E2E;
  el gate real de `done` es T017 (diferida). No se marca `[x]` para no
  repetir el hallazgo del reviewer.
