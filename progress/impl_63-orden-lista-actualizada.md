# impl 63 — Orden lista actualizada (BACKEND, Grupos A + B)

> Alcance de esta bitacora: SOLO backend (Grupos A y B + tests D1). El frontend
> (Grupo C: primitiva Tabs, `OrdenesTabs`, wiring de page) es de `frontend_dev` en
> un paso posterior. NO se tocaron UI/componentes/paginas.

## Columna real de estado en Orden

`db/schema.prisma` -> `model Orden { estatusId String @map("estatus_id") ... }`.
La clave PUBLICA del filtro es `status_id`; el mapa `FILTER_TO_COLUMN = { status_id:
"estatusId" }` (campo Prisma) es el unico punto que conoce el nombre interno.

## Archivos tocados

Creados:
- `lib/actions/order-status.ts` — Server Action `listarOrderStatus()` (A2).
- `tests/unit/actions/order-status.test.ts` — R1-R4.
- `tests/unit/types/orden-filter.test.ts` — R6/R7/R11.

Modificados:
- `lib/types/order-status.ts` — tipo `ListarOrderStatusResult` discriminado (A1).
- `lib/types/orden.ts` — `ordenFilterSchema` (`.strict()`), `ORDEN_FILTER_FIELDS`,
  `filter?` en `listarOrdenesSchema` (B1).
- `lib/services/OrdenService.ts` — `FILTER_TO_COLUMN` + traduccion `filter.status_id`
  -> `where.estatusId` con precedencia sobre el escalar, componiendo con el alcance
  por rol (B2).
- `lib/repositories/OrdenRepository.ts` — `orderBy: { value: "asc" }` en
  `listOrderStatus()` (A3, R5).
- `tests/unit/services/orden-service.test.ts` — describe nuevo R8/R9/R10.
- `tests/unit/repositories/orden-repository.guia.test.ts` — caso R5 orderBy.

NOTA: NO se relajo la autz de `listarCatalogoEstatus()` (feature 17): sigue en
maestro/admin. `listarOrderStatus()` es accion NUEVA con autz "todos excepto
mensajero".

## Mapa R -> test

| R | Test |
| --- | --- |
| R1 | `tests/unit/actions/order-status.test.ts` -> ok con `{id,value}` |
| R2 | idem -> `it.each(["maestro","admin","adminTienda","adminSatelite"])` ok |
| R3 | idem -> sin sesion -> `unauthenticated`, repo NO llamado |
| R4 | idem -> mensajero + rol desconocido -> `forbidden`, repo NO llamado |
| R5 | `tests/unit/repositories/orden-repository.guia.test.ts` -> `orderBy {value:asc}` |
| R6 | `tests/unit/types/orden-filter.test.ts` -> acepta `filter.status_id`; filter opcional |
| R7 | idem -> clave fuera de whitelist -> ZodError; `status_id` vacio -> ZodError |
| R8 | `tests/unit/services/orden-service.test.ts` -> `filter.status_id` -> `where.estatusId` (+precedencia); whitelist == ['status_id'] |
| R9 | idem -> filter + adminTienda acotado a su tienda |
| R10 | idem -> sin filter = comportamiento previo; `estatusId` escalar sigue |
| R11 | `tests/unit/types/orden-filter.test.ts` -> ni `estatusId` ni `deletedAt` ni `tiendaId` pasan el `.strict()` |

## Verificacion

`pnpm typecheck`: 0 errores en archivos de la feature 63. Los errores que quedan son
PRE-EXISTENTES del baseline `adjustments` (drift tarifas/zonas/usuarios), ajenos a
esta feature: `lib/repositories/TarifaVigentePorZonaRepository.ts`, `scripts/seed-zonas.ts`,
`tests/**/tarifa-*`, `tests/**/usuario-*`, `auth-service`, `postulacion-login-regresion`,
`asignacion-mensajero-service`, `rol-admin-satelite-authz`. Ninguno introducido aqui.

`pnpm vitest run` de los 4 archivos tocados/creados:
```
Test Files  4 passed (4)
Tests  78 passed (78)
```
Tests NUEVOS de la feature 63: 20 (8 action + 6 filter-types + 5 service filter + 1 repo R5).

## Veredicto

R1-R11 hechos; typecheck 0 en lo propio (rojos restantes pre-existentes); 20 tests
nuevos verdes, 78 verdes en los archivos tocados. Sin rojos nuevos.

---

# impl 63 — Orden lista actualizada (FRONTEND, Grupo C + tests)

> Alcance: SOLO frontend (Grupo C: primitiva Tabs, `OrdenesModule.filter`,
> `OrdenesTabs`, wiring de page + tests R12-R20). NO se tocó `lib/` de backend,
> repos, services ni schemas.

## Primitiva Tabs (C1)

`components/ui/tabs.tsx` creado MANUALMENTE (no vía `npx shadcn add tabs`): este
repo NO usa `@radix-ui` sino `@base-ui/react` (style `base-nova` en
`components.json`), igual que `select.tsx`/`collapsible.tsx`/`sheet.tsx`. La
primitiva envuelve `@base-ui/react/tabs` (`Root/List/Tab/Panel`) exponiendo los
nombres canónicos shadcn `Tabs/TabsList/TabsTrigger/TabsContent`. Correr el CLI
habría instalado deps de Radix, en conflicto con el stack base-ui del repo.

## Archivos tocados

Creados:
- `components/ui/tabs.tsx` — primitiva Tabs sobre base-ui (C1, R12/R18).
- `app/(app)/ordenes/_components/OrdenesTabs.tsx` — tabs + lazy loading duro (C3/C4).
- `tests/unit/components/ordenes-tabs.test.tsx` — R12-R18, R20 (11 tests).
- `tests/unit/components/ordenes-module.test.tsx` — R19 con/sin filter (3 tests).

Modificados:
- `app/(app)/ordenes/_components/OrdenesModule.tsx` — prop opcional
  `filter?: { status_id: string }`; se inyecta a `listarOrdenes` y entra en la key
  SWR `["ordenes:list", statusId, page, pageSize]` (C2, R15/R17). Sin la prop,
  input y comportamiento idénticos (R10/R19). Se quitó un `console.log` de debug.
- `app/(app)/ordenes/page.tsx` — wiring por rol (C5): `maestro`/`admin`/
  `adminTienda` -> `OrdenesTabs` con `exclude` por rol (default `["pendiente"]`);
  `adminSatelite`/`mensajero`/sin-sesión -> `OrdenesModule` plano (R20, sin
  regresión). `adminSatelite` FUERA del v1 (F1.4-h). La carga masiva se ofrece a
  nivel del contenedor `OrdenesTabs` (solo adminTienda).

Reparación de drift AJENO a la 63 (bloqueaba el parseo de TODOS los tests que
importan `OrdenesModule`):
- `app/(app)/ordenes/_components/ordenes-columns.tsx` — el render de la columna
  "flete" tenía un error de sintaxis de una edición a medias de OTRA sesión
  (`const ` colgante, `console.log`, `<PriceLabel value={} />`). Se reparó SOLO
  ese render a un estado válido (usa `toValidNumber`). Los renombres de headers
  ("Estatus"->"Estado", "Flete"->"Flete + IVA") son de esa misma sesión, NO se
  tocaron.

## Decisiones clave

- **`exclude` en el FRONT (aclaración humano):** `estados.filter(e => !exclude
  .includes(e.value)).map(...)`. El backend NO recibe `exclude`; `listarOrderStatus()`
  devuelve el catálogo COMPLETO y el front omite (por `value`, default `["pendiente"]`).
- **Lazy loading DURO (R16):** montaje diferido por tab visitada (set `visited`,
  patrón "ajustar estado durante el render"). Una tab nunca visitada NO monta su
  `OrdenesModule` -> NO invoca `listarOrdenes`. `keepMounted` en el Panel conserva
  el estado/paginación de las tabs ya visitadas (R17). No basta CSS.

## Mapa R -> test

| R | Test |
| --- | --- |
| R12 | `ordenes-tabs.test.tsx` -> `tablist` + 1 tab por estado mostrado |
| R13 | idem -> `pendiente` (default) y `exclude` custom no generan tab |
| R14 | idem -> tabs derivadas del catálogo (etiquetas legibles) |
| R15 | idem -> tab activa consulta `listarOrdenes` con `filter.status_id` |
| R16 | idem -> tab no visitada NO invoca `listarOrdenes`; al activarla, recién ahí consulta |
| R17 | idem -> cada tab monta su `OrdenesModule` (paginación propia por status) |
| R18 | idem -> `TabsList` con `overflow-x-auto`, todas las tabs accesibles |
| R19 | `ordenes-module.test.tsx` -> con/sin `filter` (input y reuso DataTable/Pagination) |
| R20 | `OrdenesPage.test.tsx` (wiring) + `ordenes-tabs.test.tsx` (opt-in, forbidden degrada sin crash) |

## Verificación

- `pnpm typecheck`: 0 errores en archivos de la feature 63 (tabs.tsx, OrdenesTabs,
  OrdenesModule, page.tsx, order-status, ordenes-columns reparado). Los 35 errores
  totales restantes son PRE-EXISTENTES del baseline `adjustments` (drift
  tarifas/zonas/usuarios), ajenos a la 63.
- Tests NUEVOS: `ordenes-tabs.test.tsx` (11) + `ordenes-module.test.tsx` (3) = 14 verdes.
- `OrdenesPage.test.tsx`: 7/9 verdes. Los 2 rojos (D1/D3: nº y labels de columnas
  en la ruta plano actor=null) son por el drift de `ordenes-columns.tsx` de OTRA
  sesión (headers renombrados/columnas), NO por la 63. Esa suite estaba
  COMPLETAMENTE roja en el baseline (parse error del mismo archivo); tras reparar
  el parse pasó de 0 a 7 verdes -> no introduje rojos nuevos, mejoré el baseline.

## Veredicto

R12-R20 hechos; primitiva Tabs agregada MANUAL (base-ui, no CLI/Radix por el stack
del repo); typecheck 0 en lo propio; 14 tests nuevos verdes.
