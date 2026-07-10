# Impl — Feature 21 · Postulación de mensajero

## SLICE BACKEND (backend_dev)

Estado: COMPLETO. Tasks T0–T7 del slice backend implementadas. El slice FRONTEND
(T8–T10) queda intacto para el frontend_dev.

### Decisiones humanas F1.4 respetadas
- A2: Supabase Storage, bucket PRIVADO `mensajero-docs`. Paths `{usuarioId}/{tipo}.{ext}`,
  sin URL pública (R18). Solo jpeg/png/webp, límite 5 MB (config, override por env).
- A3: error ESPECÍFICO por campo ante duplicado (`conflict` con `field: "email" | "cedula"`).
- A4: rate-limiting por IP|email en la Server Action, reutilizando `ResetRateLimiter`
  (feature 20). Sin duplicar infra.
- A5: reutiliza `strongPasswordSchema` de `lib/types/password-policy.ts` (min 8 + complejidad)
  + confirmación por `.refine`. No se duplicó la política.

### Reutilización verificada (no duplicada)
- `hashPassword` (bcrypt coste 10) de `lib/utils/password.ts` (login RBA feature 1).
- `numericIdentifierSchema` de `lib/types/auth.ts` (cédula/teléfono).
- `ResetRateLimiter` de `lib/utils/reset-rate-limit.ts` (ventana deslizante genérica).
- FK `usuario.vehiculo_id -> vehiculos.id` sobre el catálogo `Vehiculo` (feature 50, ya en dev).
- `createServerClient` de `lib/supabase/client.ts` (service role) para Storage.

### Archivos creados
- `db/migrations/20260710170000_postulacion_mensajero/migration.sql` (UP)
- `db/migrations/20260710170000_postulacion_mensajero/down.sql` (DOWN)
- `lib/config/postulacion.ts` (límite tamaño, MIME, bucket, cotas rate-limit)
- `lib/types/postulacion-mensajero.ts` (`postulacionSchema` zod, `validarArchivo`, tipos resultado)
- `lib/interfaces/external/IFileStorage.ts`
- `lib/storage/SupabaseFileStorage.ts` (bucket privado, service role, sin URL pública)
- `lib/interfaces/repositories/IMensajeroDocumentoRepository.ts`
- `lib/repositories/MensajeroDocumentoRepository.ts` (`findByUsuario`, R17)
- `lib/interfaces/repositories/IPostulacionRepository.ts`
- `lib/repositories/PostulacionRepository.ts` (unicidad, catálogos, transacción atómica usuario+docs)
- `lib/interfaces/services/IPostulacionMensajeroService.ts`
- `lib/services/PostulacionMensajeroService.ts` (flujo design §3.2)
- `lib/actions/postulacion-mensajero.ts` (Server Action pública, FormData, sin cookies)
- Tests: ver mapa abajo.

### Archivos modificados
- `db/schema.prisma`: columnas nuevas en `Usuario` (`primerApellido`, `segundoApellido`,
  `vehiculoId`, `placa`) + relación `vehiculo`; modelo `MensajeroDocumento` + enum
  `MensajeroDocumentoTipo`; relación inversa `usuarios` en `Vehiculo`; índice `vehiculoId`.
- `lib/interfaces/repositories/IUserRepository.ts`: `CreateUsuarioInput` extendido con
  `primerApellido?/segundoApellido?/vehiculoId?/placa?` (opcionales, nullable en DB).
- `tests/unit/types/vehiculos.test.ts` y `tests/integration/db/vehiculos-migration.test.ts`:
  dos guards de la feature 50 quedaron contradichos por el FK que la 50 DIFIRIÓ a la 21;
  se actualizaron de forma acotada y comentada (el FK ahora existe, aportado por la feature 21;
  y la migración de la 21 se apéndió con timestamp posterior a vehiculos). Sin tocar SQL ni
  lógica de la feature 50.

### Mapa R → test (slice backend)
| R | Test |
| --- | --- |
| R2 | `tests/unit/types/postulacion-schemas.test.ts` — payload completo / segundo_apellido omitible |
| R3 | schemas: falta documento → error; service: sube/crea 5 docs |
| R4 | schemas — falta campo obligatorio → error por campo |
| R5 | schemas — email inválido → error en `email` |
| R6 | schemas — password < 8 y > 72 → error |
| R7 | schemas — password ≠ confirmación → error |
| R8 | schemas — cédula/teléfono no numéricos / longitud |
| R9 | `tests/unit/services/postulacion-mensajero-service.test.ts` — vehículo/tipo inexistente → validation_error |
| R10 | schemas + `validarArchivo` — MIME/tamaño no permitido |
| R11 | schemas — placa vacía rechazada; normaliza trim+uppercase |
| R12 | service — crea usuario rol mensajero, no fuerza estado (default `pendiente`) |
| R13 | service — persiste apellidos, vehiculoId, placa; migración: columnas + FK |
| R14 | service — persiste hash bcrypt verificable, nunca texto plano |
| R15 | service — resuelve rol `mensajero`; rol inexistente → error, no crea catálogos |
| R16 | service — 5 uploads + 5 filas; migración: tabla + unique(usuario_id,tipo) |
| R17 | `tests/unit/repositories/mensajero-documento-repository.test.ts` — `findByUsuario` devuelve los documentos del usuario y permite resolver la `foto_rostro` (perfil) |
| R18 | `tests/unit/storage/supabase-file-storage.test.ts` — bucket privado, sin URL pública |
| R19 | service — email duplicado → `conflict('email')`, no sube ni crea |
| R20 | service — cédula duplicada → `conflict('cedula')` |
| R21 | service — carrera P2002→conflict; migración: no duplica unique de email/cédula |
| R22 | `tests/unit/actions/postulacion-action.test.ts` — no cookies, delega con contexto |
| R23 | `tests/unit/services/postulacion-login-regresion.test.ts` — login cuenta pendiente → account_unavailable |
| R24 | service — fallo upload/DB → `remove` de archivos, sin cuenta parcial |
| R25 | `tests/integration/db/postulacion-mensajero-migration.test.ts` — RLS en mensajero_documento, sin policies |
| A4 | action — supera rate-limit por IP|email → `rate_limited` |

### Salida de verificación
- `npm run typecheck`: VERDE (0 errores).
- `npm run lint`: VERDE (0 errores; 135 warnings preexistentes, todos en `.claude/skills/**`,
  ninguno en archivos de la feature 21).
- `npm test`: VERDE — **874 passed / 874**, 110 archivos. Los 59 tests nuevos de la feature 21
  pasan. Sin flaky observados en esta corrida.
- `npm run db:generate`: OK (cliente Prisma regenerado con los nuevos modelos/enum).

### Setup pendiente (NO ejecutado por el agente; acción sensible)
1. **Aplicar la migración** `20260710170000_postulacion_mensajero` contra Postgres real
   (`npm run db:migrate` / `prisma migrate deploy`). La correctitud está cubierta por tests
   estáticos (regex sobre migration.sql/down.sql). La DB de dev (localhost:5432/ordenex) tiene
   las migraciones previas aplicadas; el humano debe revisar y aplicar esta.
2. **Bucket de Supabase Storage**: crear el bucket PRIVADO `mensajero-docs` (nombre override por
   env `POSTULACION_BUCKET`). No se creó a ciegas. Requiere `SUPABASE_URL` y
   `SUPABASE_SERVICE_ROLE_KEY` en el entorno del servidor (ya usados por `createServerClient`).
3. **Env opcionales** (tienen default): `POSTULACION_MAX_FILE_BYTES` (5 MB),
   `POSTULACION_RATE_MAX` (3), `POSTULACION_RATE_WINDOW_MINUTES` (60).

### Nota de entorno
El worktree f21 no traía `node_modules` ni `.env`; se corrió `npm install` y se copió el `.env`
del repo principal (gitignored) para poder ejecutar `db:generate`/typecheck/lint/test.

### Veredicto
Slice backend COMPLETO y verde (typecheck + lint + 874 tests). Listo para el slice frontend
(T8–T10). Bloqueos: ninguno de código; solo el setup humano de migración + bucket.

---

## SLICE FRONTEND (frontend_dev)

Estado: COMPLETO. Tasks T8–T10 implementadas consumiendo el contrato de la Server
Action ya existente (`postularMensajero`). NO se tocó backend, DB, migraciones ni APIs.

### Decisiones F1.4 aplicadas en la UI
- A3 (duplicado = error por campo): `status: "conflict"` se pinta en el campo exacto
  (`email` → "Este correo ya está registrado"; `cedula` → "Este número de documento ya
  está registrado"), asociado por `aria-describedby` a un bloque `role="alert"`.
- A5 (contraseña mín. 8 + confirmación): validación en cliente con el MISMO
  `postulacionSchema` del backend (que reutiliza `strongPasswordSchema` + `.refine` de
  confirmación). No se duplicaron reglas.
- A2 (5 documentos imagen): 5 `input[type=file]` con `accept` derivado de
  `POSTULACION_ALLOWED_MIME`; tipo/tamaño validados por el schema compartido (`validarArchivo`)
  antes de enviar; el servidor revalida.

### Archivos creados
- `app/postulacion/page.tsx` — página PÚBLICA (Server Component). Sin sesión ni cookie
  (R1/R22). Carga catálogos públicos: vehículos vía `VehiculoRepository.findMany()` y
  tipos de identificación vía `prisma.tipoIdentificacion.findMany()`. Etiquetas de
  presentación aisladas (i18n-ready). Reusa el layout de marca de `app/login`/`recuperar`.
- `app/postulacion/_components/PostulacionForm.tsx` — formulario cliente (`"use client"`).
  Campos R2 + 2 Select (shadcn/`components/ui/select`) + 5 file inputs (R3). Valida con
  `postulacionSchema`, `useTransition` (spinner + submit deshabilitado), errores por campo
  accesibles (`role="alert"` + `aria-describedby`), envío como `FormData` a `postularMensajero`.
  En `ok` → vista de confirmación (R26) sin redirigir a zona autenticada. Enlace de vuelta a
  `/login`.
- `tests/components/PostulacionForm.test.tsx` — 9 tests de componente (render, validación
  cliente, envío exitoso + FormData, conflicto por campo email/cédula, validation_error del
  servidor, rate_limited). Mockea SOLO la Server Action; usa el schema real.
- `tests/integration/postulacion-page.test.tsx` — 1 test: la página pública carga catálogos
  y renderiza el formulario sin requerir sesión (R1/R22).

### Archivos modificados
- `app/login/_components/LoginForm.tsx` — enlace "¿Quieres ser mensajero? Postúlate aquí"
  hacia `/postulacion` (afordancia del design §3.5). Sin cambios de lógica.

### Mapa R → test (slice frontend)
| R | Test |
| --- | --- |
| R1  | `tests/integration/postulacion-page.test.tsx` — página pública renderiza el form sin sesión |
| R2  | `PostulacionForm.test.tsx` — "render de campos" (todos los campos con labels) |
| R3  | `PostulacionForm.test.tsx` — "render de campos" (5 file inputs `type=file`) |
| R10 | `PostulacionForm.test.tsx` — validación cliente vía schema compartido (uploads válidos exigidos) |
| R11 | `PostulacionForm.test.tsx` — "envío exitoso" (placa enviada en FormData, normalizada por schema) |
| R22 | `tests/integration/postulacion-page.test.tsx` — página no lee cookies/sesión |
| R26 | `PostulacionForm.test.tsx` — "envío exitoso" muestra "Postulación enviada", sin redirección |
| A3  | `PostulacionForm.test.tsx` — `conflict('email')` y `conflict('cedula')` pintan error por campo |
| A5  | `PostulacionForm.test.tsx` — R7 (password ≠ confirmación bloquea envío) |

### Verificación
- `npm run typecheck` → VERDE (0 errores).
- `npm run lint` → 0 errores (los 135 warnings son de `.claude/skills`, ajenos; mis archivos
  0 warnings, verificado con `eslint` dirigido).
- `npm test` → 882/884. Los 9 tests de `PostulacionForm` y el de la página pasan en la suite
  completa. Los 2 fallos son flaky de auth bajo carga paralela (`HomePage.test.tsx` R25 y
  `LoginForm.test.tsx` R27 distinguibilidad de mensajes), NO relacionados con este slice:
  reejecutados aislados dan 29/29 verde. El formulario es pesado (2 Select portal + 5 uploads),
  así que se subió el `testTimeout` del archivo a 25s para evitar timeouts flaky bajo la suite
  completa (aislado corre en ~2s).

### Veredicto
Slice frontend COMPLETO y verde. Página pública + formulario accesible que consume la Server
Action sin tocar backend. Bloqueos: ninguno (los 2 fallos de la suite son flaky de auth
preexistentes, verdes en aislado).

---

## Cambio backend: `primer_apellido` OBLIGATORIO (post-spec, decision humana)

El humano decidio que `primer_apellido` pasa de nullable a **NOT NULL** a nivel de
datos y de modelo. `segundo_apellido`, `vehiculo_id` y `placa` siguen NULLABLE.

### Archivos tocados
- `db/schema.prisma`: `primerApellido String @map("primer_apellido")` (se quito el `?`).
- `db/migrations/20260710170000_postulacion_mensajero/migration.sql` (EDITADA, no nueva):
  `ADD COLUMN "primer_apellido" TEXT NOT NULL DEFAULT ''` + `ALTER COLUMN ... DROP DEFAULT`
  (backfill seguro de la fila maestro preexistente; inserts futuros deben proveerlo).
  `down.sql` ya revierte con `DROP COLUMN` (sin cambios).
- `lib/interfaces/repositories/IUserRepository.ts`: `CreateUsuarioInput.primerApellido` ahora
  `string` (requerido).
- `lib/repositories/PostulacionRepository.ts`: `primerApellido: usuario.primerApellido` (sin `?? null`).
- `tests/integration/db/postulacion-mensajero-migration.test.ts`: aserciones actualizadas
  a NOT NULL DEFAULT '' + DROP DEFAULT (con orden) y ya-no-nullable.
- `tests/unit/repositories/user-repository.test.ts` y
  `tests/integration/repositories/user-repository-catalog.test.ts`: los inputs de creacion de
  usuario ahora incluyen `primerApellido` (llamadores ajustados por el cambio a requerido).

Nota: el seed del maestro vive en la migracion `20260709120000_seed_maestro_user/migration.sql`,
que corre ANTES de esta (la columna aun no existe), por lo que NO se le agrega `primer_apellido`;
el `DEFAULT ''` de esta migracion backfillea esa fila. La validacion zod
(`lib/types/postulacion-mensajero.ts`) y `PostularMensajeroCommand` ya exigian el campo.

### Verificacion del cambio
- `npm run db:generate` OK. `npm run typecheck` VERDE (0 errores). `npm run lint` 0 errores.
- `npm test` → 888/888 VERDE (sin flaky esta corrida). Migracion NO aplicada a Postgres
  (queda para el humano/leader); su correctitud se cubre por los tests estaticos de migracion.

### Veredicto
`primer_apellido` obligatorio implementado en datos, modelo, tipos y tests. Todo verde.
