# Feature 101 — Diseño técnico

Decisiones de implementación para R1–R12. Fullstack de baja complejidad,
ADITIVO sobre features 99 y 100 (ya en `dev`). Todo verificado contra el código
real.

## 0. Resumen de la decisión

Un único flag booleano `orden.prioridad` (default `false`) que:
- lo **enciende** el cron SLA al liberar por `not_found` (99), y
- lo **apaga** la reasignación a mensajero desde bodega (central o satélite),

y que el listado de reasignación de la bodega dueña usa para **ordenar
prioridad-first** y **resaltar la fila**. Sin tabla nueva, sin estado nuevo, sin
RLS nueva.

## 1. Modelo de datos

### 1.1 Columna
- `orden.prioridad BOOLEAN NOT NULL DEFAULT false`.
- Prisma (`db/schema.prisma`, modelo `Orden`): `prioridad Boolean @default(false) @map("prioridad")`.
- **RLS:** `orden` ya tiene `ENABLE ROW LEVEL SECURITY` (solo service-role, sin
  policies; migración `20260709130100_ordenes`). No se toca (R12).
- **Índice:** ninguno nuevo. La consulta caliente
  (`WHERE deleted_at IS NULL AND estatus_id = <en_bodega> ORDER BY prioridad DESC,
  created_at DESC`) ya está acotada por `orden_estatus_id_idx`; `prioridad` actúa
  como desempate booleano sobre una página pequeña. Si `en_bodega` creciera mucho,
  el follow-up sería un índice compuesto `(estatus_id, prioridad, created_at)`;
  no se añade ahora (baja complejidad, volumen bajo).

### 1.2 Migración
- Carpeta: `db/migrations/20260722120000_orden_prioridad/`
  - `migration.sql` (UP): `ALTER TABLE "orden" ADD COLUMN "prioridad" BOOLEAN NOT NULL DEFAULT false;`
    Comentario aclarando que es aditiva y que la RLS de `orden` no cambia (patrón
    de `20260716120000_orden_asignado_at`).
  - `down.sql` (DOWN): `ALTER TABLE "orden" DROP COLUMN IF EXISTS "prioridad";`
- Añadir NOT NULL con DEFAULT constante NO reescribe la tabla en Postgres ≥ 11.
- **Sin backfill (R11):** todas las filas existentes quedan en `false`.

## 2. Backend — encendido (R2/R3/R4)

Punto exacto: `lib/repositories/DevolucionSlaRepository.liberarDevueltaSla`.
El `updateMany` guardado por `estatus_id = devuelta` añade `prioridad: true` a su
`data` (junto a `estatusId`, `mensajeroAsignadoId: null`, `asignadoAt: null`).
Por ser un `updateMany` guardado, sólo las filas que aún están en `devuelta` se
tocan; una re-corrida (`count = 0`) no cambia nada (R4).

- `escalarDevueltaSla` (→ `rechazada`): NO se toca → R3.
- Recuperación manual de la feature 100 (`RecuperacionBodegaRepository`,
  `origen_tipo = recuperacion_manual`): NO se toca → R3.

Interfaces/servicio: sin cambios de firma. `LiberarDevueltaSlaInput` y
`DevolucionSlaService` no cambian: el flag es una decisión FIJA del repo (siempre
`true` al liberar), no un parámetro del service. Esto evita propagar el concepto
por toda la capa de negocio.

## 3. Backend — apagado (R5)

Los dos writers de `mensajero_asignado_id` que reasignan desde bodega apagan el
flag en la MISMA escritura:

- `OrdenRepository.asignarBodegaLote` (central; lo llama
  `GuiaAsignacionService.asignarDesdeBodega`): el `updateMany` ya fija
  `{ mensajeroAsignadoId, estatusId, asignadoAt: new Date() }` → añadir
  `prioridad: false`.
- `OrdenRepository.asignarSateliteLote` (satélite; lo llama
  `AsignacionSateliteService.asignar`): el `UPDATE ... RETURNING id` crudo ya fija
  `mensajero_asignado_id`, `asignado_at`, `estatus_id`, `updated_at` → añadir
  `"prioridad" = false` en el `SET`.

`generarGuiaLote` NO se toca: sus orígenes (`en_fulfillment`/`en_preparacion`) no
contienen órdenes prioritarias.

## 4. Contratos I/O — exposición del flag (R9)

- `lib/types/orden.ts`
  - `OrdenDTO`: `prioridad?: boolean` (opcional, patrón aditivo ya usado por
    `mensajeroAsignadoId?`, `zonaEsGam?`: no rompe mocks/fixtures; el repo siempre
    lo envía).
  - `OrdenListItemDTO` lo hereda de `OrdenDTO`.
- `lib/repositories/OrdenRepository.ts`
  - `toDTO`: añadir `prioridad: row.prioridad` (el `include` de `WITH_ESTATUS` no
    restringe escalares, así que `row.prioridad` está disponible).
- `lib/interfaces/services/IRecepcionSateliteService.ts` — `RecepcionSateliteDTO`:
  añadir `prioridad: boolean` (requerido; la DTO satélite es totalmente requerida,
  se actualizan sus fixtures de test).
- `lib/interfaces/repositories/IOrdenRepository.ts` — `RecepcionSateliteRow`:
  añadir `prioridad: boolean`.
- `OrdenRepository.ts`:
  - `WITH_RECEPCION_SATELITE.select`: añadir `prioridad: true` (es un `select`,
    hay que pedirlo explícitamente).
  - `toRecepcionSateliteRow`: propagar `prioridad`.

No hay endpoints ni Server Actions nuevos: `listarOrdenes` y el listado satélite
ya existen; solo cambia su ordenación y el shape del DTO (aditivo).

## 5. Orden prioridad-first (R6/R7)

- **Central** — `OrdenRepository.list`: cambiar
  `orderBy = { [SORT_COLUMN[sortBy]]: sortDir }`
  por `orderBy = [{ prioridad: "desc" }, { [SORT_COLUMN[sortBy]]: sortDir }]`.
  Global al listado, pero inocuo fuera de `en_bodega` (sólo ahí hay
  `prioridad = true`).
- **Satélite** — `OrdenRepository.findRecepcionSateliteByZona`: añadir
  `orderBy: [{ prioridad: "desc" }, { createdAt: "desc" }]` al `findMany` (hoy no
  tiene `orderBy`). Sólo el grupo "Recibidas" (`en_bodega_satelite`) tiene
  prioritarias; los demás grupos que devuelve el mismo query no se ven afectados.

El orden se hace en la QUERY (no en memoria) para que respete la paginación:
una orden prioritaria debe flotar a la primera página, no quedar atrapada en la
página 2.

## 6. Frontend — resalte de fila (R8/R10)

`components/shared/DataTable.tsx` gana una prop OPCIONAL
`rowClassName?: (row: T) => string | undefined`, aplicada al `<tr>` de datos
(hoy fijo `className="border-b"`). Sin la prop, comportamiento idéntico
(retrocompatible). Consumidores:

- **Central** — `OrdenesModule` pasa
  `rowClassName={(row) => row.prioridad ? "<clase-resalte>" : undefined}` a su
  `DataTable`. Como sólo las filas `en_bodega` liberadas por SLA traen
  `prioridad = true`, no hay resalte en otras tabs (R10).
- **Satélite** — `RecepcionSateliteModule` pasa el mismo `rowClassName` al
  `DataTable` de "Recibidas".

Color/accesibilidad: usar los tokens semánticos existentes (p. ej. la familia
`warning`/`-strong` ya usada en el módulo satélite) para el fondo de la fila, y
añadir un texto accesible (celda `sr-only` o `aria-label`/badge "Prioritaria")
para no depender sólo del color (R8). El detalle visual final lo cierra el
implementer con los tokens del repo.

Superficies NO tocadas (R10): `/novedades`, el apartado "Devueltas" de
`/recepcion-satelite` (recuperación manual, 100) y el portal del mensajero
(`/mis-asignaciones`) — no reciben `rowClassName` ni cambian su orden.

## 7. Alternativas descartadas

- **A. Estado de catálogo nuevo `en_bodega_prioritaria`.** Descartada: duplicaría
  cada estado de bodega, contaminaría la máquina de estados (feature 49), y
  rompería todas las queries/tabs que filtran por `order_status`. Un flag booleano
  ortogonal al estado es mucho más barato y no altera el flujo.
- **B. Tabla/relación aparte para la prioridad.** Descartada: es un atributo 1-a-1
  de la orden, de un solo bit; una tabla nueva exigiría RLS nueva, joins y una
  migración mayor para cero beneficio.
- **C. Sólo una columna "Prioridad" (badge) sin resaltar la fila.** Descartada: el
  requisito aprobado es "resalta su fila (color llamativo)"; un badge en una celda
  no cumple R8. La prop `rowClassName` en `DataTable` es reutilizable y deja el
  badge accesible como complemento, no como sustituto.
- **D. Ordenar prioridad-first en memoria (service o cliente).** Descartada:
  rompería la paginación (una prioritaria en la página 2 no subiría a la 1). El
  orden tiene que ir en la query SQL (`orderBy`).
- **E. Pasar la prioridad como parámetro del `DevolucionSlaService`.** Descartada:
  encender el flag es una consecuencia FIJA de liberar por SLA, no una decisión de
  negocio configurable; fijarlo en el repo (junto al `updateMany` guardado) evita
  propagar el concepto por las firmas del service e interfaces.

## 8. Impacto en tests existentes (feature 99)

`tests/unit/repositories/devolucion-sla-repository.test.ts` afirma hoy
`expect(upd.data).toEqual({ estatusId, mensajeroAsignadoId: null, asignadoAt: null })`
para la liberación. Se AJUSTA a incluir `prioridad: true` (no se afloja el
`toEqual`). Los tests de `escalarDevueltaSla` y de la recuperación manual (100)
deben seguir verdes SIN cambios y se refuerzan con la aserción negativa de R3.
