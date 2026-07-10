# Diseño — cobros (CRUD backend)

## Enfoque general

CRUD de cobros como **Server Actions** (`lib/actions/cobros.ts`, `'use server'`),
réplica exacta del patrón por capas del CRUD de órdenes (feature 6) y del
manejo de errores común (features 10/16):

```
lib/actions/cobros.ts                    Borde: resuelve actor (sesión), parsea zod, withErrorHandler + toActionError
lib/services/CobroService.ts             Autorización por rol (matriz) + reglas de dominio; sin HTTP ni DB
lib/repositories/CobroRepository.ts      Solo Prisma: create/findById/list/update/softDelete (filtra deleted_at)
lib/interfaces/services/ICobroService.ts
lib/interfaces/repositories/ICobroRepository.ts
lib/types/cobro.ts                       Zod (crear/actualizar/listar) + CobroDTO + result types discriminados
lib/config/cobros.ts                     DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE (patrón lib/config/ordenes.ts)
```

Se reutiliza sin cambios:
- `resolveActorFromSession` (`lib/auth/resolve-actor.ts`) → `Actor { usuarioId, rol }`.
- `withErrorHandler`, `isAppErrorShape`, `UnauthenticatedError`, `ValidationError`,
  `MSG` (`lib/errors`) y `toActionError` (`lib/actions/_shared/to-action-error.ts`).
- El tipo `Actor` se importa de `lib/interfaces/services/ICobroService.ts`
  (definición local espejo de la de órdenes: `{ usuarioId, rol: RolValue }`).

No se toca autenticación ni el manejador de errores; se consumen tal cual.

## Modelo de datos (Prisma)

`id` uuid TEXT, columnas `snake_case` vía `@map`, timestamps y `deleted_at`
(soft delete), idéntico a `Orden`.

```prisma
model Cobro {
  id                     String    @id @default(uuid())
  nombre                 String                                                          // D1: distingue tarifas (NOT NULL)
  valorFlete             Decimal   @db.Decimal(12, 2) @map("valor_flete")               // R2 (monto)
  valorFleteDevuelto     Decimal   @db.Decimal(12, 2) @map("valor_flete_devuelto")      // R2 (monto)
  valorFleteGam          Decimal   @db.Decimal(12, 2) @map("valor_flete_gam")           // R2/R4 (GAM -> gam)
  valorFleteDevueltoGam  Decimal   @db.Decimal(12, 2) @map("valor_flete_devuelto_gam")  // R2/R4
  fulfillment            Decimal   @db.Decimal(12, 2)                                    // R2/D3 (monto)
  comisionCod            Decimal   @db.Decimal(5, 2)  @map("comision_cod")              // R3/D3 (porcentaje 0..100)
  ivaFlete               Decimal   @db.Decimal(5, 2)  @map("iva_flete")                 // R3/D2 (porcentaje 0..100)
  ivaComisionCod         Decimal   @db.Decimal(5, 2)  @map("iva_comision_cod")          // R3/D2 (porcentaje 0..100)
  deletedAt              DateTime? @map("deleted_at")                                    // soft delete (R19/R24)
  createdAt              DateTime  @default(now()) @map("created_at")
  updatedAt             DateTime  @updatedAt       @map("updated_at")

  @@map("cobro")
  @@index([createdAt])
}
```

**Tipos** (decisiones D2/D3, dinero/porcentajes jamás en float, R2/R3):
- Montos → `Decimal(12,2)` (mismo tipo que `orden.monto_cobrar`), permite hasta
  9.999.999.999,99: `valor_flete`, `valor_flete_devuelto`, `valor_flete_gam`,
  `valor_flete_devuelto_gam`, `fulfillment`.
- Porcentajes 0..100 → `Decimal(5,2)` (p.ej. `15.00` = 15%; tope 999.99 por
  precisión, acotado a ≤ 100 en zod/servicio): `comision_cod`, `iva_flete`,
  `iva_comision_cod`. Ver alternativa descartada #2.
- `nombre` → `String` (TEXT) NOT NULL, identificador legible de la tarifa (D1).

**Nullabilidad.** `nombre` + las 8 columnas numéricas NOT NULL (R5); una tarifa
incompleta no es válida. `deleted_at` nullable por naturaleza del soft delete.

**Unicidad de `nombre` (decisión de diseño).** Se opta por `nombre` **requerido
pero NO único** (sin `@unique`). Justificación: (a) el humano marcó la unicidad
como opcional ("no necesariamente único"); (b) un índice único de Postgres sobre
`nombre` chocaría con el soft delete —una tarifa borrada seguiría "ocupando" el
nombre y bloquearía recrear otra con el mismo nombre—, y un índice único parcial
(`WHERE deleted_at IS NULL`) añade complejidad no pedida; (c) `id` uuid ya
identifica cada fila de forma estable para el CRUD. Si el negocio exige nombres no
duplicados entre tarifas vigentes, se añadirá en una iteración un índice único
parcial `@@index`/SQL `CREATE UNIQUE INDEX ... WHERE deleted_at IS NULL`.

**Cardinalidad.** Tabla con **múltiples filas** y CRUD estándar, **sin** FK a
`zona`/`orden`/`tienda` (R1, D1). No se agregan columnas fuera de `nombre` + las 8
+ estándar. Cuando llegue la feature 24 (zonas) se decidirá `zona_id` en una
migración aparte.

## Migración

Una sola migración `db/migrations/<ts>_cobros/` (patrón `20260709130100_ordenes`):

- **UP (`migration.sql`):**
  - `CREATE TABLE "cobro"` con `id` PK, `nombre TEXT NOT NULL` (D1), las 5 columnas
    de monto `DECIMAL(12,2) NOT NULL` (`valor_flete`, `valor_flete_devuelto`,
    `valor_flete_gam`, `valor_flete_devuelto_gam`, `fulfillment`), las 3 columnas de
    porcentaje `DECIMAL(5,2) NOT NULL` (`comision_cod`, `iva_flete`,
    `iva_comision_cod`), `deleted_at TIMESTAMP(3)`, `created_at DEFAULT
    CURRENT_TIMESTAMP`, `updated_at`.
  - `CREATE INDEX "cobro_created_at_idx" ON "cobro"("created_at");` (orden por
    defecto del listado). Sin índice único sobre `nombre` (ver "Unicidad de
    `nombre`").
  - `ALTER TABLE "cobro" ENABLE ROW LEVEL SECURITY;` (sin policies).
- **DOWN (`down.sql`):** `DROP TABLE IF EXISTS "cobro";` — no toca tablas
  preexistentes (R6/R7).

No hay FKs (no depende de otras tablas), por lo que el orden de creación/borrado es
trivial.

## RLS (Supabase)

`cobro` se accede solo desde el servidor (Prisma con service role). RLS habilitada
sin policies para `anon`/`authenticated` → bloquea todo salvo service role, igual
que `orden`/`usuario`. La matriz rol→operación (R9–R13) vive en `CobroService`,
testeable sin DB (ver alternativa descartada #3).

## Contratos — tipos y Server Actions

En `lib/types/cobro.ts`, estilo `lib/types/orden.ts`:

```ts
// Reutilizable en crear y (parcial) en actualizar.
const montoSchema      = z.number().nonnegative();          // R2/R5 (>= 0)
const porcentajeSchema = z.number().min(0).max(100);        // R3/R5/D2/D3 (0..100)
const nombreSchema     = z.string().min(1);                 // D1/R5 (no vacío)

export const crearCobroSchema = z.object({
  nombre: nombreSchema,
  valorFlete: montoSchema,
  valorFleteDevuelto: montoSchema,
  valorFleteGam: montoSchema,
  valorFleteDevueltoGam: montoSchema,
  fulfillment: montoSchema,               // D3: monto
  comisionCod: porcentajeSchema,          // D3: porcentaje 0..100
  ivaFlete: porcentajeSchema,             // D2: porcentaje 0..100
  ivaComisionCod: porcentajeSchema,       // D2: porcentaje 0..100
}).strict();

export const actualizarCobroSchema = crearCobroSchema.partial().strict(); // R20

export const listarCobrosSchema = z.object({
  page: z.number().int().positive().default(1),
  pageSize: z.number().int().positive()
    .default(cobrosConfig.DEFAULT_PAGE_SIZE)
    .transform((n) => Math.min(n, cobrosConfig.MAX_PAGE_SIZE)),           // R18
});

export interface CobroDTO {
  id: string;
  nombre: string;                // D1
  valorFlete: number;            // Decimal -> number (R27)
  valorFleteDevuelto: number;
  valorFleteGam: number;
  valorFleteDevueltoGam: number;
  fulfillment: number;
  comisionCod: number;
  ivaFlete: number;
  ivaComisionCod: number;
  createdAt: Date;
  updatedAt: Date;               // nunca deletedAt (R27)
}

export type ActionError =
  | { status: "validation_error"; fieldErrors: Record<string, string[]> } // R15/R23
  | { status: "unauthenticated" }                                         // R8
  | { status: "forbidden" }                                               // R11/R12/R13
  | { status: "not_found" };                                              // R17/R21/R25
```

Result types discriminados (`CrearCobroResult`, `ObtenerCobroResult`,
`ListarCobrosResult { items, page, pageSize, total }`, `ActualizarCobroResult`,
`BorrarCobroResult`), idénticos en forma a los de órdenes. Nota: **no hay estado
`conflict`** (no existe columna única provista por el usuario; `id` es uuid).

Las Server Actions (`crearCobro`, `obtenerCobro`, `listarCobros`, `actualizarCobro`,
`borrarCobro`) siguen literalmente el esqueleto de `lib/actions/ordenes.ts`:
`withErrorHandler(async () => { actor ?? throw Unauthenticated; parse zod; return
service.x(...) })` y `isAppErrorShape(r) ? toActionError(r) : r` (R26).

### `CobroService` (pseudo-contrato)

Conjunto de roles reconocidos y de escritura (matriz R9–R13):

```ts
const KNOWN_ROLES = new Set(["maestro", "admin", "adminTienda", "mensajero"]);
const READ_ROLES  = new Set(["maestro", "admin"]);   // R10/R11
const WRITE_ROLES = new Set(["maestro"]);            // R10/R11/D4 (solo maestro escribe)
```

1. **Autorización** antes de tocar datos: rol no reconocido → `forbidden` (R13);
   lecturas (`obtener`/`listar`) exigen `READ_ROLES`, escrituras
   (`crear`/`actualizar`/`borrar`) exigen `WRITE_ROLES`; en falta → `forbidden`
   (R11/R12/R13).
2. **crear**: persiste `nombre` + las 8 columnas numéricas convertidas a
   `Prisma.Decimal`; devuelve DTO (R16).
3. **obtener/actualizar/borrar**: `findById` excluye borrados (R19); ausente →
   `not_found` (R17/R21/R25); `borrar` fija `deleted_at` (R24).
4. **listar**: `findMany` filtra `deleted_at IS NULL`, `orderBy created_at desc`,
   `skip/take` con cap de `MAX_PAGE_SIZE`; devuelve `{ items, total }` (R18/R19).

`CobroRepository` convierte `Decimal ↔ number` en el borde de datos: `toDTO` hace
`row.valorFlete.toNumber()` etc.; en escritura envuelve cada number en
`new Prisma.Decimal(...)` (patrón `OrdenRepository`).

## Paginación

Offset-based (`page`/`pageSize`) con conteo total, orden por defecto
`created_at desc`, cap `MAX_PAGE_SIZE` en `lib/config/cobros.ts`
(`readPositiveInt`, patrón `lib/config/ordenes.ts`). No se expone `sortBy`/filtros
en esta feature (la tabla no tiene columnas de negocio filtrables obvias); se puede
añadir después sin romper el contrato.

## Alternativas descartadas

1. **Tarifa como fila única global (singleton) en vez de tabla multi-fila.**
   Modelaría `cobro` como una sola fila de configuración (un `upsert` sobre un id
   fijo). Descartada por decisión del humano (D1) porque: (a) la feature 24
   anticipa tarifas ligadas a zona ("se relaciona con la feature 18… alinear al
   llegar allá"), lo que apunta a múltiples filas; (b) el enunciado pide un **CRUD**
   completo (crear/listar/…​), que sobre un singleton pierde sentido (no hay
   "listar" ni "borrar"). Decisión final (D1): tabla **multi-fila con columna
   `nombre`** para distinguir tarifas, sin FK a zona/orden/tienda en esta feature.

2. **Porcentajes (`iva_flete`/`iva_comision_cod`/`comision_cod`) como monto ya
   calculado (`Decimal(12,2)`), como fracción 0..1 (`Decimal(5,4)`) o como entero
   0–100 (`Int`).** Descartadas: guardar el porcentaje como **monto** acopla la
   tasa al valor base y obliga a recalcular en cada cambio; como **entero 0–100**
   se pierden porcentajes con decimales (p.ej. `12.5%`); la **fracción 0..1** fue
   descartada por el humano (D2) frente a la representación pedida. Decisión final
   (D2/D3): **porcentaje 0..100 con dos decimales `Decimal(5,2)`** (p.ej.
   `15.00`), acotado a `≤ 100` en zod/servicio (R3/R5). `fulfillment` se mantiene
   como **monto** `Decimal(12,2)` (D3), no como porcentaje.

3. **Autorización por RLS policies de Postgres** (policies por rol) en vez de en
   `CobroService`. Descartada por el mismo motivo que en órdenes: el repo accede
   con service role que bypassa RLS, así que las policies no se ejercitarían; la
   matriz por rol es lógica de negocio que pertenece al service testeable sin DB.
   RLS se deja habilitada sin policies solo como defensa en profundidad (R7).

4. **Borrado físico (`DELETE`).** Descartada: una tarifa tiene valor de auditoría
   (qué cobros aplicaban en un momento). El borrado lógico (`deleted_at`) preserva
   trazabilidad y se excluye de listados por defecto (R19), consistente con
   `orden`.
