# Implementación — Feature 44: wallet, pago a mensajeros y cuentas por pagar (BACKEND)

> Autor: `backend_dev`. Worktree: `R:/ark-studio/projects/ricardo/ordenex-f44`.
> Alcance: capa BACKEND (bloques 1–6 + T17 reservado + T18). La UI (T14/T15/T16) la hace
> `frontend_dev`. F1.4 APROBADA: Qa=SÍ (egreso en caja 42), Qb=append-only+saldo derivado,
> Qc=automático al aprobar, Qd=`min(P,E)`, Qe=maestro `/wallet/mensajeros` + mensajero
> `/mis-pagos`, Qf=liquidación como FOLLOW-UP (solo reservado).

## Sección BACKEND — archivos tocados

### Creados
- `db/migrations/20260712180000_pago_mensajero_movimiento/migration.sql` (T2)
- `db/migrations/20260712180000_pago_mensajero_movimiento/down.sql` (T2)
- `lib/types/wallet-mensajero.ts` (T4)
- `lib/utils/cuenta-por-pagar.ts` (T5)
- `lib/interfaces/repositories/IPagoMensajeroMovimientoRepository.ts` (T6)
- `lib/repositories/PagoMensajeroMovimientoRepository.ts` (T6)
- `lib/interfaces/services/IWalletMensajeroFeedService.ts` (T8)
- `lib/services/WalletMensajeroFeedService.ts` (T8, CORAZÓN)
- `lib/interfaces/services/IWalletMensajeroService.ts` (T12)
- `lib/services/WalletMensajeroService.ts` (T12)
- `lib/actions/wallet-mensajero.ts` (T13, `'use server'`)
- `tests/integration/db/pago-mensajero-movimiento-migration.test.ts` (T3)
- `tests/integration/db/pago-mensajero-idempotencia.test.ts` (T7)
- `tests/integration/db/pago-mensajero-liquidacion.test.ts` (T17, reservado)
- `tests/unit/utils/cuenta-por-pagar.test.ts` (T5)
- `tests/unit/repositories/pago-mensajero-movimiento-repository.test.ts` (T6)
- `tests/unit/services/wallet-mensajero-feed-service.test.ts` (T9)
- `tests/unit/services/wallet-mensajero-service.test.ts` (T12)
- `tests/unit/actions/wallet-mensajero-actions.test.ts` (T13)

### Modificados
- `db/schema.prisma` (T1): enums `PagoMensajeroMovimientoTipo` (`devengo`/`pago`),
  `PagoMensajeroMovimientoCategoria` (`pago_devengado`/`pago_efectivo`/`liquidacion`/
  `ajuste_devengo`/`ajuste_pago`); modelo `PagoMensajeroMovimiento` + 2 índices; lados inversos
  en `model Usuario`. Reutiliza `WalletOrigenTipo` (sin enum de origen nuevo).
- `lib/repositories/CierresAdminRepository.ts` (T10): 2 deps nuevas por constructor
  (`IPagoMensajeroMovimientoRepository`, `IWalletMensajeroFeedService`); enganche en
  `resolverCierre` DENTRO de la misma `$transaction`, TRAS 42/43 — inserta el libro del pago Y
  (Qa) el egreso `egreso_pago_mensajero` en la caja 42 (idempotente, solo si P>0).
- `lib/actions/cierres-admin.ts` (T10): wiring `buildService` con las 2 deps nuevas.
- `tests/unit/repositories/cierres-admin-repository.test.ts` (T10): dobles del pago + 5 casos
  (R5/R17 libro+egreso, rechazar no alimenta, conflict no alimenta, R12 vencido una vez, R7
  rollback total).
- `tests/unit/services/cierres-admin-service.test.ts` (T11): `buildStack` extendido +
  `describe` nuevo (E<P → devengo/pago + egreso 42; P=0 → nada; vencido→aprobado una vez).
- `tests/unit/services/cierres-bodega-admin-service.test.ts` (T11): CierreBodega NO genera pago
  mensajero (R11).
- `tests/integration/db/wallet-idempotencia.test.ts` (42): construcción del repo con las 2 deps
  no-op del pago mensajero.
- `tests/integration/db/zonas-migration.test.ts`: exclusión `!d.endsWith("_pago_mensajero_movimiento")`.
- `specs/44-wallet-pago-mensajeros/tasks.md`: marcadas [x] las tareas BACKEND (T1–T13, T17, T18).

## Mapa R<n> → test (requisitos BACKEND)

| Req | Test |
| --- | --- |
| R1  | `wallet-mensajero-feed-service.test.ts` (fila inmutable devengo/pago) + schema.prisma (sin updatedAt/deletedAt) |
| R2  | `pago-mensajero-movimiento-repository.test.ts` (persiste mensajero_id/tipo/categoria/monto/origen) |
| R3  | `wallet-mensajero-service.test.ts` (sin update/delete; ajuste compensatorio) + `pago-mensajero-idempotencia.test.ts` (manual NO deduplica) |
| R4  | `cuenta-por-pagar.test.ts` (Decimal exacto, STRING 2 dec) |
| R5  | `cierres-admin-service.test.ts` (aprobar CierreDia genera pago) + `cierres-admin-repository.test.ts` |
| R6  | `pago-mensajero-idempotencia.test.ts` + `pago-mensajero-movimiento-migration.test.ts` (unique parcial) |
| R7  | `cierres-admin-repository.test.ts` (R7: fallo del pago revierte TODA la tx, incl. 42/43) |
| R8  | `wallet-mensajero-feed-service.test.ts` (lee P/E del cierre, un findUnique, no re-deriva) |
| R9  | `cuenta-por-pagar.test.ts` + `wallet-mensajero-feed-service.test.ts` (`pagado=min(P,E)`; `≤E`, `≤P`) |
| R10 | `wallet-mensajero-feed-service.test.ts` (P>0→devengo; pagado>0→pago; P=0→[]) + `cierres-admin-service.test.ts` |
| R11 | `cierres-bodega-admin-service.test.ts` (CierreBodega NO genera pago mensajero) |
| R12 | `cierres-admin-service.test.ts` + `cierres-admin-repository.test.ts` (vencido→aprobado una vez) |
| R13 | `wallet-mensajero-feed-service.test.ts` (netting POR CIERRE; dos cierres no se cruzan) |
| R14 | `cuenta-por-pagar.test.ts` (cuenta = Σdevengo − Σpago) + `pago-mensajero-movimiento-repository.test.ts` (agrega sin saldo almacenado) |
| R15 | `wallet-mensajero-feed-service.test.ts` (invariante `pago_devengado = pago_efectivo + cuenta`; `Σdevengo = Σsnapshot`; egreso 42 cuadra) |
| R16 | `cuenta-por-pagar.test.ts` + `wallet-mensajero-service.test.ts` (positivo/cero, nunca negativo; STRING) |
| R17 | `wallet-mensajero-feed-service.test.ts` (egreso `egreso_pago_mensajero=P`) + `cierres-admin-service.test.ts` + `cierres-admin-repository.test.ts` + `pago-mensajero-movimiento-migration.test.ts` (enum 42 reservado) |
| R18 | `wallet-mensajero-service.test.ts` + `wallet-mensajero-actions.test.ts` (maestro ve a todos) — page test (R18/R21) queda para FE |
| R19 | `wallet-mensajero-service.test.ts` + `wallet-mensajero-actions.test.ts` (maestro no acotado; otro rol → forbidden) |
| R20 | `wallet-mensajero-service.test.ts` (mensajero acotado a su mensajero_id en el WHERE) + `pago-mensajero-movimiento-repository.test.ts` |
| R21 | Server Action expone STRING (todos los `*-actions.test.ts`); page/Server Component es FE (T15) |
| R22 | `wallet-mensajero-service.test.ts` + `pago-mensajero-movimiento-repository.test.ts` (filtros cierre/fecha/mensajero en el WHERE) |
| R23 | `pago-mensajero-liquidacion.test.ts` (liquidacion + origen pago_mensajero RESERVADOS; el acto NO se implementa) |
| R24 | `pago-mensajero-movimiento-migration.test.ts` (RLS sin policies anon/authenticated) |
| R25 | `pago-mensajero-movimiento-migration.test.ts` (down reversible; enums 42 intactos) |
| R26 | `pago-mensajero-movimiento-migration.test.ts` (2 índices + unique parcial de idempotencia) |
| R27 | Transversal STRING en todos los `*-actions.test.ts` + DTOs; grep `parseFloat`/`Number(` limpio (T18) |

## Verificación ejecutada (sin tocar la DB local)

- `prisma validate` (con DATABASE_URL dummy, NO conecta): **The schema at db\schema.prisma is valid.**
- `prisma generate` (NO conecta): cliente regenerado con los tipos de `PagoMensajeroMovimiento`.
- `pnpm run typecheck`: **0 errores**.
- `pnpm run lint`: **0 errores** (135 warnings, todos en `.claude/skills/impeccable/scripts/*.mjs`
  pre-existentes, ninguno en archivos de la feature 44; `eslint` sobre los 11 fuentes nuevos/modif
  de la 44 = EXIT 0).
- `pnpm test` (suite completa, SIN DB viva): **240 archivos, 2168 tests, todos verdes.**
  - Subconjunto feature 44 (11 archivos): **145 tests verdes.**
- T18 money-safe: grep `parseFloat`/`Number(` sobre montos en fuentes 44 = solo un comentario,
  cero uso real.

## Notas / desviaciones del spec (corregidas con criterio)

1. **Nombre del test de migración (colisión de nombre).** El nombre que pedía T3
   (`tests/integration/db/pago-mensajero-migration.test.ts`) YA EXISTE: es el test de la feature 39
   (migración `_pago_mensajero_cierre`, commit 941ea7c). Para NO clobbear la cobertura de la 39,
   el test de la 44 se creó como `tests/integration/db/pago-mensajero-movimiento-migration.test.ts`
   (coincide con la carpeta de migración `_pago_mensajero_movimiento`).
2. **Firma del feed (single-read + egreso Qa).** `construirMovimientosDePago(cierreId, tx)` devuelve
   `{ libro, egresoCaja }` en vez de solo `CrearPagoMensajeroInput[]`. Un ÚNICO `findUnique` del
   cierre produce el libro (devengo + pago) Y el egreso `egreso_pago_mensajero=P` de la caja 42
   (Qa=SÍ FIRME), evitando un segundo read y manteniendo la regla `min(P,E)` en un solo punto. El
   borde P=0 devuelve `{ libro: [], egresoCaja: [] }` (equivalente al `[]` del spec).
3. **Egreso Qa reutiliza el repo de la 42.** El enganche inserta el egreso con el
   `walletMovimientoRepo` YA inyectado (constraint existente `(origen_tipo, origen_id, categoria)`
   → un egreso por cierre). Se toca la caja 42 SOLO si hay egreso (P>0); así los tests existentes
   de 42/43 que asumen "el repo de la 42 se llama una vez" siguen válidos.
4. **Sin flag de config para Qa.** Como Qa quedó FIRME (SÍ), el egreso se emite siempre que P>0;
   no se añadió un interruptor de config (a diferencia del Q3 de la 43). Si el negocio quisiera
   diferirlo, sería una adición de config sin cambio de esquema (enums ya reservados).
5. **`OrdenesModuleReuse.test.tsx` (FE, ajeno a la 44).** En una corrida de la suite completa
   apareció 1 fallo por polución de DOM entre archivos FE (aislado pasa; ninguna relación con
   backend). En la corrida siguiente la suite quedó 100% verde. No lo toqué (es FE y no lo altera
   ningún cambio de backend).

## Veredicto

BACKEND de la feature 44 COMPLETO y money-safe: modelo + migración reversible con RLS/idempotencia,
feed que consume snapshots (`min(P,E)`) con egreso Qa en la caja 42, enganche atómico en el cierre,
services/actions maestro+mensajero, y liquidación reservada — `prisma validate`/typecheck/lint/test
todos verdes (2168 tests).

---

## FIX del review (RECHAZADO — Bloqueantes 1 y 2: vista del MAESTRO)

> Autor: `backend_dev`. Corrige los DOS bloqueantes de `progress/review_44-wallet-pago-mensajeros.md`
> (R18: desglose por cierre paginado del maestro; R22: filtros server-side fecha/cierre con el saldo
> del conjunto filtrado). Raíz única: faltaba la capa **service + Server Action del maestro** que
> exponga `repo.listarPorMensajero`/`agregarCuentaPorPagar` para un mensajero ARBITRARIO. NO se tocó
> modelo/migración/feed/enganche/idempotencia/RLS ni la vista del mensajero `/mis-pagos`. Sin DB viva.

### Archivos modificados (fix)
- `lib/types/wallet-mensajero.ts` — nuevo DTO de resultado `ListarPagosDeMensajeroResult` (montos
  STRING; añade `mensajeroId`/`mensajeroNombre` al payload del desglose) + schema de borde
  `listarPagosDeMensajeroSchema` (deriva del base con `.extend`: `mensajeroId` **REQUERIDO** para el
  maestro) + type `ListarPagosDeMensajeroInput`.
- `lib/interfaces/repositories/IPagoMensajeroMovimientoRepository.ts` — nuevo método de lectura
  `obtenerNombreMensajero(mensajeroId): Promise<string | null>` (para poblar `mensajeroNombre`; no
  toca el modelo/migración).
- `lib/repositories/PagoMensajeroMovimientoRepository.ts` — impl `obtenerNombreMensajero`
  (`usuario.findUnique` select `nombre`; null si no existe).
- `lib/interfaces/services/IWalletMensajeroService.ts` — nuevo result `ListarPagosDeMensajeroServiceResult`
  + método `listarPagosDeMensajero(input, actor)`.
- `lib/services/WalletMensajeroService.ts` — impl `listarPagosDeMensajero`: **gated a `maestro`**
  (mismo patrón que `listarCuentasPorPagar`; otro rol → `forbidden`); a diferencia de
  `listarMisPagos` usa el `mensajeroId` **del input** (el maestro elige, no acotado a sí mismo);
  delega en `repo.listarPorMensajero({mensajeroId,page,pageSize,cierreId?,desde?,hasta?})` (desglose
  por cierre paginado, fecha desc) + `repo.agregarCuentaPorPagar(mensajeroId, {cierreId,desde,hasta})`
  (saldo del **conjunto filtrado**, R22) + `repo.obtenerNombreMensajero`; DTO STRING vía
  `derivarCuentaPorPagar` (Prisma.Decimal, cero `parseFloat`/`Number(`).
- `lib/actions/wallet-mensajero.ts` — nueva Server Action `listarPagosDeMensajeroAction(input, deps)`:
  resuelve actor, `unauthenticated` sin sesión, zod `listarPagosDeMensajeroSchema` (`mensajeroId`
  faltante/vacío → `validation_error`), delega bajo `withErrorHandler`, mapea
  `validation_error`/`forbidden`. Espejo de `listarMisPagosAction` pero SIN acotar a
  `actor.usuarioId` (el service gatea a maestro).
- `tests/unit/services/wallet-mensajero-service.test.ts` — describe nuevo `listarPagosDeMensajero`
  (4 tests: desglose de mensajero arbitrario paginado + nombre; filtros fecha/cierre en el WHERE del
  listado Y de la cuenta; nombre inexistente → ''; rol no maestro → forbidden sin tocar el repo).
- `tests/unit/actions/wallet-mensajero-actions.test.ts` — describe nuevo
  `listarPagosDeMensajeroAction` (5 tests: unauthenticated; `mensajeroId` faltante → validation_error;
  `mensajeroId` vacío → validation_error; rol no maestro → forbidden; maestro → ok con desglose +
  cuenta STRING del conjunto filtrado).
- `tests/unit/repositories/pago-mensajero-movimiento-repository.test.ts` — describe nuevo
  `obtenerNombreMensajero` (2 tests: devuelve nombre con where/select correctos; inexistente → null).
- `tests/unit/repositories/cierres-admin-repository.test.ts` y
  `tests/integration/db/wallet-idempotencia.test.ts` — dobles del repo actualizados con
  `obtenerNombreMensajero: vi.fn()` (mocks del contrato completo; typecheck).

### Mapa R18/R22 → test (fix)
| Req | Test (backend, fix) |
| --- | --- |
| R18 | `wallet-mensajero-service.test.ts` › `listarPagosDeMensajero` (maestro obtiene el DESGLOSE por cierre de un mensajero ARBITRARIO, paginado, fecha desc, con nombre) + `wallet-mensajero-actions.test.ts` › `listarPagosDeMensajeroAction` (ok con desglose) + `pago-mensajero-movimiento-repository.test.ts` › `obtenerNombreMensajero` |
| R22 | `wallet-mensajero-service.test.ts` › `listarPagosDeMensajero` (filtros cierre/fecha en el WHERE del listado Y de la cuenta; el saldo refleja el conjunto filtrado) + `wallet-mensajero-actions.test.ts` (mensajeroId requerido → validation_error; camino feliz con filtro) |

### Server Action entregada al FRONTEND (firma exacta)
```ts
// lib/actions/wallet-mensajero.ts
export async function listarPagosDeMensajeroAction(
  input: unknown,                       // parseado por listarPagosDeMensajeroSchema (mensajeroId REQUERIDO)
  deps?: WalletMensajeroDeps,           // opcional: { service?, getActor? } — en prod se omite
): Promise<ListarPagosDeMensajeroActionResult>;

// input (zod listarPagosDeMensajeroSchema): {
//   mensajeroId: string;               // REQUERIDO (el maestro elige)
//   page?: number;  pageSize?: number; // default 1 / 20 (pageSize max 100)
//   cierreId?: string; desde?: Date; hasta?: Date;  // filtros server-side (R22)
// }

// ListarPagosDeMensajeroActionResult =
//   | { status: "ok"; data: ListarPagosDeMensajeroResult }
//   | { status: "forbidden" }        // rol != maestro
//   | { status: "unauthenticated" }  // sin sesión
//   | { status: "validation_error"; fieldErrors: Record<string, string[]> }

// ListarPagosDeMensajeroResult (montos STRING):
//   { mensajeroId: string; mensajeroNombre: string;
//     movimientos: PagoMensajeroMovimientoDTO[]; total: number; page: number; pageSize: number;
//     cuenta: CuentaPorPagarDTO /* del conjunto filtrado */ }
```

### Verificación (fix, sin tocar la DB local)
- `pnpm run typecheck`: **0 errores**.
- `pnpm run lint`: **0 errores** (135 warnings, TODOS en `.claude/skills/impeccable/scripts/*.mjs`
  pre-existentes; ninguno en la 44).
- `pnpm test` (suite completa, SIN DB viva): **242 archivos, 2188 tests, todos verdes** (+11 tests
  vs. la corrida del review: service +4, action +5, repo +2).
- Money-safe: grep `parseFloat`/`Number(`/`.toNumber(` sobre los fuentes tocados = solo un
  comentario en el repo, cero uso real.

### Veredicto (fix)
Bloqueantes 1 y 2 CERRADOS: el maestro obtiene el desglose por cierre paginado (R18) y filtra
server-side por fecha/cierre con el saldo del conjunto filtrado (R22), vía `listarPagosDeMensajero`
+ `listarPagosDeMensajeroAction`, money-safe (STRING) — typecheck/lint/test verdes (2188). Falta
solo el wire de UI (`frontend_dev`) que consuma `listarPagosDeMensajeroAction`.

---

# Sección FRONTEND — Feature 44 (T14/T15/T16)

> Autor: `frontend_dev`. Worktree: `R:/ark-studio/projects/ricardo/ordenex-f44`.
> Alcance: capa de presentación (Bloque 7). No se tocó backend, DB ni migraciones. Consume las
> Server Actions ya entregadas (`lib/actions/wallet-mensajero.ts`); montos SIEMPRE STRING (sin
> `parseFloat`/`Number(`/aritmética en cliente). Espejo de la feature 43 (`/wallet/tiendas` y
> `/mi-wallet`).

## FRONTEND — archivos creados

### T14 — Vista del MAESTRO `/wallet/mensajeros` (R18/R19/R21/R22)
- `app/(app)/wallet/mensajeros/page.tsx` — Server Component role-aware (`maestro`; `notFound()`
  para cualquier otro rol o sin sesión). Pre-fetch `listarCuentasPorPagarAction`; props STRING.
  Defensa en profundidad: status != `ok` → `notFound`.
- `app/(app)/wallet/mensajeros/_components/CuentasPorPagarTable.tsx` — tabla semántica accesible
  (una fila por mensajero: devengado / pagado / cuenta por pagar + badge de estado por signo);
  filtro client-side por nombre; filas expandibles (aria-expanded/aria-controls) al desglose.
- `app/(app)/wallet/mensajeros/_components/DesglosePagosMensajero.tsx` — panel expandible con el
  split devengado / pagado / pendiente del mensajero (region etiquetada).
- `app/(app)/wallet/mensajeros/_components/CuentasPorPagarFiltros.tsx` — búsqueda por mensajero
  (searchbox, client-side sobre la lista ya pre-obtenida).
- `app/(app)/wallet/mensajeros/_components/wallet-mensajeros-labels.ts` — labels es-CR + `money`
  (antepone `₡` a la STRING; sin parseo).
- `tests/integration/wallet-mensajeros-page.test.tsx` — 5 tests (rol/acceso + props STRING).

### T15 — Vista propia del MENSAJERO `/mis-pagos` (R20/R21)
- `app/(app)/mis-pagos/page.tsx` — Server Component role-aware (`mensajero`; `notFound()` para
  otro rol o sin sesión). Pre-fetch `verMiCuentaPorPagarAction` + `listarMisPagosAction` (backend
  acota a `actor.usuarioId`; la página nunca pasa `mensajero_id`); props STRING. Defensa en
  profundidad.
- `app/(app)/mis-pagos/_components/MisPagosModule.tsx` — módulo cliente (espejo de
  `MiWalletModule`): tarjeta de cuenta + filtros inline (cierre + rango de fechas) + desglose +
  paginación; recarga vía `listarMisPagosAction`; errores por toast.
- `app/(app)/mis-pagos/_components/CuentaPorPagarCard.tsx` — tarjeta de cuenta por pagar
  (cuentaPorPagar destacada + devengado/pagado; badge de signo).
- `app/(app)/mis-pagos/_components/DesglosePagos.tsx` — tabla del libro (via `DataTable` shared)
  por cierre/concepto; badge por tipo (devengo/pago).
- `app/(app)/mis-pagos/_components/mis-pagos-labels.ts` — labels es-CR + `money`.
- `tests/integration/mis-pagos-page.test.tsx` — 4 tests (rol/acceso + props STRING + borde cero).

### T16 — E2E
- `e2e/wallet-mensajeros.spec.ts` — escrito (NO ejecutado, convención del repo): acceso del
  maestro a `/wallet/mensajeros` (tabla + expandir desglose + filtro por mensajero), bloqueo de
  rol no autorizado, acceso del mensajero a `/mis-pagos` (cuenta + desglose), bloqueo de
  no-mensajero. Patrón de `e2e/wallet.spec.ts` / `e2e/mi-wallet.spec.ts`.

### Modificados
- `specs/44-wallet-pago-mensajeros/tasks.md`: marcadas `[x]` T14/T15/T16.

## Mapa R18–R22 → test (FRONTEND)

| Req | Test |
| --- | --- |
| R18 | `wallet-mensajeros-page.test.tsx` (maestro ve cuentas por pagar de todos; tabla montada + props) + `e2e/wallet-mensajeros.spec.ts` (tabla + desglose) |
| R19 | `wallet-mensajeros-page.test.tsx` (rol != maestro / sin sesión → `notFound`, sin pre-fetch; forbidden → `notFound`) + `e2e` (bloqueo de rol) |
| R20 | `mis-pagos-page.test.tsx` (rol != mensajero → `notFound`, sin pre-fetch; forbidden → `notFound`; la página no pasa mensajero_id) + `e2e` (mensajero ve lo suyo / no-mensajero bloqueado) |
| R21 | `wallet-mensajeros-page.test.tsx` + `mis-pagos-page.test.tsx` (datos vía Server Component → props STRING, `typeof === "string"`, sin Decimal al cliente) |
| R22 | `CuentasPorPagarFiltros` (filtro por mensajero, client-side) + `MisPagosModule` (filtros cierre/fecha recargan por Server Action, cuenta refleja el conjunto filtrado) |

## Verificación FRONTEND ejecutada (sin DB)

- `pnpm run typecheck`: **0 errores**.
- `pnpm run lint`: **0 errores** (135 warnings, todos en `.claude/skills/impeccable/scripts/*.mjs`
  pre-existentes; NINGUNO en archivos de la 44 — grep de `wallet/mensajeros`/`mis-pagos` = limpio).
- `pnpm test` (suite completa): **242 archivos, 2177 tests, todos verdes** (incl. las 2 páginas
  nuevas y el flaky conocido `OrdenesModuleReuse.test.tsx`, que en esta corrida pasó).
  - Subconjunto FE nuevo (2 archivos): **9 tests verdes** en aislamiento.

## Notas / desviaciones FRONTEND

1. **Menú/sidebar NO tocado (por diseño).** Las features 42/43 NO registraron sus rutas
   (`/wallet`, `/mi-wallet`, `/wallet/tiendas`) en `lib/auth/menu-visibility.ts` (única fuente de
   verdad del `Sidebar`). Siguiendo EXACTAMENTE ese patrón, la 44 tampoco añade enlaces a
   `/wallet/mensajeros` ni `/mis-pagos`. Si se decide exponerlos en el menú, sería un cambio
   transversal para 42/43/44 juntas (fuera del alcance de esta feature).
2. **Filtros del maestro limitados por el backend disponible.** `listarCuentasPorPagarAction`
   devuelve el AGREGADO por mensajero (una fila por mensajero), SIN filtros server-side de
   fecha/cierre ni desglose por cierre. Por eso: (a) el filtro del maestro (R22) es por MENSAJERO
   (búsqueda client-side sobre la lista ya pre-obtenida, solo strings, money-safe); (b)
   `DesglosePagosMensajero` muestra el split del agregado (devengado/pagado/pendiente), no el
   desglose por cierre. Un desglose por cierre + filtros fecha/cierre para el maestro requeriría
   una Server Action nueva del maestro (backend, fuera del alcance FE). La vista del MENSAJERO
   (`/mis-pagos`) SÍ filtra por cierre/fecha porque `listarMisPagosAction` lo soporta.
3. **Sin primitiva `components/ui/table.tsx`.** El repo no tiene una `Table` de shadcn; la
   convención es el `DataTable` compartido (usado en `/mi-wallet` y `/wallet/tiendas`). Se reutiliza
   `DataTable` en `DesglosePagos`; para la tabla del maestro con filas expandibles se escribió una
   `<table>` semántica accesible (scope/aria-expanded/aria-controls), ya que `DataTable` no soporta
   filas de detalle.
4. **`mis-pagos` sin archivo de filtros propio.** La lista de archivos de T15 no incluye un
   componente de filtros; para respetarla, los filtros (cierre + rango de fechas) se inlinearon en
   `MisPagosModule` (mismo comportamiento que `MiWalletFiltros` de la 43, sin crear archivo extra).

## Veredicto FRONTEND

FRONTEND de la feature 44 COMPLETO y money-safe: vista del maestro (`/wallet/mensajeros`) y vista
propia del mensajero (`/mis-pagos`), role-aware con `notFound`, montos STRING pre-obtenidos en el
Server Component, E2E escrito — typecheck/lint/test todos verdes (2177 tests).

---

## FIX del review (FRONTEND — Bloqueantes 1 y 2: vista del MAESTRO)

> Cierre de los 2 bloqueantes del reviewer en `/wallet/mensajeros`, cableando la Server Action del
> maestro que `backend_dev` dejó lista (`listarPagosDeMensajeroAction`). Fix ACOTADO de UI. La nota
> #2 de arriba ("filtros del maestro limitados por el backend disponible") queda SUPERADA por este
> cableado.

### Archivos modificados (fix FRONTEND)

- `app/(app)/wallet/mensajeros/_components/DesglosePagosMensajero.tsx`: **reescrito**. Al EXPANDIR
  un mensajero, ahora carga client-side (SWR → `listarPagosDeMensajeroAction`, patrón `OrdenesModule`;
  NO fetch a `/api`) el **DESGLOSE POR CIERRE** paginado (más reciente primero: el backend lo ordena
  desc, la UI preserva el orden) en lugar del split del agregado. Añade **filtros server-side por
  cierre y rango de fechas** (R22); al aplicarlos SWR re-obtiene y el **saldo mostrado**
  (devengado/pagado/cuenta por pagar) sale de `result.data.cuenta`, es decir del **conjunto
  filtrado**. Money-safe: montos STRING renderizados tal cual con `money`, sin `parseFloat`/`Number`.
  Antes de la 1ª carga el saldo usa el resumen agregado que ya llegó por props.
- `app/(app)/wallet/mensajeros/_components/wallet-mensajeros-labels.ts`: añadidas etiquetas
  i18n-ready del desglose por cierre (`TIPO_PAGO_LABEL`, `CATEGORIA_PAGO_LABEL`, `ORIGEN_PAGO_LABEL`
  + `origenLabel`, `DESGLOSE_COLUMNAS`, `DESGLOSE_FILTRO_LABEL`, `DESGLOSE_VACIO`).
- `app/(app)/wallet/mensajeros/_components/CuentasPorPagarTable.tsx`: comentario de cabecera
  actualizado (cada fila ahora expande el desglose POR CIERRE con filtros server-side). La tabla ya
  pasaba `resumen={m}` + `id={detalleId}` → firma compatible sin cambios de props.
- `app/(app)/wallet/mensajeros/_components/CuentasPorPagarFiltros.tsx`: comentario actualizado (el
  filtro por mensajero es de la tabla-resumen; los filtros fecha/cierre viven en el desglose
  expandido). La tabla-resumen agregada por mensajero se mantiene TAL CUAL.
- `tests/integration/wallet-mensajeros-page.test.tsx`: **extendido** con 4 tests que montan el
  `DesglosePagosMensajero` real (SWRConfig con cache aislada, `listarPagosDeMensajeroAction`
  mockeada): (a) al expandir carga el desglose por cierre paginado con la action invocada como
  `{ mensajeroId, page:1, pageSize:20 }` y las filas en orden desc; (b) aplicar filtros invoca la
  action con `cierreId/desde/hasta` y `page:1`; (c) el saldo mostrado usa `result.data.cuenta` del
  conjunto filtrado (₡2000.00 → ₡1500.00). Los tests de control de acceso por rol (notFound) intactos.
- `e2e/wallet-mensajeros.spec.ts`: **extendido** (escrito, no ejecutado; convención del repo) — el
  flujo del maestro ahora expande el desglose POR CIERRE, verifica la tabla
  `Desglose por cierre de <nombre>` y ejercita el filtro server-side por rango de fecha (Aplicar).

### Mapa R18/R22 → test (fix FRONTEND)

| Req | Test |
| --- | --- |
| R18 | `wallet-mensajeros-page.test.tsx` › "al expandir carga el desglose por cierre paginado, mas reciente primero" (action `{ mensajeroId, page, pageSize }`, filas orden desc, montos STRING) + `e2e/wallet-mensajeros.spec.ts` (tabla `Desglose por cierre de <nombre>`) |
| R22 | `wallet-mensajeros-page.test.tsx` › "aplica los filtros invocando la action con cierreId/desde/hasta" + "el saldo mostrado refleja el CONJUNTO FILTRADO (result.data.cuenta)" + `e2e` (filtro server-side por rango de fecha en el desglose) |

### Verificación (fix FRONTEND, sin DB)

- `pnpm run typecheck`: **0 errores**.
- `pnpm run lint`: **0 errores** (135 warnings, todos pre-existentes en
  `.claude/skills/impeccable/scripts/*.mjs`; ninguno en archivos de la 44).
- `pnpm test` (suite completa): **242 archivos, 2191 tests, todos verdes** (incl. el flaky conocido
  `OrdenesModuleReuse.test.tsx`, que pasó). Subconjunto `wallet-mensajeros-page.test.tsx`: **7 tests
  verdes** (3 de acceso por rol + 4 nuevos del desglose/filtros).

### Veredicto (fix FRONTEND)

Bloqueantes 1 y 2 CERRADOS en la UI: el maestro, al expandir un mensajero en `/wallet/mensajeros`,
ve el DESGLOSE por cierre paginado (R18) y filtra server-side por fecha/cierre con el saldo del
conjunto filtrado (R22), consumiendo `listarPagosDeMensajeroAction`. Sin tocar backend/DB/rutas.
