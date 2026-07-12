# Bitacora de implementacion — Feature 39 (pago al mensajero por zona en el cierre)

Backend money-critical. Spec F1.4 APROBADA 2026-07-12. Rama: feature/39-pago-mensajero-zona.
Tareas ejecutadas: T0-T10, T12, T13 (T11 UI y T14 gate final quedan fuera del alcance backend).

## Veredicto: VERDE

- `npx prisma validate` -> OK (schema valido).
- `pnpm run typecheck` -> 0 errores.
- `pnpm run lint` -> 0 errores (135 warnings preexistentes en `.claude/skills/**`, ajenos).
- `pnpm test` -> 205 files / 1827 tests PASSED (0 failed). Baseline previo: 1565; +262 por
  la feature + regresion 37/38/40 intacta.
- Round-trip DB local: `prisma migrate deploy` -> `pnpm run db:rollback` (down.sql) ->
  `migrate deploy` -> `prisma migrate status` = "Database schema is up to date!".

## Archivos creados

- db/migrations/20260712130000_pago_mensajero_cierre/migration.sql (3 ADD COLUMN aditivos)
- db/migrations/20260712130000_pago_mensajero_cierre/down.sql (3 DROP en orden inverso, IF EXISTS)
- lib/interfaces/repositories/ITarifaZonaMensajeroRepository.ts (PagoTarifa + resolvePagoTarifa)
- lib/repositories/TarifaZonaMensajeroRepository.ts (findUnique exacto + fallback findFirst)
- lib/utils/pago-mensajero.ts (pagoPorResultado, util puro F1.4: solo entregada paga)
- tests/unit/repositories/tarifa-zona-mensajero-repository.test.ts (R1/R2/R3/R8)
- tests/unit/services/pago-mensajero-resolver.test.ts (R4/R5/R6/R7/R7b/R8/R9)
- tests/integration/db/pago-mensajero-migration.test.ts (R22, estatico + round-trip manual)

## Archivos modificados (fuente)

- db/schema.prisma (GestionOrden.pagoMensajero?, CierreDia.totalPagoMensajero, CierreBodega.totalPagoMensajero)
- lib/interfaces/repositories/ICierreDiaRepository.ts (+pagoMensajero row; CrearCierreInput +pagoByGestionId/+totalPagoMensajero)
- lib/interfaces/services/ICierreDiaService.ts (CierreDetalleGestion +pagoMensajero; ok +totalPagoMensajero; CierrePasadoDTO +totalPagoMensajero)
- lib/repositories/CierreDiaRepository.ts (WITH_DETALLE +pagoMensajero; toPendienteRow; crearCierre snapshot en tx; findCierresByMensajero)
- lib/services/CierreDiaService.ts (inyecta resolver + findUsuarioVehiculoId; deriva en vivo; snapshotea al solicitar; derivarPagos)
- lib/interfaces/repositories/IOrdenRepository.ts + lib/repositories/OrdenRepository.ts (findUsuarioVehiculoId)
- lib/interfaces/repositories/ICierresAdminRepository.ts + lib/repositories/CierresAdminRepository.ts (+totalPagoMensajero)
- lib/interfaces/services/ICierresAdminService.ts + lib/services/CierresAdminService.ts (+totalPagoMensajero)
- lib/interfaces/services/ICierreBodegaService.ts (Resumen/Lite/DetalleCierre/ok +totalPagoMensajero(Agregado))
- lib/interfaces/repositories/ICierreBodegaRepository.ts + lib/repositories/CierreBodegaRepository.ts (+totalPagoMensajero; sumPagoMensajero snapshot en tx)
- lib/services/CierreBodegaService.ts (sumPagoMensajero; expone agregado; snapshotea al solicitar)
- lib/interfaces/repositories/ICierresBodegaAdminRepository.ts + lib/repositories/CierresBodegaAdminRepository.ts (+totalPagoMensajero)
- lib/services/CierresBodegaAdminService.ts (mapea totalPagoMensajero por cierre_dia + agregado)
- lib/actions/cierre-dia.ts (wire TarifaZonaMensajeroRepository al buildService)

## Archivos modificados (tests extendidos, sin romper casos previos)

- tests/unit/services/cierre-dia-service.test.ts (+R10/R11/R12/R13/R15/R21)
- tests/unit/repositories/cierre-dia-repository.test.ts (R14 snapshot en tx)
- tests/unit/services/cierres-admin-service.test.ts (+R16/R17)
- tests/unit/repositories/cierres-admin-repository.test.ts (fixtures snapshot)
- tests/unit/services/cierre-bodega-service.test.ts (+R18/R19)
- tests/unit/repositories/cierre-bodega-repository.test.ts (fixtures snapshot)
- tests/unit/services/cierres-bodega-admin-service.test.ts (R20; reemplaza el obsoleto "R14 no expone pago")
- tests/unit/repositories/cierres-bodega-admin-repository.test.ts (fixtures snapshot)
- tests/integration/actions/cierre-dia-action.test.ts (5o arg del service + snapshot)
- tests/integration/db/zonas-migration.test.ts (excluye _pago_mensajero_cierre de "previas")
- tests/components/{CierreDiaModule,CierreDiaPage,CierresAdminModule}.test.tsx (fixtures DTO)
- tests/unit/services/{orden-service,rol-admin-satelite-authz,asignacion-mensajero-service,bulk-orden-service}.test.ts (findUsuarioVehiculoId en mocks IOrdenRepository)

## Mapa R -> test

| Req | Test |
| --- | --- |
| R1  | tests/unit/repositories/tarifa-zona-mensajero-repository.test.ts (R1) + cierre-dia-service.test.ts (R4) |
| R2  | tests/unit/repositories/tarifa-zona-mensajero-repository.test.ts (R2) |
| R3  | tests/unit/repositories/tarifa-zona-mensajero-repository.test.ts (R3) |
| R4  | tests/unit/services/pago-mensajero-resolver.test.ts + cierre-dia-service.test.ts (R4) |
| R5  | tests/unit/services/pago-mensajero-resolver.test.ts (R5) |
| R6  | tests/unit/services/pago-mensajero-resolver.test.ts (R6) |
| R7  | tests/unit/services/pago-mensajero-resolver.test.ts (R7) |
| R7b | tests/unit/services/pago-mensajero-resolver.test.ts (R7b) |
| R8  | tests/unit/services/pago-mensajero-resolver.test.ts (R8) + tarifa-zona-mensajero-repository.test.ts (R8) |
| R9  | tests/unit/services/pago-mensajero-resolver.test.ts (R9) |
| R10 | tests/unit/services/cierre-dia-service.test.ts (R10) |
| R11 | tests/unit/services/cierre-dia-service.test.ts (R11/R21) |
| R12 | tests/unit/services/cierre-dia-service.test.ts (R12) |
| R13 | tests/unit/services/cierre-dia-service.test.ts (R12/R13) |
| R14 | tests/unit/repositories/cierre-dia-repository.test.ts (crearCierre) |
| R15 | tests/unit/services/cierre-dia-service.test.ts (snapshot congelado) |
| R16 | tests/unit/services/cierres-admin-service.test.ts (R16) |
| R17 | tests/unit/services/cierres-admin-service.test.ts (R17) |
| R18 | tests/unit/services/cierre-bodega-service.test.ts (R18) |
| R19 | tests/unit/services/cierre-bodega-service.test.ts (R19) + cierre-bodega-repository.test.ts |
| R20 | tests/unit/services/cierres-bodega-admin-service.test.ts (R20) |
| R21 | tests/unit/services/cierre-dia-service.test.ts (R11/R21) + cierres-admin-service.test.ts (R17) |
| R22 | tests/integration/db/pago-mensajero-migration.test.ts + round-trip DB local |
| R23 | asserts `typeof ... === "string"` en pago-mensajero-resolver / cierre-dia-service / cierres-admin-service / cierres-bodega-admin-service / tarifa-zona-mensajero-repository |

## Desviaciones del design (documentadas)

1. crearCierre: el snapshot por gestion se puebla AGRUPADO por VALOR de pago (a lo sumo 2
   updateMany: cobroEntregado y 0.00), consumiendo `pagoByGestionId` del input. Equivalente
   al "agrupado por resultado" del design (F1.4: solo entregada paga), pero usando el
   contrato `CrearCierreInput.pagoByGestionId` en vez de re-derivar el resultado en el repo.
   Guardia por `cierreId` = nuevo (todo dentro de la $transaction existente). Sin TOCTOU nuevo.
2. Se agrego `totalPagoMensajeroAgregado: string` a `ListarConsolidacionServiceResult.ok`
   (no listado explicito en design §6, pero requerido por R18 para exponer el agregado en la
   pantalla de consolidacion; separado de `totalesAgregados`).
3. El test previo "R14: el DTO de detalle NO expone pago al mensajero" (feature 40) queda
   OBSOLETO por F1.4/R20 (la 39 SI expone el pago snapshoteado); se reemplazo por el test R20.

## Cierre consolidado — UI (T11) + gate final (T14)

Coordinacion: implementer. Backend por `backend_dev`, UI por `frontend_dev` (ambos `model: opus`).

### T11 — UI (frontend_dev, R10/R11/R16/R17/R18/R20)

Solo capa de presentacion en pantallas EXISTENTES (sin rutas/pantallas nuevas). Montos
renderizados TAL CUAL (STRING); cero `parseFloat`/`Number(`/`+monto`; sin sumas en cliente
(los totales vienen del backend).

Archivos modificados (UI):
- app/(app)/cierre-dia/_components/CierreDiaModule.tsx (panel "Pago al mensajero" separado + columna por orden + historico)
- app/(app)/cierre-dia/page.tsx (pasa totalPagoMensajero)
- app/(app)/cierres-admin/_components/cierre-detalle-shared.tsx (helpers PagoMensajeroTotal / columna pago + aviso)
- app/(app)/cierres-admin/_components/CierresAdminModule.tsx (total snapshot + columna por orden)
- app/(app)/cierres-admin/_components/ConsolidacionBodegaModule.tsx (agregado a mensajeros)
- app/(app)/cierres-admin/_components/CierresBodegaAdminModule.tsx (agregado + por cierre_dia)
- app/(app)/cierres-admin/page.tsx (pasa totalPagoMensajeroAgregado)
- components/ui/badge.tsx (primitiva shadcn para el aviso)
- tests/components/CierreDiaModule.test.tsx (+2 casos: R10 pago por orden, R11 total separado)

Cobertura UI: R10/R11 (cierre-dia mensajero), R16/R17 (cierres-admin), R18 (consolidacion
bodega), R20 (detalle bodega-admin).

### Aviso de tarifa faltante (F1.4 punto 5) — DESVIACION a revisar

El backend NO expone un flag explicito `tarifaFaltante` en los DTOs. El frontend implementa
el aviso en la vista admin por HEURISTICA: orden `entregada` con `pagoMensajero === "0.00"`
(comparacion de STRING, sin parseFloat) -> Badge discreto "Sin tarifa" (informativo, no
bloqueante; solo admin, no en la vista del mensajero). Limitacion: una entrega legitimamente
de valor 0 tambien dispararia el badge. Para precision, la 39 (o la 55) deberia exponer un
flag `tarifaFaltante` en el DTO. Se deja como observacion para el reviewer/leader; NO bloquea.

### Gate final T14 (corrido por el coordinador)

- `npx prisma validate` -> OK.
- `pnpm run typecheck` -> 0 errores.
- `pnpm run lint` -> 0 errores (135 warnings preexistentes en `.claude/skills/**`, ajenos).
- `pnpm test` -> 205 files / **1829 passed / 0 failed** (backend 1827 + 2 UI). Sin regresion en 37/38/40.
- `./init.sh` -> **VERDE** (`== init OK ==`; todas las migraciones con down.sql; .env presente).
- `pnpm build` -> OK (exit 0; rutas /cierre-dia y /cierres-admin compilan).

### Veredicto consolidado: VERDE. Listo para revision (reviewer).
