# Feature 20 — Recuperación de contraseña · design.md

> Decisiones técnicas. Reutiliza la infra de auth existente; sin tabla nueva.
> Cubre R1–R18. Las incógnitas quedan en Preguntas abiertas de `requirements.md`.

## 1. Modelo de datos

- **Sin migración ni tabla nueva.** Se reutiliza `EmailOtpChallenge` (`db/schema.prisma`
  L142) tal cual. Ningún campo se añade.
- Campos usados: `usuarioId`, `codeHash` (hash del OTP, R4), `deviceHash`, `ipAddress`
  (NOT NULL — ver decisión 6), `expiresAt` (R5/R15), `consumedAt` (R10/R11), `createdAt`.
- Se persiste sobre `Usuario.password_hash` (R9) vía nuevo método de repositorio
  (decisión 4). RLS: no aplica tabla nueva; se respeta el modelo actual (acceso solo por
  Server Actions server-side, sin exponer el hash).

## 2. Arquitectura de capas

Nuevo servicio `PasswordResetService` (capa Service) + Server Actions (capa Controller) +
reutilización de repositorios existentes. Frontend: una página pública multi-fase.

```
app/recuperar-contrasena/page.tsx                 ← página pública (Server Component)
  └─ _components/RecuperarContrasenaForm.tsx       ← cliente, 3 fases (R16/R17)
lib/actions/password-reset.ts                      ← Server Actions (R1,R5,R7-R11)
  └─ PasswordResetService                          ← lógica de negocio
       ├─ IUserRepository (findByEmail + updatePasswordHash*)
       ├─ IEmailOtpChallengeRepository (create, findLatestActiveByUsuarioId*, markConsumed)
       ├─ OtpChallengeIssuer (emisión OTP reutilizada)  ← usa IEmailProvider
       └─ hashPassword (lib/utils/password)
(*) método a crear
```

### Decisión 1 — Servicio nuevo `PasswordResetService`, no ampliar `AuthService`
`AuthService` ya recibe 7 dependencias (sesiones, riesgo, dispositivos, intentos) que el
reset NO necesita (no crea sesión, no evalúa riesgo, no confía dispositivo). Un servicio
dedicado con solo `IUserRepository`, `IEmailOtpChallengeRepository`, `OtpChallengeIssuer`
es más cohesivo y testeable. **Recomendado.**

### Decisión 2 — Verificación por (email + código), no por `challengeId` en cliente
En el login, `login()` devuelve `challengeId` al cliente cuando exige OTP. Copiar ese
patrón aquí filtraría existencia: solo se obtendría un `challengeId` real si el email
existe (rompe R3). Por eso el reset **no expone `challengeId`**: el cliente conserva el
email tecleado y el código; el servidor resuelve el desafío activo a partir del usuario.
Requiere un método de repo `findLatestActiveByUsuarioId` (decisión 5).

### Decisión 3 — Consumir el OTP solo en el paso final (restablecer)
La verificación intermedia (`verificarCodigoRecuperacion`) es una compuerta de UX: valida
el código pero NO llama a `markConsumed`. El consumo (`consumed_at`, R10) ocurre de forma
atómica en `restablecerContrasena`, que re-verifica el código antes de hashear y persistir.
Así un usuario que verifica pero abandona no invalida su desafío, y el desafío se consume
exactamente una vez, al cambiar la contraseña (R10/R11/R13).

## 3. Métodos de repositorio a crear (declarados explícitamente)

### Decisión 4 — `IUserRepository.updatePasswordHash(usuarioId, passwordHash)` — A CREAR
No existe hoy. Actualiza `Usuario.password_hash`. Devuelve `void` o `UsuarioPublico` (sin
hash). Implementar en `UserRepository`. Motivo: R9 necesita persistir el nuevo hash y
ningún método actual lo permite.

### Decisión 5 — `IEmailOtpChallengeRepository.findLatestActiveByUsuarioId(usuarioId)` — A CREAR
No existe (solo hay `findActiveById`). Devuelve el desafío más reciente no consumido y no
expirado para el usuario, o `null`. Motivo: decisión 2 (verificar por email sin exponer
`challengeId`). `create`, `markConsumed` se reutilizan sin cambios.

### Decisión 5b — `IEmailOtpChallengeRepository.contarRecientesPorUsuario(usuarioId, ventanaMinutos)` — A CREAR
Cuenta los desafíos creados para el usuario dentro de la ventana (por `createdAt`, usa el
índice existente `@@index([usuarioId, createdAt])`). Alimenta el rate-limit durable de
solicitudes (R19, sección 5b). Sin nueva tabla ni columna.

### Decisión 4b — Política de contraseña fuerte reutilizable — A CREAR
Validador zod `strongPasswordSchema` en `lib/types/password-policy.ts` (módulo propio para
que sea reutilizable): `min(8).max(72)` + `.regex` (o refines) que exigen ≥1 mayúscula, ≥1
minúscula, ≥1 dígito y ≥1 símbolo, cada regla con su mensaje. `resetPasswordSchema` lo
compone. **Contexto:** hoy el login/registro solo validan `min(1).max(72)`; esta feature
introduce la política fuerte SOLO para la nueva contraseña del reset y NO re-valida
contraseñas ya existentes (no hay rehash masivo). **Observación (no implementar aquí):**
conviene reutilizar `strongPasswordSchema` en features futuras (25 gestión de usuarios, 21
postulación) cuando definan/actualicen contraseñas, para unificar la política; queda como
recomendación, fuera del alcance de esta feature.

## 4. Server Actions (`lib/actions/password-reset.ts`, patrón de `lib/actions/auth.ts`)

Todas `'use server'`, con validación zod en el borde, `deps` opcional para inyección en
tests, y resultado tipado (unión discriminada como `LoginResult`).

- `solicitarRecuperacion(input)` → `PasswordResetRequestResult`
  - Valida `{ email }` (zod). Busca usuario por email. Si existe → `otpIssuer.emitir(...)`.
    Si no existe → no hace nada. **Siempre** devuelve `{ status: "ok" }` genérico (R1/R3).
- `verificarCodigoRecuperacion(input)` → `VerifyResetCodeResult`
  - Valida `{ email, code }`. Resuelve usuario + desafío activo; compara hash. Devuelve
    `{ status: "ok" }` o `{ status: "invalid_or_expired" }` (R5/R6). No consume.
- `restablecerContrasena(input)` → `ResetPasswordResult`
  - Valida `{ email, code, password, confirmPassword }` con `resetPasswordInputSchema`
    (coincidencia R7 vía `.refine`, política R8). Re-verifica el desafío activo; si válido:
    `hashPassword` → `updatePasswordHash` → `markConsumed` (R9/R10). Si el desafío ya no
    está activo → `{ status: "invalid_or_expired" }` sin tocar la contraseña (R11).

### Contratos I/O (zod, en `lib/types/password-reset.ts` — A CREAR)

```
requestResetSchema      = z.object({ email: z.string().email() })
verifyResetCodeSchema   = z.object({ email, code: /^\d{6}$/ })   // reusa OTP_CODE_LENGTH
strongPasswordSchema    = z.string().min(8).max(72)              // lib/types/password-policy.ts
                          + reglas: mayúscula, minúscula, dígito, símbolo (R8, cada una con mensaje)
resetPasswordSchema     = z.object({ email, code, password: strongPasswordSchema, confirmPassword })
                          .refine(p => p.password === p.confirmPassword, ...)  // R7
```

Tipos de resultado (unión discriminada, nunca lanzan al cliente):
`{ status: "ok" }` | `{ status: "invalid_or_expired" }` | `{ status: "validation_error"; fieldErrors }`.
`solicitarRecuperacion` solo devuelve `ok` | `validation_error` (nunca revela existencia).

## 5. Emisión y contexto de la request

Reutiliza `requestContextFromHeaders()` (patrón de `lib/actions/auth.ts`) para IP/UA y
`computeDeviceHash(userAgent)`.

### Decisión 6 — Poblar `deviceHash`/`ipAddress` con valores reales de la request (FIRME)
`EmailOtpChallenge.deviceHash`/`ipAddress` son NOT NULL. Se poblarán con
`computeDeviceHash(userAgent)` y la IP de la request, igual que el login, por trazabilidad.
No se usa marcador constante. En reset esos campos NO disparan "confiar dispositivo" (ese
paso es exclusivo de `AuthService.verifyChallenge`, que aquí no se invoca).

## 5b. Rate-limit (R19/R20) — TTL + límite ligero, sin lockout de cuenta

### Constantes nuevas en `authConfig` (`lib/config/auth.ts`, env-overridables) — A CREAR
Siguen el patrón `readPositiveInt`:
- `RESET_REQUEST_WINDOW_MINUTES` (env `AUTH_RESET_REQUEST_WINDOW_MINUTES`, default 15)
- `RESET_MAX_REQUESTS` (env `AUTH_RESET_MAX_REQUESTS`, default 3) — por email/ventana
- `RESET_VERIFY_WINDOW_MINUTES` (env `AUTH_RESET_VERIFY_WINDOW_MINUTES`, default 10)
- `RESET_MAX_VERIFY_ATTEMPTS` (env `AUTH_RESET_MAX_VERIFY_ATTEMPTS`, default 5) — por email/IP/ventana

### R19 — Límite de solicitudes (durable, por email)
Antes de emitir en `solicitar`, `PasswordResetService` llama
`contarRecientesPorUsuario(usuarioId, RESET_REQUEST_WINDOW_MINUTES)` (decisión 5b). Si el
conteo `>= RESET_MAX_REQUESTS`, NO emite OTP pero devuelve la MISMA respuesta genérica
(R1/R3). Es durable porque se apoya en `EmailOtpChallenge.createdAt` ya persistido.

### R20 — Límite de intentos de verificación (por email/IP)
Limitador ligero en `lib/utils/reset-rate-limit.ts` (A CREAR): ventana deslizante en memoria
del proceso, clave `email|ip`, con reloj inyectable para test. `verificarCodigoRecuperacion`
y `restablecerContrasena` registran el intento y, superado `RESET_MAX_VERIFY_ATTEMPTS` dentro
de `RESET_VERIFY_WINDOW_MINUTES`, responden `invalid_or_expired` sin más verificación.
**No** escribe en `login_attempt`, **no** invoca `contarFallosConsecutivosRecientes`, **no**
bloquea la cuenta ni afecta el login (R20). **Caveat documentado:** al ser en-proceso es
best-effort por instancia (Vercel); el respaldo durable es el TTL del OTP + el límite de
solicitudes R19 + el espacio de 6 dígitos. Si se requiere durabilidad estricta se evaluaría
un store compartido en una feature posterior (fuera de alcance: aquí no hay tabla nueva).

## 6. Frontend

### Decisión 7 — Ruta pública `app/recuperar-contrasena/` con formulario multi-fase
Un `page.tsx` (Server Component público; si hay sesión válida, redirige a `/` como
`login/page.tsx`) que monta `RecuperarContrasenaForm.tsx` (cliente) con estado de fase
`"email" | "code" | "password" | "done"` (R16/R17), replicando el patrón de fases de
`LoginForm.tsx`. Reutiliza primitivas shadcn/ui (`Card`, `Input`, `Label`, `Button`,
`Alert`) y estilos Tailwind existentes. El código y el email viajan en estado de cliente
entre fases (como `LoginForm` conserva `challengeId`). Se añade enlace "¿Olvidaste tu
contraseña?" en `LoginForm.tsx` hacia esta ruta (R18). Ruta FIRME: no se anida bajo
`app/login/`. (La zona frontend se implementará al liberarse tras el merge de #31; el spec
no cambia por ello.)

## 7. Alternativas descartadas

- **A. Ampliar `AuthService` en vez de servicio nuevo.** Descartada: acopla el reset a 4
  dependencias irrelevantes (sesión, riesgo, dispositivos, intentos) y engorda una clase ya
  grande. Ver decisión 1.
- **B. Devolver `challengeId` al cliente (calcar el login).** DESCARTADA por seguridad:
  emitir un `challengeId` solo cuando el email existe filtra existencia y rompe R3. Se
  verifica por (email + código). Ver decisión 2.
- **C. Tabla/token de reset dedicado (`PasswordResetToken`).** Descartada: el grounding
  exige reutilizar `EmailOtpChallenge` sin tabla nueva; el OTP ya cubre expiración, hash y
  consumo. Añadir tabla sería duplicar infraestructura.
- **D. Consumir el OTP en el paso de verificación intermedia.** Descartada: invalidaría el
  desafío antes de fijar la contraseña; un abandono tras verificar obligaría a reiniciar.
  Se consume al restablecer (decisión 3).

## 8. Trazabilidad (resumen; detalle en tasks.md)

R1/R3 → test de respuesta genérica del servicio y de `solicitarRecuperacion`.
R2/R4 → test de que existe → emite OTP y persiste hash. R5/R6 → test de verificación.
R7 → test `.refine` de coincidencia. R8 → tests de `strongPasswordSchema` (caso válido +
cada regla que falla: longitud, mayúscula, minúscula, dígito, símbolo). R9/R10/R11 → test de
restablecimiento + consumo. R12/R13 → test de aislamiento por email/sesión. R14 → test/lint
de no-log. R15 → test de constantes en `authConfig`. R19 → test de límite de solicitudes
(supera umbral → no emite, respuesta genérica). R20 → test del limitador de verificación
(supera umbral → `invalid_or_expired`, no escribe en `login_attempt`, no bloquea cuenta).
R16/R17/R18 → tests de componente/página.
