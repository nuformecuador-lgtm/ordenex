# Feature 20 — Recuperación de contraseña · tasks.md

> Checklist verificable. Cada task: qué hace, R que cubre, test que la valida, y "hecho".
> `[P]` = paralelizable con otras `[P]` del mismo bloque. Sin tabla nueva.
> Bloqueada por las Preguntas abiertas de `requirements.md` (aprobación humana previa a
> implementar; ver decisiones 1/2/3 en `design.md`).

## Bloque 0 — Contratos, política y config

- [x] **T00 — Política de contraseña fuerte reutilizable** (`lib/types/password-policy.ts`) [P]
  - Crea `strongPasswordSchema` (zod): `min(8).max(72)` + reglas de complejidad (≥1
    mayúscula, ≥1 minúscula, ≥1 dígito, ≥1 símbolo), cada regla con su mensaje. Módulo
    propio para reutilización futura (features 25/21 — sin implementarlas aquí).
  - Cubre: R8.
  - Test: `tests/unit/password-policy.test.ts` — "acepta contraseña válida"; y un caso por
    cada regla que falla: "rechaza <8", "rechaza sin mayúscula", "rechaza sin minúscula",
    "rechaza sin dígito", "rechaza sin símbolo", "rechaza >72".
  - Hecho: schema exportado, tipado sin `any`, todos los sub-tests verdes.

- [x] **T00b — Constantes de rate-limit en `authConfig`** (`lib/config/auth.ts`) [P]
  - Añade `RESET_REQUEST_WINDOW_MINUTES` (15), `RESET_MAX_REQUESTS` (3),
    `RESET_VERIFY_WINDOW_MINUTES` (10), `RESET_MAX_VERIFY_ATTEMPTS` (5), env-overridables
    vía `readPositiveInt` (`AUTH_RESET_*`). Sin hardcode fuera de este archivo.
  - Cubre: R15, R19, R20.
  - Test: `tests/unit/auth-config-reset.test.ts` — "usa defaults"; "respeta overrides de env".
  - Hecho: constantes en `AuthConfig` y `loadAuthConfig`, test verde.

- [x] **T01 — Tipos + schemas zod** (`lib/types/password-reset.ts`) [P]
  - Crea `requestResetSchema`, `verifyResetCodeSchema` y `resetPasswordSchema` (compone
    `strongPasswordSchema` de T00 + `.refine` de coincidencia password/confirmación) y las
    uniones de resultado (`PasswordResetRequestResult`, `VerifyResetCodeResult`,
    `ResetPasswordResult`). Reusa `OTP_CODE_LENGTH` de `lib/types/auth.ts`.
  - Cubre: R7 (más R8 vía composición).
  - Test: `tests/unit/password-reset-schemas.test.ts` — "rechaza cuando password y
    confirmación difieren"; "rechaza password que no cumple política"; "acepta entrada válida".
  - Depende de: T00.
  - Hecho: schemas exportados, tipados sin `any`, test verde.

## Bloque 1 — Repositorios (métodos a crear)

- [x] **T02 — `updatePasswordHash` en IUserRepository + UserRepository** [P]
  - Añade `updatePasswordHash(usuarioId, passwordHash): Promise<void>` a la interfaz y su
    implementación Prisma (`update` sobre `usuario`). No expone el hash de vuelta.
  - Cubre: R9.
  - Test: `tests/integration/user-repository-update-password.test.ts` — "actualiza
    password_hash del usuario indicado y no toca otros campos".
  - Hecho: método implementado, test verde.

- [x] **T03 — `findLatestActiveByUsuarioId` en IEmailOtpChallengeRepository + repo** [P]
  - Añade el método: devuelve el desafío más reciente `consumedAt = null` y `expiresAt >
    now`, o `null`. Reutiliza `create`/`markConsumed` existentes sin cambios.
  - Cubre: R5, R13.
  - Test: `tests/integration/otp-challenge-latest-active.test.ts` — "devuelve el desafío
    activo más reciente"; "devuelve null si consumido o expirado".
  - Hecho: método implementado, test verde.

- [x] **T03b — `contarRecientesPorUsuario` en IEmailOtpChallengeRepository + repo** [P]
  - Añade `contarRecientesPorUsuario(usuarioId, ventanaMinutos): Promise<number>` (cuenta
    por `createdAt` dentro de la ventana; usa `@@index([usuarioId, createdAt])`). Base del
    rate-limit durable de solicitudes.
  - Cubre: R19.
  - Test: `tests/integration/otp-challenge-count-recent.test.ts` — "cuenta solo los de la
    ventana"; "ignora los más antiguos que la ventana".
  - Hecho: método implementado, test verde.

- [x] **T03c — Limitador de intentos de verificación** (`lib/utils/reset-rate-limit.ts`) [P]
  - Ventana deslizante en memoria, clave `email|ip`, reloj inyectable. API: `registrar(key)`
    / `superaLimite(key, max, ventanaMs)`. No escribe en DB ni en `login_attempt`.
  - Cubre: R20.
  - Test: `tests/unit/reset-rate-limit.test.ts` — "no supera bajo el umbral"; "supera al
    N+1 dentro de la ventana"; "se reinicia pasada la ventana (reloj inyectado)".
  - Hecho: util implementado, tests verdes.

## Bloque 2 — Servicio (depende de T01, T02, T03, T03b, T03c, T00b)

- [x] **T04 — `PasswordResetService`** (`lib/services/PasswordResetService.ts`)
  - Constructor con `IUserRepository`, `IEmailOtpChallengeRepository`, `OtpChallengeIssuer`
    (o `IEmailProvider` + issuer) y el limitador de verificación (inyectable). Métodos:
    `solicitar({email,deviceHash,ipAddress})`, `verificarCodigo({email,code,ipAddress})`,
    `restablecer({email,code,newPassword,ipAddress})`.
    - `solicitar`: si usuario existe Y `contarRecientesPorUsuario < RESET_MAX_REQUESTS` →
      `otpIssuer.emitir`; en cualquier caso retorna resultado genérico. No loguea email/código.
    - `verificarCodigo`: si `superaLimite(email|ip)` → `invalid_or_expired`; si no, resuelve
      usuario + `findLatestActiveByUsuarioId` + `bcrypt.compare`; registra intento; no consume.
    - `restablecer`: idéntico gate de límite; re-verifica; si válido → `hashPassword` →
      `updatePasswordHash` → `markConsumed`; si desafío inactivo → `invalid_or_expired` sin
      tocar contraseña. Nunca escribe en `login_attempt` ni bloquea la cuenta.
  - Cubre: R1, R2, R3, R5, R6, R9, R10, R11, R13, R14, R15, R19, R20.
  - Test: `tests/unit/password-reset-service.test.ts` (repos/issuer/limitador mockeados):
    - "email inexistente devuelve respuesta genérica y no emite OTP" (R1/R3)
    - "email existente emite OTP y persiste solo el hash" (R2/R4)
    - "verificar código incorrecto o expirado devuelve error genérico" (R5/R6)
    - "restablecer con código válido hashea, persiste y marca consumido" (R9/R10)
    - "restablecer con desafío ya consumido no modifica la contraseña" (R11)
    - "un OTP de otro email no restablece la contraseña del usuario" (R13)
    - "no se registra el código ni la contraseña en claro" (R14, spy sobre logger)
    - "supera RESET_MAX_REQUESTS → no emite OTP pero responde genérico" (R19)
    - "supera RESET_MAX_VERIFY_ATTEMPTS → invalid_or_expired sin tocar login_attempt ni
      bloquear la cuenta" (R20)
  - Hecho: servicio implementado, todos los sub-tests verdes.

## Bloque 3 — Server Actions (depende de T04)

- [x] **T05 — Server Actions** (`lib/actions/password-reset.ts`)
  - `solicitarRecuperacion`, `verificarCodigoRecuperacion`, `restablecerContrasena` con
    `'use server'`, validación zod (T01), `deps` opcional para tests, contexto de request
    (`requestContextFromHeaders` + `computeDeviceHash`, IP real → device/ip del challenge y
    clave del limitador R20). `solicitarRecuperacion` nunca revela existencia.
  - Cubre: R1, R6, R7, R8, R11, R12, R15, R19, R20.
  - Test: `tests/unit/password-reset-actions.test.ts` (service inyectado):
    - "solicitar devuelve ok genérico exista o no el email" (R1/R12)
    - "verificar código inválido devuelve invalid_or_expired" (R6)
    - "restablecer con confirmación distinta devuelve validation_error" (R7)
    - "restablecer con desafío inactivo devuelve invalid_or_expired" (R11)
  - Hecho: actions implementadas, tests verdes.

## Bloque 4 — Frontend (depende de T05; UI en paralelo con Bloque 3 salvo integración)

- [x] **T06 — Página pública** (`app/recuperar-contrasena/page.tsx`) [P]
  - Server Component público; si hay sesión válida redirige a `/` (patrón `login/page.tsx`).
    Monta `RecuperarContrasenaForm`. Ruta FIRME `app/recuperar-contrasena/` (no bajo login).
  - Cubre: R12.
  - Test: `tests/integration/recuperar-contrasena-page.test.tsx` — "redirige a / si hay
    sesión válida"; "renderiza el formulario si no hay sesión".
  - Hecho: página renderiza, test verde.

- [x] **T07 — Formulario multi-fase** (`app/recuperar-contrasena/_components/RecuperarContrasenaForm.tsx`)
  - Fases `email → code → password → done`, reutiliza shadcn/ui y patrón de `LoginForm`.
    Conserva email+código en estado entre fases. Mensajes genéricos (no revela existencia).
    Confirmación de éxito con enlace a login.
  - Cubre: R16, R17.
  - Test: `tests/integration/recuperar-contrasena-form.test.tsx` — "avanza de email a
    código tras solicitar"; "muestra error genérico con código inválido"; "muestra
    confirmación y enlace a login tras restablecer".
  - Hecho: las tres fases funcionan contra actions mockeadas, tests verdes.

- [x] **T08 — Enlace desde login** (`app/login/_components/LoginForm.tsx`) [P]
  - Añade enlace "¿Olvidaste tu contraseña?" hacia `app/recuperar-contrasena`.
  - Cubre: R18.
  - Test: `tests/integration/login-form-reset-link.test.tsx` — "muestra enlace de
    recuperación que apunta a la ruta de reset".
  - Hecho: enlace visible y navegable, test verde.

## Bloque 5 — Verificación final

- [ ] **T09 — Trazabilidad + suite** (depende de T00–T08)
  - Completa el mapa R→test en `progress/impl_20-recuperacion-contrasena.md`. Corre
    `./init.sh` y la suite; todo verde. Verifica que ningún test ni código loguea OTP/
    contraseña en claro (R14).
  - Cubre: R1–R20 (cierre de trazabilidad).
  - Hecho: `./init.sh` verde, suite verde, cada R mapeado a ≥1 test nombrado.

## Notas de dependencias

- T00/T00b/T01/T02/T03/T03b/T03c en paralelo (`[P]`; T01 requiere T00). T04 requiere
  T00b, T01, T02, T03, T03b, T03c. T05 requiere T04. T06/T08 en paralelo; T07 requiere T05
  para integración real (mockeable antes). T09 cierra todo.
- Frontend (T06/T07/T08): se implementa al liberarse la zona tras el merge de #31; el spec
  no cambia por ello.
- Riesgo heredado (log de OTP en `OtpChallengeIssuer`): reportado en `requirements.md`;
  su corrección NO forma parte de estas tasks.
