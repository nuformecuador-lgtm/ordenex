# Ficha 348 — la tabla de productos estruja las columnas y parte palabras

Rama `fix/348-tabla-productos-apretada`. Arreglo acotado a la tabla de productos de `/analitica`.
Sin backend, sin base, sin rutas de API.

---

## 1. Lo que reportó el humano, y lo que resultó ser

> «las columnas de la tabla hacen que todo quede muy apenuzcado y lo ideal es que la información
> sea fácil de leer y **no se corten palabras de un renglón a otro**» — con `Nufor/m`,
> `Otros/resultados` y `(no/sumable)` en la captura.
>
> «los controles de movimiento horizontal creo que **no estás usando los del componente que ya
> existe**… está pegado a mitad de tabla y el que tenemos se mueve verticalmente con la misma».

Son **dos defectos distintos con dos causas distintas**, y ninguna de las dos era la que parecía.

| lo que parecía | lo que era, medido |
| --- | --- |
| «faltan `minWidth`» | faltaban, pero el que PARTÍA las palabras era `wrap-anywhere` |
| «la tabla no usa el componente compartido» | lo usa; lo que sobraba era un `overflow-hidden` de su `Card` |

---

## 2. El defecto de las palabras partidas: reproducido en local, no deducido

La base local **tiene una sola tienda** (`Tania`, 5 letras), así que la columna «Tienda» no se
monta —se decide por contenido, `>1 tiendaId`— y con ella no montada **no se parte nada**. Es
exactamente la deuda que la 347 declaró y no cubrió. Para verlo hubo que forzar el caso:

- **`conTienda = true` a mano en el árbol, sólo durante la medición** (parche temporal marcado
  `TEMP-348-MEDICION`, retirado antes de cerrar; `grep TEMP-348` devuelve 0).
- **Nombres reales inyectados en el TEXTO del DOM**, no en la base: `Nuform`,
  `Distribuidora Karla`, `Nuform Ecuador`, y nombres de producto largos. **No se sembró nada**
  ni se tocó un solo registro.

### El mecanismo, con el número delante

Se midió, para cada columna, **la palabra más ancha de su encabezado y de sus celdas**, cada una
con su propia fuente, más el relleno de 24 px del `<th>`:

| columna | palabra más ancha | necesita | tenía | ¿estrujada? |
| --- | --- | --- | --- | --- |
| **Tienda** | `Distribuidora` (dato) | **114** | **66** | **SÍ, −48 px** |
| Producto | `PRESENTACION` (dato) | 126 | 224 | no |
| Recaudado | `Recaudado` (rótulo) | 95 | 95 | no |
| Cobró Ordenex | **`sumable)`** (rótulo) | 89 | 89 | no |
| Para la tienda | **`sumable)`** (rótulo) | 89 | 89 | no |
| Unidades / Órdenes / Entregadas / Rechazadas | su rótulo | 83 / 77 / 96 / 100 | 83 / 76 / 95 / 100 | no |
| Otros resultados | `reprogramadas` (composición) | 120 | 120 | no |
| En proceso / Efectividad / % de rechazo | su rótulo | 74 / 94 / 74 | 74 / 93 / 74 | no |

**Once de trece columnas ya estaban exactamente en su palabra más larga.** La única estrujada era
«Tienda», y lo estaba porque `NombreProducto` llevaba **`wrap-anywhere`**: esa clase reduce el
`min-content` de la columna a UN carácter, o sea que autoriza al navegador a dejarla más estrecha
que su palabra más larga — y entonces la parte. Es el `Nufor/m` de la captura, literal.

Y se confirma la sospecha del leader: en dos columnas de dinero **la palabra más ancha del
encabezado era `sumable)` (61 px)**, del aviso y no del dato.

### Palabras partidas, medidas con `Range.getClientRects()`

Una palabra se declara partida cuando sus rects caen en **más de un `top`**. Nada a ojo.

| | 1440×950 | 390×844 |
| --- | --- | --- |
| **ANTES** | **3**: `Nuform` (2 líneas), `Distribuidora` (3), `Ecuador` (2) | **6**: `HIDROLIZADO`, `PRESENTACION`, `TURKESTERONE`, `Hemorroides`, `USB-C`, `Blanqueadora` |
| **DESPUÉS** | **0** (582 palabras miradas) | **0** (1.050 palabras miradas) |

`Blanqueadora` viene de un producto REAL de la base local: el defecto de 390 px existía sin
inyectar nada.

> ⚠️ **El instrumento mintió dos veces antes de medir bien**, y merece decirse porque es la
> trampa de [[node-e-regex-se-desescapa]] en su forma más silenciosa: `/\S+/g` escrito dentro de
> un template literal se evalúa como `/S+/g` —`\S` no es un escape válido y colapsa a `S`—, así
> que el detector partía las palabras por la letra «s» y devolvía **cero partidas** con
> `Distribuidora` roto en tres líneas delante. Lo mismo con `[^\\s]+` en un heredoc. El medidor
> final vive en un archivo aparte y **parte las palabras a mano, carácter a carácter, sin una
> sola barra invertida**.

---

## 3. El control de scroll: las dos tablas medidas, y quién estaba mal

El humano compara con `/ordenes`. **Las dos usan el MISMO `DataTable`** y la misma flecha
(`position: sticky; top: 50%`). Se midieron las dos desplazando la página de 0 a ~2.700 px:

| | `top` calculado | centro de la flecha al bajar la página |
| --- | --- | --- |
| `/ordenes` (la buena) | **475 px** | **475 · 475 · 475 · 475 · 475** — clavada a media ventana |
| `/analitica` ANTES | **1274 px** | 2421 · 2121 · 1721 · 943 · **−267** — se va con la tabla |
| `/analitica` DESPUÉS | **475 px** | 1406 · 1106 · 706 · **475 · 475** — idéntica a `/ordenes` |

### La causa

`ContenedorSeccion` envuelve la tabla en un `Card`, y `Card` trae **`overflow-hidden`**. Un
`overflow` distinto de `visible` **crea un scrollport**, y un `position: sticky` se pega a su
scrollport más cercano, no a la ventana. Ese `Card` mide **2580 px** y no scrollea nunca, así que
la flecha no se pegaba jamás — y su `top: 50%` se resolvía contra él: **1274 ≈ (2580 − 32) / 2**,
no 475. En `/ordenes` la tabla cuelga de una `<section>` sin overflow, su scrollport es la ventana
y por eso la flecha acompaña.

Los primeros valores de la tabla («475 · 475 · …» ya a `y=0` en `/ordenes` y no en `/analitica`)
son la misma propiedad vista desde otro sitio: la tabla de productos empieza a 1.398 px de alto de
página, así que hasta que no se baja, su tira sticky no ha alcanzado la restricción. Con la tabla
a la vista, las dos se comportan igual.

### Por qué NO se tocó `DataTable`

Porque `DataTable` **no está mal**: lo usan 30 listados y en `/ordenes` hace exactamente lo que el
humano da por bueno. Lo que sobraba era un scrollport, y sólo en esta sección. El arreglo es
`className="overflow-visible"` en el `ContenedorSeccion` de productos — una línea, en el punto de
montaje. **No se toca `Card` ni `ContenedorSeccion`**: las demás secciones conservan su recorte.

---

## 4. Qué se cambió

| archivo | qué |
| --- | --- |
| `app/(app)/analitica/_components/entregas/ProductosTabla.tsx` | fuera `wrap-anywhere` (escritorio y teléfono); **13 `minWidth`** declarados y medidos; `(no sumable)` fuera de los tres rótulos; leyenda nueva `textoColumnasNoSumables`, **derivada de `ORDEN_DINERO`** |
| `app/(app)/analitica/page.tsx` | `className="overflow-visible"` en el `ContenedorSeccion` de productos |
| `tests/components/ProductosTablaDinero.test.tsx` | el caso R45 de la marca **sustituido por uno que afirma más**; 3 casos nuevos de ancho/no-partido; 3 de la leyenda derivada |
| `tests/components/AnaliticaPage.test.tsx` | guardia de fuente: la sección declara `overflow-visible` |

### Los trece mínimos, y de dónde sale cada número

Cada uno es **la palabra más larga de esa columna + 24 px de relleno**, redondeado al escalón de
0,5 rem: `Tienda 8rem` · `Producto 14rem` · `Recaudado 6.5rem` · `Cobró Ordenex 6rem` ·
`Para la tienda 6rem` · `Unidades 5.5rem` · `Órdenes 5rem` · `Entregadas 6rem` ·
`Rechazadas 6.5rem` · `Otros resultados 7.5rem` · `En proceso 5rem` · `Efectividad 6rem` ·
`% de rechazo 5rem`.

El mínimo **no reserva sitio para un importe más grande y no hace falta**: `Cifra` lleva
`whitespace-nowrap`, así que un `₡12.345.678` (81 px, medido por la 347) empuja la columna solo.
El mínimo está para que se lea el ENCABEZADO.

### El aviso de «no sumable»: se mudó y afirma MÁS

La guardia `dinero-producto-no-sumable.guardia.test.ts` se leyó entera **antes** de mover nada: lo
que exige es que **no exista ningún total al pie** (barrido estático + render con tres importes
cuya suma no puede aparecer en el DOM + autocomprobación). **No pide la marca en el encabezado** —
eso lo pedía `ProductosTablaDinero › «R45 — los TRES encabezados llevan la marca»—. La guardia
**sigue en verde por su propio motivo, 11/11, y no se le tocó una línea**.

El aviso no se pierde: el párrafo largo (`avisoDinero`) sigue arriba con todas sus letras, y
debajo va la leyenda nueva, que dice lo único que la marca aportaba —**cuáles** son— y lo dice
**derivándolo de `ORDEN_DINERO`**: el día que haya una cuarta columna de dinero, la leyenda la
nombra sola. La marca larga sigue viva en el **archivo descargable**
(`MARCA_NO_SUMABLE_ARCHIVO`), que es donde de verdad hace falta: un `.xlsx` no lleva leyenda
encima y ahí el ancho no cuesta nada.

Ganancia medida al sacarla del rótulo: **la cabecera pasa de 81 px a 49 px de alto** (de 3-4
líneas a 2). En ANCHO no recupera nada —las tres columnas quedan gobernadas por su cifra— y se
dice para que nadie lo dé por hecho.

---

## 5. El navegador, con la columna «Tienda» montada

Chromium, sesión real (`admin.qa@ordenex.test`), un solo `pnpm dev` en `:3000`.

| | ANTES 1440 | DESPUÉS 1440 | ANTES 390 | DESPUÉS 390 |
| --- | --- | --- | --- | --- |
| palabras partidas | **3** | **0** | **6** | **0** |
| alto de la cabecera | 81 px | **49 px** | 33 px | 33 px |
| scroller (visible / contenido / desborde) | 1102 / 1302 / **200** | 1102 / 1416 / **314** | 308 / 308 / **0** | 308 / 316 / **8** |
| última columna fuera de la ventana | 159 px | 273 px | 0 | 0 |
| flechas de scroll | 2 | 2 | 0 | **2** |
| desborde del DOCUMENTO | 0 | **0** | 0 | **0** |
| recorte interno de un importe | 0 | **0** | 0 | **0** |

`innerText` íntegro de las tres celdas de dinero, con `₡393.433` inyectado:

```
Recaudado      → "₡393.433\nCon otro producto: 0 de 6"
Cobró Ordenex  → "₡393.433"
Para la tienda → "₡393.433"
```

**El precio, dicho sin adornos:** el desborde horizontal sube de 200 a **314 px** a 1440, y a 390
aparece un desborde de **8 px** con sus dos flechas donde antes no había ninguna. Es lo que cuesta
que ninguna palabra se parta, y es la elección explícita del humano. El documento no desborda a
ningún ancho y ningún importe se recorta.

---

## 6. Mutaciones — seis, con su línea de fallo real

Todas revertidas; el árbol final está verificado con `git diff`.

| # | mutación | resultado |
| --- | --- | --- |
| **1a** | quitar `minWidth: MIN_TIENDA` **con los casos nuevos apagados** | **74 VERDES.** Nada lo cazaba. Ver abajo. |
| **1b** | la misma, con los casos nuevos activos | ROJO ×2 — `AssertionError: la columna «Tienda» no declara mínimo: expected '' not to be ''` |
| **2** | devolver `wrap-anywhere` a `NombreProducto` | ROJO — `AssertionError: Producto: expected '<td …' not to match /\bwrap-anywhere\b/` |
| **3** | leyenda con dos columnas en vez de tres (`ORDEN_DINERO.slice(0, 2)`) | ROJO — `Unable to find an element with the text: Las columnas de dinero que no se pueden sumar hacia abajo: Recaudado, Cobró Ordenex y Para la tienda.` |
| **4** | devolver `(no sumable)` al rótulo de «Recaudado» | ROJO — `AssertionError: expected 'Recaudado (no sumable)' not to match /sumable/i` |
| **5** | mínimo simbólico: `MIN_TIENDA = "1px"` | ROJO — `AssertionError: «Tienda» → 1px: expected '1px' to match /^[\d.]+rem$/` |
| **6** | quitar `overflow-visible` de la sección | **VERDE (84 casos).** Ver abajo. |

### 1a — LOS ANCHOS NO ESTABAN ATADOS POR NADA, y está medido

El leader pidió comprobarlo explícitamente. **Confirmado**: con los tres casos nuevos apagados,
quitar el `minWidth` de «Tienda» deja **74 de 74 en verde** en los cuatro archivos de la tabla. La
347 declaraba tres mínimos para trece columnas y **borrarlos no ponía nada en rojo**: el navegador
estrujaba y la suite entera seguía verde. Es información, y es la razón de que los tres casos
nuevos existan.

### 6 — la corrección de la flecha era invisible para jsdom

Quitar `overflow-visible` dejaba **84 casos en verde** (página, shell y tabla): jsdom no hace
layout, así que ninguna suite puede ver un `overflow`. Se cerró con una **guardia de fuente** en
`AnaliticaPage.test.tsx` que lee el bloque del `ContenedorSeccion` que envuelve `<ProductosTabla`
y exige la clase; se vio fallar (`expected '<ContenedorSeccion…' to contain 'overflow-visible'`)
antes de darla por buena. Es una guardia de texto y se sabe: la alternativa era que la única
corrección de la ficha que un humano nota se pudiera revertir sin una sola señal.

---

## 7. Verde

- `pnpm typecheck` — **limpio**.
- `pnpm lint` — **0 errores**, 145 warnings preexistentes (`no-unused-vars` en tests ajenos).
- `ProductosTabla` + `ProductosTablaDinero` + `ProductosDescarga` + la guardia de no-sumable:
  **verde**, y la guardia por su propio motivo.
- `./init.sh --rapido` — ver el cierre de este archivo.

---

## 8. Lo dudoso, dicho

1. **Las flechas nuevas a 390 px.** Antes la vista de teléfono no desbordaba (308/308) y ahora
   desborda 8 px, así que aparecen dos flechas donde no había ninguna. Es la consecuencia directa
   de no partir `PRESENTACION` ni `TURKESTERONE`, y se eligió el criterio del humano; pero 8 px es
   poco desborde para dos controles, y si al verlo le molesta, la palanca es bajar el mínimo de
   «Producto» en la vista de teléfono (que hoy no declara ninguno y sale de su palabra más larga).
2. **Los nombres de tienda de PRODUCCIÓN no se conocen.** El mínimo de «Tienda» (8rem = 128 px)
   se dimensionó con `Distribuidora` (90 px), que es una suposición razonable pero **inyectada por
   mí**, no leída de la base de producción. Si allí hay un nombre de una sola palabra más largo,
   la columna crecerá sola —el `min-content` manda sobre el mínimo— y el único efecto será más
   desborde. No parte nada en ningún caso.
3. **La leyenda no es un `<caption>`.** Semánticamente lo suyo sería el `<caption>` de la tabla,
   y `DataTable` tiene la prop. Se descartó **con la medida delante**: el `<caption>` vive DENTRO
   del scroller horizontal y mide lo que mide la tabla (1416 px), así que su final quedaría fuera
   de la ventana y habría que arrastrar la tabla para leer el aviso. La leyenda va como párrafo
   junto a los otros dos avisos, a ancho de contenedor y siempre legible.
4. **`overflow-visible` en ese `Card`.** Anula el recorte de las esquinas redondeadas de esa
   tarjeta. En la práctica no cambia nada porque el `DataTable` trae su propio marco con
   `overflow-hidden`, pero es un cambio de la tarjeta entera y no sólo de la tabla; si aparece
   algún desborde visual raro en esa sección, es el primer sitio donde mirar.
5. **El panel de dinero por fila sigue sin verse en un navegador** (deuda heredada de la 347: la
   base local no tiene entregas con recaudo dentro de un cierre aprobado). Su `DataTable` interno
   hereda ahora el `overflow-visible` de la sección, así que sus flechas también deberían
   comportarse como las de `/ordenes` — **no medido**.
