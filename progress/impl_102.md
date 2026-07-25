# impl_102 — Backend de "Ingreso de bodega por rechazos SLA visible + aviso a tienda"

> Rol: backend_dev. Alcance: T1–T9 + T13 (backend). Frontend (T10–T12, T14) queda para frontend_dev.
> Decisiones del gate F1.4 respetadas: visibilidad derivada, SIN migración, money-safe.

## Veredicto
VERDE — typecheck, lint (0 errores) y los tests backend de la feature pasan. Sin bloqueantes; NO
hizo falta migración (la clasificación SLA se deriva del join con `orden_historial_estado.origen_tipo
= escalado_devuelta_sla`, ya existente por la feature 99).

## Archivos creados
- `lib/utils/rechazo-sla-flag.ts` — util puro `esRechazoSla` + constante `ORIGEN_TIPO_RECHAZO_SLA` (T1).
- `lib/utils/desglose-rechazos-sla.ts` — util puro `desglosarIngresoBodegaPorOrigen` money-safe (T4).
- `lib/types/rechazo-sla-tienda.ts` — DTO `RechazoSlaTiendaDTO` (100% serializable) (T8).
- `lib/interfaces/services/IRechazosSlaTiendaService.ts` — contrato del service de tienda (T8).
- `lib/services/RechazosSlaTiendaService.ts` — service de solo-lectura, rol `adminTienda` (T8).
- `lib/actions/rechazos-sla-tienda.ts` — Server Action `listarRechazosSlaTiendaAction` (T9).
- `tests/unit/utils/rechazo-sla-flag.test.ts` (R1/R2).
- `tests/unit/utils/desglose-rechazos-sla.test.ts` (R4/R5/R18).
- `tests/unit/repositories/orden-repository.rechazos-sla.test.ts` (R12/R13/R14/R15).
- `tests/unit/services/rechazos-sla-tienda-service.test.ts` (R12/R13/R15).
- `tests/integration/db/no-migration-102.test.ts` (R3/R17).

## Archivos modificados (producción)
- `lib/interfaces/repositories/ICierreDiaRepository.ts` — `+ esRechazoSla: boolean` en `CierreGestionPendienteRow` (T3).
- `lib/interfaces/services/ICierreDiaService.ts` — `+ esRechazoSla: boolean` en `CierreDetalleGestion` (T3).
- `lib/interfaces/services/ICierresAdminService.ts` — `+ desgloseIngresoBodegaRechazos { sla, manual, total }` en el detalle ok (T5).
- `lib/interfaces/repositories/IOrdenRepository.ts` — `RechazoSlaTiendaRow` + `find/countRechazadasSlaByTienda` (T7).
- `lib/repositories/CierresAdminRepository.ts` — `GESTION_ADMIN_SELECT` + `historialEstados` acotado; `toPendienteRowDesdeSnapshot` mapea `esRechazoSla` (T2).
- `lib/repositories/CierreDiaRepository.ts` — `toPendienteRow` fija `esRechazoSla: false` (vista en vivo, R11) (T3).
- `lib/repositories/OrdenRepository.ts` — `find/countRechazadasSlaByTienda` + `rechazoSlaWhere` + helper `decimalOrNullToString` (T7).
- `lib/services/CierreDiaService.ts` — `toDetalleDTO` propaga `esRechazoSla` (T3).
- `lib/services/CierresAdminService.ts` — `verCierreDetalle` invoca el desglose y lo devuelve, `total` = snapshot leído (T5).

## Archivos modificados (tests existentes — solo para adaptar fixtures al campo nuevo)
- Fixtures `CierreGestionPendienteRow`/`CierreDetalleGestion` (+ `esRechazoSla: false`): `cierres-admin-service`,
  `cierre-dia-service`, `cierres-bodega-admin-service`, `corte-diario-service`, `devolucion-sla-dinero`,
  `cierre-totales`, `cierre-dia-action`, `resolver-novedad-reprograma-dinero`, y los tests de componente
  `CierreDiaModule`/`CierreDiaPage`/`CierresAdminModule` (fixture default).
- Mocks de `IOrdenRepository` (+ `count/findRechazadasSlaByTienda`): `asignacion-mensajero-service`,
  `orden-service`, `bulk-orden-service`, `bulk-orden-service.carga-api`, `rol-admin-satelite-authz`.
- Payloads de `GESTION_ADMIN_SELECT` (+ `historialEstados: []`): `cierres-admin-repository`,
  `cierres-bodega-admin-repository`; y `CierresAdminModule` recibió un `desgloseIngresoBodegaRechazos`
  default (frontend_dev lo ejercita en T10/T11).
- Test nuevo de derivación repo: `cierres-admin-repository.test.ts` (R1: select acotado + esRechazoSla por gestión).

## Mapa R<n> → test (backend)
| Req | Test |
| --- | --- |
| R1  | `tests/unit/utils/rechazo-sla-flag.test.ts` (true con fila origen SLA) + `tests/unit/repositories/cierres-admin-repository.test.ts` (derivación por gestión) |
| R2  | `tests/unit/utils/rechazo-sla-flag.test.ts` (rechazo manual con ingreso != 0 → false) |
| R3  | `tests/integration/db/no-migration-102.test.ts` (sin columna/migración; derivación por join) |
| R4  | `tests/unit/utils/desglose-rechazos-sla.test.ts` (partición SLA/manual STRING escala 2) |
| R5  | `tests/unit/utils/desglose-rechazos-sla.test.ts` + `tests/unit/services/cierres-admin-service.test.ts` (sla + manual === total) |
| R6  | `tests/unit/services/cierres-admin-service.test.ts` (total = snapshot leído; totales 56/39/recibido intactos) |
| R7  | `tests/unit/services/cierres-admin-service.test.ts` (desglose estable, sin resolver tarifa) |
| R8  | `tests/unit/services/cierres-admin-service.test.ts` (subtotal SLA separado del manual) |
| R9  | `tests/unit/services/cierres-admin-service.test.ts` (cada gestión rechazada marcada SLA/manual) — E2E render en T14 (frontend) |
| R10 | `tests/unit/services/cierres-admin-service.test.ts` (adminSatelite recibe el mismo desglose) |
| R11 | `tests/unit/services/cierre-dia-service.test.ts` (/cierre-dia no expone el desglose; esRechazoSla=false) |
| R12 | `tests/unit/services/rechazos-sla-tienda-service.test.ts` + `tests/unit/repositories/orden-repository.rechazos-sla.test.ts` |
| R13 | `tests/unit/services/rechazos-sla-tienda-service.test.ts` (acota a la tienda; otro rol → forbidden) |
| R14 | `tests/unit/repositories/orden-repository.rechazos-sla.test.ts` (monto de 56 STRING escala 2) |
| R15 | `tests/unit/services/rechazos-sla-tienda-service.test.ts` + `tests/unit/repositories/orden-repository.rechazos-sla.test.ts` (predicado estado real; count/find mismo where) |
| R16 | `tests/unit/services/cierres-admin-service.test.ts` (sin movimiento wallet/caja: no invoca resolverCierre) |
| R17 | `tests/integration/db/no-migration-102.test.ts` (sin tabla/enum de notificación) |
| R18 | transversal: asserts de tipo STRING en desglose/monto/DTO (utils + repo + service tests) |

## Salidas de verificación
- `pnpm typecheck` → OK (sin errores).
- `pnpm lint` → OK: `✖ 143 problems (0 errors, 143 warnings)`; los warnings son preexistentes (skills, app/, otros), ninguno en archivos de la feature 102.
- `pnpm exec vitest run rechazo-sla-flag desglose-rechazos-sla orden-repository.rechazos-sla rechazos-sla-tienda-service no-migration-102 cierres-admin-service cierre-dia-service`
  → `Test Files 7 passed (7) · Tests 138 passed (138)`.
- Suite completa (`pnpm test`) → `Test Files 414 passed (414) · Tests 4094 passed (4094)`; sin flakies en esta corrida.

## Notas
- SIN migración: confirmado alcanzable. El monto sale del snapshot de 56 (`gestion_orden.ingreso_bodega_rechazo`)
  y la clasificación del `origen_tipo` inmutable de 99. No se añadió columna/tabla/enum.
- Q1/Q2/Q3/Q4 implementados sobre las recomendaciones por defecto (monto de 56 anclado al snapshot;
  superficie en /novedades; subtotal SLA solo en el detalle).

---

# Frontend — "Ingreso de bodega por rechazos SLA visible + pestaña de tienda"

> Rol: frontend_dev. Alcance: T10, T11, T12, T14. NO se tocó backend/DB/repos/services/actions.
> Consumidos tal cual: `ICierresAdminService.verCierreDetalle` → `desgloseIngresoBodegaRechazos
> { sla, manual, total }` (STRING escala 2) y `CierreDetalleGestion.esRechazoSla`; DTO
> `RechazoSlaTiendaDTO` + Server Action `listarRechazosSlaTiendaAction` (paginada).

## Veredicto
VERDE — `pnpm typecheck` OK, `pnpm lint` 0 errores (143 warnings preexistentes, ninguno en archivos
102), y los tests de componente tocados/agregados pasan. Los únicos rojos de la suite de componentes
son los flakies conocidos bajo carga (`HomePage`, `OrdenesModuleReuse` → "Test timed out in 5000ms"),
que pasan en aislado (verificado). Sin bloqueantes.

## Archivos creados
- `app/(app)/novedades/_components/RechazosSlaModule.tsx` — componente cliente PRIVADO de la pestaña
  "Rechazadas por SLA": guía (placeholder si null) + remisión + destinatario + monto; `monto===null`
  → badge "Pendiente de cierre"; re-fetch por Server Action; `Pagination`; estado vacío (T12).
- `app/(app)/novedades/_components/NovedadesTabs.tsx` — wrapper de pestañas (reusa `TabsGroup` con
  `keepMounted`): "En devolución" (`NovedadesModule`) + "Rechazadas por SLA" (`RechazosSlaModule`) (T12).
- `tests/components/RechazosSlaModule.test.tsx` — R12/R14 ejecutable (lista, monto STRING, guía null,
  `monto===null`→pendiente, Pagination, re-fetch por paginación, error→toast).
- `e2e/cierres-admin-rechazos-sla.spec.ts` — E2E R8/R9 (patrón de los e2e existentes; placeholder,
  NO corre en CI hasta que exista harness seed+login) (T14).

## Archivos modificados (producción)
- `app/(app)/cierres-admin/_components/cierre-detalle-shared.tsx` — labels i18n nuevas
  (`INGRESO_BODEGA_RECHAZOS_SLA_LABEL`/`..._MANUAL_LABEL`, `RECHAZO_ORIGEN_COL`, `RECHAZO_SLA_BADGE_*`,
  `RECHAZO_MANUAL_BADGE_*`) + componente `IngresoBodegaRechazosDesglose` (hermano de
  `IngresoBodegaRechazosTotal`: total + sublíneas SLA/manual) + `renderRechazoOrigen` /
  `COLUMNA_RECHAZO_ORIGEN`, insertada en la sección `rechazada` de `columnasPara` (T10, R8/R9).
- `app/(app)/cierres-admin/_components/CierresAdminModule.tsx` — `DetalleAbierto` gana
  `desgloseIngresoBodegaRechazos`; `abrirDetalle` lo propaga; el panel usa
  `IngresoBodegaRechazosDesglose` en vez de `IngresoBodegaRechazosTotal` (T10/T11).
- `app/(app)/novedades/page.tsx` — pre-fetch server-side de las DOS superficies (novedades +
  rechazos SLA, `Promise.all`); render de `NovedadesTabs`; fallback a vacío si la superficie
  secundaria no responde `ok` (defensa en profundidad) (T12).

## Archivos modificados (tests existentes)
- `tests/components/CierresAdminModule.test.tsx` — helper `makeDesglose`, reemplazados los 21
  fixtures default `0.00/0.00/0.00` por `makeDesglose()`, y AGREGADAS aserciones reales: "feature
  102/R8" (total + subtotales SLA y manual separados) y "feature 102/R9" (badge SLA/manual por fila).
- `tests/components/NovedadesPage.test.tsx` — mock de `listarRechazosSlaTiendaAction` (default ok) y
  del wrapper `NovedadesTabs`; las guardias R18/R19 siguen verdes.

## Mapa R<n> → test (frontend)
| Req | Test |
| --- | --- |
| R8  | `tests/components/CierresAdminModule.test.tsx` — "feature 102/R8: total + subtotales SLA y manual separados" + `e2e/cierres-admin-rechazos-sla.spec.ts` |
| R9  | `tests/components/CierresAdminModule.test.tsx` — "feature 102/R9: cada fila rechazada marcada SLA/Manual" + `e2e/cierres-admin-rechazos-sla.spec.ts` (E2E, no CI) |
| R10 | `tests/components/CierresAdminModule.test.tsx` — el desglose viaja por `verCierreDetalle`, misma superficie que usa el adminSatelite (alcance satélite validado backend-side en `cierres-admin-service.test.ts`) |
| R12 | `tests/components/RechazosSlaModule.test.tsx` — lista de rechazos SLA de la tienda + `tests/components/NovedadesPage.test.tsx` (superficie dentro de /novedades, solo adminTienda) |
| R14 | `tests/components/RechazosSlaModule.test.tsx` — guía/remisión/destinatario/monto STRING; `monto===null`→"Pendiente de cierre" |

## Salidas de verificación
- `pnpm typecheck` → OK (sin errores).
- `pnpm lint` → `✖ 143 problems (0 errors, 143 warnings)`; warnings preexistentes, ninguno en archivos 102.
- `pnpm exec vitest run tests/components/CierresAdminModule.test.tsx` → 27 passed.
- `pnpm exec vitest run tests/components/RechazosSlaModule.test.tsx NovedadesPage.test.tsx NovedadesModule.test.tsx` → 23 passed.
- `pnpm exec vitest run tests/components` → 758 passed; 2 fallos = flakies conocidos bajo carga
  (`HomePage`, `OrdenesModuleReuse`, "Test timed out in 5000ms"), verificados VERDES en aislado.

## Notas frontend
- El desglose SLA/manual (panel de subtotales) sale SOLO por `ICierresAdminService.verCierreDetalle`,
  que es lo que backend_dev extendió; el detalle AGREGADO de bodega (`ICierreBodegaService`,
  maestro/adminSatelite consolidación) NO lleva ese campo (extenderlo sería backend, fuera de alcance).
  El badge de origen POR FILA sí aparece también en el detalle de bodega maestro (vía `DetalleSecciones`
  → `columnasPara`). R10 (adminSatelite ve el mismo desglose) queda cubierto porque el adminSatelite
  abre el detalle por-mensajero en `CierresAdminModule`, con alcance satélite resuelto server-side.
- R11 intacto: el mensajero (`/cierre-dia`) usa su PROPIO `columnasPara` local (no el compartido), así
  que la columna "Origen" y el desglose NO se filtran a su vista.
- Money-safe: todos los montos (`sla`/`manual`/`total`, monto de tienda) llegan STRING y se renderizan
  con `money()`/prefijo `₡`; ninguna aritmética con `Number`/`parseFloat`.
