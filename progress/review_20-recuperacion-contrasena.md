# Review Feature 20 — Recuperación de contraseña (SLICE BACKEND, Bloques 0–3 / T00–T05)

> Reviewer. Alcance verificado: SOLO backend (R1–R15, R19, R20). R16–R18 (UI)
> quedan PENDIENTES a propósito (zona frontend ocupada por #31) y NO se tratan
> como bloqueantes. Rama: `feature/20-recuperacion-contrasena` vs `origin/dev`.

## Checklist verificado

### Especificación
- [x] `requirements.md` con R1–R20 EARS numerados.
- [x] `design.md` con alternativas descartadas (A/B/C/D) y su porqué.
- [x] `tasks.md` T00–T05 (backend) marcadas `[x]`. T06–T09 (frontend/cierre) `[ ]`
      correctamente pendientes por el split.

### Trazabilidad (backend R1–R15, R19, R20)
- [x] Cada requisito backend mapea a ≥1 test real y sustantivo (no vacío). Detalle:
  - R1/R3 → `password-reset-service.test.ts` (genérico, no emite) + `password-reset-actions.test.ts`.
  - R2 → service "email existente emite OTP".
  - R4 → OTP persistido solo como hash vía `OtpChallengeIssuer` reutilizado (código nuevo nunca persiste el código en claro).
  - R5/R6 → service (código correcto sin consumir / incorrecto genérico) + `otp-challenge-latest-active.test.ts`.
  - R7 → `password-reset-schemas.test.ts` (.refine) + action.
  - R8 → `password-policy.test.ts` (válida + 6 reglas: <8, >72, sin mayús/minús/dígito/símbolo) + schema + action.
  - R9 → service + `user-repository-update-password.test.ts` (solo `passwordHash`, void).
  - R10 → service "marca consumido".
  - R11 → service + action (desafío inactivo, no toca contraseña).
  - R12 (backend) → action pública sin sesión. Nota: aspecto de página/redirect es frontend (T06) pendiente.
  - R13 → service (código ajeno no restablece) + latest-active (resuelto por id del usuario destino).
  - R14 → service con spies de console.{log,info,warn,error}.
  - R15 → `auth-config-reset.test.ts` (defaults + overrides env).
  - R19 → service (supera RESET_MAX_REQUESTS → no emite) + `otp-challenge-count-recent.test.ts`.
  - R20 → service (corta antes de mirar repos, no toca `updatePasswordHash`) + `reset-rate-limit.test.ts`.
- [x] `progress/impl_20-recuperacion-contrasena.md` contiene el mapa R→test.

### Reuso sin duplicar
- [x] Emisión OTP vía `OtpChallengeIssuer.emitir` (no reimplementa generación/envío).
- [x] Hashing vía `hashPassword` (bcrypt); verificación del OTP vía `verifyPassword`.
- [x] Constantes vía `authConfig` (`readPositiveInt`, env `AUTH_RESET_*`), sin hardcode.
- [x] Sin tabla nueva: reutiliza `EmailOtpChallenge`. Sin migración/`.sql`/`.prisma` en el diff.

### Seguridad
- [x] No enumeración (R1/R3/R6): respuesta genérica `{status:"ok"}` en `solicitar` exista o
      no el email, en service Y en action; `verificar`/`restablecer` devuelven `invalid_or_expired` uniforme.
- [x] R14: el código NUEVO no loguea OTP ni contraseña. El `console.log` heredado en
      `OtpChallengeIssuer` NO se modificó (excepción aceptada) — confirmado: source intacto en el diff.
- [x] R20: usa `RESET_MAX_VERIFY_ATTEMPTS` + `ResetRateLimiter` en memoria; NO reutiliza
      `MAX_FAILED_ATTEMPTS`, NO escribe en `login_attempt`, NO bloquea la cuenta.
- [x] R13: el desafío se resuelve por el id del usuario destino; un OTP de otro email no aplica.
- [x] R10/R11: `markConsumed` solo en `restablecer` con desafío válido; consumido/expirado → no modifica contraseña.
- [x] R8: `strongPasswordSchema` zod (min8/max72 + mayús/minús/dígito/símbolo), cada regla con test.

### Alcance backend puro
- [x] Diff NO toca `app/**` (frontend pendiente). Toca `lib/**`, `tests/**`, `specs/`, `progress/`.
- [x] Sin migración ni DB nueva.

### Calidad de código y capas
- [x] TS strict sin `any` en firmas nuevas (casts `as Record<string,string[]>` en el borde zod, no `any`). `pnpm run typecheck` exit 0.
- [x] Mocks de tests existentes actualizados solo de forma aditiva (nuevos métodos de interfaz), sin cambio de lógica.
- [x] Capas separadas: Controller (actions) sin queries; Service sin HTTP (recibe ip/deviceHash ya resueltos); Repository solo Prisma; interfaces en `lib/interfaces/`.

### Verificación ejecutable (corrida por el reviewer)
- [x] `pnpm run typecheck` → exit 0.
- [x] Tests F20 aislados → 9 archivos, 41 tests verdes.
- [x] `./init.sh` → exit 0. Suite completa 95 archivos / 762 tests verdes; lint 0 errores
      (135 warnings, todos en `.claude/skills/**`, ajenos a F20). En esta corrida no
      apareció el flaky de timeouts pre-existente.

## Hallazgos

- observación: R12 en su totalidad (página pública + redirect a `/` con sesión, enlace desde
  login) es frontend (T06/T08, pendiente). El slice backend cubre su parte: acciones públicas
  sin requisito de sesión. Sin impacto para este slice.
- observación: R20 es best-effort por instancia (limitador en memoria, caveat Vercel ya
  documentado en design.md 5b). Respaldo durable: TTL del OTP + límite de solicitudes R19.
  Aceptable para el alcance de la feature.
- observación: timing R1/R3 (rama "existe" ejecuta bcrypt/envío, "no existe" no) puede filtrar
  existencia por tiempo. Ya declarado como mejora futura no bloqueante en requirements.md.
- observación: riesgo heredado `console.log` del OTP en `OtpChallengeIssuer` sigue presente;
  fuera de alcance de F20, reportado al leader. No se tocó (correcto).

Ningún hallazgo BLOQUEANTE ni menor.

## R16–R18 (frontend)
Confirmado PENDIENTES a propósito: no hay cambios en `app/**`. Se implementarán al liberarse
la zona frontend tras el merge de #31. No bloquean este slice.

## Veredicto

**APROBADO** — slice BACKEND (Bloques 0–3, T00–T05). 0 bloqueantes.
La feature 20 NO pasa a `done` global hasta completar el frontend (T06–T09) y cerrar la
trazabilidad R16–R18; este veredicto aprueba exclusivamente el slice backend entregado.
