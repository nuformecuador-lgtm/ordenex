# impl — Feature 30 · Asignación por zona (GAM) y ruteo a bodega satélite (FULLSTACK)

> Alcance: fullstack, un ciclo. Backend (types, migración, repos, service, actions) +
> Frontend (UI del maestro: columna Zona, apartado satélite, ruteo, GenerarGuiaModal).
> Backend delegado a `backend_dev`, frontend a `frontend_dev` (ambos con `model: opus`).
> Orden: backend primero (verde) → frontend.

## Archivos creados

- `db/migrations/20260711140000_order_status_en_ruta_bodega_satelite/migration.sql` — ADD VALUE + INSERT catálogo (R2).
- `db/migrations/20260711140000_order_status_en_ruta_bodega_satelite/down.sql` — DELETE condicional; documenta que el enum no se depura (R2/R21).
- `tests/integration/db/order-status-satelite-migration.test.ts` — cobertura estática migración (R2/R20/R21).
- `tests/unit/types/orden-list-dto-zona.test.ts` — DTO listado aditivo (R19).

## Archivos modificados (backend)

- `lib/types/order-status.ts` — 10.º valor `en_ruta_bodega_satelite` en `ORDER_STATUS_SEED` (R1).
- `lib/interfaces/repositories/IZonaRepository.ts` — `findGamZonaId()` (R3).
- `lib/repositories/ZonaRepository.ts` — impl `findGamZonaId` (R3).
- `lib/interfaces/repositories/IOrdenRepository.ts` — `OrdenTransicionRow` += `zonaId`/`zonaEsGam`; `findMensajerosGam`, `findMensajeroIdsValidosGam`, `rutearBodegaSateliteLote` (R5/R6/R8/R9/R10/R11/R12/R13).
- `lib/repositories/OrdenRepository.ts` — proyección zona en `findByIdsForTransicion` + listado (`WITH_ESTATUS_Y_TIENDA`/`toListItemDTO`); `findMensajerosGam`/`findMensajeroIdsValidosGam`/`rutearBodegaSateliteLote` (R5/R6/R8/R9/R10/R13/R14).
- `lib/types/orden.ts` — `OrdenListItemDTO` += `zonaNombre?`/`zonaEsGam?` (aditivo, R14/R19).
- `lib/interfaces/services/IGuiaAsignacionService.ts` — tipos + método `rutearABodegaSatelite` (R13/R16/R17).
- `lib/services/GuiaAsignacionService.ts` — constructor `(repo, zonaRepo)`; `generarGuia`/`asignarDesdeBodega` extendidos; `rutearABodegaSatelite` nuevo (R4/R6/R8/R9/R10/R11/R12/R13/R16/R17/R18).
- `lib/types/orden-guia.ts` — `rutearSateliteSchema`, `RutearSateliteResultadoItem`, `RutearSateliteResult` (R13).
- `lib/actions/ordenes-guia.ts` — `buildGuiaService` inyecta `ZonaRepository`; `listarMensajerosParaAsignacion` filtra GAM; action `rutearABodegaSatelite` (R5/R13/R16/R18).

### Adiciones de compilación forzadas por backend (guard de exhaustividad)

Añadir el 10.º status obliga a completar los `Record<OrderStatusValue,…>`. Cambios mínimos
de una línea (label/clase estática) hechos por backend; el display dinámico por zona (R15)
lo completó frontend (ver abajo):
- `app/(app)/ordenes/_components/estatus-label.ts` — key `en_ruta_bodega_satelite`.
- `app/(app)/ordenes/_components/EstatusBadge.tsx` — label + clases.

## Archivos creados/modificados (FRONTEND — T15/T16/T17)

Creado:
- `app/(app)/ordenes/_components/RutearSateliteModal.tsx` — modal de confirmación de ruteo (R13).

Modificados:
- `app/(app)/ordenes/_components/EstatusBadge.tsx` — prop opcional `zonaNombre`; deriva "En ruta a bodega <zona>" por fila para `en_ruta_bodega_satelite` (R15).
- `app/(app)/ordenes/_components/ordenes-columns.tsx` — columna "Zona" (`zonaNombre`) + paso de `zonaNombre` al badge (R14/R15).
- `app/(app)/ordenes/_components/OrdenesApartado.tsx` — acción secundaria opcional (`secondaryActionLabel`/`onSecondaryAction`).
- `app/(app)/ordenes/_components/OrdenesRevisionMaestro.tsx` — 5.º apartado solo-lectura + botón/modal "Rutear a bodega satélite" (filtra `zonaEsGam === false`) (R13/R15).
- `app/(app)/ordenes/_components/GenerarGuiaModal.tsx` — split GAM/no-GAM por fila; grupo "Se enviarán a la bodega satélite de <zona>" sin select; `mensajeroId=null` para no-GAM; toast de 3 destinos (R7/R8/R9/R11).
- `app/(app)/_components/ordenes-columns-admin-tienda.ts` — excluye "zona" (preserva contrato de 4 columnas de feature 26, R19).

Tests frontend creados/modificados:
- `tests/unit/components/ordenes-columns.test.tsx` — columna zona + badge dinámico (R14/R15).
- `tests/components/GenerarGuiaModal.test.tsx` — no-GAM sin select, `mensajeroId=null` (R7/R8).
- `tests/components/OrdenesRevisionMaestro.test.tsx` — apartado satélite + ruteo (R13/R15).
- `tests/components/OrdenesPage.test.tsx` — actualizado a 6 columnas (fallout esperado de R14).

## Tests modificados (no-regresión / actualización de contadores y mocks)

- `tests/unit/services/guia-asignacion-service.test.ts` — constructor `(repo, zonaRepo)`, mock zonaRepo, `ordenRow` con zona, tests feature 30.
- `tests/integration/actions/ordenes-guia-action.test.ts` — `rutearABodegaSatelite`, loader GAM.
- `tests/unit/repositories/orden-repository.guia.test.ts` / `orden-repository.test.ts` / `zona-repository.test.ts` — nuevos métodos + zona en listado/transición.
- `tests/unit/types/order-status.test.ts`, `tests/unit/scripts/seed-order-status.test.ts`, `tests/integration/db/order-status-enum-migration.test.ts`, `tests/components/EstatusLabel.test.ts` — 9→10 valores.
- `tests/unit/services/{asignacion-mensajero,bulk-orden,orden,rol-admin-satelite-authz,usuario-zona,zona}-service.test.ts` — mocks de interfaz completados con los nuevos métodos.
- `tests/integration/db/{usuario-fulfillment,vehiculos,postulacion-mensajero,zonas}-migration.test.ts` — guard “migración más nueva” excluye la de feature 30.

## Mapa R → test

| R | test (archivo :: nombre) |
| --- | --- |
| R1 | `tests/unit/types/order-status.test.ts` :: "R1: incluye en_ruta_bodega_satelite como 10mo valor"; `tests/unit/scripts/seed-order-status.test.ts` :: "siembra los 10 estatus" |
| R2 | `tests/integration/db/order-status-satelite-migration.test.ts` :: "R2: ALTER TYPE … ADD VALUE" / "R2: inserta la fila de catalogo" |
| R3 | `tests/unit/repositories/zona-repository.test.ts` :: "ZonaRepository.findGamZonaId … devuelve el id / devuelve null" |
| R4 | `tests/unit/services/guia-asignacion-service.test.ts` :: "R4: generarGuia/asignarDesdeBodega/rutearABodegaSatelite sin zona GAM -> validation_error, sin efectos" |
| R5 | `tests/unit/repositories/orden-repository.guia.test.ts` :: "findMensajerosGam … excluye otras zonas y zonaId NULL"; `tests/integration/actions/ordenes-guia-action.test.ts` :: "R5: … SOLO mensajeros de la zona GAM" |
| R6 | `tests/unit/repositories/orden-repository.guia.test.ts` :: "findMensajeroIdsValidosGam … excluye otras zonas/NULL"; `tests/unit/services/guia-asignacion-service.test.ts` :: "R6: mensajero de otra zona … conflict" |
| R7 | `tests/unit/services/guia-asignacion-service.test.ts` :: "R6 …" (generarGuia override + asignarDesdeBodega usan `findMensajeroIdsValidosGam`); loader GAM (R5); `tests/components/GenerarGuiaModal.test.tsx` :: "R7/R8: … grupo bodega satélite" |
| R8 | `tests/unit/services/guia-asignacion-service.test.ts` :: "R8: orden no-GAM con mensajeroId != null -> rechazo, sin efectos" |
| R9 | `tests/unit/services/guia-asignacion-service.test.ts` :: "R9/R10: orden no-GAM … en_ruta_bodega_satelite, mensajeroAsignadoId NULL" |
| R10 | `tests/unit/repositories/orden-repository.guia.test.ts` :: "rutearBodegaSateliteLote … num_guia idempotente"; service "R9/R10 …" |
| R11 | `tests/unit/services/guia-asignacion-service.test.ts` :: "R11: lote mixto … UNA sola llamada" / "R11/R17: … todo-o-nada" |
| R12 | `tests/unit/services/guia-asignacion-service.test.ts` :: "R12: orden no-GAM en el lote (en_bodega) -> conflict" |
| R13 | `tests/unit/services/guia-asignacion-service.test.ts` :: "R13: rutea N ordenes no-GAM"; `tests/integration/actions/ordenes-guia-action.test.ts` :: "rutearABodegaSatelite (server action)"; `tests/components/OrdenesRevisionMaestro.test.tsx` :: "R13: 'Rutear a bodega satélite' invoca la action con los ordenIds NO-GAM" |
| R14 | `tests/unit/repositories/orden-repository.test.ts` :: "R14: incluye zona.{nombre,esGam} … mapea zonaNombre/zonaEsGam"; `tests/unit/components/ordenes-columns.test.tsx` :: "R14: renderiza el nombre de la zona (zonaNombre) en la fila" |
| R15 | `tests/unit/components/ordenes-columns.test.tsx` :: "R15: una fila en_ruta_bodega_satelite se lee 'En ruta a bodega <zona>' con el nombre real"; `tests/components/OrdenesRevisionMaestro.test.tsx` :: "R15: monta el 5.º apartado solo-lectura 'En ruta a bodega satélite'" |
| R16 | `tests/unit/services/guia-asignacion-service.test.ts` :: "R16: … admin/adminTienda/mensajero -> forbidden"; `tests/integration/actions/ordenes-guia-action.test.ts` :: "rutearABodegaSatelite … unauthenticated" |
| R17 | `tests/unit/services/guia-asignacion-service.test.ts` :: "R17: origen invalido / orden borrada -> conflict sin transaccion a medias"; "R11/R17 … todo-o-nada" |
| R18 | `tests/unit/services/guia-asignacion-service.test.ts` :: "Feature 30 — no-regresion camino GAM feature 17 (R18)" + toda la suite feature 17 verde; firmas de actions estables (`tests/integration/actions/ordenes-guia-action.test.ts`) |
| R19 | `tests/unit/types/orden-list-dto-zona.test.ts` :: "zonaNombre/zonaEsGam aditivos" |
| R20 | `tests/integration/db/order-status-satelite-migration.test.ts` :: "R20: introduce UN solo valor nuevo" |
| R21 | `tests/integration/db/order-status-satelite-migration.test.ts` :: "DOWN — reversible y condicional (R21)" |
| R22 | esta tabla (reviewer valida) |

## Verificación (salida real — FINAL fullstack, tras frontend)

- `pnpm run typecheck` → **OK** (`tsc --noEmit`, sin errores).
- `pnpm run lint` → **0 errores** (135 warnings, todas en `.claude/skills/impeccable/scripts/*`, ajenas a la feature).
- `pnpm test` → **Test Files 154 passed (154) · Tests 1287 passed (1287)** (1282 backend + 5 frontend).
- `./init.sh` → **== init OK ==** (verde): typecheck + lint + 1287 tests + "todas las migraciones tienen down.sql" + ".env presente".

## DEUDA / bloqueos

- **`db:migrate` / `db:rollback` contra Postgres real: NO ejecutado (DEUDA ACEPTADA).** No hay
  DB Postgres aislada en el entorno y `.env` apunta a un Supabase compartido; aplicar la
  migración sería arriesgado sin aprobación. Cobertura estática vía
  `tests/integration/db/order-status-satelite-migration.test.ts` (mismo patrón que las
  migraciones de features 15/17/24/28, cuyos tests también son estáticos). Pendiente:
  correr `pnpm db:migrate` + `pnpm db:rollback` en un entorno con DB (R21 “ejecutable”).
- Sin otros bloqueos. Frontend T15–T17 completado (columna Zona, apartado satélite, ruteo,
  grupo no-GAM en GenerarGuiaModal, display "En ruta a bodega <zona>").

## Veredicto

Feature 30 completa y verde fullstack (typecheck + lint + 1287 tests + `./init.sh` OK);
todos los R1–R22 mapeados a test concreto. Única deuda aceptada: aplicación real de la
migración contra Postgres (cubierta por test estático). El reviewer decide.
