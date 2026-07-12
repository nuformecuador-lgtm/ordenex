# Implementación — Feature 17: revisión maestro / generar guía / asignación mensajero

> **ESTADO: COMPLETO (backend + frontend), T0-T20.** Suite completa en verde
> (1239/1239). Coordinado por el `implementer`: `backend_dev` (bloques 0-5 +
> loaders de soporte) → `frontend_dev` (bloque 6 + T2/T8-UI). Migración creada
> pero NO aplicada contra Postgres real (deuda de despliegue explícita, ver
> "Deuda / notas").

## Resumen ejecutivo (T20)

Qué se construyó:
- **Migración** `db/migrations/20260711130000_orden_num_guia_deferred_mensajero_asignado_espera_aceptacion/`
  (`migration.sql` + `down.sql`): `orden.num_guia` pasa a NULLABLE sin default,
  secuencia `orden_num_guia_seq` desligada (`OWNED BY NONE`) para reutilizar
  `nextval` manualmente; nueva columna `orden.mensajero_asignado_id` (FK→usuario,
  nullable, ON DELETE SET NULL, índice); estado `en_espera_aceptacion` al enum
  `order_status_value` + fila de catálogo. `down.sql` con advertencia (falla si
  hay guías NULL) y borrado condicional del catálogo.
- **Estado nuevo** `en_espera_aceptacion` (9.º de `ORDER_STATUS_SEED`, fuente de verdad).
- **Servicio** `GuiaAsignacionService` (`generarGuia`, `asignarDesdeBodega`):
  autorización solo `maestro`; guardia por estado de origen; transacción por lote;
  `num_guia = nextval` a todas las elegibles (idempotente `WHERE num_guia IS NULL`);
  destino `en_espera_aceptacion` (con mensajero) o `en_bodega` (sin). Repo dueño de
  `$transaction` (el service no importa Prisma).
- **Server Actions** `lib/actions/ordenes-guia.ts`: `generarGuia`, `asignarDesdeBodega`,
  `listarMensajerosParaAsignacion` (todos los rol `mensajero`, sin filtro de zona),
  `listarCatalogoEstatus` (loader value→id).
- **UI del maestro** (`app/(app)/ordenes/`): `page.tsx` gatea por rol; 4 apartados
  separados (`en_fulfillment`, `en_preparacion`, `en_espera_aceptacion`, `en_bodega`)
  vía `OrdenesRevisionMaestro` + `OrdenesApartado` (DataTable+Pagination+checkbox);
  `GenerarGuiaModal` (agrupa por sugerido, override, UNA llamada) y
  `AsignarBodegaModal`; Toast + refresco SWR; `admin` en solo-lectura.

Rango R cubierto: **R0-R32** (todos con test; ver tabla de trazabilidad completa).
Tests de features previas tocados por el cambio de `num_guia` a nullable: **~13**
(`order-status`/`seed-order-status`, `orden-repository`/`.bulk`, `orden-service`,
`asignacion-mensajero-service`, `bulk-orden-service`, `rol-admin-satelite-authz`
—stubs de métodos nuevos—, `order-status-enum-migration`, y los tests de
migraciones previas que excluyen la carpeta nueva del filtro "no se modificó
migración previa"); en frontend, 3 tests de `OrdenesPage`/pagination/reuse por el
cambio de `page.tsx` a Server Component async.

Verificación final (T20, salida real):
- `pnpm run typecheck` → **0 errores**.
- `pnpm run lint` → **0 errores** (135 warnings preexistentes en `.claude/skills`, ajenos).
- `pnpm test` → **152 archivos, 1239 tests, todos verdes** (38s).
- `./init.sh` → **== init OK ==** (incluye "todas las migraciones tienen down.sql").

Deuda / notas:
- La migración NO se aplicó contra Postgres real (no hay DB en el entorno; deuda de
  despliegue explícita del encargo). Los tests de DB son aserciones estáticas sobre
  el SQL + unit con Prisma/`$transaction` mockeado.
- `down.sql` de `num_guia`→NOT NULL **falla intencionalmente** si existen órdenes con
  `num_guia = NULL` (documentado; el operador resuelve esos datos antes de revertir).
- `ALTER TYPE ADD VALUE` no puede ir en transacción en Postgres antiguo (documentado
  en la migración; `IF NOT EXISTS` lo hace idempotente).
- Fuera de alcance (respetado): filtro por zona/GAM y ruteo a bodega satélite
  (feature 30); rechazo/aceptación del mensajero (feature 36 — aquí solo se deposita
  en `en_espera_aceptacion`).

### Tabla de trazabilidad completa R→test (T20/R32)
| Req | Test |
|---|---|
| R0  | revisión documental (reviewer): puerta F1.4 APROBADA en `requirements.md` |
| R1  | `tests/unit/db/orden-num-guia-deferred.test.ts` (num_guia nullable, sin default, UNIQUE) |
| R2  | `tests/unit/repositories/orden-repository.test.ts`, `orden-repository.bulk.test.ts` |
| R3  | `tests/unit/db/orden-num-guia-deferred.test.ts` (`OWNED BY NONE`) |
| R4  | `tests/unit/services/guia-asignacion-service.test.ts` (num_guia único/incremental) |
| R5  | `tests/unit/repositories/orden-repository.guia.test.ts` (`WHERE num_guia IS NULL`) |
| R6  | `tests/unit/db/orden-num-guia-deferred.test.ts` (down.sql: advertencia guías NULL) |
| R7  | `tests/unit/db/orden-num-guia-deferred.test.ts` (FK nullable ON DELETE SET NULL + índice) |
| R8  | `tests/unit/repositories/orden-repository.test.ts`, `orden-repository.bulk.test.ts` |
| R9  | `tests/unit/types/order-status.test.ts` (9 valores + seed idempotente) |
| R10 | `tests/unit/db/orden-num-guia-deferred.test.ts`, `tests/integration/db/order-status-enum-migration.test.ts` |
| R11 | `tests/unit/services/guia-asignacion-service.test.ts` (maestro ok) |
| R12 | `tests/integration/actions/ordenes-guia-action.test.ts` (admin escritura→forbidden); UI: `tests/components/OrdenesRevisionMaestro.test.tsx` (readOnly) |
| R13 | `tests/unit/services/guia-asignacion-service.test.ts` (otros roles→forbidden) |
| R14 | `tests/integration/actions/ordenes-guia-action.test.ts` (sin actor→unauthenticated) |
| R15 | `tests/components/OrdenesRevisionMaestro.test.tsx` (apartados en_fulfillment/en_preparacion separados) + loader `orden-repository.guia.test.ts`/`ordenes-guia-action.test.ts` |
| R16 | `tests/components/OrdenesRevisionMaestro.test.tsx` (apartados en_espera_aceptacion/en_bodega) |
| R17 | `tests/components/OrdenesRevisionMaestro.test.tsx` (selección múltiple por checkbox) |
| R18 | `tests/components/OrdenesRevisionMaestro.test.tsx` (botón Generar guía en revisión) + `guia-asignacion-service.test.ts` (ambos orígenes) |
| R19 | `tests/unit/services/guia-asignacion-service.test.ts` (todas reciben num_guia, incl. bodega) |
| R20 | `tests/components/GenerarGuiaModal.test.tsx` + `tests/unit/repositories/orden-repository.test.ts` (mensajeroSugeridoId en DTO) |
| R21 | `tests/unit/services/guia-asignacion-service.test.ts` (sugerido→en_espera_aceptacion) |
| R22 | `tests/unit/services/guia-asignacion-service.test.ts` (override→en_espera_aceptacion) |
| R23 | `tests/unit/services/guia-asignacion-service.test.ts` (sin mensajero→en_bodega con guía) |
| R24 | `tests/components/GenerarGuiaModal.test.tsx` (una llamada, lote mixto) + `guia-asignacion-service.test.ts` |
| R25 | `tests/unit/services/guia-asignacion-service.test.ts`, `orden-repository.guia.test.ts` (atomicidad) |
| R26 | `tests/components/AsignarBodegaModal.test.tsx` + `tests/unit/services/guia-asignacion-service.test.ts` |
| R27 | `tests/unit/services/guia-asignacion-service.test.ts` (origen inválido→rechazo sin efectos) |
| R28 | `tests/integration/actions/ordenes-guia-action.test.ts`, `orden-repository.guia.test.ts` (lista sin filtro de zona) |
| R29 | `tests/unit/services/guia-asignacion-service.test.ts` (orden inexistente/borrada/estado inválido) |
| R30 | `tests/unit/repositories/orden-repository.test.ts`, `tests/unit/components/ordenes-columns.test.tsx` (guía "Pendiente") |
| R31 | `tests/unit/services/bulk-orden-service.test.ts`, `orden-repository.bulk.test.ts` (carga masiva verde salvo num_guia NULL) |
| R32 | esta tabla (reviewer valida cobertura completa) |

---

## Bitácora detallada por sesión (histórico)

> Backend puro (bloques 0-5 de `tasks.md`). NO toca UI (bloque 6, T16-T19,
> pendiente de `frontend_dev`). T2 (label `en_espera_aceptacion` en
> `estatus-label.ts`/`EstatusBadge.tsx`) también queda para `frontend_dev`; es
> el único fallo conocido de la suite (`tests/components/EstatusLabel.test.ts`).

## Alcance de esta sesión (soporte R15/R16 para la UI del maestro)

La UI agrupa órdenes por `value` de estado (`en_fulfillment`, `en_preparacion`,
`en_espera_aceptacion`, `en_bodega`) pero `listarOrdenes` (feature 6/7) filtra
por `estatusId` (uuid FK). Se añadió un loader de solo lectura del catálogo
`order_status` para que la UI resuelva `value -> estatusId` sin tocar el
contrato de `listarOrdenes`.

### Archivos tocados (esta sesión)
- `lib/interfaces/repositories/IOrdenRepository.ts` — tipo `OrderStatusLiteRow`
  y método `listOrderStatus(): Promise<OrderStatusLiteRow[]>`.
- `lib/repositories/OrdenRepository.ts` — implementación con
  `prisma.orderStatus.findMany({ select: { id: true, value: true } })`.
- `lib/types/orden-guia.ts` — `EstatusLiteDTO` y
  `ListarCatalogoEstatusResult` (`ok | unauthenticated | forbidden`).
- `lib/actions/ordenes-guia.ts` — `listarCatalogoEstatus(deps?)`, mismo patrón
  que `listarMensajerosParaAsignacion` (resuelve actor, `UnauthenticatedError`
  si falta, `maestro`/`admin` -> ok, resto -> forbidden).
- `tests/unit/repositories/orden-repository.guia.test.ts` — test de
  `listOrderStatus` (mapea id/value).
- `tests/integration/actions/ordenes-guia-action.test.ts` — tests de
  `listarCatalogoEstatus` (unauthenticated sin actor, ok maestro/admin,
  forbidden resto).
- Stubs de `IOrdenRepository` en tests (se agregó `listOrderStatus: vi.fn()`
  para que sigan compilando): `tests/unit/services/asignacion-mensajero-service.test.ts`,
  `tests/unit/services/bulk-orden-service.test.ts`,
  `tests/unit/services/guia-asignacion-service.test.ts`,
  `tests/unit/services/orden-service.test.ts`,
  `tests/unit/services/rol-admin-satelite-authz.test.ts`.

### Firma exacta del loader (para `frontend_dev`)
```ts
// lib/actions/ordenes-guia.ts
export interface ListarCatalogoEstatusDeps {
  ordenRepo?: Pick<IOrdenRepository, "listOrderStatus">;
  getActor?: () => Promise<Actor | null>;
}

export async function listarCatalogoEstatus(
  deps: ListarCatalogoEstatusDeps = {},
): Promise<ListarCatalogoEstatusResult>;

// lib/types/orden-guia.ts
export interface EstatusLiteDTO { id: string; value: string }
export type ListarCatalogoEstatusResult =
  | { status: "ok"; estatus: EstatusLiteDTO[] }
  | { status: "unauthenticated" }
  | { status: "forbidden" };
```
Uso esperado en la UI: `listarCatalogoEstatus()` una vez, construir un mapa
`value -> id`, y seguir llamando `listarOrdenes({ where: { estatusId } })` sin
cambios (contrato feature 6/7 intacto).

## R -> test (soporte de esta sesión)
| Requisito | Test |
|---|---|
| R15/R16 (listar por estado en la UI del maestro; loader de soporte) | `tests/unit/repositories/orden-repository.guia.test.ts` → `describe("OrdenRepository.listOrderStatus (R15/R16)")`; `tests/integration/actions/ordenes-guia-action.test.ts` → `describe("R15/R16: listarCatalogoEstatus ...")` (ok maestro/admin, forbidden resto) y `describe("R14: sin sesion valida ...")` → caso `listarCatalogoEstatus` (unauthenticated). |

## R -> test (trabajo previo de la sesión, bloques 0-5, ya en el working tree)
| Requisito | Test |
|---|---|
| R1 (num_guia nullable, sin default) | `tests/unit/db/orden-num-guia-deferred.test.ts` |
| R3 (secuencia `orden_num_guia_seq` OWNED BY NONE) | `tests/unit/db/orden-num-guia-deferred.test.ts` |
| R4/R7 (mensajero_asignado_id FK nullable ON DELETE SET NULL + índice) | `tests/unit/db/orden-num-guia-deferred.test.ts` |
| R9/R10 (`en_espera_aceptacion` en catálogo/enum) | `tests/unit/types/order-status.test.ts`, `tests/integration/db/order-status-enum-migration.test.ts` |
| R2/R8 (create/createMany no envían num_guia) | `tests/unit/repositories/orden-repository.test.ts`, `orden-repository.bulk.test.ts` |
| R11/R13/R18/R19/R21-R25/R27-R29 (GuiaAsignacionService.generarGuia) | `tests/unit/services/guia-asignacion-service.test.ts` |
| R26-R29 (asignarDesdeBodega) | `tests/unit/services/guia-asignacion-service.test.ts` |
| R12/R14 (actions generarGuia/asignarDesdeBodega) | `tests/integration/actions/ordenes-guia-action.test.ts` |
| R28/T15 (listarMensajerosParaAsignacion) | `tests/integration/actions/ordenes-guia-action.test.ts`, `tests/unit/repositories/orden-repository.guia.test.ts` |
| R5/R25 (idempotencia num_guia, atomicidad del lote) | `tests/unit/repositories/orden-repository.guia.test.ts` |

> Bloque 6 (T16-T19, UI) y T2 (label) quedan para `frontend_dev`; T20 (cierre
> con tabla R->test completa contra `requirements.md`) se completa cuando el
> frontend termine.

## Verificación
- `pnpm run typecheck`: **verde salvo el fallo conocido de T2** (4 errores
  preexistentes en `app/(app)/ordenes/_components/estatus-label.ts`,
  `EstatusBadge.tsx` y `tests/components/EstatusLabel.test.ts` por el nuevo
  valor `en_espera_aceptacion` — fuera de alcance de `backend_dev`, resuelve
  `frontend_dev` en T2). Sin errores nuevos.
- `pnpm run lint`: **0 errores**, 135 warnings preexistentes (no relacionados,
  en `.claude/skills/impeccable/scripts/*`).
- `pnpm test`: **1222/1223 verde**; único fallo es
  `tests/components/EstatusLabel.test.ts` (mismo motivo que typecheck, T2
  pendiente de frontend_dev).

## Veredicto
Backend completo para el soporte R15/R16 (loader `listarCatalogoEstatus` +
`OrdenRepository.listOrderStatus`); suite verde salvo el fallo conocido y ya
delegado (T2/UI) — listo para que `frontend_dev` consuma el loader.

## Sesión adicional — soporte R20 (modal "Generar guía": agrupar por sugerido)

`OrdenListItemDTO` no exponía `mensajeroSugeridoId`/`mensajeroAsignadoId`, y la
UI del modal necesita agrupar la selección en (a) órdenes CON sugerido y (b)
SIN, además de mostrar el mensajero asignado en `en_espera_aceptacion`/
`en_bodega`. Cambio aditivo, sin migración (los escalares ya existen en
`Orden` desde features 15/17; `WITH_ESTATUS_Y_TIENDA` usa `include`, que no
restringe escalares, así que ya venían en el row).

### Archivos tocados
- `lib/types/orden.ts` — `OrdenListItemDTO` gana `mensajeroSugeridoId?: string
  | null` y `mensajeroAsignadoId?: string | null`. Opcionales (no requeridos)
  para no romper los mocks tipados de `tests/components/*.test.tsx` (fuera de
  mi alcance como backend_dev); el repositorio SIEMPRE los envía. `OrdenDTO`
  base NO se tocó (solo el item de listado).
- `lib/repositories/OrdenRepository.ts` — `toListItemDTO` mapea
  `row.mensajeroSugeridoId`/`row.mensajeroAsignadoId`.
- `tests/unit/repositories/orden-repository.test.ts` — `ordenRow()` agrega
  defaults `mensajeroSugeridoId: null, mensajeroAsignadoId: null`; nuevo test
  `"R20: mapea mensajeroSugeridoId y mensajeroAsignadoId en el DTO del
  listado"` (una orden con ambos ids, otra con ambos null).

### R -> test
| Requisito | Test |
|---|---|
| R20 (agrupación por sugerido/asignado en el modal "Generar guía") | `tests/unit/repositories/orden-repository.test.ts` → `describe("OrdenRepository.list (R30/R31/R34)")` → `"R20: mapea mensajeroSugeridoId y mensajeroAsignadoId en el DTO del listado"` |

### Verificación
- `pnpm run typecheck`: mismo fallo preexistente de T2 (4 errores en
  `estatus-label.ts`/`EstatusBadge.tsx`/`EstatusLabel.test.ts` por
  `en_espera_aceptacion`), sin errores nuevos.
- `pnpm run lint`: 0 errores, 135 warnings preexistentes (no relacionados).
- `pnpm test`: 1223/1224 verde; único fallo es el mismo conocido
  `tests/components/EstatusLabel.test.ts`.

### Veredicto (sesión adicional)
`OrdenListItemDTO` expone `mensajeroSugeridoId`/`mensajeroAsignadoId` de forma
aditiva y verde en toda la suite salvo el fallo conocido de T2/frontend.
