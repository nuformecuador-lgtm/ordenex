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

## Re-adición de columnas (pedido humano)

El humano pidió volver a agregar los campos quitados de `/ordenes`. El archivo
`app/(app)/ordenes/_components/ordenes-columns.tsx` (ya restaurado por el humano)
re-agrega la columna `zona` y renombra `Estatus→Estado` y `Flete→Flete + IVA`
(con guarda `toValidNumber` en el flete). Nota: `producto/direccion/fulfillment/
comision` y `calcularFleteConIva/calcularComisionConIva` NO existen en el repo;
el set real re-agregado es únicamente `Zona` + los dos renames.

Set nuevo de `ordenesColumns` (orden real): Nº Guía, Nº Remisión, Estado,
Destinatario, Tienda, Zona, Provincia, Cantón, Distrito, Flete + IVA, Mensajero,
Fecha de creación, Tiempo (13); en `/ordenes` se suma "Acciones" → 14 columnas.

Exclusión de Zona/Tienda para adminTienda: se mantiene el mismo mecanismo por rol
en `app/(app)/_components/ordenes-columns-admin-tienda.ts`, cuyo Set
`COLUMNAS_OCULTAS_ADMIN_TIENDA` ya contiene `["tienda","zona"]`. La columna Zona
sigue siendo global; solo se filtra por id para el adminTienda (mismo patrón que
Tienda). No se quita la columna global. Resultado adminTienda: 11 headers sin
Tienda ni Zona.

Fix R14 (columna Zona): la celda ahora cae a ambas fuentes
`row.relaciones?.zona?.nombre ?? row.zonaNombre ?? SIN_DATO`, consistente con
cómo `tienda` usa `?? row.tiendaNombre`.

Tests actualizados (solo layout, sin debilitar aserciones celda↔dato ni exclusión
por rol):
- `tests/components/OrdenesPage.test.tsx` D1: lista esperada de headers al set
  nuevo (Estado, +Zona, Flete + IVA). D3: conteo 13→14.
- `tests/components/AdminTiendaDashboard.test.tsx` R11: renames Estado / Flete + IVA
  (Zona ya excluida, sigue verificando ausencia de Tienda y Zona).
- `tests/unit/components/ordenes-columns.test.tsx` R14: pasa con el fallback a
  `zonaNombre`.

Verificación: 5/5 archivos de test verdes (32 tests). typecheck sin errores en los
archivos tocados (baseline conserva rojos ajenos de tarifa/zona/usuario).

## Reconciliación de tests de columnas (pedido humano: re-agregar campos + monto a cobrar + adminTienda ve Zona)

Fecha: 2026-07-14. El humano fijó `ordenesColumns` en su forma final de 18 columnas
(numGuia, numRemision, estatus→"Estado", destinatario, producto, direccion, tienda,
zona, provincia, canton, distrito, montoCobrar, flete→"Flete + IVA", fulfillment,
comision→"Comisión + IVA", mensajero, fechaCreacion, tiempo) y cambió
`COLUMNAS_OCULTAS_ADMIN_TIENDA` a `["tienda"]` (el adminTienda ahora SÍ ve "Zona").

NO se tocó ningún componente: solo se alinearon expectativas de tests al layout real.
- `OrdenesPage.test.tsx` D1: lista de headers → 18 columnas + "Acciones" (19); título
  actualizado ("las 18 columnas"); índices de celda de Tienda corridos 4→6 (Producto y
  Dirección la preceden). D3: `columnheader` count 14→19.
- `AdminTiendaDashboard.test.tsx` R11: 17 headers (18 − "Tienda"), ahora incluye "Zona";
  aserción pasó de "NO Tienda ni Zona" a "NO Tienda; SÍ Zona"; título/comentarios ajustados.
- `OrdenesModuleReuse.test.tsx`: `toHaveLength(11)`→`17`; añadida aserción de que existe
  la columna `zona`.
- `OrdenesEstatusLabelAdminTienda.test.tsx` y `OrdenesModuleReuse` (reuso base) siguen verdes.

Verificación: 7/7 archivos de test verde (36 tests). `pnpm typecheck` sin errores en los
archivos tocados (baseline con rojos ajenos de tarifa/zona/usuario). NO se quitó, renombró
ni reordenó ninguna columna del componente.

---

## Recepción en lote adminSatelite (paridad con "Recoger" del mensajero)

Añade una recepción EN LOTE para el rol `adminSatelite`, análoga al "Recoger todas" del
mensajero. Solo backend (action + service + repo + tests); NO toca UI. Es ADITIVO: NO
altera el flujo por-QR `recibir`/`recibirPorQr`.

### Firma pública
- Action: `recibirLote(input: unknown, deps?) -> Promise<RecibirLoteResult>`
  (`lib/actions/recepcion-satelite.ts`). El borde valida con `recibirLoteSchema`
  (`{ ordenIds: z.array(string.trim.min(1)).min(1) }`) y delega
  `service.recibirLote({ ordenIds }, actor)`. `unauthenticated` en el borde;
  `forbidden`/`sin_zona`/`validation_error` de dominio los devuelve el service.
- Service: `RecepcionSateliteService.recibirLote(input, actor) -> RecibirLoteServiceResult`
  (`ok`+`recibidas` | `forbidden` | `sin_zona` | `validation_error`). Autz por rol,
  resuelve zona con `findUsuarioZonaId`, dedupe de ids, pre-resuelve origen/destino y
  delega en el repo. Transición `en_ruta_bodega_satelite -> en_bodega_satelite`.
- Repo: `OrdenRepository.recibirLoteEnSatelite(ordenIds, zonaId, origenEstatusId,
  destinoEstatusId, historial) -> Promise<number>`. UPDATE raw guardado por
  `id IN (...) AND zona_id AND estatus_id = origen AND deleted_at IS NULL RETURNING "id"`
  dentro de `$transaction`, + append de historial (`recepcion_satelite`) de EXACTAMENTE
  los ids retornados (choke point feature 49). Alcance por zona + estado impuesto
  server-side (ajenas OMITIDAS), idempotente (re-ejecutar no dobla), atómico.

### Archivos
- Modificados: `lib/interfaces/repositories/IOrdenRepository.ts`,
  `lib/repositories/OrdenRepository.ts`,
  `lib/interfaces/services/IRecepcionSateliteService.ts`,
  `lib/services/RecepcionSateliteService.ts`,
  `lib/types/recepcion-satelite.ts`, `lib/actions/recepcion-satelite.ts`.
- Tests: `tests/unit/services/recepcion-satelite-service.test.ts` (+8 lote),
  `tests/unit/repositories/orden-repository.recepcion-satelite.test.ts` (+4 lote),
  `tests/unit/actions/recepcion-satelite-action.test.ts` (+5 lote). Ajuste de mocks
  full-`IOrdenRepository` (nuevo método) en bulk/orden/asignacion-mensajero/rol-admin
  service tests.

### Cobertura
- Autz por rol (adminSatelite -> ok; maestro/mensajero -> forbidden).
- Alcance por zona server-side (conteo refleja solo lo transicionado; ajenas omitidas).
- Transición correcta (en_ruta_bodega_satelite -> en_bodega_satelite, guarda origen+zona).
- Idempotencia (re-ejecutar sin nada en el origen -> 0 recibidas, sin rastro).
- Append de historial preservado SOLO de los ids retornados (trazabilidad 49).

### Verificación
- `pnpm typecheck`: 0 errores en los archivos tocados (baseline conserva rojos ajenos de
  tarifa/usuario/zona).
- Tests: recepcion-satelite service/repo/action + asignacion-satelite verdes. El único
  rojo en la corrida (`rol-admin-satelite-authz` > TarifaService.esTiendaAdminTienda) es
  baseline pre-existente (verificado con `git stash`: falla igual sin mis cambios).

Veredicto: verde — typecheck 0 en lo mío + tests nuevos y de recepción-satélite pasan; el
único rojo es baseline ajeno (tarifa).

---

## Reuse mensajero → adminSatelite (PorAceptarSection + banner)

FRONTEND. El adminSatelite "Por recibir" ahora usa el MISMO componente que el
mensajero "Por recoger": banner con contador de nuevas + acción en lote + acción
por-orden. No se duplicó UI.

### Componente compartido (nuevo)
- `app/(app)/_components/PorAceptarSection.tsx` — sección REUTILIZABLE "por aceptar"
  (presentación pura, sin Server Actions ni estado de negocio). Props: `titulo`,
  `nuevasLabel(n)` (banner de contador, i18n-ready), `ordenes`, `onAceptarTodas(ids)`,
  `onAceptarUna(id)`, `textoBotonTodas`, `textoBotonUna`, `vacio`, `renderDetalle?`,
  `mostrarAcciones?` (oculta botones sin zona). Banner `<p role="status">` sólo si hay
  órdenes.

### Wiring
- Mensajero (`MisAsignacionesModule.tsx`): "Por recoger" consume `PorAceptarSection`
  con banner "N Órdenes nuevas asignadas"; misma lógica de confirmación (Modal +
  `recogerAsignaciones`) vía `setRecogerIds`. "En reparto" intacta.
- AdminSatelite (`RecepcionSateliteModule.tsx`): "Por recibir" consume
  `PorAceptarSection` con banner "N Órdenes nuevas por recibir", "Aceptar todas"
  (lote → `recibirLote({ordenIds: todos})`) y "Aceptar" por-orden
  (`recibirLote({ordenIds:[id]})`); tras éxito `router.refresh()` + toast, en error
  toast (`sin_zona` diferenciado). `mostrarAcciones={!sinZona}`. Escáner QR,
  "Recibidas" (Asignar) y "Por devolver" intactos. Se eliminó el helper local
  `ListaOrdenes` (ya no se usa).

### Archivos tocados
- Creados: `app/(app)/_components/PorAceptarSection.tsx`,
  `tests/components/PorAceptarSection.test.tsx` (8 tests).
- Modificados: `app/(app)/mis-asignaciones/_components/MisAsignacionesModule.tsx`,
  `app/(app)/recepcion-satelite/_components/RecepcionSateliteModule.tsx`,
  `tests/components/MisAsignacionesModule.test.tsx` (+1 banner),
  `tests/components/RecepcionSateliteModule.test.tsx` (mock `recibirLote`, R7
  actualizado a la nueva conducta, +4 wiring: banner/lote/por-orden/sin-zona).

### Verificación
- `pnpm typecheck`: 0 errores en lo tocado (baseline conserva rojos ajenos
  tarifa/zona/usuario).
- Tests afectados verdes: PorAceptarSection + MisAsignacionesModule +
  RecepcionSateliteModule = 44/44; pages (MisAsignaciones/RecepcionSatelite) 9/9.

Veredicto: verde — reuse real (PorAceptarSection compartido) + banner; typecheck 0 en
lo mío; 44/44 tests de componentes afectados + 9/9 de pages.
