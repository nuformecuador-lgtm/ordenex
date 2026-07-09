# Implementación — login (RBA), backend (T005–T017)

> Nota: T001–T004 (modelo de datos, migración, RLS) ya estaban aplicados en el
> repo al iniciar esta sesión. Este documento cubre T005–T017 (interfaces,
> repositorios, servicios de dominio, Server Actions). T018 (contrato para
> `login(home)`), T019 y T020 quedan fuera de este alcance.

## Archivos creados

Config y utilidades:
- `lib/config/auth.ts` — constantes de auth sobreescribibles por env (T011a).
- `lib/utils/password.ts` — hash/verify con `bcryptjs` (T014).
- `lib/utils/device.ts` — hash de dispositivo a partir del User-Agent.
- `lib/db/prisma-client.ts` — singleton perezoso de `PrismaClient`.

Interfaces (`lib/interfaces/`):
- `repositories/IUserRepository.ts`, `ILoginAttemptRepository.ts`,
  `ITrustedDeviceRepository.ts`, `IEmailOtpChallengeRepository.ts`,
  `ISessionRepository.ts` (T006).
- `services/IAuthService.ts`, `IRiskEngine.ts`; `external/IEmailProvider.ts` (T007).

Repositorios (`lib/repositories/`):
- `UserRepository.ts` (T008), `LoginAttemptRepository.ts` (T009),
  `TrustedDeviceRepository.ts` (T010), `EmailOtpChallengeRepository.ts` (T010a),
  `SessionRepository.ts` (T010b).

Servicios de dominio (`lib/services/`):
- `RiskEngine.ts` (T011), `OtpChallengeIssuer.ts` (T011b, genera/envía OTP),
  `EmailProvider.ts` (`StubEmailProvider`, implementación de arranque de
  `IEmailProvider`), `AuthService.ts` (T012, incluye el bloqueo T013).

Borde (T015, T016):
- `lib/types/auth.ts` — schemas zod (`loginInputSchema`,
  `verifyChallengeInputSchema`, `numericIdentifierSchema`) y el tipo
  `LoginResult`.
- `lib/actions/auth.ts` — Server Actions `login`, `verifyChallenge`, `logout`.

Seed (T005):
- `scripts/seed-catalogos.ts` + script `pnpm run db:seed` en `package.json`.

Dependencia agregada: `bcryptjs` (no había ninguna librería de hashing en
`package.json`; se eligió `bcryptjs` por ser pura JS, sin bindings nativos).

## Tests (Prisma mockeado en todos los casos; no hay DB real disponible en este entorno)

- `tests/unit/utils/password.test.ts`
- `tests/unit/config/auth-config.test.ts`
- `tests/unit/repositories/user-repository.test.ts`
- `tests/unit/repositories/login-attempt-repository.test.ts`
- `tests/unit/repositories/trusted-device-repository.test.ts`
- `tests/unit/repositories/email-otp-challenge-repository.test.ts`
- `tests/unit/repositories/session-repository.test.ts`
- `tests/unit/services/risk-engine.test.ts`
- `tests/unit/services/otp-challenge-issuer.test.ts`
- `tests/unit/services/auth-service.test.ts`
- `tests/unit/types/auth-schemas.test.ts`
- `tests/integration/actions/auth-action.test.ts`
- `tests/integration/repositories/user-repository-catalog.test.ts` (T017)

## Mapa R<n> → test

| Requisito | Cubierto por |
| --- | --- |
| R1–R3 | `db/schema.prisma` (modelo `Usuario` con FKs a `TipoIdentificacion`/`Rol`); no re-verificado en esta sesión (T001, fuera de alcance). |
| R4 | `user-repository.test.ts` → "traduce violacion de unicidad de email a UsuarioDuplicadoError (R4)" |
| R5 | `user-repository.test.ts` → "traduce violacion de unicidad de cedula a UsuarioDuplicadoError (R5)" |
| R6 | `password.test.ts` → "el hash nunca es igual al texto plano (R6)" + verify en ambos sentidos |
| R7 | `user-repository.test.ts` → "no exposicion de passwordHash en `create`/`findByEmail`"; `AuthService` solo usa `findByEmailWithHash` |
| R8 | `auth-schemas.test.ts` → "rechaza un email con formato invalido (R8)"; `auth-action.test.ts` → "R8: rechaza email invalido..." |
| R9 | `auth-schemas.test.ts` → password vacía/longitud máxima (R9); `auth-action.test.ts` → "R9: rechaza password vacia..." |
| R10 | `user-repository-catalog.test.ts` (T017) → catálogo inexistente rechazado |
| R10a | `auth-schemas.test.ts` → `numericIdentifierSchema` (no numérico, longitud min/max) |
| R11 | `auth-service.test.ts` → verificación de existencia + password |
| R12 | `auth-service.test.ts` → "R12: devuelve invalid_credentials..." (email inexistente y password incorrecta); `auth-action.test.ts` → "R12: propaga invalid_credentials" |
| R13 | `auth-service.test.ts` → "R13: rechaza con account_unavailable..."; `auth-action.test.ts` → "R13: propaga account_unavailable" |
| R14 | `auth-service.test.ts` → "R14, R16: concede sesion directa..." (evalúa riesgo tras credenciales+estado válidos) |
| R15 | `risk-engine.test.ts` → señales dispositivo/IP/fallos recientes |
| R16 | `auth-service.test.ts` → "R14, R16: concede sesion directa cuando el riesgo es bajo" |
| R17 | `auth-service.test.ts` → "R17: exige challenge_required..."; `auth-action.test.ts` → "R17: devuelve challenge_required..." |
| R18 | `login-attempt-repository.test.ts` → "registrar inserta el intento con todos los campos de auditoria (R18)" |
| R19 | `auth-service.test.ts` → "R19: OTP valido concede sesion..."; `auth-action.test.ts` → "R19: OTP valido concede sesion y setea cookie" |
| R20 | `auth-service.test.ts` → "R20: OTP invalido..." y "OTP expirado..."; `auth-action.test.ts` → "R20: OTP invalido/expirado no concede sesion" |
| R21 | `auth-service.test.ts` → "R21, R21a: el 6to intento..."; "R21: el bloqueo caduca pasados 15 minutos..." |
| R21a | `auth-service.test.ts` (idem); `auth-action.test.ts` → "R21a: propaga account_locked..." |
| R22 | `auth-service.test.ts` → "R22: un intento exitoso registra el intento como exitoso..." |
| R23 | `session-repository.test.ts` → TTL 24h; `auth-action.test.ts` → "R16, R23: sesion concedida setea la cookie httpOnly..." |
| R23a | `session-repository.test.ts` → "findValidById devuelve null si expiresAt ya paso (R23a)" |
| R24 | `session-repository.test.ts` → "deleteById elimina el registro (R24)"; `auth-action.test.ts` → "R24: elimina la sesion y limpia la cookie" |

## Verificación ejecutada

```
$ pnpm run typecheck
> tsc --noEmit
(sin errores)

$ pnpm run lint
> eslint
(sin errores ni warnings)

$ pnpm run test
 Test Files  14 passed (14)
      Tests  77 passed (77)

$ bash init.sh
...
✓ dependencias presentes
-> pnpm run typecheck   (OK)
-> pnpm run lint        (OK)
-> pnpm run test        (14 files / 77 tests OK)
✓ todas las migraciones tienen down.sql
! no hay .env. Crea uno a partir de .env.example   (esperado: sin credenciales reales de Supabase en este entorno)
== init OK ==
```

## Notas / decisiones de implementación

- No hay conexión real a Supabase/Postgres disponible en este entorno (no hay
  `.env`), por lo que todos los tests usan Prisma mockeado, incluidos los
  llamados "integration" en `tests/integration/` (siguen el patrón de
  inyección de dependencias, no abren conexión real).
- `lib/db/prisma-client.ts` construye el `PrismaClient` de forma perezosa
  (`getPrismaClient()`) para que importar `lib/actions/auth.ts` en tests no
  dispare una conexión real; solo se instancia si efectivamente se invoca una
  Server Action sin `authService` inyectado.
- `lib/actions/auth.ts` acepta un segundo parámetro opcional `deps` (authService/
  getContext/setCookie/etc.) para permitir tests de integración sin `next/headers`
  ni `next/cookies` reales; en producción se llama sin ese argumento.
- T017 se implementó validando la FK de catálogo explícitamente en
  `UserRepository.create` (dos `findUnique` antes del `create`) en vez de
  depender del código de error de Postgres; da un error de dominio
  (`CatalogoInvalidoError`) más claro y testeable sin necesitar reconstruir
  errores internos de Prisma.
- `StubEmailProvider` es una implementación de arranque (loguea metadata, no
  el código OTP) para no violar el anti-patrón "console.log de secretos"; se
  reemplaza por un proveedor real cuando esa integración se aborde
  explícitamente (fuera de alcance de T005–T017).

## Diferimientos aprobados (decisión humana 2026-07-08)

Tras la revisión (`progress/review_login.md`, 2 bloqueantes de verificación), el
humano aprobó diferir explícitamente:

1. **E2E (Playwright) del flujo de login (T021):** DIFERIDO a la feature #2
   `login(home)`, porque el E2E necesita la pantalla `/login` que vive en esa
   feature. Es condición BLOQUEANTE de `login(home)`: no puede cerrarse sin un
   E2E que cubra login exitoso, credenciales inválidas, cuenta bloqueada y logout.
   `login` permanece `in_progress` hasta que ese E2E exista y pase.
2. **Verificación de rechazo RLS con key `anon` (T004):** DIFERIDA al despliegue
   con Supabase real (misma limitación de entorno que T020). Los `ENABLE ROW
   LEVEL SECURITY` ya están en `migration.sql`; falta el test de integración que
   confirme el rechazo anon, a correr cuando haya `.env`/DB de prueba.

Ambos son gaps de verificación de entorno/alcance, no de lógica: el reviewer
confirmó trazabilidad R1–R24 real, capas correctas, sin exposición de hash ni
secretos, y typecheck/lint/test/init.sh en verde.
