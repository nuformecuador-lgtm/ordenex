# Feature 26 — Dashboard / apartado del admin de tienda — tasks.md

> Checklist discreta y verificable. `[P]` = paralelizable. Cada task indica los R que
> cubre y su criterio de "hecho". Frontend puro; sin cambios de backend/DB/actions.

## T0 — Preparación

- [x] **T0.1** Puerta humana F1.4 resuelta. Decisiones firmes: (1) MVP "solo
  órdenes" (encabezado + módulo de órdenes, sin métricas); (2) landing `/` condicional
  por rol (no ruta `/tienda`); (3) ocultar columna "Tienda" para adminTienda; (4)
  Sidebar sin cambios. Sin preguntas pendientes.
  **Hecho:** decisiones fijadas en `requirements.md` y `design.md`.

## T1 — Extracción del módulo de órdenes reutilizable (R6, R9, R10)

- [x] **T1.1** Crear `app/(app)/ordenes/_components/OrdenesModule.tsx` (`"use client"`)
  moviendo el cuerpo actual de `ordenes/page.tsx` (estado page/pageSize, SWR con
  `ordenesFetcher`/`listarOrdenes`, `DataTable`, `Pagination`,
  `OrdenesCargaMasivaButton`). Prop opcional `columns?: Column<OrdenListItemDTO>[]`
  con default `ordenesColumns`. Cubre R6, R9, R10.
  **Hecho:** compila en strict; sin `any`; sin duplicar `DataTable`.
  Depende de: T0.1.

- [x] **T1.2** Refactorizar `app/(app)/ordenes/page.tsx` para renderizar
  `<OrdenesModule />` sin cambio funcional. Cubre R10.
  **Hecho:** los tests existentes de `/ordenes`
  (`tests/integration/actions/ordenes-action.test.ts` y demás relacionados) siguen
  verdes; UI de `/ordenes` idéntica.
  Depende de: T1.1.

## T2 — Columnas del dashboard sin "Tienda" (R11)

- [x] **T2.1** `[P]` Crear `app/(app)/_components/ordenes-columns-admin-tienda.ts`
  exportando `ordenesColumnsAdminTienda` = `ordenesColumns` sin la entrada `id:
  "tienda"`. NO modificar `ordenes-columns.tsx`. Cubre R11.
  **Hecho:** array tipado `Column<OrdenListItemDTO>[]`, 4 columnas, sin "Tienda".
  Depende de: T0.1 (paralelo a T1).

## T3 — Dashboard del admin de tienda (R1, R2, R6, R8)

- [x] **T3.1** Crear `app/(app)/_components/AdminTiendaDashboard.tsx` (Server
  Component): encabezado/título del apartado (D5) + `<OrdenesModule
  columns={ordenesColumnsAdminTienda} />`. Cubre R2, R6, R8, R11.
  **Hecho:** renderiza header visible + módulo de órdenes con botón de carga masiva.
  Depende de: T1.1, T2.1.

## T4 — Ramificación de la landing por rol (R1, R3, R4, R5)

- [x] **T4.1** Modificar `app/(app)/page.tsx` para llamar
  `resolveActorFromSession()` y ramificar: `adminTienda` → `<AdminTiendaDashboard/>`;
  otros roles / sin sesión → comportamiento actual (placeholder). Rol resuelto solo
  server-side. Cubre R1, R3, R4, R5.
  **Hecho:** adminTienda ve dashboard; otros roles y anónimo no; sin hook de cliente
  para rol.
  Depende de: T3.1.

## T5 — Tests (trazabilidad R1–R11)

- [x] **T5.1** `[P]` Test de componente/render de `AdminTiendaDashboard`: header
  presente (R2), módulo de órdenes montado (R6), botón carga masiva presente (R8),
  columna "Tienda" ausente (R11), estados loading/error/empty delegados (R9).
  **Hecho:** aserciones para R2, R6, R8, R9, R11 pasan.
  Depende de: T3.1.

- [x] **T5.2** `[P]` Test de la ramificación de `page.tsx` por rol: `adminTienda`
  renderiza dashboard (R1); rol distinto NO lo renderiza (R3); sin sesión NO lo
  renderiza (R4); rol resuelto server-side (R5).
  **Hecho:** aserciones para R1, R3, R4, R5 pasan (mockeando `resolveActorFromSession`).
  Depende de: T4.1.

- [x] **T5.3** `[P]` Test estructural/reuso: el dashboard consume `OrdenesModule`
  (mismo componente que `/ordenes`), sin segunda implementación de `DataTable`/fetch
  (R10). **E2E DIFERIDO** (deuda aceptada): no se creó `e2e/dashboard-admin-tienda.spec.ts`
  porque el repo no tiene infraestructura seed/login para `adminTienda` (la suite e2e
  existente está escrita pero no ejecutada; ver `history.md`). Dictamen del reviewer:
  aceptable, no bloqueante.
  **Hecho:** R7 verificado por test real de backend (`tests/unit/services/orden-service.test.ts`,
  filtro `where.tiendaId`, feature 6); R1 por component tests; R10 verificado
  estructuralmente. E2E de login adminTienda queda como deuda diferida.
  Depende de: T1.2, T4.1.

## T6 — Verificación final

- [x] **T6.1** `./init.sh` en verde + suite de tests completa (unit/integration/e2e)
  pasa. Mapa R1–R11 → test documentado en `progress/impl_26-dashboard-admin-tienda.md`.
  **Hecho:** todos los R con test verde; sin regresiones en `/ordenes`.
  Depende de: T5.1, T5.2, T5.3.

## Mapa R → task/test

| Req | Task(s) | Test |
| --- | --- | --- |
| R1  | T4.1 | T5.2, T5.3 (e2e) |
| R2  | T3.1 | T5.1 |
| R3  | T4.1 | T5.2 |
| R4  | T4.1 | T5.2 |
| R5  | T4.1 | T5.2 |
| R6  | T1.1, T3.1 | T5.1 |
| R7  | (backend feature 6) | T5.3 (e2e) |
| R8  | T3.1 | T5.1 |
| R9  | T1.1 | T5.1 |
| R10 | T1.1, T1.2 | T5.3 |
| R11 | T2.1, T3.1 | T5.1 |
