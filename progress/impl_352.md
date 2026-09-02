# impl_352 — Ordenar las tablas por fecha (BACKEND)

Worktree `R:\wt\352`, rama `feature/352-ordenar-tablas`. Backend únicamente: contrato de
ordenamiento en el servidor para el listado de `/ordenes`. **NO se tocó nada de `app/` ni de
`components/`.**

> **No existe `specs/352-*`** en este árbol (ni ficha 352 en `feature_list.json`). Los `R<n>` de
> abajo los fija esta bitácora a partir del encargo del leader y del pedido humano; no vienen de
> un `requirements.md` aprobado. El leader decide si eso hay que subsanar antes de mergear.

## El pedido y lo que ya existía

Pedido humano: «es importante que las tablas se puedan ordenar de fecha más reciente a más
lejana y viceversa».

**Medido antes de escribir nada, y corrige una parte de la premisa que me dieron:** el contrato
de ordenamiento en el servidor **ya existía** para `/ordenes` desde antes de esta ficha —
`SORT_FIELDS`/`SORT_DIRS` en `lib/types/orden.ts`, `sortBy`/`sortDir` en `listarOrdenesSchema`,
`SORT_COLUMN` en `OrdenRepository`—. Lo que no existía es (a) el control en la cabecera (eso es
del frontend) y (b) **un orden que aguante la paginación**. Lo segundo es lo que arregla esta
ficha, y no es cosmético.

## El defecto real, medido contra la base

`OrdenRepository.list` ordenaba por `[{prioridad:"desc"}, {<columna>: <dir>}]` y **nada más**.
Ninguna de las tres columnas ordenables es única sobre las filas que se listan:

- `created_at` **repite en masa**: las órdenes nacen por carga masiva, en `createMany` dentro de
  una transacción, y toman el `CURRENT_TIMESTAMP` de esa transacción. Medido en la base local el
  2026-09-01: **sobre 67 órdenes hay un grupo de 23 y otro de 22 filas con el mismo `created_at`
  al milisegundo**. Con páginas de 25, un grupo de 23 cruza el corte entre la página 1 y la 2.
- `num_guia` es única pero **NULLABLE**: toda orden `pendiente` empata con las demás sin guía.
- `num_remision` solo es única **por tienda** y solo entre las vivas (índice parcial de la 294).

Sin desempate, el orden dentro del empate lo decide el plan, y `LIMIT 25 OFFSET 0` no se
resuelve con el mismo plan que `LIMIT 25 OFFSET 100`. Medido sobre un corpus de 241 filas:
**recorriendo las 10 páginas salían 200 filas distintas de 241 en `desc`** (41 perdidas y otras
tantas repetidas) **y 238 de 241 en `asc`**.

## Contrato (lo que el frontend tiene que usar)

Entrada de `listarOrdenes(input)` / `listarOrdenesCompleto(input)` — Server Actions de
`lib/actions/ordenes.ts`, sin cambios de firma:

| clave | valores | por defecto |
| --- | --- | --- |
| `sortBy` | `"created_at"` \| `"num_guia"` \| `"num_remision"` (`SORT_FIELDS`) | `"created_at"` |
| `sortDir` | `"asc"` \| `"desc"` (`SORT_DIRS` = `DIRECCIONES_ORDEN`) | `"desc"` |

- Unión **cerrada** de literales (`z.enum`). Un valor fuera de la lista → `validation_error`
  **sin ejecutar consulta**. El nombre de columna real nunca cruza la frontera: lo traduce
  `SORT_COLUMN`, dentro del repositorio.
- El objeto de entrada es ahora **`.strict()`**: una clave desconocida (`sort`, `orderBy`,
  `sortDirection`) → `validation_error` en vez de descartarse en silencio. Antes, unos nombres
  equivocados devolvían el orden por defecto sin error: la flecha puesta en la cabecera y las
  filas sin mover.
- Devuelve lo de siempre: `{ status:"ok", items, page, pageSize, total }`.
- **El orden efectivo es `prioridad DESC, <columna> <dir>, id ASC`.** Las dos claves que el
  cliente no controla están ahí a propósito y se documentan abajo.
- Para la clave de caché: `claveDeOrden({sortBy, sortDir})` →`"created_at:desc"`, en
  `lib/types/ordenamiento-listado.ts`.

### Dos cosas que el frontend tiene que saber

1. **`prioridad DESC` va DELANTE del orden elegido** (feature 101/R6, intacta). Una orden
   marcada como prioritaria flota a la página 1 aunque el usuario pida «más antiguas primero».
   Es correcto y deliberado, pero **se ve como si el orden no se hubiera aplicado**. Hoy solo hay
   `prioridad = true` en bodega central/satélite.
2. **La clave SWR de `OrdenesModule` NO incluye el orden.** Comprobado en el archivo:
   `app/(app)/ordenes/_components/OrdenesModule.tsx:280` usa
   `["ordenes:list", filterKey, page, pageSize]`. Tal cual está, el primero que pida «más
   antiguo» le sirve su resultado al siguiente que pida «más reciente». **Hay que añadir
   `claveDeOrden(...)` a esa key** (misma disciplina que `serializarFiltro`, 144/R61). Es
   frontend, no lo toqué.

## Archivos

**Creados**

- `lib/types/ordenamiento-listado.ts` — el contrato compartido: `DIRECCIONES_ORDEN` /
  `DireccionOrden` (fuente única de la dirección), `esquemaDireccionOrden`,
  `OrdenamientoListado<C>`, `esquemaOrdenamiento(campos, porDefecto, dirPorDefecto)`,
  `ordenTotal(criterios, desempate)` y `claveDeOrden(orden)`.
- `tests/integration/db/orden-listado-orden-total.test.ts` — 11 casos contra Postgres real.
- `tests/unit/types/ordenamiento-listado.test.ts` — 15 casos de la capa pura y del borde.

**Modificados**

- `lib/repositories/OrdenRepository.ts` — `DESEMPATE_UNICO = { id: "asc" }` y el `orderBy` de
  `list` armado con `ordenTotal(...)`, que **exige** el desempate como argumento.
- `lib/types/orden.ts` — `SORT_DIRS`/`SortDir` pasan a ser reexport del módulo compartido;
  `listarOrdenesSchema` usa `esquemaOrdenamiento(...)` y gana `.strict()`.
- `tests/unit/repositories/orden-repository.test.ts` — dos `toEqual` literales del `orderBy`
  actualizados al contrato nuevo (siguen siendo literales, no derivados de la fuente).

**Sin migración y sin índice nuevo.** El `orderBy` ya empezaba por `prioridad`, así que el plan
nunca pudo servirse del btree de `created_at`; añadir una tercera clave no cambia esa clase de
plan. Nada que aplicar a ninguna base.

## Por qué `id` y no `num_guia`

`id` es la PK, `NOT NULL` y única sobre **todas** las filas. `num_guia` es única pero nullable:
todas las `pendiente` siguen empatadas entre sí. No es un argumento de pizarra — está medido en
la mutación M6 de abajo, con un corpus que incluye 60 órdenes sin guía: con `num_guia` de
desempate el recorrido `asc` devolvió 230 filas distintas de 241.

La dirección del desempate es fija (`asc`) y no acompaña a `sortDir`: el `id` es un uuid v4, su
orden no significa nada, y hacerlo cambiar de sentido sugeriría que sí. Lo que la paginación
necesita es que sea **el mismo** en las dos consultas, no que signifique algo.

## Mapa R<n> → test

| R | Qué exige | Test |
| --- | --- | --- |
| R1 | El listado acepta `{sortBy, sortDir}` explícitos | `ordenamiento-listado.test.ts` › «admite los tres campos de la lista blanca en los dos sentidos» |
| R2 | `sortBy` es unión cerrada; otro valor → `validation_error` sin consulta | idem › «un nombre de columna libre NO entra»; y el preexistente `ordenes-action.test.ts` › `sortBy:"peso"` |
| R3 | `sortDir` solo `asc`/`desc` | idem › «una direccion que no es asc/desc se RECHAZA» |
| R4 | Clave desconocida → `validation_error`, no descarte mudo | idem › «una clave DESCONOCIDA se rechaza en vez de descartarse en silencio» |
| R5 | El orden por defecto NO cambia (`created_at desc`) | `orden-listado-orden-total.test.ts` › «el orden por defecto NO cambia»; unit › «el defecto es la mas reciente primero» |
| R6 | El orden es TOTAL: desempate único obligatorio | unit › los 3 casos de `ordenTotal`; `orden-repository.test.ts` › los dos `orderBy` literales |
| R7 | Con empates, ninguna fila se repite entre páginas | integración › «no repite ni pierde una sola fila (desc)» y «(asc)» |
| R8 | Con empates, ninguna fila se pierde | idem (mismo caso: `Set.size` + comparación de conjuntos) |
| R9 | La misma página dos veces da lo mismo | integración › «la misma pagina pedida dos veces devuelve exactamente los mismos ids» |
| R10 | `asc` invierte de verdad el sentido | integración › «`asc` invierte de verdad el sentido» |
| R11 | `sortBy` llega hasta la consulta | integración › «`sortBy` llega hasta la consulta: por num_guia el orden es OTRO» |
| R12 | La descarga sale en el MISMO orden que la pantalla | integración › «la DESCARGA sale exactamente en el mismo orden que la pantalla» |
| R13 | La caché distingue dos ordenamientos | unit › los 3 casos de `claveDeOrden` |
| R14 | `prioridad DESC` sigue por delante (101/R6 intacta) | integración › «`prioridad` sigue mandando por delante del orden elegido» |
| R15 | El camino completo (acción→servicio→repo) hereda el orden total | integración › «el listado por el SERVICIO recorre las paginas sin repetir ni perder filas» |

Contrapeso del archivo de integración: «el corpus queda aislado: la ventana del 2001 solo
contiene las 241 filas sembradas». Si eso fallara, ningún conteo del archivo afirmaría nada.

**No hay ningún `if (!datos) return;`.** El sembrador (`sembrarBase`, de `_semilla-rollup.ts`)
**revienta** si la base local no tiene catálogos, en vez de dejar el archivo verde sin comprobar
nada. Todo corre en una transacción que **siempre** se revierte: la base local la comparten
varios worktrees y aquí no queda ni una fila.

## Mutaciones (7 aplicadas, medidas y revertidas)

| # | Mutación | Resultado | Línea de fallo real |
| --- | --- | --- | --- |
| M1 | **Quitar el desempate** (`orderBy` sin `{id:"asc"}`) | ROJO, 5 casos | `orden-listado-orden-total.test.ts:196` `AssertionError: expected 200 to be 241`; `:207` `expected 238 to be 241`; `:224` `empate del lote A: expected […(120)] to deeply equal […(120)]`; `:330` `expected 200 to be 241`; `:341` `expected […(241)] to deeply equal […(241)]`; `orden-repository.test.ts:254` `expected [{prioridad:'desc'},…(1)] to deeply equal [{prioridad:'desc'},…(2)]` |
| M2 | **Invertir el sentido** del orden (`sortDir==="asc"?"desc":"asc"`) | ROJO, 6 casos | `orden-listado-orden-total.test.ts:247` `expected 984225600000 to be 984398400000`; `:265` `expected 984398400000 to be 984225600000`; `:304` `expected […(25)] to not deeply equal […(25)]`; `orden-repository.test.ts:496` `expected {createdAt:'asc'} to deeply equal {createdAt:'desc'}` |
| M3 | El desempate **delante** (`[desempate, ...criterios]`) | ROJO, 8 casos | `ordenamiento-listado.test.ts:22` `expected [{id:'asc'},…(2)] to deeply equal [{prioridad:'desc'},…(2)]`; `orden-listado-orden-total.test.ts:247` `expected 984312000000 to be 984398400000`; `orden-repository.test.ts:495` `expected {id:'asc'} to deeply equal {prioridad:'desc'}` |
| M4 | Cambiar el **defecto** de `sortDir` a `"asc"` | ROJO, 3 casos | `ordenamiento-listado.test.ts:91` `expected 'asc' to be 'desc'`; `:120` `expected {Object(sortBy,sortDir)} to match object {sortBy:'created_at',…(1)}`; `orden-listado-orden-total.test.ts:233` `expected 'asc' to be 'desc'` |
| M5 | Quitar el **`.strict()`** del schema | ROJO, 2 casos | `ordenamiento-listado.test.ts:113` `expected function to throw an error, but it didn't`; `:125` idem |
| M6 | Desempatar por **`num_guia`** (única pero NULLABLE) | ROJO, 4 casos | `orden-listado-orden-total.test.ts:219` `expected 230 to be 241`; `:236` `empate del lote A: expected […(120)] to deeply equal […(120)]`; `:316` `expected […(25)] to not deeply equal […(25)]`; `orden-repository.test.ts:254` |
| M7 | Invertir el **sentido del desempate** (`{id:"desc"}`) | ROJO, 1 caso | `orden-listado-orden-total.test.ts:236` `empate del lote A: expected […(120)] to deeply equal […(120)]` |

**Nada sobrevivió en verde en el estado final del archivo**, pero hay dos hallazgos que valen
más que el conteo:

1. **M1 SOBREVIVIÓ con el corpus con el que escribí el test la primera vez** (25 filas, dos
   empates de 12, páginas de 10): Postgres ordenaba el conjunto entero y devolvía el mismo orden
   en las dos páginas, así que «paginar no repite ni pierde» salía **verde sin desempate**. Sólo
   lo cazaba el caso de forma («dentro de un empate, el orden lo fija el id»). Subir el corpus a
   241 filas con dos empates de 120 y páginas de 25 —el `DEFAULT_PAGE_SIZE` real— es lo que hace
   que aparezca el defecto. **Está escrito en la cabecera del archivo de test con las cifras**,
   porque quien encoja ese corpus dejará el archivo verde y sin valor.
2. **M7 lo caza un solo caso, y es correcto que sea así.** `{id:"desc"}` sigue siendo un orden
   total y la paginación sigue sin repetir ni perder: los tests no sobre-restringen una elección
   que es arbitraria, solo la fijan donde toca.

## Qué queda preparado y qué NO

- **`/ordenes` (paginado y descarga): hecho.** Los dos comparten `repo.list`, así que no pueden
  divergir.
- **`/usuarios`: NO tocado, y tiene el mismo defecto latente.** `lib/types/usuario.ts` declara
  `USUARIO_SORT_FIELDS` (`createdAt`/`nombre`/`email`/`estado`) y `UserRepository.list:219-220`
  construye `orderBy` de **una sola columna, sin desempate**. Ordenar por `estado` o por `nombre`
  con repetidos tiene exactamente el problema que aquí se arregla. Queda fuera por el encargo
  («empieza por `/ordenes`»), no por estar bien.
- **El resto de listados**: no tienen contrato de orden; su `orderBy` es fijo en el repositorio.
  Hay **75** `orderBy` de una sola columna en `lib/repositories/**` — techo, no recuento de
  defectos: muchos son `include` anidados o catálogos que no paginan. Sumar una tabla al
  contrato es: declarar su lista blanca `as const`, componer el schema con
  `esquemaOrdenamiento(...)` y armar el `orderBy` con `ordenTotal(...)`, que **obliga** a pasar
  el desempate.

## Verificación

```
$ pnpm run typecheck
> tsc --noEmit
(sin salida: 0 errores)

$ pnpm run lint
✖ 145 problems (0 errors, 145 warnings)

$ pnpm exec vitest run tests/integration/db/orden-listado-orden-total.test.ts \
    tests/unit/types/ordenamiento-listado.test.ts \
    tests/unit/repositories/orden-repository.test.ts \
    tests/integration/actions/ordenes-action.test.ts \
    tests/unit/services/orden-service-busqueda.test.ts \
    tests/unit/services/orden-service-descarga.test.ts \
    tests/unit/descarga/contrato-paginado.test.ts
 Test Files  7 passed (7)
      Tests  122 passed (122)

$ pnpm exec vitest related --run lib/types/orden.ts lib/repositories/OrdenRepository.ts \
    lib/types/ordenamiento-listado.ts
 Test Files  331 passed (331)
      Tests  4659 passed | 17 skipped (4676)
   Duration  589.44s

$ pnpm run test:guardias
 Test Files  1 failed | 171 passed (172)
      Tests  1 failed | 2586 passed (2587)
 FAIL tests/unit/guards/superficie-de-uso.guardia.test.ts
   + "lib/actions/tarifas.ts:67 obtenerTarifa"
```

El único rojo es el heredado y tolerado (`superficie-de-uso` por `lib/actions/tarifas.ts:67`).

**`./init.sh --rapido` se va a negar**: el diff toca `lib/types/**`. La corrida completa es
obligatoria y la tiene que hacer el leader; yo no la corrí (excede el techo de una invocación).
No se hizo commit: eso es del leader.

## Lo dudoso

1. **`prioridad DESC` por delante del orden que pide el usuario.** Lo conservé porque el encargo
   dice que el orden por defecto no cambia y porque es la feature 101/R6. Pero con el control en
   la cabecera esto pasa a ser visible: pedir «más antiguas primero» y ver arriba las
   prioritarias se lee como que el orden no se aplicó. **Es una decisión de producto, no técnica**,
   y no la tomé yo.
2. **La clave SWR sigue sin el orden.** Está medido y dicho arriba; mientras el frontend no la
   añada, dos ordenamientos comparten caché. No es un defecto que introduzca esta ficha, pero sí
   uno que esta ficha vuelve alcanzable.
3. **`.strict()` en `listarOrdenesSchema` es un cambio de comportamiento del borde.** Verifiqué
   los cuatro sitios que llaman a estas acciones (`OrdenesModule.tsx:69` y `:481`) y los tests, y
   todos pasan solo claves conocidas; la corrida de 331 archivos salió verde. Pero cualquier
   llamador futuro que mande una clave de más ahora recibe `validation_error` en vez de que se le
   ignore, y eso es a propósito.
4. **`num_remision` sigue en la lista blanca** aunque nadie la ordena hoy. No la quité: retirar
   una clave del contrato es un cambio incompatible que esta ficha no pidió.
5. **No se midió contra producción.** Las cifras de empates son de la base local (67 órdenes).
   Producción se vació a propósito el 2026-08-25, así que ahí el corpus es otro; el mecanismo
   —`createMany` en transacción— es el mismo.
