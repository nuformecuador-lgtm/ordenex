# Diseño — login (RBA)

## Enfoque general

Login como **Server Action** (`lib/actions/auth.ts`, `'use server'`), no route
handler: es una mutación interna del propio proyecto (login/logout), consistente
con `docs/architecture.md` ("mutación desde componente propio → Server Action").
Capas: Controller (Server Action) → `AuthService` → `UserRepository` +
`LoginAttemptRepository` + `RiskEngine` (servicio de dominio, sin HTTP ni DB
directa).

```
lib/actions/auth.ts            Controller: parsea con zod, llama a AuthService
lib/services/AuthService.ts    Orquesta: valida credenciales, calcula riesgo,
                                decide sesión directa / challenge / rechazo
lib/services/RiskEngine.ts     Calcula señal de riesgo (RBA) a partir de señales
lib/repositories/UserRepository.ts
lib/repositories/LoginAttemptRepository.ts
lib/repositories/TrustedDeviceRepository.ts
lib/interfaces/services/IAuthService.ts, IRiskEngine.ts
lib/interfaces/repositories/IUserRepository.ts, ILoginAttemptRepository.ts, ITrustedDeviceRepository.ts
lib/supabase/server.ts         Cliente Supabase server-side (ya existente/asumido)
```

## Modelo de datos (Prisma)

Se agregan modelos nuevos a `db/schema.prisma`. Columnas en `snake_case` vía
`@map`/`@@map` según `docs/conventions.md` (Tablas y columnas Supabase:
`snake_case`).

Catálogos como tablas simples con solo `id` y `value` (decisión cerrada #3):

```prisma
model TipoIdentificacion {
  id       String    @id @default(uuid())
  value    String    @unique            // seed: "cedula", "ruc", "pasaporte"

  usuarios Usuario[]

  @@map("tipo_identificacion")
}

model Rol {
  id       String    @id @default(uuid())
  value    String    @unique            // seed: "admin", "usuario"

  usuarios Usuario[]

  @@map("rol")
}

enum EstadoUsuario {
  pendiente     // recién creado, sin verificar
  activo
  inactivo
  bloqueado     // por seguridad / bloqueo por fallos

  @@map("estado_usuario")
}

model Usuario {
  id                    String        @id @default(uuid())
  nombre                String
  email                 String        @unique
  telefono              String
  passwordHash          String        @map("password_hash")
  estado                EstadoUsuario @default(pendiente)
  cedula                String        @unique
  tipoIdentificacionId  String        @map("tipo_identificacion_id")
  rolId                 String        @map("rol_id")
  createdAt             DateTime      @default(now()) @map("created_at")
  updatedAt             DateTime      @updatedAt       @map("updated_at")

  tipoIdentificacion    TipoIdentificacion @relation(fields: [tipoIdentificacionId], references: [id])
  rol                   Rol                @relation(fields: [rolId], references: [id])
  loginAttempts         LoginAttempt[]
  trustedDevices        TrustedDevice[]
  otpChallenges         EmailOtpChallenge[]

  @@map("usuario")
  @@index([tipoIdentificacionId])
  @@index([rolId])
}

model LoginAttempt {
  id          String   @id @default(uuid())
  usuarioId   String?  @map("usuario_id")   // null si el email no resolvió a usuario
  emailUsado  String   @map("email_usado")
  exitoso     Boolean
  ipAddress   String   @map("ip_address")
  userAgent   String   @map("user_agent")
  riskScore   Int      @map("risk_score")
  riskReason  String   @map("risk_reason")  // resumen de señales usadas
  createdAt   DateTime @default(now()) @map("created_at")

  usuario     Usuario? @relation(fields: [usuarioId], references: [id])

  @@map("login_attempt")
  @@index([usuarioId, createdAt])
  @@index([ipAddress, createdAt])
}

model TrustedDevice {
  id            String   @id @default(uuid())
  usuarioId     String   @map("usuario_id")
  deviceHash    String   @map("device_hash")  // hash de fingerprint (UA + atributos), nunca PII cruda
  ipAddress     String   @map("ip_address")
  lastSeenAt    DateTime @default(now()) @map("last_seen_at")
  createdAt     DateTime @default(now()) @map("created_at")

  usuario       Usuario  @relation(fields: [usuarioId], references: [id])

  @@map("trusted_device")
  @@unique([usuarioId, deviceHash])
  @@index([usuarioId])
}

// Challenge OTP por email para el paso adicional de RBA (R17-R20).
model EmailOtpChallenge {
  id          String   @id @default(uuid())
  usuarioId   String   @map("usuario_id")
  codeHash    String   @map("code_hash")   // hash del código OTP, nunca el código en claro
  deviceHash  String   @map("device_hash") // dispositivo a confiar si el OTP se supera (R19)
  ipAddress   String   @map("ip_address")
  expiresAt   DateTime @map("expires_at")
  consumedAt  DateTime? @map("consumed_at")
  createdAt   DateTime @default(now()) @map("created_at")

  usuario     Usuario  @relation(fields: [usuarioId], references: [id])

  @@map("email_otp_challenge")
  @@index([usuarioId, createdAt])
}
```

**Sesión — reutiliza el modelo existente.** No se crea tabla nueva de sesión;
se usa el modelo `Session` ya presente en `db/schema.prisma`
(`id`, `userId`, `expiresAt`, `createdAt`). Al conceder sesión se inserta un
registro con `expiresAt = now + 24h` (constante `SESSION_TTL_HOURS = 24`) y se
setea la cookie httpOnly `session` con el `id` del registro. Logout elimina el
registro (R24). `middleware.ts` verifica presencia de la cookie; la validez por
`expiresAt` (R23a) se resuelve server-side al leer la sesión.

Notas:
- `passwordHash` nunca se selecciona en queries que devuelvan datos al cliente;
  el repositorio expone un método separado `findByEmailWithHash` solo para el
  flujo de verificación de credenciales.
- `estado` como enum Postgres (`pendiente` / `activo` / `inactivo` /
  `bloqueado`), no string libre, para que R13 sea verificable en DB (además de
  en la capa de servicio).
- `codigo` OTP nunca se persiste en claro: se guarda `codeHash`. El código en
  claro solo viaja en el email enviado.
- Catálogos (`tipo_identificacion`, `rol`) sin RLS de usuario final: se leen
  server-side únicamente (validación de FK), no se exponen a queries de cliente
  no autenticado directamente.

## RLS (Supabase)

Todas las tablas se acceden exclusivamente desde el servidor (Server Actions /
Prisma con service role), no hay acceso directo desde el cliente vía
`supabase-js` a estas tablas. Aun así, `docs/architecture.md` exige RLS en toda
tabla sensible, como defensa en profundidad si en el futuro se expone la key
anon:

```sql
alter table usuario enable row level security;
alter table login_attempt enable row level security;
alter table trusted_device enable row level security;
alter table email_otp_challenge enable row level security;
alter table tipo_identificacion enable row level security;
alter table rol enable row level security;

-- Ninguna policy para rol anon/authenticated: por defecto RLS sin policies
-- bloquea todo acceso salvo el service role (usado por el server de Next).
```

## Migraciones

`db/migrations/<timestamp>_login_usuario_rba/`:
- `migration.sql` (UP, generado por `pnpm run db:migrate:create`): crea enum
  `estado_usuario`, tablas `tipo_identificacion`, `rol`, `usuario`,
  `login_attempt`, `trusted_device`, `email_otp_challenge`, sus índices, FKs, y
  los `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`. NO recrea `session` (ya
  existe).
- `down.sql` (manual, OBLIGATORIO): drop de las 6 tablas nuevas en orden inverso
  de dependencia (`email_otp_challenge`, `login_attempt`, `trusted_device`,
  `usuario`, `rol`, `tipo_identificacion`) y drop del enum `estado_usuario`. No
  toca `session`.

## Contrato — Server Action `login`

```ts
// lib/actions/auth.ts
'use server'

type LoginInput = {
  email: string;
  password: string;
};

type LoginResult =
  | { status: 'ok' }                                   // sesión concedida, cookie seteada
  | { status: 'challenge_required'; challengeId: string } // RBA exige OTP por email
  | { status: 'invalid_credentials' }                  // R12
  | { status: 'account_unavailable' }                  // R13 (estado != activo)
  | { status: 'account_locked'; retryAfterMinutes: number } // R21/R21a (lockout temporal)
  | { status: 'validation_error'; fieldErrors: Record<string, string[]> }; // R8/R9

async function login(input: LoginInput): Promise<LoginResult>
```

Entrada validada con zod (`email` formato email, `password` no vacía y con
longitud máxima) antes de tocar `AuthService` (R8, R9).

`AuthService.login` (pseudo-contrato):
1. Valida input (zod, en el borde de la Server Action, no en el service).
2. `UserRepository.findByEmailWithHash(email)`.
3. Si no existe o `bcrypt.compare` falla → registra `LoginAttempt` (exitoso:
   false) → devuelve `invalid_credentials` (R12).
4. **Chequeo de bloqueo temporal (R21/R21a):** si el usuario tiene
   `MAX_FAILED_ATTEMPTS` (5) fallos consecutivos dentro de la ventana
   `LOCKOUT_MINUTES` (15), rechaza con `account_locked` sin evaluar riesgo. El
   chequeo se hace tras resolver el usuario y antes de conceder sesión.
5. Si `estado !== activo` → registra intento → devuelve `account_unavailable`
   (R13). (`bloqueado` es un caso de estado no-activo persistido; el lockout
   temporal de R21 es transitorio y se calcula de `LoginAttempt`.)
6. `RiskEngine.evaluate({ usuarioId, ipAddress, userAgent, failedAttemptsRecientes })`
   → `{ score, reasons }`.
7. Si `score` bajo `RISK_THRESHOLD` → concede sesión (`Session` + cookie),
   registra intento exitoso, marca/actualiza `TrustedDevice`, resetea contador
   de fallos (R16, R22).
8. Si `score` >= `RISK_THRESHOLD` → genera OTP, guarda `EmailOtpChallenge` (con
   `codeHash`, `expiresAt = now + OTP_TTL_MINUTES`), envía el código por email,
   devuelve `challenge_required` con `challengeId` (R17).

`AuthService.verifyChallenge(challengeId, code)`:
- Valida que el challenge exista, no esté consumido ni expirado, y que
  `bcrypt.compare(code, codeHash)` coincida.
- Éxito → marca `consumedAt`, concede sesión, confía el dispositivo
  (`TrustedDevice`), resetea fallos (R19).
- Fallo/expiración → no concede sesión (R20).

### Constantes de configuración (no hardcode disperso)

Centralizadas (p.ej. `lib/config/auth.ts`), sobreescribibles por entorno:
- `MAX_FAILED_ATTEMPTS = 5`
- `LOCKOUT_MINUTES = 15`
- `SESSION_TTL_HOURS = 24`
- `OTP_TTL_MINUTES` (valor a fijar en implementación; se sugiere 10)
- `RISK_THRESHOLD` (umbral del RiskEngine)

## Señales de riesgo (RBA) — `RiskEngine`

Señales usadas para el score (todas derivables del stack actual, sin
integraciones nuevas obligatorias):

| Señal | Fuente | Peso conceptual |
| --- | --- | --- |
| Dispositivo no reconocido | hash de `User-Agent` + atributos de cliente comparado contra `TrustedDevice.deviceHash` del usuario | alto |
| IP/red no reconocida | `ipAddress` de la request comparado contra IPs vistas en `LoginAttempt` exitosos recientes del usuario | medio |
| Intentos fallidos recientes | conteo de `LoginAttempt.exitoso = false` en ventana de tiempo configurable para ese usuario/IP | alto |
| Geolocalización inconsistente ("impossible travel") | derivable de IP→país/región (requiere servicio de geo-IP; opcional, fuera del MVP) | medio (condicional a disponibilidad) |
| Hora inusual respecto al patrón del usuario | hora del intento vs. distribución histórica de `LoginAttempt` exitosos del usuario | bajo |

El score es la suma ponderada de señales activas; el umbral (`RISK_THRESHOLD`)
es configuración, no hardcode (principio de `docs/architecture.md`). La señal de
geolocalización ("impossible travel") queda como opcional/condicional: solo se
activa si hay un proveedor de geo-IP disponible. No es requisito del MVP y no
bloquea R15–R17, que se satisfacen con dispositivo, IP y fallos recientes.

## Hashing de contraseña

`bcrypt` (o `argon2id` si ya está disponible en el proyecto; se decide en
implementación según qué paquete ya esté en `package.json`) con factor de costo
estándar de la librería. Nunca se compara en texto plano ni se loguea el valor
de `password`.

## Alternativas descartadas

1. **RBA como middleware genérico interceptando todas las rutas** (en vez de
   lógica dentro de `AuthService`/`RiskEngine` invocada solo desde el login).
   Descartada porque el riesgo se evalúa en el momento de autenticación, no en
   cada request; meterlo en `middleware.ts` acoplaría lógica de negocio de auth
   a la capa de enrutamiento (viola "Separación de capas" y el anti-patrón
   "lógica de negocio dentro de... handlers de ruta" de `docs/architecture.md`),
   y `middleware.ts` no tiene acceso cómodo a Prisma/DB en el edge runtime.
2. **Guardar el resultado de riesgo como columna simple en `usuario` en vez de
   tabla `login_attempt` con histórico.** Descartada porque el RBA necesita
   comparar contra intentos pasados (IPs vistas, fallos recientes, patrón de
   horas) para calcular el score; una sola columna pierde el histórico
   necesario para las señales de R15 y para auditoría (R18).
3. **JWT stateless en vez de cookie de sesión server-side.** Descartada porque
   `middleware.ts` ya usa un modelo de cookie `session` simple verificada por
   presencia, y agregar JWT introduciría revocación distribuida sin necesidad
   clara en esta feature; se mantiene consistencia con el mecanismo existente
   (R23, R24) hasta que haya un requisito explícito de stateless auth.

## Trazabilidad prevista

- R1–R7 → tests de repositorio/modelo (constraints únicos, no exposición de
  hash, relaciones FK).
- R8–R10, R10a → tests de validación de `AuthService`/zod schema (email,
  password, FK de catálogos, cédula/teléfono numérico + longitud).
- R11–R14 → tests de `AuthService.login` con mocks de `UserRepository`.
- R15–R20 → tests de `RiskEngine` (unit) y de `AuthService`/`verifyChallenge`
  orquestando OTP por email (integration, con proveedor de email mockeado).
- R21, R21a, R22 → tests de `LoginAttemptRepository`/`AuthService` con
  `MAX_FAILED_ATTEMPTS` y `LOCKOUT_MINUTES` configurados en entorno de test
  (5 fallos → `account_locked`; expira a los 15 min; éxito resetea contador).
- R23, R23a, R24 → tests de integración de la Server Action `login`/`logout`,
  del modelo `Session` (TTL 24h, expiración) y de `middleware.ts`.
