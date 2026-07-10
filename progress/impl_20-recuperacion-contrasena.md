# Implementación Feature 20 — Recuperación de contraseña (BACKEND, Bloques 0–3)

> Alcance de esta bitácora: SOLO backend (T00–T05). El frontend (T06/T07/T08,
> requisitos R16/R17/R18) queda PENDIENTE — se implementará cuando se libere la
> zona frontend. Sin migración ni tabla nueva (se reutiliza `EmailOtpChallenge`).

## Tasks completadas: T00, T00b, T01, T02, T03, T03b, T03c, T04, T05 → `[x]`

## Archivos creados

- `lib/types/password-policy.ts` — `strongPasswordSchema` (zod, R8).
- `lib/types/password-reset.ts` — schemas `requestResetSchema`, `verifyResetCodeSchema`,
  `resetPasswordSchema` + uniones de resultado.
- `lib/utils/reset-rate-limit.ts` — `ResetRateLimiter` (ventana deslizante en memoria) +
  `buildResetRateKey`.
- `lib/interfaces/services/IPasswordResetService.ts` — contrato del servicio.
- `lib/services/PasswordResetService.ts` — lógica de negocio del reset.
- `lib/actions/password-reset.ts` — Server Actions `solicitarRecuperacion`,
  `verificarCodigoRecuperacion`, `restablecerContrasena`.
- Tests: `tests/unit/password-policy.test.ts`, `tests/unit/auth-config-reset.test.ts`,
  `tests/unit/password-reset-schemas.test.ts`, `tests/unit/reset-rate-limit.test.ts`,
  `tests/unit/password-reset-service.test.ts`, `tests/unit/password-reset-actions.test.ts`,
  `tests/integration/user-repository-update-password.test.ts`,
  `tests/integration/otp-challenge-latest-active.test.ts`,
  `tests/integration/otp-challenge-count-recent.test.ts`.

## Archivos modificados

- `lib/config/auth.ts` — 4 constantes `RESET_*` (env `AUTH_RESET_*`, patrón `readPositiveInt`).
- `lib/interfaces/repositories/IUserRepository.ts` — `updatePasswordHash`.
- `lib/repositories/UserRepository.ts` — impl. `updatePasswordHash`.
- `lib/interfaces/repositories/IEmailOtpChallengeRepository.ts` — `findLatestActiveByUsuarioId`,
  `contarRecientesPorUsuario`.
- `lib/repositories/EmailOtpChallengeRepository.ts` — impl. de ambos métodos.
- Mocks de tests existentes actualizados para las nuevas firmas de interfaz (sin cambio de
  lógica): `tests/unit/services/auth-service.test.ts`,
  `tests/unit/services/otp-challenge-issuer.test.ts`,
  `tests/unit/services/asignacion-mensajero-service.test.ts`,
  `tests/unit/services/rol-admin-satelite-authz.test.ts`.
- `specs/20-recuperacion-contrasena/tasks.md` — T00–T05 marcadas `[x]`.

## Mapa R → test (cobertura backend: R1–R15, R19, R20)

| R | Test |
|---|------|
| R1  | `password-reset-service.test.ts` "email inexistente devuelve respuesta generica y no emite OTP"; `password-reset-actions.test.ts` "devuelve ok generico exista o no el email" |
| R2  | `password-reset-service.test.ts` "email existente emite OTP" |
| R3  | `password-reset-service.test.ts` "email inexistente … no emite OTP" |
| R4  | `email-otp-challenge-repository.test.ts` (pre-existente, solo `codeHash`); issuer reutilizado |
| R5  | `password-reset-service.test.ts` "verificar codigo correcto devuelve ok sin consumir"; `otp-challenge-latest-active.test.ts` |
| R6  | `password-reset-service.test.ts` "verificar codigo incorrecto o expirado"; `password-reset-actions.test.ts` "propaga invalid_or_expired" |
| R7  | `password-reset-schemas.test.ts` "rechaza cuando password y confirmacion difieren"; `password-reset-actions.test.ts` "confirmacion distinta devuelve validation_error" |
| R8  | `password-policy.test.ts` (válida + 6 reglas que fallan); `password-reset-schemas.test.ts`; `password-reset-actions.test.ts` "password debil" |
| R9  | `password-reset-service.test.ts` "restablecer con codigo valido hashea, persiste…"; `user-repository-update-password.test.ts` |
| R10 | `password-reset-service.test.ts` "…y marca consumido" |
| R11 | `password-reset-service.test.ts` "desafio ya consumido/expirado no modifica"; `password-reset-actions.test.ts` "desafio inactivo" |
| R12 | `password-reset-actions.test.ts` "devuelve ok generico exista o no el email" (acción pública, sin sesión) |
| R13 | `password-reset-service.test.ts` "un OTP con codigo de otro no restablece"; `otp-challenge-latest-active.test.ts` |
| R14 | `password-reset-service.test.ts` "no registra el codigo ni la contrasena en claro" (spies de console) |
| R15 | `auth-config-reset.test.ts` (defaults + overrides) |
| R19 | `password-reset-service.test.ts` "supera RESET_MAX_REQUESTS → no emite OTP"; `otp-challenge-count-recent.test.ts` |
| R20 | `password-reset-service.test.ts` "supera RESET_MAX_VERIFY_ATTEMPTS → invalid_or_expired sin tocar repos"; `reset-rate-limit.test.ts` |

R16/R17/R18 → PENDIENTES (frontend T06/T07/T08).

## Salida de verificación (real)

- `pnpm run typecheck` → sin errores (exit 0).
- `pnpm run lint` → 0 errores, 135 warnings (todos en `.claude/skills/**`, ajenos a esta
  feature; ningún archivo de F20 flagueado).
- `npx vitest run` (suite completa, aislada) → **95 archivos, 762 tests, todos verdes.**
- Tests nuevos aislados → **9 archivos, 41 tests verdes.**
- `./init.sh` → termina en **verde (exit 0)**. Bajo la ejecución paralela de init aparecieron
  2 timeouts flaky PRE-EXISTENTES (`tests/integration/**` HomePage y `ordenes-carga-masiva.route`),
  documentados por el humano; verificados en aislamiento → pasan (16/16). No son de F20.

## Decisiones / notas

- No se creó migración ni tabla: se reutiliza `EmailOtpChallenge` (design.md).
- `deviceHash`/`ipAddress` del challenge se pueblan con valores reales de la request
  (`computeDeviceHash(userAgent)` + IP), decisión F1.4/6.
- Rate-limit de verificación (R20): util en memoria (`ResetRateLimiter`), NO escribe en
  `login_attempt`, NO reutiliza `MAX_FAILED_ATTEMPTS`, NO bloquea la cuenta.
- Rate-limit de solicitudes (R19): durable vía `contarRecientesPorUsuario` sobre
  `EmailOtpChallenge.createdAt`.
- R14: el código NUEVO no loguea OTP ni contraseña. El `console.log` heredado en
  `OtpChallengeIssuer` NO se tocó (excepción aceptada por el humano).

## Veredicto

Backend de la Feature 20 (Bloques 0–3, T00–T05) implementado y verde; frontend
(T06–T08, R16/R17/R18) pendiente.
