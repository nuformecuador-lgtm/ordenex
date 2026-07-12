# Feature 17 — Órdenes: revisión maestro / generar guía / asignación de mensajero · design.md

Zone: `fullstack` · complexity: `high` · depends_on: 27, 28 · branch: `feature/17-revision-maestro-generar-guia`

> Puerta F1.4 CERRADA/APROBADA (humano, 2026-07-10). Este design implementa las 5
> decisiones firmes de `requirements.md`. No hay decisiones abiertas.

Arquitectura por capas del repo (`docs/architecture.md`): Controller (Server Action) →
Service (lógica de negocio pura, testeable) → Repository (Prisma). Mutaciones internas
por Server Action (`'use server'`), nunca `fetch` a rutas internas. Toda entrada externa
se valida en el borde con zod.

---

## 1. Modelo de datos

### 1.1 `orden.num_guia` diferido (R1–R6)

Estado actual (feature 6):

```prisma
numGuia Int @unique @default(autoincrement()) @map("num_guia") // SERIAL
```

Estado objetivo:

```prisma
numGuia Int? @unique @map("num_guia") // nullable, sin default; asignado en "Generar guía"
```

Mecanismo de secuencia (decisión 1, APROBADA): el SERIAL de la feature 6 ya creó la
secuencia `orden_num_guia_seq` y la dejó `OWNED BY orden.num_guia`. Al quitar el
`DEFAULT`, la secuencia sigue existiendo pero queda "propiedad" de la columna; se la
**desliga** con `OWNED BY NONE` para que no la elimine un futuro `DROP COLUMN` y para
dejar explícito que su ciclo de vida es independiente. La asignación de guía consume
`nextval('orden_num_guia_seq')` por fila dentro de la transacción de "Generar guía".

Propiedades:
- **Único e incremental** (R4): garantizado por la propia secuencia + el índice UNIQUE.
- **Idempotente** (R5): el `UPDATE` filtra `WHERE num_guia IS NULL`, de modo que las
  filas ya numeradas no vuelven a consumir la secuencia. Hay "huecos" posibles en la
  numeración (si una transacción aborta tras `nextval`), lo cual es aceptable: el
  requisito es unicidad + monotonía, no contigüidad.

Migración `db/migrations/<ts>_orden_num_guia_deferred_mensajero_asignado_espera_aceptacion/`:

`migration.sql` (UP), en orden:
```sql
-- 1) num_guia: quitar default y NOT NULL, conservar UNIQUE
ALTER TABLE "orden" ALTER COLUMN "num_guia" DROP DEFAULT;
ALTER TABLE "orden" ALTER COLUMN "num_guia" DROP NOT NULL;
-- desligar la secuencia del SERIAL para que sobreviva independiente
ALTER SEQUENCE "orden_num_guia_seq" OWNED BY NONE;

-- 2) mensajero_asignado_id (R7)
ALTER TABLE "orden" ADD COLUMN "mensajero_asignado_id" TEXT;
CREATE INDEX "orden_mensajero_asignado_id_idx" ON "orden"("mensajero_asignado_id");
ALTER TABLE "orden" ADD CONSTRAINT "orden_mensajero_asignado_id_fkey"
  FOREIGN KEY ("mensajero_asignado_id") REFERENCES "usuario"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- 3) nuevo estado de catálogo (R9/R10), patrón feature 15/28
ALTER TYPE "order_status_value" ADD VALUE IF NOT EXISTS 'en_espera_aceptacion';
INSERT INTO "order_status" ("id","value")
  VALUES (gen_random_uuid()::text,'en_espera_aceptacion')
  ON CONFLICT ("value") DO NOTHING;
-- RLS de "orden" ya habilitada desde 20260709130100_ordenes; se conserva sin policies.
```

`down.sql` (DOWN), en orden inverso, con la advertencia obligatoria (R6):
```sql
-- Revertir estado de catálogo: solo si ninguna orden lo referencia (patrón feature 15)
DELETE FROM "order_status" WHERE "value" = 'en_espera_aceptacion'
  AND NOT EXISTS (SELECT 1 FROM "orden" o JOIN "order_status" s
    ON o."estatus_id"=s."id" WHERE s."value"='en_espera_aceptacion');
-- (el valor del enum order_status_value NO se elimina: Postgres no soporta DROP VALUE;
--  se deja documentado. Es inocuo mientras no lo referencie ninguna fila.)

-- Revertir mensajero_asignado_id
ALTER TABLE "orden" DROP CONSTRAINT IF EXISTS "orden_mensajero_asignado_id_fkey";
DROP INDEX IF EXISTS "orden_mensajero_asignado_id_idx";
ALTER TABLE "orden" DROP COLUMN IF EXISTS "mensajero_asignado_id";

-- Revertir num_guia a SERIAL NOT NULL.
-- ADVERTENCIA: esta sentencia FALLA explícitamente si existen órdenes con
-- num_guia = NULL (p.ej. órdenes creadas por carga masiva aún sin guía); en ese caso
-- el rollback requiere resolver esos datos manualmente antes de reintentar (no se
-- corrompen datos en silencio).
ALTER SEQUENCE "orden_num_guia_seq" OWNED BY "orden"."num_guia";
ALTER TABLE "orden" ALTER COLUMN "num_guia" SET DEFAULT nextval('orden_num_guia_seq');
ALTER TABLE "orden" ALTER COLUMN "num_guia" SET NOT NULL;
```

> Nota de riesgo para el implementer: `ALTER TYPE ... ADD VALUE` no puede ejecutarse
> dentro de una transacción en versiones antiguas de Postgres; verificar que el runner de
> migraciones no lo envuelva, o separar el `ADD VALUE` en su propia sentencia. `IF NOT
> EXISTS` lo hace idempotente.

### 1.2 `mensajero_asignado_id` (R7/R8)

Nuevo campo en `Orden`, hermano de `mensajeroSugeridoId`:

```prisma
mensajeroAsignadoId String?  @map("mensajero_asignado_id") // feature 17: mensajero ASIGNADO
mensajeroAsignado   Usuario? @relation("OrdenMensajeroAsignado", fields: [mensajeroAsignadoId], references: [id])
@@index([mensajeroAsignadoId])
```

En `Usuario` se añade el lado inverso de la relación:
```prisma
ordenesAsignadas Orden[] @relation("OrdenMensajeroAsignado") // feature 17
```

`mensajeroSugeridoId` (feature 15) permanece intacto: es la SUGERENCIA de la carga masiva;
`mensajeroAsignadoId` es la DECISIÓN del maestro. La feature 36 leerá el asignado.

### 1.3 Catálogo `en_espera_aceptacion` (R9/R10)

- `lib/types/order-status.ts`: añadir `"en_espera_aceptacion"` como 9.º valor de
  `ORDER_STATUS_SEED` (fuente única de verdad). `seedOrderStatus` lo siembra por upsert
  sin cambios de código.
- Migración: `INSERT ... ON CONFLICT DO NOTHING` (cubre bases ya migradas) + `ALTER TYPE`
  del enum standalone `order_status_value`.
- El label legible ("En espera de aceptación del mensajero") vive en la capa de
  presentación (`app/(app)/ordenes/_components/estatus-label.ts`), no en la DB.

---

## 2. Modelo de estados y transiciones

Estados involucrados (todos ya en catálogo tras esta feature):

```
en_fulfillment  ─┐
                 ├─(Generar guía + mensajero)──▶ en_espera_aceptacion
en_preparacion  ─┘        │
                          └─(Generar guía, sin mensajero)──▶ en_bodega
en_bodega ──(asignar mensajero)──▶ en_espera_aceptacion
```

Reglas de transición (guardia por estado de ORIGEN, R27):

| Origen | Acción | mensajeroId | Efecto | Destino |
| --- | --- | --- | --- | --- |
| `en_fulfillment` / `en_preparacion` | Generar guía | string (mensajero válido) | `num_guia`=nextval si NULL; `mensajero_asignado_id`=mensajero | `en_espera_aceptacion` |
| `en_fulfillment` / `en_preparacion` | Generar guía | `null` | `num_guia`=nextval si NULL; `mensajero_asignado_id`=NULL | `en_bodega` |
| `en_bodega` | Asignar mensajero | string (mensajero válido) | `mensajero_asignado_id`=mensajero (num_guia ya existe, no se toca) | `en_espera_aceptacion` |

- `num_guia` se asigna a TODAS las órdenes del lote de "Generar guía", incluidas las que
  van a `en_bodega` (R19, decisión 2).
- La transición de bodega NO reasigna `num_guia` (esas órdenes ya lo tienen del paso de
  "Generar guía"; idempotencia R5).
- Cualquier origen distinto a los permitidos → rechazo sin efectos (R27/R29).

---

## 3. Capa de servicio

Nuevo `lib/services/GuiaAsignacionService.ts` (implementa
`lib/interfaces/services/IGuiaAsignacionService.ts`). Separado de `OrdenService` (CRUD)
porque su lógica de negocio es distinta (transición por lote transaccional + secuencia),
patrón de un servicio por responsabilidad.

Autorización (R11–R14), antes de tocar datos:
- `actor.rol !== "maestro"` → `{ status: "forbidden" }` (admin, adminTienda, mensajero,
  otros). `admin` conserva lectura por las acciones de listado existentes (`OrdenService.listar`),
  no por este servicio de escritura.

### 3.1 `generarGuia(input, actor)` (R18–R25, R27–R29)

Input (contrato I/O, decisión 5, R24):
```ts
interface GenerarGuiaDecision { ordenId: string; mensajeroId: string | null; }
interface GenerarGuiaInput { decisiones: GenerarGuiaDecision[]; } // lote mixto en una llamada
```

Resultado de dominio (discriminado, patrón repo):
```ts
type GenerarGuiaServiceResult =
  | { status: "ok"; resultados: Array<{ ordenId: string; numGuia: number; estado: string }> }
  | { status: "forbidden" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "conflict"; detalle: Array<{ ordenId: string; motivo: string }> };
```

Algoritmo (dentro de UNA transacción Prisma, R25):
1. Autorización de rol (R11–R13).
2. Precarga: las órdenes por `ordenId` (excluyendo `deleted_at`), y el conjunto de
   `usuario` con rol `mensajero` para validar los `mensajeroId` no nulos (R28, SIN filtro
   de zona → ver Límites).
3. Validar por orden: existe, no borrada, estado de origen ∈ {`en_fulfillment`,
   `en_preparacion`} (R27); `mensajeroId` (si no nulo) es mensajero válido (R28). Fallo →
   se acumula en `conflict.detalle`/`validation_error` y se ABORTA la transacción (R25/R29):
   no se numera parcialmente.
4. Resolver `estatusId` de `en_espera_aceptacion` y `en_bodega` por `value` (guarda
   defensiva si falta el seed, patrón `OrdenService`/`BulkOrdenService`).
5. Para cada orden elegible:
   - Asignar `num_guia = nextval('orden_num_guia_seq')` solo si `num_guia IS NULL`
     (`UPDATE orden SET num_guia = nextval(...) WHERE id = $1 AND num_guia IS NULL`), R19/R5.
   - `mensajeroId !== null` → `mensajero_asignado_id = mensajeroId`, `estatus_id` =
     `en_espera_aceptacion` (R21/R22).
   - `mensajeroId === null` → `mensajero_asignado_id = NULL`, `estatus_id` = `en_bodega` (R23).
6. Commit. Devolver `resultados` con `numGuia` final por orden.

`nextval` se ejecuta vía `repo`/Prisma `$executeRaw` con la secuencia parametrizada por
nombre constante (no interpolar entrada de usuario). La transacción usa
`prisma.$transaction(async (tx) => …)` para que `nextval` y los `UPDATE` compartan
atomicidad.

### 3.2 `asignarDesdeBodega(input, actor)` (R26–R29)

Input:
```ts
interface AsignarBodegaInput { ordenIds: string[]; mensajeroId: string; } // un mensajero para el lote
```
Algoritmo (transaccional):
1. Autorización (solo `maestro`).
2. `mensajeroId` debe ser mensajero válido (R28); si no, `validation_error`.
3. Cada orden: existe, no borrada, estado de origen = `en_bodega` (R27); si no,
   `conflict` y aborta.
4. `UPDATE`: `mensajero_asignado_id = mensajeroId`, `estatus_id` = `en_espera_aceptacion`.
   NO se toca `num_guia` (ya asignado; R5/R26).

### 3.3 Repository (`IOrdenRepository` / `OrdenRepository`)

Métodos nuevos (o extensión del repo de órdenes):
- `findByIdsForTransicion(ids): Array<{ id; estatusValue; numGuia: number|null; deletedAt }>`
- `findMensajeroIds(ids): Set<string>` (usuarios con rol `mensajero`) — SIN filtro de zona.
- `asignarGuiaYTransicion(tx, ordenId, { estatusId, mensajeroAsignadoId, asignarGuia })` →
  hace el `UPDATE ... num_guia = nextval(...) WHERE num_guia IS NULL` cuando `asignarGuia`.
- Ejecuta bajo `prisma.$transaction`.

`createManyOrdenes` (feature 15) y `create` (feature 6) DEBEN dejar de depender del
DEFAULT del SERIAL; con el default eliminado insertan `num_guia = NULL` automáticamente
(no envían la columna). No requieren código nuevo salvo verificar que no pasan `num_guia`.

---

## 4. Capa de acción (Server Actions) y UI

`lib/actions/ordenes-guia.ts` (`'use server'`), patrón `lib/actions/ordenes.ts`:
- `generarGuia(input: unknown, deps)`: resuelve actor (`unauthenticated` si falta, R14),
  valida `input` con zod (`generarGuiaSchema`: array de `{ ordenId: string.min(1),
  mensajeroId: string.min(1).nullable() }`), instancia el service, devuelve resultado.
  Errores → `withErrorHandler` + `toActionError` (feature 10/11).
- `asignarDesdeBodega(input: unknown, deps)`: análogo con `asignarBodegaSchema`.

UI (`app/(app)/ordenes/…`, Server Component que valida rol por `cookies()` y pasa datos a
componentes `private/` por props):
- Apartados/tabs separados por estado: `en_fulfillment`, `en_preparacion`,
  `en_espera_aceptacion`, `en_bodega` (R15/R16). Reutiliza DataTable (feature 7) +
  Paginación (feature 8) por apartado, filtrando `estatusId` por `value`.
- Selección múltiple por checkbox (R17). Botón "Generar guía" habilitado en los apartados
  de revisión (R18); botón "Asignar mensajero" en el apartado `en_bodega`.
- Modal async (feature 13): al "Generar guía" agrupa la selección en (a) con
  `mensajero_sugerido_id` (preselecciona el sugerido, permite override o "sin mensajero")
  y (b) sin sugerido (elige mensajero o deja "sin") (R20). Al confirmar, construye
  `decisiones: [{ ordenId, mensajeroId | null }]` y hace UNA llamada a `generarGuia` (R24).
- `admin`: la UI renderiza los apartados en solo-lectura (sin botones de acción); el
  backend igualmente rechaza escrituras (R12, defensa en profundidad).
- Toast (feature 11) con el resumen (`n` guías generadas, `m` a espera, `k` a bodega) o el
  error de dominio.

Contrato de lista de mensajeros para el modal: acción/loader que devuelve TODOS los
usuarios con rol `mensajero` (sin filtro de zona, R28). La feature 30 cambiará el cuerpo
de ese loader sin alterar la firma consumida por el modal.

---

## 5. Alternativas descartadas

### A. Mecanismo de `num_guia`: contador en tabla propia con `SELECT ... FOR UPDATE` (DESCARTADA)
Mantener un contador aplicativo (`guia_counter(id, valor)`) y bloquear la fila para
incrementarlo. **Descartada** porque: (1) introduce contención/serialización manual y una
tabla nueva con su RLS; (2) reimplementa lo que Postgres ya garantiza con una SEQUENCE
(atomicidad y unicidad sin bloqueo de fila); (3) el SERIAL de la feature 6 YA dejó
`orden_num_guia_seq` viva — reutilizarla evita crear infraestructura y preserva la
continuidad de la numeración histórica. → Elegido: `nextval` sobre la secuencia
existente desligada (`OWNED BY NONE`).

### B. `num_guia` asignado solo a las órdenes que van a mensajero (DESCARTADA)
No numerar las órdenes que caen en `en_bodega` hasta que salgan de bodega. **Descartada**
por decisión 2 (APROBADA): la guía debe existir con independencia de la aceptación, para
que la orden sea rastreable desde que el maestro la procesa. Numerar todo el lote también
simplifica la idempotencia (R5) y evita un segundo momento de numeración en bodega.

### C. Reutilizar `mensajero_sugerido_id` como campo de asignación (DESCARTADA)
Sobrescribir `mensajero_sugerido_id` con el mensajero definitivo, sin columna nueva.
**Descartada** por decisión 4 (APROBADA): se perdería la trazabilidad SUGERIDO (carga
masiva) vs ASIGNADO (maestro), que la feature 36 necesita para comparar/auditar. → Campo
`mensajero_asignado_id` separado.

### D. Reutilizar `OrdenService.actualizar` para las transiciones (DESCARTADA)
Empujar las transiciones por el `actualizar` existente (que ya toca `estatusId`).
**Descartada** porque `actualizar` no ofrece transacción por lote, ni asignación de
secuencia, ni guardia por estado de origen específica de este flujo; mezclar ambos
degradaría un servicio CRUD estable. → Servicio dedicado `GuiaAsignacionService`.

---

## 6. Notas de riesgo para el implementer (no bloquean el spec)

- **Barrido de tipos `numGuia` (R30):** al pasar a `number | null`, revisar TODOS los
  consumidores de features 6/7 (tipos de dominio `lib/types/orden.ts`, serializadores del
  listado, componentes de tabla) para tratar el `null` (mostrar "pendiente"/vacío). Un
  `strict` compile-error aquí es esperado y debe resolverse, no silenciarse.
- **`down.sql` falla con guías NULL:** documentado en R6/§1.1; es intencional. El
  runner de rollback debe reportar el fallo claramente.
- **Solape con feature 15:** `createManyOrdenes` inserta `num_guia` NULL tras quitar el
  default; confirmar que el repo no envía la columna y que los tests de carga masiva
  siguen verdes salvo por el valor NULL de guía (R31).
- **Feature 30 restringe mensajeros luego:** mantener el contrato de la lista de
  mensajeros y del `mensajeroId` estable para que la 30 solo cambie el cuerpo del loader.
- **`ALTER TYPE ADD VALUE` fuera de transacción:** ver nota en §1.1.
