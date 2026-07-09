# Tasks — login (RBA)

> Backend: `backend_dev`. Frontend: `frontend_dev` (solo lo mínimo que esta
> feature necesita exponer; la UI completa vive en `login(home)`).
> `[P]` = paralelizable respecto a las tareas de su mismo bloque de dependencia.

## Bloque 1 — Modelo de datos (backend_dev)

- [x] T001 Agregar a `db/schema.prisma` los modelos `TipoIdentificacion` (id,
  value) y `Rol` (id, value), enum `EstadoUsuario` (`pendiente`/`activo`/
  `inactivo`/`bloqueado`), `Usuario`, `LoginAttempt`, `TrustedDevice`,
  `EmailOtpChallenge` según `design.md`. No recrear `Session` (ya existe).
  **Hecho cuando:** `prisma validate` no reporta errores. Depende de:
  aprobación del spec.
- [x] T002 Generar migración con `pnpm run db:migrate:create` (nombre
  `login_usuario_rba`). **Hecho cuando:** existe
  `db/migrations/<ts>_login_usuario_rba/migration.sql` con las 6 tablas nuevas,
  el enum, FKs e índices de `design.md` (sin recrear `session`). Depende de:
  T001.
- [x] T003 Escribir `down.sql` manual que revierta exactamente T002 (drop de las
  6 tablas nuevas en orden inverso + drop del enum, sin tocar `session`).
  **Hecho cuando:** `pnpm run db:rollback` seguido de `pnpm run db:migrate` deja
  el esquema idéntico (sin diff de `prisma migrate status`). Depende de: T002.
- [~] T004 Agregar `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` para las 6
  tablas nuevas dentro de `migration.sql` (o migración separada) sin policies
  para `anon`/`authenticated`. **Hecho cuando:** una query desde un cliente
  Supabase con key `anon` a cualquiera de las 6 tablas es rechazada.
  Depende de: T002.
  **PARCIAL:** los `ENABLE ROW LEVEL SECURITY` YA están en `migration.sql`
  (verificado por lectura por el reviewer). La **verificación del rechazo con
  key `anon`** queda DIFERIDA al despliegue con Supabase real (misma limitación
  que T020: no hay `.env`/DB en este entorno). Al desplegar, correr un test de
  integración que confirme el rechazo anon en las 6 tablas (docs/verification.md).
- [x] T005 [P] Seed de catálogos: `tipo_identificacion` → (cedula, ruc,
  pasaporte); `rol` → (admin, usuario). Script en `scripts/` o `prisma/seed`.
  **Hecho cuando:** correr el seed deja exactamente esos registros y son
  idempotentes (re-ejecutar no duplica). Depende de: T002.

## Bloque 2 — Interfaces y repositorios (backend_dev)

- [x] T006 [P] Definir interfaces en `lib/interfaces/repositories/`:
  `IUserRepository`, `ILoginAttemptRepository`, `ITrustedDeviceRepository`,
  `IEmailOtpChallengeRepository`, `ISessionRepository`. **Hecho cuando:**
  compilan en `strict` sin `any`. Depende de: T001.
- [x] T007 [P] Definir interfaces en `lib/interfaces/services/`: `IAuthService`,
  `IRiskEngine`; y en `lib/interfaces/external/`: `IEmailProvider` (envío del
  OTP). **Hecho cuando:** compilan en `strict` sin `any`. Depende de: T001.
- [x] T008 Implementar `lib/repositories/UserRepository.ts` (incluye
  `findByEmailWithHash`, que nunca se usa fuera de `AuthService`). **Hecho
  cuando:** tests unitarios con Prisma mockeado cubren: creación, unicidad de
  `email`/`cedula` (R4, R5), no exposición de hash en métodos públicos (R7).
  Depende de: T002, T006.
- [x] T009 [P] Implementar `lib/repositories/LoginAttemptRepository.ts`
  (registrar intento, contar fallos recientes por usuario/IP en ventana de
  tiempo configurable). **Hecho cuando:** tests unitarios cubren inserción y
  conteo con ventana configurable. Depende de: T002, T006.
- [x] T010 [P] Implementar `lib/repositories/TrustedDeviceRepository.ts`
  (buscar/crear/actualizar `lastSeenAt` por `usuarioId` + `deviceHash`).
  **Hecho cuando:** tests unitarios cubren alta y actualización idempotente.
  Depende de: T002, T006.
- [x] T010a [P] Implementar `lib/repositories/EmailOtpChallengeRepository.ts`
  (crear challenge, buscar por id no consumido/no expirado, marcar
  `consumedAt`). **Hecho cuando:** tests unitarios cubren creación, lookup con
  filtro de expiración/consumo, y marcado de consumido. Depende de: T002, T006.
- [x] T010b [P] Implementar `lib/repositories/SessionRepository.ts` sobre el
  modelo `Session` existente (crear con `expiresAt`, buscar por id, eliminar,
  descartar expirados). **Hecho cuando:** tests unitarios cubren alta con TTL,
  lectura de sesión válida vs. expirada (R23a) y borrado (R24). Depende de:
  T006 (no requiere T002; `Session` ya existe).

## Bloque 3 — Servicios de dominio (backend_dev)

- [x] T011 Implementar `lib/services/RiskEngine.ts` con las señales de
  `design.md` (dispositivo, IP, fallos recientes; geolocalización marcada como
  opcional/condicional). **Hecho cuando:** tests unitarios cubren: score bajo
  con dispositivo/IP reconocidos y sin fallos (R15, R16), score alto con
  dispositivo nuevo o fallos por encima del umbral (R15, R17), umbral leído de
  configuración (no hardcode). Depende de: T007, T009, T010.
- [x] T011a [P] Definir constantes de configuración de auth en
  `lib/config/auth.ts`: `MAX_FAILED_ATTEMPTS=5`, `LOCKOUT_MINUTES=15`,
  `SESSION_TTL_HOURS=24`, `OTP_TTL_MINUTES`, `RISK_THRESHOLD`, sobreescribibles
  por entorno. **Hecho cuando:** compilan en `strict` y test verifica lectura de
  overrides por env. Depende de: T001.
- [x] T011b Implementar generación/envío de OTP: helper que genera código,
  guarda `codeHash` vía `EmailOtpChallengeRepository` y envía por
  `IEmailProvider`. **Hecho cuando:** test verifica que el código en claro NUNCA
  se persiste (solo `codeHash`) y que se invoca el proveedor de email.
  Depende de: T010a, T014, T007.
- [x] T012 Implementar `lib/services/AuthService.ts` (`login`, `verifyChallenge`,
  `logout`) orquestando `UserRepository`, `LoginAttemptRepository`,
  `TrustedDeviceRepository`, `EmailOtpChallengeRepository`, `SessionRepository`,
  `RiskEngine`, `IEmailProvider`. **Hecho cuando:** tests unitarios cubren
  R11–R14, R16, R17, R19, R20, R22 con todos los repos/engine/proveedor
  mockeados. Depende de: T008, T009, T010, T010a, T010b, T011, T011a, T011b.
- [x] T013 Implementar bloqueo temporal duro por intentos fallidos (R21/R21a) en
  `AuthService`: tras `MAX_FAILED_ATTEMPTS` (5) fallos consecutivos dentro de
  `LOCKOUT_MINUTES` (15), rechazar con `account_locked` sin evaluar riesgo.
  **Hecho cuando:** test cubre que el 6.º intento dentro de la ventana devuelve
  `account_locked` aun con credenciales correctas, y que el bloqueo caduca
  pasados 15 minutos (tiempo mockeado). Depende de: T012.
- [x] T014 Implementar hashing/verificación de contraseña (`lib/utils/password.ts`
  o similar) usando la librería de hashing ya presente en `package.json` (o
  agregar `bcrypt`/`argon2` si no existe ninguna). **Hecho cuando:** test
  unitario verifica que un hash nunca es igual al texto plano y que
  `verify(plain, hash)` funciona correctamente en ambos sentidos (R6).
  Depende de: ninguna (puede ir en paralelo con Bloque 1) `[P]`.

## Bloque 4 — Borde (Server Action) (backend_dev)

- [x] T015 Definir schemas zod en `lib/types/`: entrada de `login`
  (`email` formato email, `password` no vacía/longitud máx), entrada de
  `verifyChallenge` (`challengeId`, `code`), y validación genérica de `cedula`
  y `telefono` (solo numérico + longitud min/max configurable, R10a). **Hecho
  cuando:** tests cubren rechazo de email inválido (R8), password vacía/larga
  (R9) y cédula/teléfono no numérico o fuera de longitud (R10a) sin llamar a
  `AuthService`. Depende de: T012.
- [x] T016 Implementar `lib/actions/auth.ts` (`login`, `verifyChallenge`,
  `logout`) como Server Actions que parsean con zod, extraen IP/User-Agent de la
  request, llaman a `AuthService`, y en caso de éxito crean `Session` (TTL 24h) y
  setean la cookie httpOnly `session` (consistente con `middleware.ts`); logout
  elimina la `Session`. **Hecho cuando:** test de integración cubre R12, R13,
  R21a→`account_locked`, R16→sesión concedida, R17→`challenge_required`,
  R19→OTP válido concede sesión, R20→OTP inválido/expirado no concede, R23,
  R23a, R24. Depende de: T012, T015.
- [x] T017 Validar FK de `tipo_identificacion_id`/`rol_id` en el flujo de
  creación de usuario (fuera del login en sí, pero requerido por R10 para que
  el modelo de datos sea consistente). **Hecho cuando:** test de integración
  rechaza creación de usuario con IDs de catálogo inexistentes. Depende de:
  T008.

## Bloque 5 — Frontend mínimo requerido por esta feature (frontend_dev)

- [x] T018 [P] Exponer un hook/cliente tipado en `lib/types/` (contrato
  `LoginInput`/`LoginResult` de `design.md`) para que `login(home)` lo consuma,
  sin construir aún la UI. **Hecho cuando:** el tipo compila en `strict` y es
  importable desde `app/`. Depende de: T016. Nota: la pantalla de login (UI)
  se implementa en la feature `login(home)`, no aquí.

## Bloque 6 — Verificación final (backend_dev)

- [x] T019 Correr `pnpm run typecheck`, `pnpm run lint` y la suite de tests
  (`tests/unit`, `tests/integration`) en verde. **Hecho cuando:** todos pasan y
  la salida se registra en `progress/impl_login.md` junto con el mapa
  R1..R24 (incluidos R10a, R21a, R23a) → test. Depende de: T001–T018.
- [~] T020 Verificar manualmente rollback de migración
  (`pnpm run db:rollback` y re-`pnpm run db:migrate`) sin errores y sin
  pérdida de datos de catálogos fuera de lo esperado. **Hecho cuando:** el
  comando corre sin error y el esquema resultante coincide con el previo al
  rollback. Depende de: T002, T003.
  **DIFERIDA:** no hay `.env` ni conexión a Supabase/Postgres en este entorno;
  no se puede ejecutar rollback contra una DB real. `down.sql` existe y `init.sh`
  valida que todas las migraciones lo tengan. Verificar al desplegar con DB real.
- [~] T021 Test E2E (Playwright) del flujo crítico de auth: login exitoso,
  credenciales inválidas, cuenta bloqueada (lockout) y logout. **Hecho cuando:**
  `pnpm run test:e2e` cubre esos 4 caminos contra la UI real.
  **DIFERIDA a la feature #2 `login(home)`:** el E2E requiere la pantalla
  `/login` (email + contraseña), que es el alcance de `login(home)`, no de esta
  feature (solo backend/flujo). Es **condición bloqueante de `login(home)`**: esa
  feature NO puede cerrarse sin este E2E cubriendo el flujo de `login`. Decisión
  humana registrada 2026-07-08.
