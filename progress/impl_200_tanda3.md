# Feature 200 — Tanda 3: el libro (DataTable, WalletLedger, WalletFiltros, WalletModule)

Rama: `feature/200-wallet-ui-presentacion`. Alcance: **solo presentación**. No se tocó ninguna
server action, DTO, `lib/`, ni **ningún test**.

## Archivos tocados (4, ninguno más)

1. `components/shared/DataTable.tsx` — prop nueva `align`, aditiva.
2. `app/(app)/wallet/_components/WalletLedger.tsx` — jerarquía de la tabla.
3. `app/(app)/wallet/_components/WalletFiltros.tsx` — reescrito como barra de una línea.
4. `app/(app)/wallet/_components/WalletModule.tsx` — solo la sección del libro (+ el import de
   las primitivas de `Card`).

## A) `DataTable` — `align?: "left" | "right"`

Prop **opcional** en `Column<T>`, aplicada al `<th>`, al `<td>` de datos y al `<td>` del
skeleton. Implementada con un helper `alignClass(column)` que devuelve **`undefined`** cuando la
columna no la declara: eso es lo que la hace retrocompatible de verdad —la celda queda con el
`className` de siempre, no con un `text-left` añadido— y por tanto las 30 tablas del censo
renderizan byte a byte como antes. Verificado: la suite entera del `DataTable` (34 archivos,
353 tests) pasa sin tocar una línea de test, incluido `DataTable.test.tsx > B12/B13`, que
compara clases de fila.

En el skeleton, además de la clase en el `<td>`, el placeholder recibe `ml-auto` cuando la
columna es `"right"`: `Skeleton` es un bloque con ancho propio (`w-16`…) y `text-align` no lo
mueve, así que sin eso la columna saltaría de lado justo al terminar de cargar.

El JSDoc sigue el patrón con el que se documentó `minWidth`: por qué existe (un importe alineado
a la izquierda deja las unidades a distinta altura en cada fila, y comparar dos filas obliga a
leer cifra a cifra), que es opt-in, y qué pasa cuando está ausente.

## B) `WalletLedger`

- **`Monto`**: `align: "right"`, `tabular-nums` y color por tipo (`text-success-strong` /
  `text-danger-strong`) en un subcomponente `MontoCelda`. El STRING se pinta **tal cual** con
  `money(m.monto)`: sin `+`/`-` delante (el signo sería un dato inventado por la pantalla; quien
  dice la dirección es la columna «Tipo») y sin `Number(` / `parseFloat(` / `parseInt(` /
  `.toFixed(` en todo el archivo.
- **`TipoBadge`**: `default`/`destructive` → `success`/`danger`, las variantes semánticas de
  `components/ui/badge.tsx`. Es el mismo arreglo que la tanda 2 hizo en el badge de signo:
  `default` es el naranja de MARCA y usarlo para «Ingreso» hacía que la fila más común de la
  tabla compitiera en color con los botones. Los textos siguen saliendo de `TIPO_LABEL`.
- **`minWidth` por columna**: 7rem fecha · 6rem tipo · 11rem categoría · 9rem monto · 18rem
  origen (la más ancha: lleva origen + descripción libre) · 7rem acciones. Con esto el scroll
  horizontal del `DataTable` aparece antes de que las celdas se estrujen.
- `Acciones` y el botón «Reversar»: sin cambios funcionales.

### EL ORDEN DE LAS COLUMNAS NO SE PERMUTÓ — y es la única decisión abierta

El encargo pedía `Fecha · Origen · Categoría · Tipo · Monto · Acciones`. Está **bloqueado por un
test**, y se midió antes de decidir (se implementó la permuta, se corrió, y se revirtió):

```
tests/components/descarga/WalletDescarga.test.tsx:566
  «R62: el listado los pinta como a los demás, sin cambiar las columnas»

  AssertionError: expected [ Array(6) ] to deeply equal [ 'Fecha', 'Tipo', 'Categoría', …(3) ]
  - "Tipo"      + "Origen"
  + "Tipo"      - "Origen"
```

Esa aserción es de la feature 173 y lo que quiere afirmar es **otra cosa**: que las dos
categorías nuevas no AÑADEN ni QUITAN columnas. El orden se le coló dentro por usar `toEqual`
sobre el array. Mover esas seis líneas es un cambio de aserción **deliberado** y necesita
aprobación —esta tanda tiene prohibido tocar tests—, así que la permuta queda pendiente y el
motivo está anotado en el propio `WalletLedger.tsx`, en el sitio donde alguien lo buscará.

Dato para quien decida: el mismo patrón está repetido en un ledger hermano
(`tests/integration/wallet-tiendas-desglose.test.tsx:443` fija
`["Fecha","Tipo","Concepto","Monto","Origen"]` para `DesgloseMovimientosTienda`), así que
permutar el libro de caja sin más dejaría los dos ledgers con órdenes distintos.

Lo que sí llegó sin tocar el orden es de donde venía la mayor parte de la ganancia de lectura: el
dinero a la derecha, en rejilla y con color semántico.

## C) `WalletFiltros` — barra compacta

De `flex flex-wrap items-end gap-4` con cuatro rótulos encima (dos alturas de pantalla) a
`flex flex-wrap items-center gap-2`: una línea en pantallas grandes, y en móvil cada control
ocupa su propia fila (`w-full sm:w-auto`). Controles y botones a `h-9`. «Aplicar» primario y
«Limpiar» a la derecha (`sm:ml-auto`).

Conservados sin tocar: el `aria-label="Filtros del libro"` del `<form>`, los cuatro campos, el
borrador local (`draft`/`set`) y el contrato `onAplicar`/`onLimpiar`/`disabled`.

### El `htmlFor` huérfano: **existía**, y está arreglado

Confirmado. Los dos `<Select>` tenían `<Label htmlFor="wallet-filtro-tipo">` y
`<Label htmlFor="wallet-filtro-categoria">` y **no había ningún elemento con esos ids en el
documento**: la primitiva `Select` acepta `id` (su JSDoc dice literalmente «para casar con un
`Label htmlFor` (patrón `FormField`)») pero nadie se lo pasaba. Las dos etiquetas colgaban de la
nada desde la feature 42. Arreglado pasando el `id` al `Select`, que es el mismo pareado que ya
usa en producción `DesgloseMovimientosTienda.tsx:396-399`.

Medido, no supuesto: se escribió una sonda temporal que recorre los `label[for]` del formulario y
busca su destino en el DOM, se comprobó que **muere con una mutación** (quitar un solo `id` la
pone roja con «htmlFor huérfano: wallet-filtro-tipo») y se borró. Los 4 rótulos apuntan hoy a un
id real.

### Rótulos: qué es `sr-only` y qué no

- **Los dos `Select`** pasan a `sr-only`: su nombre visible ya lo dice el `placeholder`
  («Todos los tipos» / «Todas las categorías»), que además informa mejor que un rótulo, porque
  dice qué se está viendo ahora y no cómo se llama el campo. El nombre accesible lo sigue dando
  el `aria-label`, que tiene precedencia sobre la etiqueta nativa: no se mueve, y por eso
  `getByRole("combobox", { name: "Filtrar por categoría" })` sigue verde.
- **Las dos fechas conservan su rótulo VISIBLE** (corto, `text-xs text-muted-foreground`, en
  línea con el campo). Ver «Decisiones» punto 1: aquí me aparté del encargo a propósito.

## D) `WalletModule` — el libro dentro de una card

La sección pasa de tres hermanos sueltos a UNA `Card`, hermana (nunca anidada) de las otras dos
de la página:

- `<section aria-label="Libro de movimientos">` **por fuera** de la `Card`, conservada; el
  `CardTitle` le añade el título VISIBLE que la sección nunca tuvo (hasta ahora el nombre del
  bloque solo existía en el árbol de accesibilidad).
- La barra de filtros es hija DIRECTA del `Card` (sin `CardContent`), con
  `border-b bg-muted/30 px-(--card-spacing) py-3`: así el fondo y el borde llegan a los dos
  bordes de la tarjeta y los controles quedan alineados con el título.
- `<WalletLedger>` en `CardContent`.
- `<Pagination>` en `CardFooter` con **`sticky={false}`** y
  `className="w-full justify-between gap-3 py-0"` — el patrón que la tanda 2 descubrió y que ya
  usan `GastosFijosPlantillasPanel`, `DetalleMensajeroPanel` y `DesglosePagosMensajero`.
  `ariaLabel="Paginación del libro"`, intacto.

`recargar`, `buildInput`, `buildInputCompleto`, `manejarError`, `obtenerFilasDescarga` y todas
las llamadas a actions: sin tocar. Lo único que se añadió al archivo fuera de esa sección es el
`import` de las primitivas de `Card`.

## Decisiones tomadas sin instrucción explícita

1. **Las dos fechas NO reciben `aria-label`.** El encargo pedía «`aria-label` + un rótulo corto»,
   y eso habría roto un test que no puedo tocar:
   `tests/components/descarga/WalletDescarga.test.tsx:413` hace
   `screen.getByLabelText("Desde")`, y un `aria-label` distinto tapa el rótulo en el cómputo del
   nombre accesible. Además, superponer un `aria-label` a una palabra que SE VE en pantalla es
   justo lo que WCAG 2.5.3 (Label in Name) pide evitar. Así que las fechas conservan su
   `<Label htmlFor>` como rótulo corto visible, que es también su nombre accesible: una sola
   fuente, sin duplicar. El `input[type=date]` no tiene placeholder que las nombre, así que el
   rótulo tenía que quedarse visible de todos modos.
2. **«Limpiar» se queda en `variant="outline"`, no baja a `ghost`** (el encargo permitía
   cualquiera de las dos). La barra vive sobre `bg-muted/30` y un botón sin borde ahí se lee como
   texto suelto, no como algo pulsable.
3. **El alto `h-9` va como clase literal en cada control**, no por una constante compartida.
   Tailwind lee el fuente y no evalúa expresiones; es la misma razón que anotó la tanda 1 para
   las clases de la grilla.
4. **`align` devuelve `undefined` (no `"text-left"`) para las columnas que no la declaran.** Con
   `"text-left"` por defecto, las 30 tablas del censo habrían ganado una clase nueva en cada
   celda: mismo píxel, pero ya no es cierto que «ausente ⇒ render EXACTAMENTE igual», y cualquier
   test que compare `className` lo habría notado.
5. **No se tocó `wallet-ledger-descarga-columnas.ts`**, cuyo JSDoc dice que las columnas del
   archivo van «en su orden de pantalla». Es un quinto archivo, fuera del alcance declarado, y
   además hoy sigue siendo verdad porque el orden de pantalla no se movió. Si algún día se
   aprueba la permuta del punto B, ese comentario hay que revisarlo con ella.
6. **La trampa de la tanda 2, respetada**: ni un solo comentario de estos cuatro archivos nombra
   la etiqueta de la tabla entre los signos de menor/mayor. `cobertura-tablas.guardia` sigue
   contando una tabla en `WalletLedger.tsx` y 47 archivos de `tests/unit/descarga` +
   `tests/components/descarga` + `tests/components/paginacion` pasan.

## Verificación (ningún test tocado)

```
pnpm exec vitest run tests/unit/components/wallet-ledger-reversa.test.tsx \
  tests/unit/components/wallet-indemnizacion-libro.test.tsx \
  tests/integration/wallet-page.test.tsx
  → Test Files 3 passed (3) · Tests 19 passed (19)

pnpm exec vitest run tests/components/descarga tests/components/paginacion tests/unit/descarga
  → Test Files 47 passed (47) · Tests 323 passed (323)

# Toda la suite del DataTable: los 34 .test que lo nombran (grep -rl "DataTable" tests/)
pnpm exec vitest run $(grep -rl "DataTable" tests/ | grep -E "\.test\.tsx?$")
  → Test Files 34 passed (34) · Tests 353 passed (353)

pnpm exec tsc --noEmit
  → sin salida (verde)
```

De más, para no dejar un rojo detrás:

```
pnpm exec vitest run tests/unit/guards tests/components/CajaResumenCard.test.tsx \
  tests/unit/components/wallet-desglose-egresos-card.test.tsx \
  tests/unit/components/wallet-gastos-fijos-panel.test.tsx
  → Test Files 28 passed (28) · Tests 305 passed (305)

pnpm exec eslint <los 4 archivos> → limpio
```

`git status` al cerrar: solo los 8 archivos de las tres tandas + `feature_list.json`. Ningún
archivo bajo `tests/`.

**Falta el gate completo (`./init.sh`) antes de cualquier PR.**
