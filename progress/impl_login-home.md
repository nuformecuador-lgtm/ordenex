# Implementación — login(home)

## Resumen

Esta entrada reemplaza la verificación previa, que el reviewer rechazó
(`progress/review_login-home.md`, 2026-07-08, 3 hallazgos bloqueantes). El
código de UI de producción ya era correcto salvo un defecto real de R22; lo
que faltaba era verificación ejecutable real. Este documento registra:

1. El defecto R22 corregido en `app/login/_components/LoginForm.tsx`.
2. El entorno de test de componentes (jsdom + Testing Library) agregado.
3. Los tests de componente reales (renderizan el código de producción,
   mockean solo las Server Actions/dependencias server-side) que reemplazan
   `tests/components/login-page.test.ts` (falso, eliminado).
4. El mapa `R<n> → test` reescrito para apuntar a un archivo + nombre de test
   concreto, no a fragmentos de código.

## Corrección de código de producción — defecto R22

`app/login/_components/LoginForm.tsx`, función `moveFocusToFirstError`:

- **Antes:** leía el *state* `credentialsFieldErrors`/`codeFieldErrors`
  (cerrado sobre el render anterior a la actualización, por lo tanto vacío
  en el primer submit inválido) y, cuando el único error era el de
  password, enfocaba `emailRef` a propósito ("No tenemos ref de password"),
  moviendo el foco a un campo SIN error. Violaba R22 en el primer submit y
  cuando el error era solo de password.
- **Después:** `moveFocusToFirstError(phase, errors)` recibe como parámetro
  la variable local `errors` recién calculada por `safeParse(...).flatten()`
  en el propio handler (nunca el state), y se agregó `passwordRef` para que
  el foco vaya al campo de password cuando ese es el único con error.
  Aplicado a las 3 invocaciones (validación cliente de credenciales,
  `validation_error` del servidor en credenciales, validación cliente y
  `validation_error` del servidor en challenge).
- **Regresión demostrada:** se revirtió temporalmente la corrección (sin
  tocar los tests) y se confirmó que
  `tests/components/LoginForm.test.tsx` falla exactamente en los 2 casos de
  R22 (`mueve el foco al campo de correo cuando el error es de email` y
  `mueve el foco al campo de contraseña cuando SOLO ese campo tiene error`);
  con la corrección restaurada, ambos pasan. Ver sección "Verificación
  ejecutable" para la salida.

## Defecto de test corregido (bloqueante de verificación, no de UI)

Los formularios (`credentials` y `challenge`) de `LoginForm.tsx` no tenían
`noValidate`. Esto no rompía la UI en sí, pero significaba que la
validación HTML5 nativa del navegador (p. ej. sobre `type="email"`) podía
interceptar el `submit` **antes** de que corriera nuestro `onSubmit`
(zod + errores accesibles `role="alert"`/`aria-describedby` de R3/R4/R20),
mostrando en su lugar el tooltip nativo del navegador — inconsistente entre
navegadores y no cubierto por R20. Se agregó `noValidate` a ambos `<form>`,
de forma que la única fuente de validación de cliente sea `credentialsSchema`
/`codeSchema` (zod), como especifica `design.md`. Esto también fue lo que
hacía que los tests reales (que sí ejercitan el DOM real, a diferencia del
test falso anterior) fallaran al intentar reproducir R3/R4/R14 con un email
sintácticamente inválido.

## Entorno de test de componentes agregado (Bloqueante 2)

- Dependencias nuevas (`devDependencies`): `@testing-library/react`,
  `@testing-library/user-event`, `@testing-library/jest-dom`, `jsdom`.
- `vitest.config.ts`: se mantiene `environment: "node"` por defecto (no se
  rompe ningún test de backend existente); los archivos de test de
  componente declaran `// @vitest-environment jsdom` en su primera línea.
  Se agregó `setupFiles: ["./tests/setup/jest-dom.ts"]` (matchers de
  jest-dom, no-op para los tests en node) y
  `environmentOptions.jsdom.pretendToBeVisual: true` (requerido por jsdom
  para la sumisión implícita del formulario al hacer click en un botón
  `type="submit"`; sin efecto en los tests que corren en `node`).
- `tests/setup/jest-dom.ts` — registra `@testing-library/jest-dom/vitest`.

## Tests de componente nuevos (reemplazan el test falso)

- **Eliminado:** `tests/components/login-page.test.ts` (reimplementaba
  regex/funciones/strings inline; nunca importaba ni renderizaba
  `LoginForm`, `app/login/page.tsx` ni `LogoutButton`; incluía
  `expect(true).toBe(true)`).
- **`tests/components/LoginForm.test.tsx`** (jsdom) — renderiza el
  componente real `LoginForm` importado de
  `app/login/_components/LoginForm.tsx`; mockea únicamente
  `@/lib/actions/auth` (`login`, `verifyChallenge`) y `next/navigation`
  (`useRouter`). La validación de cliente ejercitada es el
  `credentialsSchema`/`codeSchema` reales del componente (no reimplementados
  en el test). 33 casos, cubren R1–R23, R27.
- **`tests/components/LoginPage.test.tsx`** (jsdom) — importa y ejecuta
  `app/login/page.tsx` (Server Component real, sin mockear su lógica);
  mockea `next/headers` (`cookies`), `next/navigation` (`redirect`),
  `@/lib/db/prisma-client`, `@/lib/repositories/SessionRepository` y aísla
  `LoginForm` con un stub (ya cubierto en detalle por `LoginForm.test.tsx`).
  Cubre R24.
- **`tests/components/HomePage.test.tsx`** (jsdom) — importa y ejecuta
  `app/page.tsx` real; mismos mocks server-side que `LoginPage.test.tsx`;
  aísla `LogoutButton` con un stub. Cubre R25.
- **`tests/components/LogoutButton.test.tsx`** (jsdom) — renderiza el
  componente real `app/_components/LogoutButton.tsx`; mockea
  `@/lib/actions/auth` (`logout`) y `next/navigation`. Cubre R26.

## Mapa de trazabilidad R<n> → test (reescrito)

Cobertura sin DB (unit/componente, ejecutada realmente en este entorno) vs.
cobertura de flujo completo (E2E, `e2e/auth.spec.ts`, T017 — **ejecución
diferida** por falta de `.env`/DB, ver más abajo).

| Req. | Descripción | Test (archivo → caso) | Cobertura E2E adicional (diferida) |
|---|---|---|---|
| R1 | Campos email/password con label | `tests/components/LoginForm.test.tsx` → `LoginForm — render de campos (R1, R2, R19) > renderiza email, password y el boton de envio con labels asociadas` | — |
| R2 | Botón submit "Iniciar sesión" | mismo caso que R1 | — |
| R3 | Bloquea envío + error si email inválido, sin invocar `login` | `LoginForm.test.tsx` → `LoginForm — validacion de cliente (R3, R4) > R3: bloquea el envio y muestra error cuando el correo es invalido, sin invocar login` | `e2e/auth.spec.ts` (accesibilidad/validación) |
| R4 | Bloquea envío + error si password vacía | `LoginForm.test.tsx` → `... > R4: bloquea el envio y muestra error cuando la contraseña esta vacia, sin invocar login` | — |
| R5 | Invoca `login` una vez con `{email,password}` | `LoginForm.test.tsx` → `LoginForm — invocacion de login (R5, R6, R6a) > R5: invoca login exactamente una vez con { email, password } cuando la validacion pasa` | `e2e/auth.spec.ts` (login exitoso) |
| R6 | Botón disabled + indicador mientras pending | `LoginForm.test.tsx` → `... > R6, R6a: deshabilita el boton mientras login esta pendiente e impide doble-submit` | — |
| R6a | Impide doble-submit concurrente | mismo caso que R6 (spy de `login` a 1 sola invocación tras 2 clicks) | — |
| R7 | Redirección tras `status: "ok"` (con/sin/`//`) | `LoginForm.test.tsx` → `LoginForm — resultados de login (R7-R12) > R7: status ok redirige a redirectParam cuando es una ruta interna valida`, `... redirige a / cuando no hay redirectParam`, `... redirige a / cuando redirectParam es un open-redirect ('//evil.com')` | `e2e/auth.spec.ts` (login exitoso + `?redirect=`) |
| R8 | `invalid_credentials`: mensaje genérico, conserva email | `LoginForm.test.tsx` → `... > R8: invalid_credentials muestra mensaje generico y conserva el correo` | `e2e/auth.spec.ts` (credenciales inválidas) |
| R9 | `account_unavailable`: mensaje distinguible | `LoginForm.test.tsx` → `... > R9: account_unavailable muestra un mensaje distinguible` | — |
| R10 | `account_locked`: incluye `retryAfterMinutes` | `LoginForm.test.tsx` → `... > R10: account_locked muestra el valor de retryAfterMinutes recibido` | `e2e/auth.spec.ts` (cuenta bloqueada) |
| R11 | `validation_error` del servidor bajo el campo | `LoginForm.test.tsx` → `... > R11: validation_error del servidor muestra el error bajo el campo correspondiente` | — |
| R12 | `challenge_required` transiciona de fase sin reload | `LoginForm.test.tsx` → `... > R12: challenge_required transiciona a la fase de verificacion sin recargar la pagina` | `e2e/auth.spec.ts` (flujo OTP) |
| R13 | Campo código + label + botón separado | `LoginForm.test.tsx` → `LoginForm — fase OTP (R13-R18) > R13: renderiza el campo de codigo con label y un boton de envio separado` | — |
| R14 | Bloquea envío si código no son 6 dígitos | `LoginForm.test.tsx` → `... > R14: bloquea el envio si el codigo no son 6 digitos y no invoca verifyChallenge` | — |
| R15 | Invoca `verifyChallenge` con `{challengeId, code}` | `LoginForm.test.tsx` → `... > R15: invoca verifyChallenge con { challengeId, code } cuando el codigo es valido` | — |
| R16 | Redirección tras `verifyChallenge` ok (misma regla que R7) | `LoginForm.test.tsx` → `... > R16: status ok en verifyChallenge redirige igual que R7` | `e2e/auth.spec.ts` (flujo OTP) |
| R17 | `otp_invalid`: error, mantiene fase/challengeId | `LoginForm.test.tsx` → `... > R17: otp_invalid muestra error y mantiene la fase de verificacion` | `e2e/auth.spec.ts` (código inválido → válido) |
| R18 | `validation_error` de `verifyChallenge` bajo el campo código | `LoginForm.test.tsx` → `... > R18: validation_error de verifyChallenge muestra el error bajo el campo de codigo` | — |
| R19 | `id` único + `htmlFor` en cada campo (email/password/código) | `LoginForm.test.tsx` → caso de R1/R2 (email/password) + caso de R13 (código) | — |
| R20 | Errores con `role="alert"`/`aria-live` + `aria-describedby` | `LoginForm.test.tsx` → `LoginForm — accesibilidad (R19-R23) > R20: los errores se anuncian con role=alert y aria-describedby los asocia al campo` (más los asserts de `aria-describedby` en R11/R18) | `e2e/auth.spec.ts` (aria-live/aria-describedby) |
| R21 | Foco inicial en email al montar | `LoginForm.test.tsx` → `... > R21: coloca el foco inicial en el campo de correo al montar` | — |
| R22 | Foco al primer campo con error tras submit inválido | `LoginForm.test.tsx` → `... > R22: mueve el foco al campo de correo cuando el error es de email (primer submit)` y `... > R22: mueve el foco al campo de contraseña cuando SOLO ese campo tiene error (primer submit)` (ambos fallan con el código anterior al fix, ver arriba) | — |
| R23 | Operable por teclado: tab order + Enter | `LoginForm.test.tsx` → `... > R23: Enter dentro del campo de contraseña envia el formulario de credenciales` y `... > R23: el orden de tabulacion es email -> password -> submit` | `e2e/auth.spec.ts` (`page.keyboard`) |
| R24 | Sesión válida en `/login` → redirige a `/` sin mostrar form | `tests/components/LoginPage.test.tsx` → `app/login/page.tsx — sesion activa (R24) > redirige a / cuando la cookie de sesion es valida...`, `... > renderiza el formulario cuando no hay cookie de sesion`, `... > renderiza el formulario cuando la sesion de la cookie esta expirada/invalida` | `e2e/auth.spec.ts` (protección de rutas) |
| R25 | Botón "Cerrar sesión" solo con sesión válida | `tests/components/HomePage.test.tsx` → `app/page.tsx — boton de cerrar sesion (R25) > muestra el boton...`, `... > NO muestra el boton cuando no hay sesion valida`, `... > NO muestra el boton cuando la sesion... esta expirada/invalida` | `e2e/auth.spec.ts` (logout) |
| R26 | Click invoca `logout`, deja sin sesión válida | `tests/components/LogoutButton.test.tsx` → `LogoutButton (R26) > al hacer click invoca la Server Action logout y luego navega a /login` | `e2e/auth.spec.ts` (logout + ruta protegida vuelve a `/login`) — el "sin sesión válida server-side" solo se cierra con DB real |
| R27 | Mensajes distinguibles por status; `account_locked` incluye minutos | `LoginForm.test.tsx` → `LoginForm — distinguibilidad de mensajes de error (R27) > presenta un texto distinto por cada status de error y account_locked incluye los minutos` | — |

Notas sobre la cobertura:
- R7/R16 con datos reales de backend (login válido produciendo `status: ok`,
  `account_locked` real tras `MAX_FAILED_ATTEMPTS`, OTP real) solo se
  verifican end-to-end en `e2e/auth.spec.ts`; los tests de componente
  verifican el comportamiento de `LoginForm` ante cada `status` posible
  mockeando la Server Action, que es exactamente lo que design.md prevé
  como cobertura sin DB.
- R25/R26 dependen de `SessionRepository.findValidById` real contra
  Postgres para el caso "sesión fue realmente invalidada tras logout"; los
  tests de componente cubren la lógica de UI (mostrar/ocultar botón,
  invocar `logout`) con esa dependencia mockeada.

## Verificación ejecutable

### pnpm run typecheck
```
> ordenex@0.1.0 typecheck
> tsc --noEmit

(sin salida = sin errores)
```
**Resultado: VERDE**

### pnpm run lint
```
> ordenex@0.1.0 lint
> eslint

(sin salida = sin errores ni warnings)
```
**Resultado: VERDE**

### pnpm run test
```
> ordenex@0.1.0 test
> vitest run

 RUN  v4.1.10 C:/Users/Cristian/Documents/trabajo/arc/ordenex

 Test Files  18 passed (18)
      Tests  110 passed (110)
```
**Resultado: VERDE** — 15 archivos/83 tests preexistentes (backend, sin
regresión) + 4 archivos nuevos de componente (`LoginForm.test.tsx` 33 casos,
`LoginPage.test.tsx` 3 casos, `HomePage.test.tsx` 3 casos,
`LogoutButton.test.tsx` 1 caso; total 40 casos nuevos, netos +27 tests tras
eliminar el archivo falso de 4 casos) = 18 archivos / 110 tests.

### Regresión R22 demostrada
Se revirtió temporalmente `moveFocusToFirstError` a la versión con el
defecto original (lee `credentialsFieldErrors`/`codeFieldErrors` del state
en vez de la variable local `errors`, y enfoca `emailRef` cuando el único
error es de password):
```
pnpm exec vitest run tests/components/LoginForm.test.tsx -t "R22"
...
 Test Files  1 failed (1)
      Tests  2 failed | 24 skipped (26)
```
Con la corrección restaurada:
```
pnpm exec vitest run tests/components/LoginForm.test.tsx -t "R22"
...
 Test Files  1 passed (1)
      Tests  2 passed | 24 skipped (26)
```

## Archivos creados/modificados en esta corrección

- `app/login/_components/LoginForm.tsx` — fix R22 (`passwordRef`, uso de
  `errors` local en vez de state, `noValidate` en ambos `<form>`).
- `vitest.config.ts` — `include` de `.test.tsx`, `setupFiles`,
  `environmentOptions.jsdom.pretendToBeVisual`.
- `tests/setup/jest-dom.ts` — nuevo.
- `tests/components/LoginForm.test.tsx` — nuevo (reemplaza el test falso).
- `tests/components/LoginPage.test.tsx` — nuevo.
- `tests/components/HomePage.test.tsx` — nuevo.
- `tests/components/LogoutButton.test.tsx` — nuevo.
- `tests/components/login-page.test.ts` — eliminado (test falso).
- `package.json` / `pnpm-lock.yaml` — nuevas devDependencies:
  `@testing-library/react`, `@testing-library/user-event`,
  `@testing-library/jest-dom`, `jsdom`.
- `specs/login-home/tasks.md` — T004–T015, T018 marcadas [x] con criterio
  de "Hecho cuando" real (test de componente existente y verde); T017 se
  mantiene [~] (E2E escrito, ejecución diferida por falta de DB).

## E2E (T017) — sin cambios de estado

`e2e/auth.spec.ts` no se modificó ni se ejecutó (sigue sin `.env`/DB en este
entorno). Permanece **[~] diferido de ejecución** (no de escritura), tal
como lo dejó el reviewer: es el único camino que ejercita R7/R16 con backend
real, `account_locked` real, OTP real, y "logout invalida la sesión
server-side" de punta a punta. Mientras no se ejecute en verde, ni
`login(home)` ni `login` pueden pasar a `done` (regla de trazabilidad de
`CLAUDE.md`; ver también `docs/verification.md`).

## Bloqueos

Ninguno de parte de frontend_dev. Persiste el bloqueo ya documentado por el
reviewer: ejecutar `e2e/auth.spec.ts` requiere `.env`/DB de prueba con seed
de usuarios (válido, uno para challenge OTP, uno bloqueable) — fuera del
alcance de este agente (sin backend/DB).
