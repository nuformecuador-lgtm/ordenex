# Review — ordenes - list (feature id 7, complexity high)

Reviewer: agente `reviewer`. Fecha: 2026-07-09.
Veredicto: **APROBADO** (0 bloqueantes).

## Checklist CHECKPOINTS

### Especificación
- [x] `specs/ordenes-list/requirements.md` con R1–R26 en EARS.
- [x] `specs/ordenes-list/design.md` con ≥1 alternativa descartada (4 documentadas).
- [x] `specs/ordenes-list/tasks.md` con TODAS las tasks en `[x]` (A1–A3, B1–B11, C1–C2, D1–D7, E1–E5, F1–F3).

### Trazabilidad
- [x] Cada R1–R26 mapea a ≥1 test concreto y real (tabla abajo).
- [x] `progress/impl_ordenes-list.md` contiene el mapa `R -> test`.

### Calidad de código (ejecutado por el reviewer)
- [x] `pnpm typecheck` (tsc --noEmit) — sin errores.
- [x] `pnpm lint` (eslint) — sin errores.
- [x] `pnpm test` (vitest run) — 37 archivos / 263 tests, todos verdes.
- [x] `./init.sh` — `== init OK ==` (aviso `.env` preexistente, no bloqueante).
- [x] Flujo crítico E2E: `/ordenes` es solo lectura sobre la action existente de la
      feature 6; el CRUD/auth de órdenes ya está cubierto por la feature 6. No se
      considera flujo crítico nuevo. No bloqueante.

### Datos y seguridad
- [x] Sin tabla nueva → no aplica RLS nueva. R25 es un `include`/`select` sobre la
      relación existente `Orden.tienda -> Usuario` (schema.prisma:238, no nullable).
- [x] Sin migración nueva (git status limpio en `db/`; init confirma down.sql en todas).
- [x] Sin secretos hardcodeados; sin hardcode de país/moneda/cuenta.
- [x] No hay webhooks en esta feature.

### Patrón de capas / permisos
- [x] Repository (`OrdenRepository.list`) solo query Prisma + mapeo DTO; sin lógica de negocio.
- [x] Service (`OrdenService.listar`) mantiene autorización por rol INTACTA (adminTienda
      fuerza `where.tiendaId`); solo propaga los items enriquecidos. Sin HTTP.
- [x] UI usa la Server Action existente `listarOrdenes` vía SWR; NO se creó API route
      (`find app/api -iname *orden*` vacío). No fetch a `app/api/*` (verificado en D7).
- [x] `DataTable<T>` es genérico y reutilizable: no importa tipos de `orden`; el dominio
      vive en `ordenes-columns.tsx` junto a la página.

## Verificación específica pedida

### DataTable genérico (`components/shared/DataTable.tsx`)
- [x] `Column<T> { id; value; render?: ((row:T)=>ReactNode) | keyof T | string }` — coincide con el contrato.
- [x] `rowKey` por defecto `row.id`; no usa índice cuando hay id.
- [x] Test render-FUNCIÓN (B2), render-STRING/clave (B3), SIN render por `column.id` (B4).
- [x] Estado vacío (B7), carga role=status (B8), error role=alert (B9), N filas y orden (B5).
- [x] Accesibilidad: `<table>` semántico, `<th scope="col">` verificado (B1), nombre accesible
      por ariaLabel (B1) y caption (B10).

### Vista `/ordenes` (`app/(app)/ordenes/page.tsx`)
- [x] Client Component con SWR; fetcher llama a la action existente `listarOrdenes({})`, throw si no-ok.
- [x] 5 columnas en orden: `numGuia`, `numRemision`, `estatus`, `destinatario`, `tienda`.
- [x] Columna `tienda` muestra `tiendaNombre` (nombre legible); D1 afirma que el uuid `tiendaId`
      NO aparece en el DOM.
- [x] Loading (D2), vacío "No hay órdenes" (D3), error genérico sin internals (D4).

### Backend (ampliación mínima feature 6)
- [x] DTO `OrdenListItemDTO = OrdenDTO & { tiendaNombre: string }`; `ListarOrdenesResult.items`
      pasa a `OrdenListItemDTO[]`. `OrdenDTO` (crear/obtener/actualizar) sin cambios.
- [x] `OrdenRepository.list` usa `WITH_ESTATUS_Y_TIENDA` y mapea `tiendaNombre = row.tienda.nombre`;
      `create/findById/update` siguen con `toDTO`/`WITH_ESTATUS` (sin tiendaNombre). CRUD intacto.
- [x] Autorización por rol intacta (service tests confirman `where.tiendaId` forzado para adminTienda).
- [x] Sin migración nueva.

### Antecedente de tests falsos (login) — verificado
- [x] `tests/components/DataTable.test.tsx`: RENDERIZA el componente real y ASEVERA sobre roles/th/td/
      texto. No tautologías (B4 verifica celda vacía real; B6 espía console.error por warnings de key).
- [x] `tests/components/OrdenesPage.test.tsx`: monta la PÁGINA real con SWR, mockea solo la action,
      y afirma mapeo celda a celda, ausencia del uuid, estados y que NO se llama a `fetch`.
- [x] `tests/unit/repositories/orden-repository.test.ts` y `orden-service.test.ts`: ejercitan `list`/
      `listar` reales y verifican `include`, mapeo de `tiendaNombre` y autorización sin re-filtrar.
- Ningún test falso detectado.

## Tabla R -> test (estado)

| R | Test | Estado |
| --- | --- | --- |
| R1 | DataTable.test B1 (tipo Row sin dominio) + genérico | OK |
| R2 | DataTable.test B1 | OK |
| R3a | DataTable.test B2 (render función) | OK |
| R3b | DataTable.test B3 (render string) | OK |
| R3c | DataTable.test B4 (sin render) | OK |
| R4 | DataTable.test B11 (id único) | OK |
| R5 | DataTable.test B1 | OK |
| R6 | DataTable.test B2 + OrdenesPage D1 (estatus/tienda) | OK |
| R7 | DataTable.test B3 + OrdenesPage D1 (numRemision) | OK |
| R8 | DataTable.test B4 + OrdenesPage D1 (numGuia/destinatario) | OK |
| R9 | DataTable.test B5 | OK |
| R10 | DataTable.test B6 | OK |
| R11 | DataTable.test B7 | OK |
| R12 | DataTable.test B8 | OK |
| R13 | DataTable.test B9 | OK |
| R14 | DataTable.test B10 | OK |
| R15 | DataTable.test B1 (th scope=col) | OK |
| R16 | DataTable.test B1 + B10 | OK |
| R17 | OrdenesPage D1 (columnas + page) | OK |
| R18 | OrdenesPage D1 + D7 (action, sin fetch API) | OK |
| R19 | OrdenesPage D1 | OK |
| R20 | OrdenesPage D2 (carga) + D3 (vacío) | OK |
| R21 | OrdenesPage D4 (no-ok + throw, sin internals) | OK |
| R22 | OrdenesPage D5 + orden-service R25/R26 (where.tiendaId) | OK |
| R23 | OrdenesPage D6 (sin controles ni acciones) | OK |
| R24 | OrdenesPage D1 (tiendaNombre, uuid ausente) | OK |
| R25 | orden-repository R25/R26 + orden-service R25/R26 | OK |
| R26 | orden-repository + orden-service + OrdenesPage D1 | OK |

## Hallazgos
- (menor) No se añadió E2E Playwright para `/ordenes`. Aceptable: vista de solo lectura
  sobre backend ya cubierto por la feature 6; no es flujo crítico nuevo. No bloqueante.

## Bloqueantes
- Ninguno.

## Veredicto final
**APROBADO** — 0 bloqueantes. La feature puede pasar a `done` (registrar entrada en
`progress/history.md` y actualizar `feature_list.json`).
