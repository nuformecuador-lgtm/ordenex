# Feature 21 — Postulación de mensajero · design.md

Decisiones técnicas para satisfacer `requirements.md`. Respeta el patrón de capas
(Controller/Server Action → Service → Repository) y las convenciones del repo.

## 1. Modelo de datos

### 1.1 Extensión de `usuario` (columnas nuevas, todas NULLABLE)

Se agregan columnas a `usuario` en vez de crear un `mensajero_perfil` 1:1, porque
`primer_apellido`/`segundo_apellido` son atributos de identidad de cualquier
usuario y el propio enunciado fija el FK en `usuario.vehiculo_id -> vehiculos.id`.

| Columna | Tipo | Null | Notas |
| --- | --- | --- | --- |
| `primer_apellido` | TEXT | SÍ | Requerido a nivel servicio para postulación (R13) |
| `segundo_apellido` | TEXT | SÍ | Opcional también en la postulación (R2) |
| `vehiculo_id` | TEXT (uuid) | SÍ | FK → `vehiculos(id)` `ON DELETE RESTRICT` |
| `placa` | TEXT | SÍ | Normalizada uppercase/trim (R11) |

- **`nombre` se conserva** como "nombres / primer nombre". El login usa `email`,
  no `nombre`, así que agregar apellidos NO impacta la autenticación. `nombre`
  sigue NOT NULL y NO es único (confirmado en schema).
- Las columnas son **nullable en la DB** para no romper filas existentes (usuario
  maestro sembrado, usuarios de otros roles). La obligatoriedad para mensajeros se
  impone en el `PostulacionMensajeroService` + zod, no en la DB (que debe seguir
  aceptando usuarios no-mensajero sin vehículo).
- Índice `usuario_vehiculo_id_idx` sobre `vehiculo_id`.

### 1.2 Tabla nueva `mensajero_documento`

Normaliza los 5 documentos (extensible, evita 5 columnas nullable en `usuario`).

```
mensajero_documento
  id             TEXT PK (uuid)
  usuario_id     TEXT NOT NULL  FK -> usuario(id) ON DELETE CASCADE
  tipo           mensajero_documento_tipo NOT NULL   -- enum Postgres
  storage_path   TEXT NOT NULL   -- path en el bucket privado, no URL pública
  content_type   TEXT NOT NULL   -- image/jpeg | image/png | image/webp
  created_at     TIMESTAMP(3) NOT NULL DEFAULT now()
  @@unique([usuario_id, tipo])   -- un doc por tipo por usuario (R16)
  @@index([usuario_id])
```

Enum Postgres `mensajero_documento_tipo`:
`cedula_anverso | cedula_reverso | propiedad_anverso | propiedad_reverso | foto_rostro`.

- **RLS** activado sin políticas anon/authenticated (solo service role), igual que
  `cobro`/`usuario` (R25).
- `foto_rostro` (R17): el perfil obtiene la imagen consultando la fila
  `tipo = foto_rostro` de este usuario y generando URL firmada.

### 1.3 Migración (up/down obligatorio)

`db/migrations/<ts>_postulacion_mensajero/`:
- `migration.sql` (UP):
  - `CREATE TYPE "mensajero_documento_tipo" AS ENUM (...)`.
  - `ALTER TABLE "usuario" ADD COLUMN "primer_apellido" TEXT, ADD COLUMN "segundo_apellido" TEXT, ADD COLUMN "vehiculo_id" TEXT, ADD COLUMN "placa" TEXT;`
  - FK `usuario_vehiculo_id_fkey` → `vehiculos(id)` RESTRICT; índice.
  - `CREATE TABLE "mensajero_documento" (...)`, unique, índice, FK CASCADE.
  - `ALTER TABLE "mensajero_documento" ENABLE ROW LEVEL SECURITY;`
- `down.sql` (DOWN): `DROP TABLE IF EXISTS "mensajero_documento";`
  `DROP TYPE IF EXISTS "mensajero_documento_tipo";`
  `ALTER TABLE "usuario" DROP CONSTRAINT IF EXISTS "usuario_vehiculo_id_fkey";`
  `DROP INDEX IF EXISTS "usuario_vehiculo_id_idx";`
  `ALTER TABLE "usuario" DROP COLUMN IF EXISTS "placa", ..., DROP COLUMN "primer_apellido";`
  (Revierte exactamente, sin tocar `vehiculos` ni otras tablas.)

> Precondición A1: la tabla `vehiculos` (feature 50) debe existir en `dev`. Ver
> Preguntas abiertas de `requirements.md`.

## 2. Almacenamiento de archivos — Supabase Storage (bucket privado)

No existe infra de subida previa. Decisión: **Supabase Storage**, coherente con el
stack (ya hay `createServerClient` con service role en `lib/supabase/client.ts`).

- Bucket privado `mensajero-docs` (creado por seed/script, no público).
- Path: `{usuario_id}/{tipo}.{ext}` (no adivinable + único por R16). No se expone
  URL pública (R18); la lectura futura (feature 22) usa URL firmada.
- Subida desde el servidor con service role (nunca desde el cliente con anon key).
- Contrato de storage detrás de interfaz `IFileStorage` (`upload`, `remove`) para
  poder mockear en tests sin red.
- Límites configurables por env (`POSTULACION_MAX_FILE_BYTES`, tipos permitidos).

### Alternativa descartada (obligatoria)

**Guardar los archivos como `bytea`/base64 en Postgres** (columnas o tabla de
blobs). Descartada porque: (a) infla la base y los backups con binarios de imagen,
(b) degrada el rendimiento de queries sobre `usuario`, (c) no aprovecha CDN ni URLs
firmadas, (d) complica el límite de tamaño de payload de Server Actions. Supabase
Storage separa el binario de los metadatos relacionales, que es el patrón esperado
del stack.

## 3. Rutas, capas y contratos

### 3.1 Server Action pública (Controller)

`lib/actions/postulacion-mensajero.ts` (`'use server'`):
- `postularMensajero(formData: FormData, deps?)`. Recibe **FormData** (campos de
  texto + 5 `File`), porque las Server Actions soportan archivos nativamente y
  evita crear una Route API solo para mutar (architecture.md).
- NO lee cookies ni resuelve actor (acción pública, R22). No setea cookie de
  sesión (contraste con `login`).
- Extrae campos, arma objeto, valida con zod, delega en el service, traduce el
  resultado a `ActionResult` con el patrón `withErrorHandler` + `toActionError`.

Resultado tipado:
```
type PostularMensajeroResult =
  | { status: "ok" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "conflict"; field: "email" | "cedula" }
  | { status: "error" }
```

### 3.2 Service (lógica de negocio)

`lib/services/PostulacionMensajeroService.ts` implementa
`IPostulacionMensajeroService` (`lib/interfaces/services/`). Recibe por constructor:
`IUserRepository`, `IMensajeroDocumentoRepository`, `IFileStorage`, y un resolvedor
de catálogos (rol/vehículo/tipo). Sin HTTP ni Prisma directo.

Flujo de `postular(input, archivos)`:
1. Resolver `rolId` de `mensajero` (R15). Validar existencia de `vehiculo_id` y
   `tipo_identificacion_id` (R9).
2. Chequeo previo de unicidad `email`/`cedula` (R19/R20) para dar error de campo
   limpio; el constraint DB (R21) es la garantía dura ante carreras.
3. `hashPassword(password)` (R14). La confirmación ya se validó en zod (R7).
4. Generar `usuarioId` (uuid) antes de subir. Subir los 5 archivos a
   `{usuarioId}/{tipo}` (R16). Recolectar paths.
5. En **una transacción Prisma**: crear `usuario` (estado default `pendiente`,
   R12/R13) + insertar 5 `mensajero_documento`.
6. **Atomicidad (R24):** si la transacción falla → borrar los objetos subidos
   (best-effort `IFileStorage.remove`). Si una subida falla → abortar antes de
   escribir en DB (no hay cuenta parcial). Mapear P2002 → `conflict`.

### 3.3 Repositories

- `UserRepository.create` (extender `CreateUsuarioInput`): agrega
  `primerApellido?`, `segundoApellido?`, `vehiculoId?`, `placa?`. Mantiene el mapeo
  P2002 → `UsuarioDuplicadoError('email'|'cedula')`.
- Añadir resolutor de rol por valor (p. ej. `findRolByValue('mensajero')`) y de
  vehículo/tipo por id (o reusar checks existentes de catálogo).
- `MensajeroDocumentoRepository` (`IMensajeroDocumentoRepository`): `createMany`
  dentro de la transacción; `findByUsuario`.

### 3.4 Tipos y validación

`lib/types/postulacion-mensajero.ts`: `postulacionSchema` (zod) con:
- reuse `numericIdentifierSchema` para `cedula`/`telefono` (R8),
- `email().` (R5), `password` `min/max(72)` (R6), `.refine` password ===
  confirmación (R7), `placa` no vacío + transform uppercase/trim (R11),
- `vehiculo_id`/`tipo_identificacion_id` uuid,
- validación de archivos (tipo MIME permitido + tamaño máx) reusable cliente y
  servidor (R10).

### 3.5 Frontend (slice frontend)

- Página pública `app/postulacion/page.tsx` (Server Component mínimo) + componente
  cliente `_components/PostulacionForm.tsx`, siguiendo estructura y estilo de
  `app/login/_components/LoginForm.tsx` (Card, Input, Label, Alert, `useTransition`,
  `noValidate`, errores accesibles `role="alert"`).
- 5 `input[type=file]` con `accept="image/*"` y validación de tipo/tamaño en
  cliente (R10) antes de enviar; el servidor revalida (borde tipado).
- Envío como `FormData` a la Server Action. En `ok` → vista de confirmación (R26),
  sin redirección a zona autenticada. En `conflict`/`validation_error` → error por
  campo. Enlace desde `app/login` a `/postulacion` (afordancia).

## 4. Seguridad

- Contraseña: bcrypt coste 10 reutilizando `hashPassword` (R14); nunca se loguea
  ni retorna. Confirmación validada en cliente y servidor (R7).
- Acción pública sin sesión ni cookie de salida (R22). Cuenta queda `pendiente`,
  el login existente rechaza no-`activo` (R23) — se cubre con test de regresión.
- Documentos en bucket privado, paths bajo `usuarioId`, sin URL pública (R18).
- Rate-limiting por IP/captcha: NO hay infra genérica reutilizable → punto ABIERTO
  A4 (no se inventa).

## 5. Trazabilidad R → test

| R | Test (tipo · ubicación aprox.) |
| --- | --- |
| R1 | Integración: GET `/postulacion` responde 200 sin sesión (`tests/integration`) |
| R2 | Unit zod: schema acepta payload completo; `segundo_apellido` omitible |
| R3 | Unit zod/service: exige los 5 tipos de documento |
| R4 | Unit zod: falta campo obligatorio → `validation_error` por campo |
| R5 | Unit zod: email inválido → error en `email` |
| R6 | Unit zod: password > 72 y < mínimo → error |
| R7 | Unit zod: password ≠ confirmación → error; service no crea |
| R8 | Unit zod: cedula/telefono no numéricos o longitud fuera de rango |
| R9 | Unit service: vehiculo_id/tipo inexistente → error catálogo, no crea |
| R10 | Unit zod/service: archivo no imagen o > máx → rechazo, no sube |
| R11 | Unit zod: `placa` vacía rechazada; normaliza uppercase/trim |
| R12 | Unit service: crea usuario rol mensajero, estado `pendiente` |
| R13 | Unit service: persiste apellidos, vehiculo_id, placa (mock repo) |
| R14 | Unit service: llama `hashPassword`; no persiste texto plano |
| R15 | Unit service: resuelve rol mensajero; no crea catálogos |
| R16 | Unit service: sube 5 archivos y crea 5 filas `mensajero_documento` |
| R17 | Unit/integración: perfil obtiene doc `foto_rostro` del usuario |
| R18 | Integración/policy: bucket privado; sin URL pública (assert config) |
| R19 | Unit service + integración: email duplicado → `conflict('email')`, sin cuenta |
| R20 | Unit service + integración: cedula duplicada → `conflict('cedula')` |
| R21 | Integración/migración: constraint único email/cedula viola con P2002 |
| R22 | Unit action: no setea cookie; no requiere actor |
| R23 | Integración regresión: login de cuenta `pendiente` → `account_unavailable` |
| R24 | Unit service: fallo en DB → `IFileStorage.remove` llamado; sin fila usuario |
| R25 | Integración/migración: RLS habilitado en `mensajero_documento` |
| R26 | Component test: tras `ok`, muestra confirmación, no redirige a dashboard |

## 6. Alternativas descartadas (resumen)

1. **Blobs en Postgres** para los documentos → descartada (§2).
2. **Tabla `mensajero_perfil` 1:1** separada para apellidos/vehículo/placa →
   descartada: el enunciado fija `usuario.vehiculo_id`; apellidos son identidad
   general; añadir una tabla 1:1 solo por 4 columnas es sobre-ingeniería. Los
   documentos SÍ van a tabla propia por ser 1:N conceptual y binario.
3. **Route Handler `app/api/postulacion`** en vez de Server Action → descartada:
   es una mutación interna desde componente propio; architecture.md manda Server
   Action y no fetch a API interna.
