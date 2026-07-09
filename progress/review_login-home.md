# Review — feature login(home)  (2a pasada, post-rework)

Fecha: 2026-07-08
Reviewer: subagente reviewer (SDD)

## Veredicto final

**APROBADO** — 0 hallazgos bloqueantes.

Los 3 bloqueantes de la 1a pasada quedan CERRADOS y el defecto R22 fue corregido
con test de regresión real. Único pendiente conocido: la EJECUCIÓN del E2E (T017)
sigue diferida por falta de `.env`/DB (aceptado por el humano, análogo a T020); es
el gate para pasar `login` y `login(home)` a `done`, no un bloqueante de este
review.

## Verificación ejecutable reejecutada (evidencia)

- `pnpm run typecheck`  -> tsc --noEmit, sin errores. VERDE.
- `pnpm run lint`       -> eslint, sin errores ni warnings. VERDE.
- `pnpm run test`       -> Test Files 18 passed (18), Tests 110 passed (110). VERDE.
  (83 backend sin regresión + 27 netos nuevos de componente.)
- Verificación independiente de la regresión R22 (hecha por el reviewer): revertí
  el fix en `LoginForm.tsx` (moveFocusToFirstError leyendo el state stale y
  enfocando email para el error de password) y corrí `vitest -t "R22"`:
  **2 tests fallan**. Restaurado el fix: **2 tests pasan**. La regresión es genuina.

## Estado de los 3 bloqueantes previos

### BLOQUEANTE 1 (tests que no ejercitan el código real) — CERRADO
- Se ELIMINÓ `tests/components/login-page.test.ts` (confirmado: el archivo ya no
  existe). Con él desaparecen el `expect(true).toBe(true)` y las
  reimplementaciones inline de regex/getRedirectTarget/mensajes.
- `tests/components/LoginForm.test.tsx` importa y RENDERIZA el `LoginForm` real
  (`@/app/login/_components/LoginForm`) y solo mockea `@/lib/actions/auth`
  (login/verifyChallenge) y `next/navigation` (useRouter). La validación de
  cliente que se ejercita es el `credentialsSchema`/`codeSchema` reales del
  componente (el módulo `@/lib/types/auth` NO se mockea). Asserts concretos:
  no-invocación en validación fallida (R3/R4/R14), invocación única con payload
  (R5/R15), disabled/pending y no-doble-submit (R6/R6a), redirección por cada
  variante de `redirectParam` incl. open-redirect `//` (R7/R16), un caso por cada
  `status` (R8-R12, R17, R18), `aria-describedby` real apuntando al id del
  contenedor `role="alert"` (R11/R18/R20), distinguibilidad de mensajes leyendo
  el `textContent` renderizado (R27).
- `LogoutButton.test.tsx` renderiza el componente real e invoca `logout` mockeada
  (R26). No quedan tests tautológicos.

### BLOQUEANTE 2 (sin entorno ni tests de componente) — CERRADO
- Añadidos `@testing-library/react`, `user-event`, `jest-dom`, `jsdom`;
  `tests/setup/jest-dom.ts` registra los matchers; `vitest.config.ts` incluye
  `.tsx`, setup global y `pretendToBeVisual` (para la submisión implícita del
  form). Los tests de componente declaran `// @vitest-environment jsdom` por
  archivo, sin afectar los 83 tests de backend en entorno node.
- R1-R23 y R27 se cubren con tests de componente SIN DB (LoginForm es un Client
  Component puro), tal como preveía `design.md`. R24/R25 se cubren ejecutando los
  Server Components reales `app/login/page.tsx` y `app/page.tsx` (import dinámico,
  sin mockear su lógica; se mockean solo `next/headers`, `next/navigation`,
  `prisma-client` y `SessionRepository`, y se aísla el hijo ya cubierto). Esa
  aislación de hijos es legítima, no tautológica.

### BLOQUEANTE 3 (mapa de trazabilidad apuntando a código) — CERRADO
- `progress/impl_login-home.md` reescribió la tabla R1..R27: cada fila apunta
  ahora a `archivo → nombre del caso` de un test real (verifiqué por muestreo R5,
  R7, R11, R20, R22, R24, R25, R26, R27 contra los archivos). La columna E2E
  adicional está marcada explícitamente como diferida.

## Defecto R22 — CORREGIDO
`LoginForm.tsx` ahora pasa la variable local `errors` a `moveFocusToFirstError`
(no el state stale) y añade `passwordRef`, enfocando el campo que realmente tiene
error. Cubierto por dos casos que fallan con el código anterior (verificado por el
reviewer, ver evidencia). Además se añadió `noValidate` a ambos `<form>` para que
corra la validación zod/accesible en jsdom y en el navegador (R3/R4/R20).

## Checklist contra CHECKPOINTS.md
- [x] requirements.md (R1-R27), design.md (con alternativas), tasks.md presentes.
- [~] tasks.md: T017 [~] (E2E diferido de ejecución), T019 [~] (init.sh no corre
      test:e2e). El resto [x] con evidencia. Diferimientos explícitos y aprobados.
- [x] Cada R<n> mapea a un test real (no vacío, no reimplementado); mapa en
      impl_login-home.md.
- [x] typecheck / lint / test en verde (reejecutado: 110/110).
- [x] Sin tablas nuevas (RLS N/A). Sin secretos. Sin fetch a API para mutaciones
      (Server Actions). Server Components validan sesión server-side vía cookies().
- [~] E2E de flujo crítico de auth: ESCRITO con asserts reales (4 caminos), pero
      su EJECUCIÓN está diferida por falta de DB. Único requisito de CHECKPOINTS
      que queda pendiente de ejecución; es el gate de `done`.

## Evaluación del E2E (T017 / cierra T021 de login)
Sin cambios respecto a la 1a pasada: `e2e/auth.spec.ts` cubre login exitoso,
credenciales inválidas, cuenta bloqueada, logout (+ OTP y accesibilidad) con
asserts reales. Ahora ya NO es la única evidencia de R7-R10/R16/R25/R26 — esos
requisitos tienen cobertura de componente ejecutada. La ejecución del E2E queda
como condición de cierre a `done` de AMBAS features:
1. `.env` con `DATABASE_URL`/credenciales Supabase (page.tsx consulta Prisma).
2. `pnpm run db:migrate` + seed (usuario válido, uno para OTP, uno bloqueado) y
   obtener el OTP real (hoy `123456` es placeholder).
3. `pnpm dev` + `pnpm run test:e2e` en verde.

## Conclusión
El rework resolvió los 3 bloqueantes y el defecto R22 con verificación ejecutable
real. Veredicto: **APROBADO**. `login(home)` queda lista salvo la ejecución del
E2E, que —por decisión humana previa— se difiere y se comparte con `login`; ambas
pasan a `done` cuando el E2E corra en verde contra una DB de prueba.
