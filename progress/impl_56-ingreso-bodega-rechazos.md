# Impl 56 — Ingreso de bodega por rechazos (`cobroRechazado`) — BACKEND

Rama: `feature/56-ingreso-bodega-rechazos`. Espejo de la 39. Money-critical.
Veredicto: **VERDE**. typecheck 0 · lint 0 errores · test 1860/1860 · round-trip migración limpio.

## Números reales (antes -> después)
- typecheck: 0 -> 0 errores.
- lint: 0 -> 0 errores (135 warnings pre-existentes, todos en `.claude/skills/*`, ninguno mío).
- test: 1829/1829 -> **1860/1860** (+31 tests nuevos, 0 regresiones).
- migración: `pnpm prisma validate` OK; `migrate deploy` aplica; `db:rollback` (down) OK;
  `migrate deploy` (up) re-aplica -> round-trip up->down->up limpio.
  (Nota: `pnpm db:migrate` = `migrate dev` pide reset por drift PRE-EXISTENTE en
  `20260711200000_provincia_zona_id_nullable`, ajeno a la 56. `migrate status` solo lista
  la 56 como pendiente; se aplicó con `migrate deploy`.)
- money-safety: `grep parseFloat|Number(` en los 9 archivos de producción tocados = 0 usos
  reales (solo comentarios "sin parseFloat/Number").

## Archivos NUEVOS
- `db/migrations/20260712140000_ingreso_bodega_rechazos/migration.sql` (3 ADD COLUMN aditivas)
- `db/migrations/20260712140000_ingreso_bodega_rechazos/down.sql` (3 DROP COLUMN IF EXISTS, orden inverso)
- `lib/utils/ingreso-bodega.ts` (`ingresoBodegaPorResultado`, util puro)
- `tests/unit/utils/ingreso-bodega.test.ts`
- `tests/integration/db/ingreso-bodega-migration.test.ts`

## Archivos MODIFICADOS (producción)
- `db/schema.prisma` (3 campos: `GestionOrden.ingresoBodegaRechazo`,
  `CierreDia.totalIngresoBodegaRechazos`, `CierreBodega.totalIngresoBodegaRechazos`)
- `lib/interfaces/repositories/ICierreDiaRepository.ts` (+`ingresoBodegaRechazo`, +`ingresoByGestionId`, +`totalIngresoBodegaRechazos`)
- `lib/interfaces/services/ICierreDiaService.ts` (+`ingresoBodegaRechazo`, +`tarifaFaltante`, +`totalIngresoBodegaRechazos` en DTO/pasado/result)
- `lib/interfaces/repositories/ICierresAdminRepository.ts` (+`totalIngresoBodegaRechazos`)
- `lib/interfaces/services/ICierresAdminService.ts` (+`totalIngresoBodegaRechazos`)
- `lib/interfaces/services/ICierreBodegaService.ts` (+ resumen/lite/detalle/agregado)
- `lib/interfaces/repositories/ICierreBodegaRepository.ts` (+ consolidable/resumen/input)
- `lib/interfaces/repositories/ICierresBodegaAdminRepository.ts` (+ detalle cierre_dia)
- `lib/services/CierreDiaService.ts` (`derivarIngresoBodega`, expone total, deriva `tarifaFaltante`, snapshotea en `solicitarCierre`, `toDetalleDTO` +2 params)
- `lib/repositories/CierreDiaRepository.ts` (WITH_DETALLE + toPendienteRow + crearCierre tx `idsByIngreso` + findCierresByMensajero)
- `lib/services/CierresAdminService.ts` (`toResumen` + total)
- `lib/repositories/CierresAdminRepository.ts` (SELECT + toResumenRow)
- `lib/services/CierreBodegaService.ts` (`sumIngresoBodega`, agregado en listar, congela en solicitar)
- `lib/repositories/CierreBodegaRepository.ts` (2 SELECT + 2 mappers + crearCierreBodega tx)
- `lib/services/CierresBodegaAdminService.ts` (`toResumen` + detalle por cierre_dia)
- `lib/repositories/CierresBodegaAdminRepository.ts` (SELECT + toDetalleCierreRow)

## Archivos MODIFICADOS (tests existentes — fixtures + regresión 37/38/39/40)
- unit/services: cierre-dia, cierres-admin, cierre-bodega, cierres-bodega-admin (+casos 56)
- unit/repositories: cierre-dia, cierres-admin, cierre-bodega, cierres-bodega-admin (+casos 56)
- components: CierreDiaModule, CierreDiaPage, CierresAdminModule (fixtures; sin cambio de render)
- integration/actions: cierre-dia-action (fixtures)
- integration/db: zonas-migration (exclusión housekeeping del nuevo sufijo, patrón 39)

## Mapa R -> test
- R1  `tests/unit/utils/ingreso-bodega.test.ts` (usa cobroRechazado de la tarifa resuelta)
- R2  `tests/unit/services/cierre-dia-service.test.ts` (resuelve por zona del mensajero)
- R3  `tests/unit/utils/ingreso-bodega.test.ts` (rechazada+cobroRechazado>0 -> monto)
- R4  `tests/unit/utils/ingreso-bodega.test.ts` (entregada/reprogramada/devuelta -> 0.00)
- R5  `tests/unit/utils/ingreso-bodega.test.ts` (rechazada cobroRechazado==0 -> 0.00)
- R6  `tests/unit/utils/ingreso-bodega.test.ts` (tarifa null -> 0.00 sin lanzar)
- R7  `tests/unit/utils/ingreso-bodega.test.ts` (Decimal exacto, STRING 2 dec)
- R7b `tests/unit/services/cierre-dia-service.test.ts` (ingreso NO altera pago_mensajero)
- R8  `tests/unit/services/cierre-dia-service.test.ts` (ingreso atribuido al destino del cierre)
- R9  `tests/unit/services/cierre-dia-service.test.ts` (listarCierreDia expone ingreso por gestión)
- R10 `tests/unit/services/cierre-dia-service.test.ts` (total separado de totales y pago mensajero)
- R11 `tests/unit/services/cierre-dia-service.test.ts` (solicitarCierre snapshotea por gestión)
- R12 `tests/unit/services/cierre-dia-service.test.ts` (snapshotea total del cierre)
- R13 `tests/unit/repositories/cierre-dia-repository.test.ts` (persiste ingreso+total en 1 tx, `idsByIngreso`)
- R14 `tests/unit/services/cierre-dia-service.test.ts` (cambio de tarifa post-cierre no altera snapshot)
- R15 `tests/unit/services/cierres-admin-service.test.ts` (detalle expone ingreso snapshot)
- R16 `tests/unit/services/cierres-admin-service.test.ts` (resumen expone total snapshot)
- R17 `tests/unit/services/cierre-bodega-service.test.ts` (listarConsolidacion expone agregado)
- R18 `tests/unit/services/cierre-bodega-service.test.ts` (solicitarCierreBodega snapshotea agregado)
- R19 `tests/unit/services/cierres-bodega-admin-service.test.ts` (detalle por cierre_dia + agregado)
- R20 `tests/unit/services/cierre-dia-service.test.ts` (totales recibidos + pago mensajero intactos)
- R21 `tests/integration/db/ingreso-bodega-migration.test.ts` (aditiva, orden inverso, timestamp posterior)
- R22 asserts `typeof === "string"` transversales en unit services/repos
- R23 `tests/unit/services/cierre-dia-service.test.ts` (tarifaFaltante true si resolver->null; false si tarifa 0.00 real)

## Decisiones F1.4 implementadas EXACTAS
Q1/Q2: solo `rechazada`; cobroRechazado>0 -> monto, ==0/null -> "0.00"; reusa `resolvePagoTarifa`
(no toca pago-mensajero.ts). Q3: congela en `solicitarCierre`, deriva en `listarCierreDia`.
Q4: migración aditiva 3 columnas + down. Q5: destino ya resuelto por `solicitarCierre`.
Q6: `tarifaFaltante` server-side (`tarifa===null`), aplica a entregas Y rechazos; arregla deuda m1
de la 39 (false con tarifa 0.00 real). Fuera de alcance: UI (frontend_dev).

## Sin regresión 37/38/39/40
Snapshots existentes (dinero recibido `total_efectivo/simpe/transferencia/general`,
`total_pago_mensajero` a los 3 niveles) INTACTOS: sus tests pasan sin cambio de semántica;
solo se AÑADIERON campos y se MEJORÓ el aviso de tarifa faltante con el flag server-side.
