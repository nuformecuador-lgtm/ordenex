# Feature 24 — Gestión de zonas (configuración) · design.md

> El QUÉ está en `requirements.md`. Aquí el CÓMO técnico. Todo lo relativo al
> esquema se basa en `db/schema.prisma` REAL (leído, no inventado).
>
> **REESCRITO 2026-07-10** para el modelo correcto: catálogo geográfico GLOBAL y
> asignación de zona a nivel de distrito (`distrito.zona_id`). Se elimina
> `provincia.zona_id`.

## 1. Estado actual REAL del esquema (fuente: `db/schema.prisma`)

Geografía (tablas creadas vacías por la feature 6, sin seed) — se **remodela**:

- `zona` → `Zona { id, nombre }` (map `zona`). Relaciones actuales:
  `provincias Provincia[]`, `ordenes Orden[]`.
- `provincia` → `Provincia { id, nombre, zonaId @map("zona_id") }`
  FK `provincia_zona_id_fkey -> zona.id`; índice `provincia_zona_id_idx`. **Se
  ELIMINA `zona_id`** (con su FK e índice).
- `canton` → `Canton { id, nombre, provinciaId }` FK `canton_provincia_id_fkey`.
  **Se mantiene.**
- `distrito` → `Distrito { id, nombre, cantonId }` FK `distrito_canton_id_fkey`.
  **Se le AÑADE `zona_id` (nullable)**.
- `usuario` → `Usuario` (map `usuario`). Hoy SIN `zona_id`. Rol vía `rolId` →
  `rol.value` (enum `RolValue`: `maestro | admin | mensajero | adminTienda |
  adminSatelite`). Ya tiene `fulfillment` (feature 27).
- `orden` → `Orden` YA tiene `zonaId`, `provinciaId`, `cantonId` NOT NULL y
  `distritoId` nullable, con FKs propias directas a las cuatro tablas.
  **NO se toca** (R10). Eliminar `provincia.zona_id` no afecta a `orden` porque
  `orden` no depende de esa columna.
- `cobro` → referencia de tipos: montos `Decimal @db.Decimal(12,2)`. Es el modelo
  análogo para `pago_entrega`/`pago_rechazo`.

## 2. Cambios de modelo de datos

### 2.1 Migración Prisma `db/migrations/<ts>_zonas_catalogo_global_pagos/`

`migration.sql` (up):

```sql
-- zona: pagos + flag GAM
ALTER TABLE "zona" ADD COLUMN "pago_entrega" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "zona" ADD COLUMN "pago_rechazo" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "zona" ADD COLUMN "es_gam" BOOLEAN NOT NULL DEFAULT false;

-- nombre unico (R2). La normalizacion de comparacion se aplica en el service/seed
-- antes de escribir; el indice unico garantiza la invariante a nivel DB.
CREATE UNIQUE INDEX "zona_nombre_key" ON "zona"("nombre");

-- un solo es_gam=true (R3): indice unico parcial
CREATE UNIQUE INDEX "zona_es_gam_unico" ON "zona"("es_gam") WHERE "es_gam" = true;

-- provincia: se ELIMINA zona_id (R4). La zona deja de ser padre de la geografia.
ALTER TABLE "provincia" DROP CONSTRAINT IF EXISTS "provincia_zona_id_fkey";
DROP INDEX IF EXISTS "provincia_zona_id_idx";
ALTER TABLE "provincia" DROP COLUMN IF EXISTS "zona_id";

-- distrito: zona_id nullable (R5) + FK RESTRICT + indice
ALTER TABLE "distrito" ADD COLUMN "zona_id" TEXT;
CREATE INDEX "distrito_zona_id_idx" ON "distrito"("zona_id");
ALTER TABLE "distrito" ADD CONSTRAINT "distrito_zona_id_fkey"
  FOREIGN KEY ("zona_id") REFERENCES "zona"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- usuario: zona_id nullable (R6) + FK RESTRICT + indice
ALTER TABLE "usuario" ADD COLUMN "zona_id" TEXT;
CREATE INDEX "usuario_zona_id_idx" ON "usuario"("zona_id");
ALTER TABLE "usuario" ADD CONSTRAINT "usuario_zona_id_fkey"
  FOREIGN KEY ("zona_id") REFERENCES "zona"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
```

RLS (R12): `zona`, `provincia`, `canton`, `distrito` ya tienen RLS habilitado por
la migración `20260709130000_ordenes_catalogos_geografia` (verificado). Esta
migración NO vuelve a habilitarlo ni lo deshabilita; se documenta que permanece
activo. Si el implementer confirma que alguna quedó sin RLS, la añade aquí y el
`down.sql` la revierte.

`down.sql` (revierte exacto, orden inverso; patrón
`20260710180000_usuario_fulfillment/down.sql`), **sin tocar `orden`** (R10/R11):

```sql
ALTER TABLE "usuario" DROP CONSTRAINT IF EXISTS "usuario_zona_id_fkey";
DROP INDEX IF EXISTS "usuario_zona_id_idx";
ALTER TABLE "usuario" DROP COLUMN IF EXISTS "zona_id";

ALTER TABLE "distrito" DROP CONSTRAINT IF EXISTS "distrito_zona_id_fkey";
DROP INDEX IF EXISTS "distrito_zona_id_idx";
ALTER TABLE "distrito" DROP COLUMN IF EXISTS "zona_id";

-- restaura provincia.zona_id exactamente como estaba (NOT NULL + FK RESTRICT +
-- indice). Como las tablas estan vacias, ADD COLUMN NOT NULL no requiere backfill;
-- si hubiera filas, el down debe crear primero como NULLABLE. En este repo la
-- geografia esta vacia -> se restaura NOT NULL directo (documentado).
ALTER TABLE "provincia" ADD COLUMN "zona_id" TEXT NOT NULL;
CREATE INDEX "provincia_zona_id_idx" ON "provincia"("zona_id");
ALTER TABLE "provincia" ADD CONSTRAINT "provincia_zona_id_fkey"
  FOREIGN KEY ("zona_id") REFERENCES "zona"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

DROP INDEX IF EXISTS "zona_es_gam_unico";
DROP INDEX IF EXISTS "zona_nombre_key";
ALTER TABLE "zona" DROP COLUMN IF EXISTS "es_gam";
ALTER TABLE "zona" DROP COLUMN IF EXISTS "pago_rechazo";
ALTER TABLE "zona" DROP COLUMN IF EXISTS "pago_entrega";
```

### 2.2 `db/schema.prisma` (reflejo del cambio)

```prisma
model Zona {
  id          String  @id @default(uuid())
  nombre      String  @unique                              // R2
  pagoEntrega Decimal @default(0) @db.Decimal(12, 2) @map("pago_entrega")
  pagoRechazo Decimal @default(0) @db.Decimal(12, 2) @map("pago_rechazo")
  esGam       Boolean @default(false) @map("es_gam")
  distritos   Distrito[]                                   // nueva relacion inversa
  usuarios    Usuario[]                                    // nueva relacion inversa
  ordenes     Orden[]
  @@map("zona")
}

// Provincia: se QUITA zonaId, la FK y el @@index([zonaId]); pierde `zona`.
model Provincia {
  id       String   @id @default(uuid())
  nombre   String
  cantones Canton[]
  ordenes  Orden[]
  @@map("provincia")
}

// Distrito: + zonaId String? @map("zona_id"); zona Zona? @relation(...);
//           @@index([zonaId])
// Usuario:  + zonaId String? @map("zona_id"); zona Zona? @relation(...);
//           @@index([zonaId])
```

Nota: `Zona.provincias` desaparece (ya no hay `provincia.zonaId`). El índice único
parcial `zona_es_gam_unico` no se expresa en Prisma (índice parcial); vive solo en
SQL, documentado como invariante reforzada en DB además de la lógica del service.

## 3. Backend (patrón feature 25/18: action → service → repository, errores feat 10)

Capas nuevas (nombres siguiendo el repo):

- `lib/types/zona.ts` — schemas Zod + DTO + tipos de resultado discriminados por
  `status`. `montoSchema = z.number().nonnegative()` (igual que `cobro.ts`).
  `crearZonaSchema.strict()`:
  `{ nombre, pagoEntrega, pagoRechazo, esGam, distritoIds: string[] (>=1) }`.
  `actualizarZonaSchema = crearZonaSchema.partial().strict()` (con `id`).
  `listarZonasSchema` con page/pageSize (clamp a MAX, patrón `cobro.ts`).
  `ZonaDTO`: montos `Decimal -> number`, `distritosCount: number`.
- `lib/config/zonas.ts` — `DEFAULT_PAGE_SIZE`, `MAX_PAGE_SIZE`.
- `lib/geo/normalize.ts` — `normalizeZonaKey(raw): string` (clave de dedup) y
  `canonicalZonaNombre(raw): string` (nombre mostrado). Reutilizado por el service
  (unicidad R2/R21) y el seed (dedup R35). Ver §5.1.
- `lib/interfaces/repositories/IZonaRepository.ts` — `create`, `findById`,
  `findByNombreKey`, `list({skip,take})`, `update`, `setGam`, `listLight`,
  `assignDistritos`, `distritosDeZona`. Catálogo:
  `IGeoRepository` con `listProvincias`, `listCantones(provinciaId)`,
  `listDistritos(cantonId)` (cada distrito con su `zonaId`/`zonaNombre`).
- `lib/interfaces/services/IZonaService.ts` — `Actor`, resultados discriminados.
- `lib/repositories/ZonaRepository.ts` — Prisma; `create`/`update` usan
  `prisma.$transaction`: (1) crea/actualiza la fila `zona`; (2) valida que los
  distritos existan y no pertenezcan a otra zona (R20); (3) `updateMany`
  `distrito.zona_id` para asignar los nuevos y liberar (`NULL`) los removidos;
  (4) si `esGam`, desmarca la anterior. Atomicidad R17/R18/R22/R23.
- `lib/repositories/GeoRepository.ts` — lecturas del catálogo global.
- `lib/services/ZonaService.ts` — `WRITE_ROLES = new Set(["maestro"])` (D2),
  `READ_ROLES = new Set(["maestro","admin"])`. Reglas: unicidad de nombre por clave
  normalizada (R21), invariante `es_gam` único (R23), distrito ya asignado →
  `conflict` (R20), validación de entrada (R19).
- `lib/actions/zonas.ts` (`"use server"`) — `crearZona`, `obtenerZona`,
  `listarZonas`, `actualizarZona`, `marcarZonaGam`, `listarZonasLight`,
  `listarProvincias`, `listarCantones`, `listarDistritos`. Cada una envuelve con
  `withErrorHandler`, resuelve actor (`resolveActorFromSession`), lanza
  `UnauthenticatedError` antes del service (R13), `parse` con Zod →
  `VALIDATION_ERROR`, y mapea `AppErrorShape` con `toActionError`. Contrato de
  salida discriminado por `status` (R25/R26).

Extensión de usuarios (R27/R28): el servicio de usuarios (feature 25) acepta
`zonaId` opcional y valida su existencia contra `IZonaRepository.findById`. Se
documenta como punto de integración; el cambio concreto en `UsuarioService` es una
task con dependencia.

### 3.1 Contratos I/O (resumen)

- `crearZona(input) -> { status:"ok", zona: ZonaDTO } | { status:"validation_error",
  fieldErrors } | { status:"unauthenticated" } | { status:"forbidden" } |
  { status:"conflict", reason:"nombre"|"distrito", distritoIds? }`.
- `actualizarZona(input) -> ... | { status:"not_found" }`.
- `listarZonas(input) -> { status:"ok", items: ZonaDTO[], page, pageSize, total } | ...`.
- `listarZonasLight() -> { status:"ok", items: {id,nombre,esGam}[] } | ...` (R15).
- `marcarZonaGam(id) -> { status:"ok" } | { status:"not_found" } | ...`.
- `listarProvincias() -> { status:"ok", items:{id,nombre}[] }`;
  `listarCantones(provinciaId) -> { status:"ok", items:{id,nombre}[] }`;
  `listarDistritos(cantonId) -> { status:"ok", items:{id,nombre,zonaId,zonaNombre}[] }`.

## 4. Frontend (patrón `app/(app)/configuracion` feature 25)

- `app/(app)/configuracion/page.tsx` — hoy renderiza `UsuariosModule` (feat 25). Se
  organiza en secciones/tabs para incluir el módulo de zonas (autorización
  server-side: solo `maestro`, R29). Precarga `listarZonas` en server.
- `app/(app)/configuracion/_components/ZonasModule.tsx` — client component:
  DataTable + Pagination (R30), botón crear, Modal de formulario, Toast (R32).
- `.../_components/ZonaForm.tsx` — `nombre`, `pagoEntrega`, `pagoRechazo`, **toggle
  `esGam`** ("marcar como zona central/GAM"; único origen del flag, el seed nunca lo
  setea) y **selector de distritos** que consume `listarProvincias` →
  `listarCantones` → `listarDistritos`, marcando/desmarcando distritos (deshabilita
  o advierte los ya asignados a otra zona). Muestra `fieldErrors`/conflicto (R33).
- `.../_components/zonas-columns.tsx` — columnas: nombre, nº distritos, pago
  entrega, pago rechazo, badge GAM.

## 5. Seed del catálogo global (gate de despliegue)

- `scripts/seed-zonas.ts` — patrón `scripts/seed-catalogos.ts` (idempotente,
  `getPrismaClient`, `process.loadEnvFile()`, `isEntrypoint` para no auto-correr al
  importarlo desde un test). Cruza **DOS fuentes XLSX**, ambas leídas con `exceljs`
  (ya presente; ver `lib/parsers/spreadsheet.ts`):
  - **Fuente GEOGRAFÍA** = mapa oficial completo de Costa Rica (archivo en
    `public/`, nombre a confirmar, p. ej. `public/geografia-cr-completa.xlsx`): 7
    provincias, 84 cantones, 489 distritos, con correcciones de nombre ("León
    Cortés Castro", Sarchí ex-"Valverde Vega"). Puebla `provincia`/`canton`/
    `distrito`. Es la fuente autoritativa de la jerarquía.
  - **Fuente ZONA** = Excel original `public/mapa-geografico-costa-rica.xlsx`, hoja
    **"Jerarquía (revisar)"**, columnas
    `Provincia | Cantón | Distrito | Estado | Zona | Corrección/Nota` (307 filas de
    distrito, 263 con zona, ~76 sin zona). Solo aporta las **asignaciones de zona**
    (columna `Zona`) y se usa para pre-crear/deduplicar las zonas.
- **Cruce**: por clave normalizada `provincia + cantón + distrito` (misma
  normalización de nombres, ver §5.1). A cada distrito del catálogo completo se le
  asigna la zona que el Excel original indique para esa terna. Distritos del mapa
  completo ausentes del Excel original, o con celda `Zona` vacía → `zona_id = NULL`.
  Ternas del Excel original sin correspondencia en el mapa completo → se reportan y
  omiten (R38), NO fallan.

### 5.1 Algoritmo de normalización de nombre de zona

```
normalizeZonaKey(raw):
  1. si vacío/whitespace -> null (distrito sin zona, R36)
  2. trim
  3. colapsar espacios internos a uno solo (/\s+/ -> " ")
  4. quitar acentos: NFD + eliminar marcas combinantes (\p{Diacritic})
  5. toLowerCase()
  -> clave de dedup (p.ej. "GAM","Gam" -> "gam"; "LIMÓN ABAJO","LIMON ABAJO" -> "limon abajo")

canonicalZonaNombre(raw):
  1. trim + colapsar espacios
  2. Title Case por palabra
  3. excepción: acrónimos reconocidos (Set ["GAM"]) se conservan en MAYÚSCULAS
  -> "GAM", "Zona Sur", "Limon Abajo", "Puntarenas", "San Ramon", "Guanacaste", "Quepos"
```

Zonas esperadas tras dedup (por la data dura observada): **GAM** (119+35=154
distritos), **Zona Sur** (6+1), **Limon Abajo** (5+1), **Puntarenas** (27, cruza
Alajuela+Puntarenas), **San Ramon** (26), **Guanacaste** (8), **Quepos** (3). Todas
nacen con `es_gam=false`; el maestro marca GAM como zona central por UI. El que GAM
y Puntarenas crucen provincias CONFIRMA que la zona va a nivel de distrito.

### 5.2 Mapeo columna → campo

Fuente GEOGRAFÍA (mapa oficial completo):

| Columna            | Destino                                             |
|--------------------|-----------------------------------------------------|
| `Provincia`        | `provincia.nombre` (upsert por `nombre`)            |
| `Cantón`           | `canton.nombre` (upsert por `(provincia_id,nombre)`)|
| `Distrito`         | `distrito.nombre` (upsert por `(canton_id,nombre)`) |

Fuente ZONA (Excel original, hoja "Jerarquía (revisar)"):

| Columna            | Uso                                                 |
|--------------------|-----------------------------------------------------|
| `Provincia`+`Cantón`+`Distrito` | clave de cruce (normalizada) con la geografía |
| `Zona`             | `normalizeZonaKey` → zona (dedup) → `distrito.zona_id` |
| `Estado`           | ignorado (metadato de revisión humana)              |
| `Corrección/Nota`  | ignorado (metadato de revisión humana)              |

### 5.3 Orden y idempotencia

1. **Geografía**: leer el mapa completo; por fila upsert `provincia` → `canton` →
   `distrito` (upsert por nombre dentro del padre) (R34/R39).
2. **Zonas**: leer el Excel original; deducir el conjunto de zonas normalizadas
   (dedup por `normalizeZonaKey`) → upsert `zona` por `nombre` canónico con
   `pago_entrega = pago_rechazo = 0` y **`es_gam = false`** (R35/R37/R39). El seed
   NUNCA setea `es_gam`; es toggle de UI (R31).
3. **Cruce**: por cada terna del Excel original, resolver el distrito del catálogo
   completo por clave normalizada `provincia+cantón+distrito` y setear su
   `distrito.zona_id` a la zona correspondiente. Distritos sin match o con `Zona`
   vacía → `NULL` (R36).
4. Filas incompletas o ternas sin correspondencia → registrar y omitir sin fallar
   (R38).
5. Idempotencia: en re-corridas NO sobrescribir `pago_entrega`/`pago_rechazo`/
   `es_gam` de zonas ya editadas por el maestro (upsert de zona con `update: {}`
   sobre esos campos, patrón `seedRoles`); solo asegura existencia (R39).
6. Resumen final por consola: distritos poblados (mapa completo), distritos con zona
   asignada, distritos sin zona, zonas creadas, ternas sin correspondencia, filas
   omitidas.

Testeable con fixtures XLSX sintéticos (una por fuente) sin DB real; la corrida
contra los archivos reales de `public/` + DB real es el gate de despliegue (R40).

## 6. Alternativas descartadas

**Alternativa A — Mantener la geografía como hija de la zona (`provincia.zona_id`)
con tecleo inline (modelo del spec previo, P3).** DESCARTADA: el humano
(2026-07-10) confirmó que es incorrecto. El Excel real lo contradice — una misma
zona (GAM, Puntarenas) abarca distritos de VARIAS provincias, así que la zona no
puede colgar de una provincia. Además duplicaría geografía por zona y no permitiría
un catálogo nacional reutilizable. Se adopta catálogo global + `distrito.zona_id`.

**Alternativa B — Poner `zona_id` en `canton` en vez de `distrito`.** DESCARTADA:
la data muestra zonas que parten un mismo cantón/provincia y asignaciones a nivel
de distrito (263 de 307 filas de distrito mapeadas individualmente); el grano
correcto es el distrito. Colgar de cantón perdería resolución.

**Alternativa C — Tabla pivote `zona_distrito` (N:M).** DESCARTADA: el requisito es
"un distrito pertenece a lo sumo a UNA zona" (D4). Una FK nullable en `distrito`
modela exactamente 0..1 zona por distrito, con menos superficie que una pivote y
sin riesgo de doble asignación. Si en el futuro un distrito debiera estar en varias
zonas, se migraría a pivote.

## 7. Trazabilidad R→test (propuesta)

| R | Test propuesto (archivo · caso) |
|---|---|
| R1 | migración smoke: `zona.pago_entrega/pago_rechazo/es_gam` existen con defaults. |
| R2 | migración: índice único `zona_nombre_key`; insertar nombre dup falla. |
| R3 | migración: índice parcial `zona_es_gam_unico`; segunda fila `es_gam=true` falla. |
| R4 | migración: `provincia.zona_id`, su FK e índice ya NO existen. |
| R5 | migración: `distrito.zona_id` existe, nullable, con FK e índice. |
| R6 | migración: `usuario.zona_id` existe, nullable, con FK e índice. |
| R7 | DB: distrito/usuario con `zona_id` inexistente falla; con `NULL` pasa. |
| R8 | DB: borrar zona con distrito/usuario/orden asociado → error RESTRICT. |
| R9 | migración: `canton.provincia_id` y `distrito.canton_id` intactos. |
| R10 | migración: `orden` (zona/provincia/canton/distrito_id y FKs) sin cambios; down no toca `orden`. |
| R11 | `down.sql`: up→down→up reproducible; provincia.zona_id restaurado. |
| R12 | RLS habilitado en zona/provincia/canton/distrito (`pg_class.relrowsecurity`). |
| R13 | `zonas.actions.test`: sin sesión → `unauthenticated`, service no invocado. |
| R14 | `GeoService.test`: listar provincias/cantones/distritos con marca de zona. |
| R15 | `zonas.actions.test`: `listarZonasLight` → `{id,nombre,esGam}`. |
| R16 | `ZonaService.test`: rol no-write → `forbidden`. |
| R17 | `ZonaRepository.test`: crear zona asigna `distrito.zona_id` a los distritos. |
| R18 | `ZonaRepository.test`: distrito inexistente en el set → rollback, 0 cambios. |
| R19 | `zona.schema.test`: nombre vacío / monto negativo / distrito inexistente → `validation_error`. |
| R20 | `ZonaService.test`: distrito ya en otra zona → `conflict`; misma zona → idempotente. |
| R21 | `ZonaService.test`: nombre dup (clave normalizada) → `conflict`. |
| R22 | `ZonaService.test`: editar libera distritos removidos (`zona_id=NULL`) y asigna nuevos; inexistente → `not_found`. |
| R23 | `ZonaService.test`: marcar segunda zona GAM desmarca la anterior en la misma tx. |
| R24 | `ZonaService.test`: listar paginado → items+total+distritosCount. |
| R25 | `zonas.actions.test`: cada rama de `status` sin excepción fuera del contrato. |
| R26 | `zona.dto.test`: DTO expone montos number, sin campos internos. |
| R27 | `UsuarioService.test`: mensajero/adminSatelite acepta `zonaId`; otros roles null. |
| R28 | `UsuarioService.test`: `zonaId` inexistente → `validation_error`. |
| R29 | `ConfiguracionPage.test`: rol no-maestro no ve módulo zonas. |
| R30 | `ZonasModule.test`: DataTable + Pagination con datos precargados. |
| R31 | `ZonaForm.test`: selector navega provincia→cantón→distrito y marca distritos. |
| R32 | `ZonasModule.test`: éxito → Toast ok + refresco; error → Toast error. |
| R33 | `ZonaForm.test`: `fieldErrors`/conflicto de distrito junto a campos, sin perder valores. |
| R34 | `seed-zonas.test`: fixture mapa completo → provincia/canton/distrito poblados. |
| R35 | `seed-zonas.test`: Excel original `GAM`+`Gam` → una zona; pagos 0; `es_gam=false`. |
| R36 | `seed-zonas.test`: cruce por terna asigna `distrito.zona_id`; sin match/Zona vacía → `NULL`. |
| R37 | `seed-zonas.test`: ninguna zona sembrada con `es_gam=true` (todas false). |
| R38 | `seed-zonas.test`: fila incompleta/terna sin correspondencia → omitida, no falla; resumen emitido. |
| R39 | `seed-zonas.test`: dos corridas → sin duplicados, mismos ids; no pisa pagos/es_gam editados. |
| R40 | Documental/gate: corrida contra los XLSX reales + DB real (no test automatizado). |
