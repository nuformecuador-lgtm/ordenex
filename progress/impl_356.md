# Impl 356 — el control para ordenar `/ordenes` por fecha de creación

Frontend de la ficha 356, en el worktree `R:\wt\352` (rama `feature/356-control-de-orden`).
La 352 dejó el ordenamiento cerrado en el servidor y **nunca construyó la interfaz**. Palabras
del humano el 2026-09-02: «no veo un botón con el cual organizar los datos de las tablas por su
fecha de creación, que fue lo que finalmente te pedí». Sin control, la capacidad no existe.

Sin backend: no se toca `lib/services`, `lib/repositories`, `lib/actions` ni el schema. El
contrato consumido es el que ya está en `dev` (`sortBy`/`sortDir` + `claveDeOrden`).

## Archivos

Creados

- `app/(app)/ordenes/_components/ordenamiento-creacion.ts` — declaraciones puras del control
  (campo, dirección inicial, las dos opciones con sus etiquetas, nombre accesible, nota de
  prioridad y el `{sortBy, sortDir}` que se emite).
- `tests/unit/components/ordenamiento-creacion.test.ts`
- `tests/unit/components/ordenes-module-orden.test.tsx`
- `tests/unit/components/ordenes-listado-orden.test.tsx`

Modificados

- `app/(app)/ordenes/_components/OrdenesListado.tsx` — estado de la dirección, el conmutador
  dentro de la barra de filtros y `orden` hacia el módulo.
- `app/(app)/ordenes/_components/OrdenesModule.tsx` — prop `orden`, el orden en la **key de
  SWR**, reinicio de página, el orden en la petición y en la descarga, y el `<caption>` que
  explica `prioridad DESC`.
- `components/shared/DataTable.tsx` — ancho mínimo de la caja de filtros (defecto de solapamiento
  medido a 390 px; ver más abajo).
- Cuatro archivos de test ajenos con la MISMA corrección de una línea: la entrada exacta de
  `listarOrdenes` ahora lleva el orden explícito
  (`OrdenesPageFiltros`, `ordenes-listado-buscador`, `ordenes-listado-filtros`, `ordenes-listado`).

## El control, y por qué esta forma

**Un `SegmentedToggle` con «Más recientes» / «Más antiguas», primer elemento de la barra de
filtros de `/ordenes`.** Tres decisiones, cada una con su motivo:

1. **En la barra, no en la cabecera de la columna.** «Fecha de creación» es la columna **17 de
   18**: la tabla mide 2.374 px y desborda a scroll horizontal en TODOS los anchos medidos
   (1440 incluido), así que esa cabecera está fuera de pantalla salvo que se arrastre la tabla.
   Un control que hay que buscar arrastrando reproduce exactamente el problema que se arregla.
   La barra es además la referencia que señaló el humano para «cómo deben verse las cosas».
2. **Conmutador y no desplegable.** Con dos opciones, un desplegable esconde la mitad del control
   tras un clic; el conmutador enseña las dos y marca la puesta (`aria-pressed`). Es el mismo
   `SegmentedToggle` del portal del mensajero y de cierres: no se inventó ninguna primitiva.
3. **Texto, no sólo flechas.** «Más recientes»/«Más antiguas» dice qué va a pasar sin pulsarlo, y
   sin usar el vocabulario del servidor (`asc`/`desc`). Los iconos acompañan.

Sólo ordena por **fecha de creación**. La lista blanca admite tres campos, pero lo pedido —y lo
medido como faltante— es ese; `claveDeOrden` ya lleva `sortBy`, así que sumar otro campo mañana
no toca la caché.

## Los tres puntos que el encargo marcaba

1. **La key de SWR lleva el orden.** `["ordenes:list", filterKey, claveOrden, page, pageSize]`,
   con `claveOrden = claveDeOrden(orden)` (la función del contrato, no una plantilla a mano). Sin
   esto, pedir «Más antiguas» sirve la caché de «Más recientes»: el control puesto y las filas
   quietas. Atado por test y matado por mutación (M1).
2. **Cambiar el orden vuelve a la página 1**, con el mismo patrón de «ajustar estado durante el
   render» que ya usa el cambio de filtro. La **selección NO se limpia**, a diferencia del
   filtro: ahí las filas marcadas salen del conjunto, aquí el conjunto es el mismo y sólo se
   reparte distinto entre páginas.
3. **`prioridad DESC` va delante, y la interfaz lo dice.** Un `<caption>` de la tabla: «Las
   órdenes prioritarias se muestran primero; el resto sigue el orden por fecha de creación».
   Aparece **sólo** si la página visible trae al menos una orden con `prioridad === true` y sólo
   donde hay control de orden. En el resto de listados `prioridad` es `false` en todas las filas,
   el desempate booleano no mueve nada y anunciar una regla invisible obliga a preguntar «¿qué es
   una prioritaria?». Va como `<caption>` porque es la pieza que HTML tiene para describir una
   tabla: sale bajo la barra y encima de las filas, y existe también para un lector de pantalla.
   `aria-label="Órdenes"` sigue mandando en el nombre accesible (test propio).

## Lo que encontró el navegador y la suite no podía

**A 390 px el botón «Descargar» tapaba 93 px del control, y el clic no llegaba.** Playwright no
conseguía pulsar «Más antiguas»: `<button aria-label="Descargar Órdenes"> intercepts pointer
events`. No era del conmutador.

Medido en Chromium a 390 px, con `min-w-0 flex-1` en la caja de filtros de `DataTable`:

| pieza | ancho | derecha |
|---|---|---|
| fila de la cabecera | 342 | 366 |
| **caja de filtros** (`min-w-0 flex-1`) | **180** | **204** |
| campo de búsqueda (`min-w-[250px]`) | 250 | 274 |
| conmutador de orden | 281 | **305** |
| control de descarga | 118 | 330 (empieza en 212) |

Los hijos de la barra **no pueden encogerse** por debajo de su contenido, así que la caja de 180
px no aprieta: **desborda**. Y el defecto **ya existía**: con el filtro «Estado» puesto su
disparador llega a x=248 dentro de una caja que acaba en 204 (`min-w-56` = 224 px). No se veía
porque caía en la segunda línea, sobre espacio vacío. El conmutador, al ser el primer hijo, cayó
en la MISMA línea que la descarga.

Arreglo, en el punto que lo causa: `min-w-0 flex-1` → `min-w-[min(100%,18rem)] flex-1`. 18rem =
288 px es el ancho del hijo más ancho de esta barra, así que o hay sitio de sobra o la fila se
parte (el `flex-wrap` que ya estaba declarado) y la descarga baja a su propia línea; no queda
franja intermedia donde algo se solape. El `min()` lo acota al 100 % del contenedor para que una
tabla en una caja estrecha no herede un mínimo mayor que su ancho. **En escritorio no cambia
nada**: a 1440 px la fila mide ~1130 y los dos caben (captura antes/después idéntica).

### Medidas después del arreglo

| | 1440×900 | 390×844 |
|---|---|---|
| control dentro del viewport | sí (x=280, 281×32) | sí (x=24, 281×32) |
| solapa con la descarga | no | no (baja a su línea) |
| desborde horizontal de la página | no | no |
| botones recortados (`scrollWidth > clientWidth`) | no | no |
| texto | «Más recientes» / «Más antiguas», íntegro | íntegro |
| alto control / alto buscador | 32 / 32 | 32 / 32 |
| `wrap-anywhere` en la pantalla | 0 nodos | 0 nodos |
| primeras fechas antes de pulsar | 24/7/26 5:40 p. m. ×3 | igual |
| primeras fechas tras «Más antiguas» | 21/7/26 6:59 / 7:59 / 8:59 p. m. | igual |
| `aria-pressed` tras pulsar | Más antiguas=true | Más antiguas=true |
| errores de consola | 0 | 0 |

El reorden es real contra la base local (67 órdenes), no un doble.

## Mutaciones (6, todas rojas, todas revertidas)

| # | mutación | efecto |
|---|---|---|
| M1 | `["ordenes:list", filterKey, page, pageSize]` — el orden fuera de la key | **6 rojos**. `ordenes-module-orden.test.tsx:174` → `Unable to find an element with the text: 1002` (la tabla sigue enseñando la fila de «Más recientes») |
| M2 | quitar `setPage(1)` del reinicio por orden | **2 rojos**. `ordenes-module-orden.test.tsx:233` y `ordenes-listado-orden.test.tsx:203` → `expected 2 to be 1` |
| M3 | quitar `...(orden ?? {})` de la petición (el control no viaja) | **11 rojos**. `ordenes-listado-orden.test.tsx:155` → `expected undefined to be 'created_at'` |
| M4 | el aviso mira `prioridad === false` | **1 rojo**. `ordenes-module-orden.test.tsx:306`. (El caso positivo SOBREVIVE: su página es mixta y `some` se cumple igual. El negativo lo caza.) |
| M5 | el aviso deja de mirar si la superficie ofrece el control | **1 rojo**. `ordenes-module-orden.test.tsx:313` |
| M6 | `DIRECCION_ORDEN_INICIAL = "asc"` (la pantalla arranca al revés que el servidor) | **5 rojos**. `ordenamiento-creacion.test.ts:24` → `expected 'asc' to be 'desc'` |

Tras revertirlas, los tres archivos nuevos: 26/26 en verde.

## Estado de la verificación

- `pnpm typecheck` — verde.
- `pnpm lint` — 0 errores (150 avisos, los mismos 150 de antes de tocar nada).
- `pnpm exec vitest run guard` — 172/173. Único rojo: `superficie-de-uso` por
  `lib/actions/tarifas.ts:67 obtenerTarifa`, **heredado** y ajeno a esta ficha.
- `pnpm exec vitest run tests/unit/components tests/components` — 5.101 pasados, 1 rojo:
  `GenerarApiKeyForm.test.tsx:168`, que **pasa aislado en 6,6 s** y no toca nada de esto (es la
  familia «rojo por timeout bajo carga»).

## Lo dudoso, dicho

- **El `<caption>` no se pudo ver en el navegador.** La base local no tiene NINGUNA orden con
  `prioridad = true` (el filtro «Reasignables» devuelve vacío), así que el aviso sólo está
  verificado por test. Es esperable: la prioridad la enciende «deshacer asignación» y producción
  se vació el 2026-08-25.
- **El arreglo de `DataTable` no tiene test.** jsdom no calcula layout: no hay forma de que un
  test vea el solapamiento. La evidencia es la medición del navegador y el porqué queda escrito
  junto a la clase, que es la convención del repo. Si alguien devuelve `min-w-0`, la barra móvil
  se rompe otra vez en silencio.
- **`DataTable` la comparten 22 tablas.** El cambio sólo actúa donde la fila no da para los dos
  controles, o sea donde hoy ya se desbordaban; en escritorio es un no-op medido.
- **«Limpiar todo» NO devuelve el orden a «Más recientes»**, y es deliberado: ese botón deshace lo
  que ESCONDE filas (filtro y búsqueda), y el orden no oculta ninguna. Además sólo aparece con
  filtros o búsqueda puestos, así que quien únicamente cambió el orden no tendría cómo deshacerlo
  por ahí — el control, que sigue a la vista, ya es esa forma. Hay test.
- **El listado plano no lleva control.** `adminSatelite`, `mensajero` y sin sesión reciben en
  `/ordenes` un `OrdenesModule` **sin barra de filtros** (page.tsx:160); no hay dónde poner el
  conmutador sin inventarles una barra. Su petición no cambia ni una clave. Si se quiere ahí,
  es otra ficha.
- **Cuatro tests ajenos tocados.** Afirmaban la entrada EXACTA de `listarOrdenes`
  (`{page:1,pageSize:25}`) como «sin regresión de la 144/169». Lo que vigilan —que sin selección
  no se inyecte ninguna clave de FILTRO— sigue en pie y la igualdad sigue siendo exacta: sólo se
  sumaron las dos claves de orden que ahora la pantalla manda siempre. Motivo escrito en cada uno.
- **Servidor de desarrollo:** el que estaba levantado servía `R:\job\...\ordenex` (otro árbol), así
  que no enseñaba este código. Se levantó uno propio en el **puerto 3001** para medir y se apagó
  al terminar. Con Turbopack **no arranca en un worktree** (`Symlink [project]/node_modules is
  invalid, it points out of the filesystem root`, por el junction de `node_modules`): hay que usar
  `next dev --webpack`. Queda apuntado porque volverá a pasarle a quien mida desde un worktree.
