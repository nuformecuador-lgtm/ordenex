# Feature 144 — implementación BACKEND (bloques B1, B2 y B5)

> Worktree `ordenex-wt-144`, rama `feature/144-filtros-ordenes` (salida de
> `origin/dev @ 55b0cd4` + 3 commits de spec/bookkeeping).
> Alcance: **solo backend**. Bloque A, B3, B4 y TB2.5 (`page.tsx`) son del `frontend_dev`.
> **Ningún `.tsx` de producción fue tocado.**

## Tasks cerradas

| Task | Qué |
| --- | --- |
| TB1.1 | `ordenFilterSchema` a 9 claves + 2 `refine` |
| TB1.2 | helpers de borde horario CR en `lib/utils/fecha-cr.ts` |
| TB1.3 | `OrdenService.listar`: `FILTER_TO_COLUMN` ampliado + rango temporal + scoping al final |
| TB1.4 | `OrdenRepository.list` + `ListOrdenesWhere` |
| TB1.5 | tests de no regresión del contrato |
| TB2.1 | `GeoRepository.listProvinciasLite/listCantonesLite/listDistritosLite` |
| TB2.2 | `UserRepository.listCuentasTienda` |
| TB2.3 | `ZonaRepository.listLite` |
| TB2.4 | `FiltrosOrdenesService` + `obtenerCatalogoFiltrosOrdenes()` |
| TB5.1 | migración de índices + `down.sql` + `@@index` |

**No cerradas (fuera de alcance):** TB2.5 (toca `app/(app)/ordenes/page.tsx`), todo el
bloque A, B3, B4 y el bloque 6 de cierre.

## Archivos

### Nuevos (producción)
- `lib/types/filtros-ordenes.ts` — DTOs del catálogo (`OpcionCatalogo`, `OpcionConPadre`,
  `CuentaTiendaDTO`, `CatalogoFiltrosOrdenesDTO`, resultado discriminado).
- `lib/interfaces/services/IFiltrosOrdenesService.ts`
- `lib/services/FiltrosOrdenesService.ts`
- `lib/actions/filtros-ordenes.ts` — `obtenerCatalogoFiltrosOrdenes(deps?)`.
- `db/migrations/20260728120000_orden_indices_filtros/{migration.sql,down.sql}`

### Modificados (producción)
- `lib/types/orden.ts` — `ORDEN_FILTER_FIELDS` (9), `CREATED_PRESETS`, `ordenFilterSchema`.
- `lib/utils/fecha-cr.ts` — `inicioDelDiaCREnUtc`, `inicioDelDiaSiguienteCREnUtc`,
  `inicioDeUltimosNDiasCREnUtc`.
- `lib/services/OrdenService.ts` — mapa ampliado, `rangoCreacion()`, reloj inyectable.
- `lib/repositories/OrdenRepository.ts` — helper `criterio()` + `where` ampliado.
- `lib/interfaces/repositories/IOrdenRepository.ts` — `ListOrdenesWhere` (extraído y ampliado).
- `lib/interfaces/repositories/{IGeoRepository,IUserRepository,IZonaRepository}.ts`
- `lib/repositories/{GeoRepository,UserRepository,ZonaRepository}.ts`
- `db/schema.prisma` — 4 `@@index` en `model Orden`.

### Tests nuevos
`tests/unit/types/orden-filter-144.test.ts`, `tests/unit/utils/fecha-cr-filtros.test.ts`,
`tests/unit/services/orden-service-filtros.test.ts`,
`tests/unit/repositories/orden-repository-filtros.test.ts`,
`tests/unit/repositories/catalogo-filtros-ordenes.test.ts`,
`tests/unit/services/filtros-ordenes-service.test.ts`,
`tests/unit/actions/filtros-ordenes-action.test.ts`,
`tests/integration/db/orden-indices-filtros-migracion.test.ts`.

### Tests ajustados (no silenciados)
- 8 archivos con **dobles de repositorio escritos a mano** que dejaron de satisfacer las
  interfaces al ganar métodos: `asignacion-mensajero-service`, `auth-service`,
  `postulacion-login-regresion`, `rol-admin-satelite-authz`, `usuario-service`,
  `usuario-zona`, `zona-service`, `geo-service`. Se les añadió el método faltante
  (`listCuentasTienda` / `listLite` / `list*Lite`), nada más.
- `tests/unit/types/orden-filter.test.ts` — **1 aserción** de la feature 63 que censaba la
  whitelist como *exactamente* `['status_id']`. La ampliación a 9 claves es el cambio de
  contrato que pide R30, así que la aserción pasa a `toContain("status_id")` y el censo
  exacto vive en el test nuevo. Las otras 8 aserciones del archivo (rechazo de claves
  fuera de whitelist, escalar|lista, lista vacía) **quedaron intactas y verdes**.
- `tests/integration/db/zonas-migration.test.ts` — una línea en la **denylist a mano** de
  migraciones (deuda conocida del arnés: se pone roja con cada migración nueva).

## Migración

`db/migrations/20260728120000_orden_indices_filtros/`

- UP: `CREATE INDEX` sobre `orden(zona_id)`, `orden(provincia_id)`, `orden(canton_id)`,
  `orden(distrito_id)`.
- DOWN: los 4 `DROP INDEX IF EXISTS` en orden inverso.
- **Solo índices**: sin tablas, sin columnas, sin enums ⇒ **sin RLS nueva**.
  `created_at`/`tienda_id`/`estatus_id` ya estaban indexados; no se duplican.
- **NO se aplicó contra la base** (el `.env` del worktree apunta a una base compartida con
  producción). Validada por **forma estática** en
  `tests/integration/db/orden-indices-filtros-migracion.test.ts` (contenido del UP/DOWN,
  simetría CREATE↔DROP, ausencia de DDL de esquema, `@@index` en `schema.prisma`,
  timestamp no anterior a las previas). **Pendiente al desplegar: `prisma migrate deploy`.**

## Mapa R → test

| R | Test (archivo::nombre) |
| --- | --- |
| R30 | `tests/unit/types/orden-filter-144.test.ts::R30: la whitelist son exactamente las 9 claves de la feature` + `::R30: acepta las cinco claves de catalogo y las tres temporales` + `tests/unit/services/orden-service-filtros.test.ts::R30: cada clave publica se traduce a SU columna, nunca al reves` |
| R31 | `orden-filter-144.test.ts::R31: una clave fuera de la whitelist sigue produciendo ZodError (no llega a Prisma)` |
| R32 | `orden-filter-144.test.ts::R32: <clave> exige LISTA NO VACIA de ids no vacios` (5 casos, uno por catálogo) |
| R33 | `orden-service-filtros.test.ts::R33: filtros DISTINTOS son claves hermanas del mismo where -> AND` + `orden-repository-filtros.test.ts::R33: las claves son hermanas del mismo objeto -> AND entre filtros distintos` |
| R34 | `orden-service-filtros.test.ts::R34: un filtro multi-valor viaja como LISTA (el repo lo traduce a IN -> OR interno)` + `orden-repository-filtros.test.ts::R34: cada lista se traduce a `{ in: [...] }` en SU columna` |
| R35 | `orden-repository-filtros.test.ts::R35: un id inexistente produce `IN ('id-inventado')` -> cero filas, no todas` + `::R35: una lista VACIA de un filtro NUEVO produce `IN ()` (cero filas), no ausencia de clave` + `::R35: lo mismo para tienda, provincia, canton y distrito` + `orden-service-filtros.test.ts::R35: un id inventado viaja tal cual como criterio…` |
| R36 | `orden-service-filtros.test.ts::R36: adminTienda con filter.tienda_id de OTRA tienda -> el where queda con la SUYA` + `::R36: adminTienda ni siquiera puede colar su tienda + otra (la lista se sustituye)` + `::R36: el resto de filtros del adminTienda si se aplican…` + `::R36: maestro/admin no reciben acotamiento por rol…` |
| R37 | `orden-service-filtros.test.ts::R37: mensajero sigue acotado a sus asignadas CON filtros nuevos` + `::R37: mensajero sigue acotado a sus asignadas SIN filtros nuevos` |
| R38 | `orden-filter-144.test.ts::R38: acepta cada valor del dominio cerrado` + `::R38: un valor fuera del dominio -> ZodError sin consulta` + `::R38: una LISTA de presets se rechaza (es un solo valor, no multi)` |
| R39 | `orden-filter-144.test.ts::R39: exige el formato de fecha calendario YYYY-MM-DD` + `::R39: el rango INVERTIDO (desde > hasta) -> ZodError sin consulta` + `::R39: desde === hasta es valido (un solo dia)` + `::R39/R42: un solo extremo es valido (rango abierto por el otro lado)` |
| R40 | `orden-filter-144.test.ts::R40: preset + desde -> ZodError…` + `::R40: preset + hasta -> ZodError` + `::R40: preset + rango completo -> ZodError` + `::R40: el error viaja bajo una clave del filtro (fieldErrors utilizable)` |
| R41 | `tests/unit/utils/fecha-cr-filtros.test.ts::R41: 'ultimos 7 dias' arranca el 00:00 CR de hace 6 dias…` + `::R41: 15/30/90 dias usan la misma regla N-1` + `::R41: el dia CR se resuelve sobre la hora de pared de CR…` + `orden-service-filtros.test.ts::R41: created_preset '7d' -> gte = 00:00 CR de hace 6 dias` + `::R41: cada preset del dominio produce su propio borde` |
| R42 | `fecha-cr-filtros.test.ts::R42: `2026-07-15T05:59:59Z` … queda FUERA de desde=2026-07-15` + `::R42: `2026-07-15T06:00:00Z` … queda DENTRO` + `::hasta=2026-07-15 INCLUYE `2026-07-16T05:59:59Z`` + `::hasta=2026-07-15 EXCLUYE `2026-07-16T06:00:00Z`` + `orden-service-filtros.test.ts::R42: hasta es INCLUSIVE…` + `::R42: solo desde -> rango abierto por arriba` + `::R42: un dia unico (desde === hasta) cubre las 24 horas de ese dia CR` |
| R43 | `orden-filter-144.test.ts::R43: NO acepta instantes absolutos del reloj del cliente` + `orden-service-filtros.test.ts::R43: el instante del preset sale del reloj del SERVIDOR, no del cliente` |
| R44 | `orden-repository-filtros.test.ts::R44: `count` recibe EXACTAMENTE el mismo objeto `where` que `findMany`` + `::R44: tambien sin filtros nuevos` |
| R45 | `orden-service-filtros.test.ts::R45: sin `filter`, el params del repo es EXACTAMENTE el previo a esta feature` + `::R45: con solo `status_id`, el where no gana ninguna clave nueva` + `::R45: el `estatusId` escalar heredado sigue funcionando igual` + `::R45: adminTienda sin filtros conserva su acotamiento previo` + `::R45: `filter` vacio no introduce claves (ni temporales)` + `orden-filter-144.test.ts::R45: sin `filter`, el input parseado es el de siempre` + `::R45: `status_id` conserva la union escalar\|lista` + `orden-repository-filtros.test.ts::R45: un `where` vacio produce exactamente `{ deletedAt: null }`` (+2 más) |
| R46 | `orden-service-filtros.test.ts::R46: los filtros nuevos combinan con status_id sin que ninguno anule al otro` + `::R46: los filtros nuevos combinan con el rango temporal…` + `orden-filter-144.test.ts::R46: `status_id` convive con los filtros nuevos en el mismo objeto` |
| R47 | `tests/unit/services/filtros-ordenes-service.test.ts::R47: las CINCO lecturas se disparan EN PARALELO…` + `::R47/R48: entrega las cinco colecciones en una sola respuesta` + `tests/unit/actions/filtros-ordenes-action.test.ts::R47: devuelve el catalogo del service tal cual, en UNA sola llamada` |
| R48 | `tests/unit/repositories/catalogo-filtros-ordenes.test.ts::R48: cada canton trae su PADRE (provincia) como `padreId`` + `::R48: cada distrito trae su PADRE (canton) como `padreId`, sin la zona` + `::R48/R49: `{id,nombre}` de TODAS las zonas, por nombre asc` + `filtros-ordenes-service.test.ts::R48: cantones y distritos llegan con su padre resoluble sin mas datos` |
| R49 | `catalogo-filtros-ordenes.test.ts::R49: las provincias se piden `{id,nombre}` ordenadas por nombre asc` + `::R49: la misma entrada produce el mismo orden (determinista)` + `::R49: orden determinista por nombre asc` (tiendas) |
| R50 | `catalogo-filtros-ordenes.test.ts::R50: consulta los DOS roles dueños posibles…` + `::R50: NO filtra por `estado` — las cuentas inactivas se incluyen` + `::R50/R51: expone las DOS banderas (`esApiKey`, `activa`) por cuenta` |
| R51 (parte backend: el dato que permite agrupar) | `catalogo-filtros-ordenes.test.ts::R50/R51: expone las DOS banderas (`esApiKey`, `activa`) por cuenta`. *El mapeo a grupo/etiqueta es de B3 (`frontend_dev`).* |
| R52 | `filtros-ordenes-service.test.ts::R52: sin sesion -> `unauthenticated` y NINGUNA lectura se dispara` + `filtros-ordenes-action.test.ts::R52: sin sesion, el actor `null` llega al service…` |
| R53 | `filtros-ordenes-service.test.ts::R53: rol `<x>` -> `forbidden` sin datos` (4 roles) + `::R53: rol `<x>` (opera el listado) -> `ok` con el catalogo` (3 roles) + `filtros-ordenes-action.test.ts::R53: un rol ajeno al listado obtiene `forbidden` sin datos` |
| R54 | `catalogo-filtros-ordenes.test.ts::R54: no pide ni devuelve PII (email/telefono/cedula/hash)` + `filtros-ordenes-service.test.ts::R54: las cuentas tienda no arrastran PII…` |
| R64 (parte backend) | `filtros-ordenes-service.test.ts::R64: si una lectura falla, el service PROPAGA el error (la page decide el fallback)`. *El fallback a barra deshabilitada es de TB2.5/TB4.1.* |
| Migración | `tests/integration/db/orden-indices-filtros-migracion.test.ts` (14 casos: UP, DOWN, simetría, RLS, schema) |

**R1–R29, R55–R63, R65** no son de este alcance (bloque A / B3 / B4 / cierre).

## Verificación (medida en este worktree, sobre `5196cee`)

```
$ pnpm typecheck
> ordenex@0.1.0 typecheck C:\Users\Cristian\Documents\trabajo\arc\ordenex-wt-144
> tsc --noEmit
(sin salida = 0 errores)
```

```
$ pnpm lint
✖ 145 problems (0 errors, 145 warnings)
  0 errors and 1 warning potentially fixable with the `--fix` option.
```

```
$ pnpm test
 Test Files  526 passed (526)
      Tests  5427 passed (5427)
   Start at  10:10:16
   Duration  170.37s
```

```
$ ./init.sh
✓ lint paso
✓ test paso
 Test Files  526 passed (526)
      Tests  5427 passed (5427)
✓ todas las migraciones tienen down.sql
✓ .env presente
== init OK ==
```

```
$ git diff package.json pnpm-lock.yaml
(vacío — dependencias nuevas: NINGUNA)
```

**Delta contra el baseline** (518 archivos / 5308 tests / lint 0 errores·145 warnings /
typecheck 0): **+8 archivos de test, +119 tests, 0 fallos, 0 errores nuevos de lint ni de
typecheck**. Los 8 archivos son exactamente los que añadí.

## Pendiente / dudoso

1. **Flakiness ajena, NO introducida por esta rama.** Tres de las cinco corridas completas
   de `pnpm test` mostraron 1–2 fallos en `tests/integration/recuperar-contrasena-form.test.tsx`
   (y una vez otro archivo de UI), con **conteos distintos en cada corrida sobre el mismo
   código**. Demostrado, no supuesto: ese archivo pasa **7/7 en tres corridas aisladas
   seguidas**, la suite `tests/integration` completa pasa **119 archivos / 993 tests**, y
   la corrida final completa (y la de `./init.sh`) salió **526/526 y 5427/5427 verde**. El
   archivo no tiene relación alguna con el diff (recuperación de contraseña). Es un flake
   de timing bajo carga del runner, deuda del arnés.
2. **`prisma migrate deploy` pendiente al desplegar** (ver sección Migración).
3. **`orden.distrito_id` sigue siendo NULLABLE** (riesgo §8.6 del design). Esta feature no
   cambia la nulabilidad: mientras exista alguna orden con `distrito_id IS NULL`, esas
   órdenes son invisibles bajo el filtro de distrito y visibles sin él. Confirmar el dato
   real y, si procede, migrar a `NOT NULL` es **otra feature**.
4. **Sin verificación contra base real.** Todo lo de esta entrega está cubierto con Prisma
   mockeado y forma estática del SQL. El plan de ejecución del `IN (...)` con los índices
   nuevos no se midió (no hay base de pruebas disponible aquí).

## Notas para el `frontend_dev`

1. **Punto de entrada del catálogo:** `obtenerCatalogoFiltrosOrdenes(deps?)` en
   `lib/actions/filtros-ordenes.ts`. Resuelve el actor server-side, autoriza y hace el
   `Promise.all` **dentro del service**. Devuelve
   `{status:"ok", catalogo} | {status:"unauthenticated"} | {status:"forbidden"}`.
   Para TB2.5: llamarlo tras las guardias de rol de la page y pasar `catalogo` por props,
   o **`null`** si el `status` no es `ok` **o si lanza** (el service propaga el error de la
   DB a propósito: el fallback R64 lo decide la page con un `try/catch`).
   Acepta `deps` (`{filtrosOrdenesService, getActor}`) para testear la page sin DB.
2. **DTO del catálogo:** `CatalogoFiltrosOrdenesDTO` en `lib/types/filtros-ordenes.ts`.
   Las tiendas traen **banderas** (`esApiKey`, `activa`), no textos: el sufijo
   "(inactiva)" y el `group` ("Cuentas tienda" / "Integraciones (API)") son **tuyos**, en
   `construirFiltrosOrdenes` (R51). Cantón y distrito traen `padreId` — mapéalo a
   `parentValue`.
3. **Claves del `filter`** (idénticas a las del catálogo, la traducción es la identidad
   salvo el tiempo): `zona_id`, `tienda_id`, `provincia_id`, `canton_id`, `distrito_id`
   como **listas no vacías de strings**; `created_preset` como **escalar** de
   `CREATED_PRESETS` (`"7d"|"15d"|"30d"|"90d"`, exportado desde `lib/types/orden.ts`);
   `created_desde`/`created_hasta` como `"YYYY-MM-DD"`.
4. **Nunca mandes lista vacía ni preset+rango juntos.** Una lista vacía es
   `validation_error` (R32) y preset+rango también (R40). `seleccionAFilter` debe **omitir
   la clave**, no mandar `[]`. Del mismo modo, no mandes instantes ISO con hora: el borde
   los rechaza (los calcula el servidor).
5. **`hasta` es INCLUSIVO** (cubre todo el día indicado en hora de Costa Rica). No hace
   falta que la UI sume un día.
6. **`adminTienda`**: aunque no declares el filtro de tienda (R62), el backend ya pisa
   cualquier `tienda_id` con la tienda propia. No es una defensa que puedas relajar en la
   UI, pero tampoco puedes romperla desde ahí.
7. **`OrdenService` acepta un reloj inyectable** como 2.º argumento del constructor (solo
   para tests del preset). En producción nadie lo pasa.
