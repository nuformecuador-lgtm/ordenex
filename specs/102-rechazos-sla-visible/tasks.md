# Feature 102 — tasks.md

> Checklist discreta y verificable. Orquestación: **backend_dev → frontend_dev** (NO implementer
> monolítico). Cada task marca `[B]` backend / `[F]` frontend, sus dependencias y `[P]` si es
> paralelizable con otra del mismo bloque. Criterio de "hecho" explícito por task. El mapa
> `R<n> → test` cierra el archivo (el reviewer rechaza si falta alguno). Sin migración (objetivo
> del gate); si en T2 se detectara imprescindible, se abre sub-task de migración aditiva + `down.sql`.

## Bloque 0 — Preparación

- [ ] **T0 [B]** Confirmar en el gate las Preguntas Abiertas Q1–Q4 de `requirements.md`. Registrar la
  decisión (o "recomendación por defecto") antes de codificar la superficie de tienda (T7–T9) y el
  detalle del subtotal (T4–T6). *Hecho:* decisión anotada; requisitos afectados re-redactados si aplica.

## Bloque 1 — Clasificación SLA (backend)

- [x] **T1 [B]** Util puro `lib/utils/rechazo-sla-flag.ts` (o helper inline en el mapper) que derive
  `esRechazoSla` de la presencia de una fila de historial `origen_tipo = "escalado_devuelta_sla"`
  enlazada por `gestion_orden_id`. *Depende:* T0. *Hecho:* función pura tipada + test T1 verde (R1/R2).
- [x] **T2 [B]** Extender `CierresAdminRepository.GESTION_ADMIN_SELECT` con la relación acotada
  `historialEstados: { where: { origenTipo: "escalado_devuelta_sla" }, take: 1, select: { id: true } }`
  y mapear `esRechazoSla` en `toPendienteRowDesdeSnapshot`. *Depende:* T1. *Hecho:* el DTO de gestión
  trae `esRechazoSla`; sin columna/migración nueva (R3), typecheck verde.
- [x] **T3 [B] [P]** Añadir `esRechazoSla: boolean` a `CierreGestionPendienteRow`
  (`ICierreDiaRepository`) y a `CierreDetalleGestion` (`ICierreDiaService`); `toDetalleDTO`
  (`CierreDiaService`) lo propaga (default `false` en vivo). *Depende:* T1. *Hecho:* interfaces
  extendidas, typecheck verde, vista en vivo del mensajero sin desglose (R11).

## Bloque 2 — Desglose money-safe del cierre (backend) [💰]

- [x] **T4 [B]** Util puro `lib/utils/desglose-rechazos-sla.ts` →
  `desglosarIngresoBodegaPorOrigen(gestiones)` con `Prisma.Decimal`, salida STRING escala 2.
  *Depende:* T3. *Hecho:* test T4 verde; `sla + manual === total` (R4/R5/R18).
- [x] **T5 [B]** `CierresAdminService.verCierreDetalle` invoca el util y devuelve
  `desgloseIngresoBodegaRechazos { sla, manual, total }`; aserta identidad con
  `cierre.totalIngresoBodegaRechazos` snapshot (no recomputa el total). *Depende:* T4, T2. *Hecho:*
  test T5/T6 verde (R5/R6/R7/R8); alcance satélite recibe el mismo desglose (R10).
- [x] **T6 [B] [P]** Test de regresión: el flujo de detalle NO altera totales 56/39/recibido y NO
  emite movimientos de wallet/caja. *Depende:* T5. *Hecho:* test verde (R6/R16).

## Bloque 3 — Superficie de la tienda (backend) [💰]

- [x] **T7 [B]** `IOrdenRepository`: `findRechazadasSlaByTienda(tiendaId, {skip,take})` +
  `countRechazadasSlaByTienda(tiendaId)` (predicado: `estatus=rechazada` + tienda + `deleted_at IS
  NULL` + EXISTS historial `origen_tipo=escalado_devuelta_sla`). Monto = `ingreso_bodega_rechazo` de
  la gestión SLA (Q1/Q2 default; `null` = pendiente de cierre). *Depende:* T0. *Hecho:* test T14/T15
  verde (R12/R13/R14/R15); money-safe STRING.
- [x] **T8 [B]** `lib/types/rechazo-sla-tienda.ts` (`RechazoSlaTiendaDTO`) +
  `lib/services/RechazosSlaTiendaService.ts` (rol `adminTienda`, acota a `actor.usuarioId`, otro rol
  → forbidden). *Depende:* T7. *Hecho:* test de service verde (R12/R13/R15).
- [x] **T9 [B]** Server Action `lib/actions/rechazos-sla-tienda.ts` (`'use server'`, sesión/cookies,
  patrón `listarNovedadesAction`). *Depende:* T8. *Hecho:* action tipada devuelve DTOs paginados; no
  route handler (R17: sin canal nuevo).

## Bloque 4 — Frontend (frontend_dev)

- [x] **T10 [F]** `cierre-detalle-shared.tsx`: mostrar subtotal "por SLA" y "manual" junto al total
  (etiquetas i18n-ready nuevas) + badge "SLA" por fila en la sección `rechazada` (`columnasPara`,
  usando `g.esRechazoSla`). *Depende:* T5, T3. *Hecho:* detalle muestra ambos subtotales y marca por
  fila (R8/R9); montos como STRING.
- [x] **T11 [F] [P]** Verificar que `CierresAdminModule`, `ConsolidacionBodegaModule` y
  `CierresBodegaAdminModule` renderizan el nuevo desglose (consumen `cierre-detalle-shared`).
  *Depende:* T10. *Hecho:* `CierresAdminModule` (central + adminSatelite, R10) muestra el desglose
  SLA/manual del panel; el detalle de bodega maestro (`CierresBodegaAdminModule` vía
  `DetalleSecciones`) muestra el badge de origen por fila. NOTA: el panel de subtotales SLA/manual
  solo sale por `verCierreDetalle` (`ICierresAdminService`), que es el que backend_dev extendió;
  `ICierreBodegaService` NO lleva el desglose agregado (no es alcance frontend), y R10 ya queda
  cubierto por el alcance satélite de `CierresAdminModule`.
- [x] **T12 [F]** Sección/pestaña de solo-lectura "Rechazadas por SLA" en `app/(app)/novedades/`
  (componente privado por props; Server Component valida `adminTienda`; re-fetch por Server Action;
  estado vacío; `null` → "pendiente de cierre"). *Depende:* T9. *Hecho:* la tienda ve sus rechazos
  SLA con monto en una pantalla que ya visita, sin ítem de menú nuevo (R12/R14).

## Bloque 5 — Verificación e integración

- [x] **T13 [B]** Test de integración `tests/integration/db/no-migration-102.test.ts`: el
  schema/migraciones NO cambian y no hay tabla/enum de notificación nuevos. *Depende:* T2, T7.
  *Hecho:* test verde (R3/R17).
- [x] **T14 [F]** E2E `e2e/cierres-admin-rechazos-sla.spec.ts`: un cierre con rechazo SLA + rechazo
  manual muestra ambos subtotales y marca cada fila. *Depende:* T10. *Hecho:* spec escrito con el
  patrón de los e2e existentes (emails placeholder, sin harness seed+login → NO corre en CI, como
  el resto de `e2e/*`); la cobertura EJECUTABLE de R8/R9 queda en
  `tests/components/CierresAdminModule.test.tsx` ("feature 102/R8" y "feature 102/R9").
- [ ] **T15 [B/F]** `progress/impl_102.md` con el mapa `R<n> → test`; `./init.sh`, `pnpm typecheck`,
  `pnpm lint`, `pnpm test` en verde. *Depende:* todo lo anterior. *Hecho:* CHECKPOINTS cumplidos;
  cada `R<n>` mapeado a un test que pasa.

## Mapa R<n> → test (trazabilidad; el reviewer lo exige)

| Req | Test |
| --- | --- |
| R1  | `tests/unit/utils/rechazo-sla-flag.test.ts` (T1) — flag true con fila origen SLA enlazada |
| R2  | `tests/unit/utils/rechazo-sla-flag.test.ts` (T1) — rechazo manual con ingreso != 0 → false |
| R3  | `tests/integration/db/no-migration-102.test.ts` (T13) — sin columna/migración nueva |
| R4  | `tests/unit/utils/desglose-rechazos-sla.test.ts` (T4) — partición SLA/manual STRING escala 2 |
| R5  | `tests/unit/utils/desglose-rechazos-sla.test.ts` (T4) — sla + manual === total |
| R6  | `tests/unit/services/cierres-admin-service.test.ts` (T5/T6) — totales 56/39/recibido intactos |
| R7  | `tests/unit/services/cierres-admin-service.test.ts` (T5) — desglose estable live/cerrado |
| R8  | `tests/unit/services/cierres-admin-service.test.ts` (T5) — subtotal SLA separado del manual |
| R9  | `e2e/cierres-admin-rechazos-sla.spec.ts` (T14) — cada fila marcada SLA/manual |
| R10 | `tests/unit/services/cierres-admin-service.test.ts` (T5) — alcance satélite recibe el desglose |
| R11 | `tests/unit/services/cierre-dia-service.test.ts` (T3) — `/cierre-dia` no expone el desglose |
| R12 | `tests/unit/services/rechazos-sla-tienda-service.test.ts` (T8) — lista incluye rechazo SLA de la tienda |
| R13 | `tests/unit/services/rechazos-sla-tienda-service.test.ts` (T8) — acota a la tienda; otro rol forbidden |
| R14 | `tests/unit/repositories/orden-repository.rechazos-sla.test.ts` (T7) — monto de 56 STRING escala 2 |
| R15 | `tests/unit/services/rechazos-sla-tienda-service.test.ts` (T8) — orden no-rechazada/borrada no aparece |
| R16 | `tests/unit/services/cierres-admin-service.test.ts` (T6) — sin movimiento de wallet/caja |
| R17 | `tests/integration/db/no-migration-102.test.ts` (T13) — sin tabla/enum de notificación |
| R18 | transversal (T4/T5/T7) — asserts de tipo STRING escala 2 en cada monto/DTO nuevo |
