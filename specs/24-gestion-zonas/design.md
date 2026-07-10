# Feature 24 — Gestión de zonas (configuración) · design.md

> El QUÉ está en `requirements.md`. Aquí el CÓMO técnico. Todo lo relativo al
> esquema se basa en `db/schema.prisma` REAL (leído, no inventado).

## 1. Estado actual REAL del esquema (fuente: `db/schema.prisma`)

Jerarquía de geografía (tablas creadas vacías, sin seed) — se MANTIENE:

- `zona` → `Zona { id String @id, nombre String }` (map `zona`). Relaciones:
  `provincias Provincia[]`, `ordenes Orden[]`.
- `provincia` → `Provincia { id, nombre, zonaId @map("zona_id") }`
  FK `zona_id -> zona.id`; `@@index([zonaId])`.
- `canton` → `Canton { id, nombre, provinciaId @map("provincia_id") }`
  FK `provincia_id -> provincia.id`; `@@index([provinciaId])`.
- `distrito` → `Distrito { id, nombre, cantonId @map("canton_id") }`
  FK `canton_id -> canton.id`; `@@index([cantonId])`.
- `usuario` → `Usuario` (map `usuario`). Hoy SIN `zona_id`. Rol vía
  `rolId @map("rol_id")` → `rol.value` (enum `RolValue`:
  `maestro | admin | mensajero | adminTienda | adminSatelite`).
- `orden` → `Orden` YA tiene `zonaId @map("zona_id")` NOT NULL con FK a `zona`.
  **No se toca.**
- `cobro` → referencia de tipos: montos `Decimal @db.Decimal(12,2)`, soft delete
  `deleted_at`. Es el modelo análogo para `pago_entrega`/`pago_rechazo`.

## 2. Cambios de modelo de datos

### 2.1 Migración Prisma `db/migrations/<ts>_zonas_pagos_usuario_zona/`

`migration.sql` (up):

- `ALTER TABLE "zona" ADD COLUMN "pago_entrega" DECIMAL(12,2) NOT NULL DEFAULT 0;`
- `ALTER TABLE "zona" ADD COLUMN "pago_rechazo" DECIMAL(12,2) NOT NULL DEFAULT 0;`
- `ALTER TABLE "zona" ADD COLUMN "es_gam" BOOLEAN NOT NULL DEFAULT false;`
- Unicidad de nombre (D4): `CREATE UNIQUE INDEX "zona_nombre_key" ON "zona"("nombre");`
- Un solo GAM (D5): índice único parcial
  `CREATE UNIQUE INDEX "zona_es_gam_unico" ON "zona"("es_gam") WHERE "es_gam" = true;`
- `ALTER TABLE "usuario" ADD COLUMN "zona_id" TEXT;` (NULLABLE, R2)
- `CREATE INDEX "usuario_zona_id_idx" ON "usuario"("zona_id");`
- `ALTER TABLE "usuario" ADD CONSTRAINT "usuario_zona_id_fkey" FOREIGN KEY ("zona_id")
   REFERENCES "zona"("id") ON DELETE RESTRICT ON UPDATE CASCADE;` (R5/R6)
- RLS (R4): `ALTER TABLE "zona"/"provincia"/"canton"/"distrito" ENABLE ROW LEVEL
  SECURITY;` sin policies anon/authenticated (patrón `mensajero_documento`,
  `vehiculos`). La FK `orden.zona_id` ya tiene `ON DELETE RESTRICT` implícito por
  ser NOT NULL → refuerza R6.

`down.sql` (revierte exacto, orden inverso; patrón `20260710170000_postulacion_mensajero/down.sql`):

- `ALTER TABLE "usuario" DROP CONSTRAINT IF EXISTS "usuario_zona_id_fkey";`
- `DROP INDEX IF EXISTS "usuario_zona_id_idx";`
- `ALTER TABLE "usuario" DROP COLUMN IF EXISTS "zona_id";`
- `DROP INDEX IF EXISTS "zona_es_gam_unico";`
- `DROP INDEX IF EXISTS "zona_nombre_key";`
- `ALTER TABLE "zona" DROP COLUMN IF EXISTS "es_gam";`
- `ALTER TABLE "zona" DROP COLUMN IF EXISTS "pago_rechazo";`
- `ALTER TABLE "zona" DROP COLUMN IF EXISTS "pago_entrega";`
- NO deshabilitar RLS de geografía si estaba habilitado por otra migración; si esta
  migración lo habilitó, el down lo revierte (`DISABLE ROW LEVEL SECURITY`).
  (El implementer verifica si la geografía ya tenía RLS previo antes de decidir.)

### 2.2 `db/schema.prisma` (reflejo del cambio)

```
model Zona {
  id          String  @id @default(uuid())
  nombre      String  @unique                 // D4
  pagoEntrega Decimal @default(0) @db.Decimal(12,2) @map("pago_entrega")
  pagoRechazo Decimal @default(0) @db.Decimal(12,2) @map("pago_rechazo")
  esGam       Boolean @default(false) @map("es_gam")
  provincias  Provincia[]
  ordenes     Orden[]
  usuarios    Usuario[]                        // nueva relación inversa
  @@map("zona")
}
// Usuario: + zonaId String? @map("zona_id"); zona Zona? @relation(...); @@index([zonaId])
```

## 3. Backend (patrón feature 25/18: action → service → repository, errores feature 10)

Capas nuevas (nombres siguiendo el repo):

- `lib/types/zona.ts` — schemas Zod + DTO + tipos de resultado discriminados por
  `status`. `montoSchema = z.number().nonnegative()` (igual que `cobro.ts`).
  `crearZonaSchema.strict()`: `{ nombre, pagoEntrega, pagoRechazo, esGam,
  provincia: { nombre, canton: { nombre, distritos: string[] (>=1) } } }`.
  `actualizarZonaSchema = crearZonaSchema.partial().strict()`.
  `listarZonasSchema` con page/pageSize (clamp a MAX, patrón `cobro.ts`).
  `ZonaDTO`: montos `Decimal -> number`.
- `lib/config/zonas.ts` — `DEFAULT_PAGE_SIZE`, `MAX_PAGE_SIZE`.
- `lib/interfaces/repositories/IZonaRepository.ts` — `create`, `findById`,
  `findByNombre`, `list({skip,take})`, `update`, `setGam`, `listLight()`.
- `lib/interfaces/services/IZonaService.ts` — `Actor`, resultados
  `CrearZonaServiceResult` etc. discriminados.
- `lib/repositories/ZonaRepository.ts` — Prisma; el `create`/`update` usa
  `prisma.$transaction` para crear zona + provincia + canton + distritos
  atómicamente (R9/R10).
- `lib/services/ZonaService.ts` — `WRITE_ROLES = new Set(["maestro"])` (D2),
  `READ_ROLES = new Set(["maestro","admin"])`. Reglas: unicidad de nombre (R12),
  invariante `es_gam` único (R14), validación de geografía mínima (R11).
- `lib/actions/zonas.ts` (`"use server"`) — `crearZona`, `obtenerZona`,
  `listarZonas`, `actualizarZona`, `marcarZonaGam`, `listarZonasLight`. Cada una
  envuelve con `withErrorHandler`, resuelve actor (`resolveActorFromSession`),
  lanza `UnauthenticatedError` antes del service, `parse` con Zod →
  `VALIDATION_ERROR`, y mapea `AppErrorShape` con `toActionError`
  (adaptador compartido). Contrato de salida discriminado por `status` (R16/R17).

Extensión de usuarios (R19/R20): el servicio de usuarios (feature 25) acepta
`zonaId` opcional y valida su existencia contra `IZonaRepository.findById`. Se
documenta como punto de integración; el cambio concreto en `UsuarioService` es una
task con dependencia.

### 3.1 Contratos I/O (resumen)

- `crearZona(input) -> { status:"ok", zona: ZonaDTO } | { status:"validation_error",
  fieldErrors } | "unauthenticated" | "forbidden" | { status:"conflict" }`.
- `listarZonas(input) -> { status:"ok", items: ZonaDTO[], page, pageSize, total } | ...`.
- `listarZonasLight() -> { status:"ok", items: {id,nombre,esGam}[] } | ...` (R18).
- `marcarZonaGam(id) -> { status:"ok" } | "not_found" | "conflict" | ...`.

## 4. Frontend (patrón `app/(app)/configuracion` feature 25)

- `app/(app)/configuracion/page.tsx` — hoy renderiza solo `UsuariosModule`. Se
  añade una organización por pestañas/secciones para incluir el módulo de zonas
  (autorización server-side: solo `maestro`, R21). Precarga `listarZonas` en server.
- `app/(app)/configuracion/_components/ZonasModule.tsx` — client component:
  DataTable + Pagination (R22), botón crear, Modal de formulario, Toast (R24).
- `.../_components/ZonaForm.tsx` — nombre, provincia (input), cantón (input),
  distritos (lista dinámica, >=1), `pagoEntrega`, `pagoRechazo`, checkbox `esGam`.
  Muestra `fieldErrors` (R25).
- `.../_components/zonas-columns.tsx` — columnas: nombre, provincia/cantón,
  nº distritos, pago entrega, pago rechazo, badge GAM.

## 5. Seed (gate de impl)

- `scripts/seed-zonas.ts` — patrón `scripts/seed-catalogos.ts` (idempotente,
  `getPrismaClient`, `process.loadEnvFile()`, `isEntrypoint`). Lee el XLSX con
  `exceljs` (ya presente; ver `lib/parsers/spreadsheet.ts`), agrupa filas por
  `zona`, y hace upsert por `nombre` (R28) creando geografía hija en transacción.
- **GATE**: sin el Excel del humano (formato en `requirements.md` pregunta 7) la
  task de ejecución del seed no se realiza (R27). Se puede desarrollar y testear el
  parser con un fixture XLSX sintético mientras tanto.

## 6. Alternativa descartada

**Alternativa A — Remodelar la geografía a una sola tabla `zona` autoreferenciada
(árbol `parent_id`) o colapsar provincia/cantón en columnas de `zona`.**
Descartada porque: (1) contradice la decisión humana del 2026-07-10 de MANTENER la
jerarquía `Zona → Provincia → Cantón → Distrito`; (2) `orden` ya tiene FKs
`zona_id`, `provincia_id`, `canton_id`, `distrito_id` NOT NULL/nullable apuntando a
las cuatro tablas reales — colapsarlas exigiría migrar datos y reescribir features
6/15/18 ya entregadas; (3) mayor riesgo y área de cambio sin beneficio funcional
para esta feature. Se conserva el modelo actual y solo se le añaden columnas.

**Alternativa B (menor) — catálogo maestro precargado de Ecuador para elegir
provincia/cantón/distrito.** Descartada por ahora: el alcance dice que las tablas
se pueblan como hijos de la zona; un catálogo nacional es más dato del que el humano
pidió. Queda como pregunta abierta 3 por si se prefiere.

## 7. Trazabilidad R→test (propuesta)

| R | Test propuesto (archivo · caso) |
|---|---|
| R1 | `db/migrations` smoke: aplica migración y `pago_entrega/pago_rechazo/es_gam` existen en `zona`. |
| R2 | migración: `usuario.zona_id` existe, nullable, con FK e índice. |
| R3 | `down.sql`: tras down, columnas/FK/índices revertidos; `orden.zona_id` intacto. |
| R4 | RLS habilitado en zona/provincia/canton/distrito (query `pg_class.relrowsecurity`). |
| R5 | Repo/DB: insertar usuario con `zona_id` inexistente falla; con null pasa. |
| R6 | DB: borrar zona con orden/usuario asociado → error RESTRICT. |
| R7 | `zonas.actions.test`: sin sesión → `unauthenticated`, service no invocado. |
| R8 | `ZonaService.test`: rol no-write → `forbidden`. |
| R9 | `ZonaService/Repository.test`: crear zona persiste provincia+canton+distritos enlazados. |
| R10 | `ZonaRepository.test`: fallo en hija → rollback, 0 filas. |
| R11 | `zona.schema.test`: nombre vacío / monto negativo / sin distritos → `validation_error`. |
| R12 | `ZonaService.test`: nombre duplicado → `conflict`. |
| R13 | `ZonaService.test`: editar nombre/pagos/geografía → `ok`; inexistente → `not_found`. |
| R14 | `ZonaService.test`: marcar segunda zona GAM desmarca/rechaza según D5. |
| R15 | `ZonaService.test`: listar paginado devuelve items+total+resumen geografía. |
| R16 | `zonas.actions.test`: cada rama de `status` sin excepción fuera del contrato. |
| R17 | `zona.dto.test`: DTO expone montos como number, sin campos internos. |
| R18 | `zonas.actions.test`: `listarZonasLight` devuelve {id,nombre,esGam}. |
| R19 | `UsuarioService.test`: mensajero/adminSatelite acepta `zonaId`; otros roles null. |
| R20 | `UsuarioService.test`: `zonaId` inexistente → `validation_error`. |
| R21 | `ConfiguracionPage.test`: rol no-maestro no ve módulo zonas. |
| R22 | `ZonasModule.test`: renderiza DataTable + Pagination con datos precargados. |
| R23 | `ZonaForm.test`: modal captura todos los campos (nombre, geografía, pagos, GAM). |
| R24 | `ZonasModule.test`: éxito → Toast ok + refresco; error → Toast error. |
| R25 | `ZonaForm.test`: `fieldErrors` se muestran junto a campos, sin perder valores. |
| R26 | `seed-zonas.test`: fixture XLSX → zonas+geografía creadas. |
| R27 | Documental/gate: task de ejecución bloqueada sin Excel real (no test automatizado). |
| R28 | `seed-zonas.test`: correr dos veces → sin duplicados, mismo id. |
