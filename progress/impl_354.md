# Ficha 354 — la columna «Recaudado» sigue siendo un acordeón

Rama `fix/354-columna-recaudado`, árbol principal. Solo presentación: sin backend, sin base, sin
rutas de API. Un archivo de componente y uno de tests.

---

## 1. Lo reportado, reproducido en el navegador antes de tocar nada

> «la columna de **recaudado sigue estando súper angosta**» — con la celda partida en ocho.

Reproducido a 1440×950 **con la columna «Tienda» montada**, carácter a carácter (cada letra
situada por su rectángulo en pantalla y agrupada por banda vertical, sin una sola regex):

| la captura del humano | lo medido en local, ANTES |
| --- | --- |
| `₡35.697` | `₡35.697` |
| `Con otro` | `Con otro` |
| `producto: 4` | `producto: 4` |
| `de 33` | `de 33` |
| `Pendiente` | `Pendiente de` |
| `de cierre:` | `cierre:` |
| `₡23.798 (2` | `₡23.798 (2` |
| `órdenes)` | `órdenes)` |

**Ocho renglones, los ocho, en las 25 filas** (`max = min = 8`). El único desajuste es dónde cae
el corte entre el 5.º y el 6.º renglón, que depende de un par de píxeles de fuente. Es el mismo
defecto y la misma celda.

### Forzar el caso, que es donde la 348 se equivocó

La base local **tiene una sola tienda y ningún cierre aprobado**: sin forzar nada, la columna
«Tienda» no se monta y las tres celdas de dinero dicen «—». Medir así fue exactamente el error
que dejó pasar este defecto, así que se fabricó el caso de producción **en el navegador**, con un
parche temporal marcado `TEMP-354-MEDICION` activado solo con `?temp354=1`: tres tiendas
(`Nuform`, `Distribuidora Karla`, `Nuform Ecuador`), 33 órdenes, 4 acompañadas, recaudado
`₡35.697` y pendiente `₡23.798` de 2 órdenes — los números de la captura.

**No se sembró ni se tocó un solo registro.** El parche está retirado: `grep TEMP-354` y
`grep temp354` sobre `app/`, `lib/`, `components/` y `tests/` devuelven **0**.

---

## 2. La causa, con el número que la nombra

La 348 midió «cero palabras partidas» y era **verdad**; lo que pasa es que respondía a otra
pregunta. Su mínimo por columna salía de **la palabra más ancha**, y para once de las trece
columnas eso es correcto porque su contenido son palabras sueltas y cifras. La celda de
«Recaudado» no lleva palabras: lleva **dos frases**.

Medido clonando cada pieza real con su propia fuente y leyendo su ancho a `min-content` y a
`max-content`:

| pieza de la celda | palabra más ancha | **la FRASE entera** |
| --- | --- | --- |
| `₡35.697` | 65 px | 65 px |
| `Con otro producto: 4 de 33` | 58 px | **161 px** |
| `Pendiente de cierre: ₡23.798 (2 órdenes)` | 61 px | **244 px** |

El mínimo declarado era **6,5rem = 104 px**, calculado sobre esos 65 px de la cifra. Con 104 px
de columna, el navegador hacía lo único que podía: plegar las frases. Y ninguna guardia lo veía
porque **ninguna palabra se rompía por dentro**, que es lo único que la 348 dejó atado.

---

## 3. Qué se cambió, y por qué esta forma

Dos piezas, y una sostiene a la otra:

1. **`whitespace-nowrap` en las dos líneas de apoyo** (`Contexto unaLinea` en `CeldaRecaudado`).
   Sube el `min-content` de la columna **de la palabra a la frase**, y lo hace solo: el día que
   el importe pendiente tenga dos dígitos más, o las órdenes pasen de 999, la columna crece con
   el dato sin que nadie edite un número. **Es la garantía.**
2. **`MIN_DINERO.recaudado` de 6,5rem a 17rem**, medido sobre la frase: 244 px + 24 de relleno
   del `<th>` = 268 px = 16,75rem, redondeado al escalón de 0,5rem hacia arriba. **Es el suelo**,
   y su función es que la columna NO cambie de ancho al pasar de página cuando una página no
   tiene ninguna fila con pendiente de cierre.

**No es un recorte y no se esconde nada.** `whitespace-nowrap` no abrevia, no tapa y no corta:
prohíbe que la columna sea más estrecha que su frase. Es lo contrario de `wrap-anywhere` —el
culpable de la 348, que BAJABA el `min-content` a un carácter y autorizaba a partir palabras—, y
por eso no reintroduce aquel defecto. R63 sigue intacto: ni `truncate`, ni `line-clamp`, ni
`overflow-hidden`, y su guardia sigue verde por su propio motivo.

**`unaLinea` NO se aplica a `Contexto` entero, a propósito.** La composición de «Otros
resultados» también es un `Contexto` y **crece con el catálogo de desenlaces**: forzarla a una
línea convertiría esa columna en una de 300 px que nadie ha pedido. Hay un caso de test que lo
fija (mutación M5).

| archivo | qué |
| --- | --- |
| `app/(app)/analitica/_components/entregas/ProductosTabla.tsx` | `Contexto` gana `unaLinea`; las dos líneas de apoyo de `CeldaRecaudado` la declaran; `MIN_DINERO.recaudado` 6,5rem → **17rem**; la fila de «Recaudado» de la tabla de mínimos de la 348 queda marcada como derogada, con el porqué |
| `tests/components/ProductosTablaDinero.test.tsx` | bloque «FICHA 354», 4 casos |

### Lo que se consideró y se descartó, con la medida delante

- **Sacar las dos líneas de apoyo a columnas propias.** «Pendiente de cierre» como columna pide
  ~155 px y «Recaudado» seguiría necesitando 185 para la línea de acompañadas: **340 px** entre
  las dos, contra los 272 de dejarlas apiladas. Más ancho y una columna más que leer.
- **Acortar las frases.** Habría bastado con quitar «de cierre» (−48 px), pero el encargo dice
  que los tres datos se quedan y el texto no estaba en discusión; cambiar copy visible para
  ganar píxeles es una decisión distinta y de otro dueño.
- **Bajar «Producto» de 14rem a 10rem para pagar parte del ensanche.** MEDIDO: devuelve **64 px**
  de desborde (506 → 442) a cambio de que los nombres de producto pasen de 2 a **3 renglones** y
  la fila de 73 a 77 px. **No aplicado**: el encargo pide no sacrificar otras columnas sin medir,
  y medido no compensa. Queda como palanca si el desborde molesta.

---

## 4. El navegador, con la columna «Tienda» montada

Chromium, sesión real (`admin.qa@ordenex.test`), **un solo `pnpm dev`** en `:3000`.

> ⚠️ **El contador de renglones se autocomprueba antes de publicar un número.** Un renglón es una
> banda vertical de tinta; dos trozos están en el mismo renglón si sus bandas se solapan más de
> la mitad de la más baja. Tres casos de control inyectados en la propia página —uno forzado a
> una línea, otro a tres y **uno con dos tamaños de fuente en la misma línea base**— tienen que
> dar 1, 3 y 1 exactos o el medidor aborta con `exit 3`. El tercero **cazó una versión anterior
> del contador que contaba 2 donde había 1**, y con ella los números de teléfono habrían salido
> inflados. (Lección de la 348: el instrumento mintió dos veces.)

### 1440 × 950

| | ANTES | DESPUÉS |
| --- | --- | --- |
| **renglones de la celda de Recaudado** | **8** (las 25 filas) | **3** (las 25 filas) |
| alto de esa celda / de la fila | 153 px | **73 px** |
| ancho de «Recaudado» | 104 px (6,5rem) | **272 px (17rem)** |
| scroller: visible / contenido / **desborde** | 1102 / 1440 / **338** | 1102 / 1608 / **506** |
| desborde del DOCUMENTO | 0 | **0** |
| flechas de scroll | 2 | 2 |
| importes recortados por dentro | 0 de 275 | **0 de 275** |
| la cifra `₡35.697`, ¿visible sin arrastrar? | sí | **sí, y con 442 px de margen** |

Anchos de las **catorce** columnas después (px): Desglose 48 · Tienda 128 · Producto 224 ·
**Recaudado 272** · Cobró Ordenex 96 · Para la tienda 96 · Unidades 88 · Órdenes 80 ·
Entregadas 96 · Rechazadas 104 · Otros resultados 120 · En proceso 80 · Efectividad 96 ·
% de rechazo 80. **Solo cambia «Recaudado»**; las otras trece están donde las dejó la 348.

`innerText` íntegro de las tres celdas de dinero (idéntico antes y después — no se quitó ni una
letra, solo dejó de plegarse):

```
Recaudado      → "₡35.697\nCon otro producto: 4 de 33\nPendiente de cierre: ₡23.798 (2 órdenes)"
Cobró Ordenex  → "₡4.250"
Para la tienda → "₡7.649"
```

Y los renglones, tal como caen en pantalla:

```
ANTES (8)                          DESPUÉS (3)
₡35.697                            ₡35.697
Con otro                           Con otro producto: 4 de 33
producto: 4                        Pendiente de cierre: ₡23.798 (2 órdenes)
de 33
Pendiente de
cierre:
₡23.798 (2
órdenes)
```

### 390 × 844 — la vista de teléfono NO se tocó, y aquí está por qué

| | ANTES | DESPUÉS | ensayo descartado |
| --- | --- | --- | --- |
| renglones del bloque «Recaudado» | 5 | 5 | 3 |
| ancho de la columna «Resultado» | 159 px | 159 px | 267 px |
| scroller: visible / contenido / **desborde** | 308 / 331 / **23** | 308 / 331 / **23** | 308 / 440 / **132** |
| **cifras del bloque fuera del borde visible** | 11 px | 11 px | **120 px** |

A 390 px la tabla se apila en dos columnas y el scrollport mide **308 px**. Las frases piden 244
más el nombre del producto (125): no caben, y **no hay forma de darles sitio sin sacar del área
visible las cifras**, que van alineadas a la derecha. Se probó (`unaLinea` también en la vista de
teléfono): baja el bloque a 3 renglones y deja **las cifras 120 px fuera** con `scrollLeft = 0`.
Se descartó por eso, con el número delante.

Además, el teléfono **no sufre lo mismo**: sus cortes caen en sitios naturales —`Con otro
producto: 4` / `de 33` y `Pendiente de cierre:` / `₡23.798 (2 órdenes)`—, no en `Con otro` /
`producto: 4`. Y sus otras dos celdas de dinero ocupan 2 renglones cada una (etiqueta + cifra).

**Los 11 px de cifra fuera del borde a 390 son HEREDADOS y no cambian con esta ficha**: están
antes y después, y vienen del desborde de 23 px que la 348 ya declaró como precio de no partir
palabras. Queda dicho porque nadie lo ha mirado desde entonces.

### Las otras dos columnas de dinero: no sufren lo mismo

Medido, no supuesto: **«Cobró Ordenex» y «Para la tienda» ocupan 1 renglón en las 25 filas**,
antes y después, a 1440 px. Su celda es UNA cifra con `whitespace-nowrap` y no lleva ninguna
línea de apoyo, así que la trampa de la frase no las alcanza. Lo que sí ocupa dos renglones es
su **rótulo** («Cobró / Ordenex», «Para la / tienda»), y eso es una cabecera de dos palabras
partiendo entre palabras, no un dato plegado. **No se tocan.**

### Con los datos reales de la base local (una tienda, nada liquidado)

Recaudado pasa de **4 a 2 renglones** (`"—"` + `"Con otro producto: 0 de 6"`, ahora entera), la
fila de **87 a 71 px** y el desborde del scroller de **186 a 354 px**. Es el coste del suelo de 17rem en el caso sin
pendiente, y se dice: la columna se queda a 272 px aunque su contenido más largo pida 185. Es el
precio de que la columna no cambie de ancho al pasar de página.

---

## 5. El precio, dicho sin adornos

El desborde horizontal a 1440 sube de **338 a 506 px** (y de 186 a 354 con una sola tienda). Es
el canje que este módulo tiene decidido —«mejor deslizar que estrujar»— y que el encargo
confirma. A cambio, cada fila baja de **153 a 73 px**: con 25 filas en pantalla, la tabla se
acorta unos **2.000 px de alto**. Se gana en las dos direcciones menos en una.

Lo que se queda fuera del borde derecho al abrir son las columnas de conteo a partir de
«Entregadas» —antes empezaba en «Rechazadas»—: dos columnas más de arrastre. El dinero, que es
el dato que se pidió, sigue **entero y a la vista sin tocar el scroll**.

---

## 6. Mutaciones — seis, con su línea de fallo real

Arnés con autocomprobación: verifica que el patrón aparece **exactamente una vez**, que el
archivo **cambió**, que **vitest llegó a ejecutar** (`Test Files` en la salida) y que el árbol
**queda byte a byte como estaba**. (Lección de [[arnes-de-mutaciones-que-miente]].)

| # | mutación | resultado y línea |
| --- | --- | --- |
| **M1** | **quitar el mínimo nuevo**: `recaudado: "17rem"` → `"6.5rem"` | **ROJO** — `AssertionError: expected 6.5 to be greater than or equal to 16.75` |
| **M2** | borrar el mínimo de «Recaudado» del todo | **ROJO** — `AssertionError: la columna «Recaudado» no declara mínimo: expected '' not to be ''` |
| **M3** | quitar `unaLinea` de la línea de «Pendiente de cierre» | **ROJO** — `AssertionError: Pendiente de cierre: ₡10.000 (1 orden): expected 'text-xs text-muted-foreground' to contain 'whitespace-nowrap'` |
| **M4** | quitar `unaLinea` de la línea de «Con otro producto» | **ROJO** — `AssertionError: Con otro producto: 4 de 33: expected 'text-xs text-muted-foreground' to contain 'whitespace-nowrap'` |
| **M5** | el arreglo perezoso: `whitespace-nowrap` en TODOS los `Contexto` | **ROJO** — `AssertionError: expected 'text-xs text-muted-foreground whitesp…' not to contain 'whitespace-nowrap'` (lo caza la composición de «Otros resultados») |
| **M6** | recortar la frase en vez de ensanchar la columna (`truncate`) | **ROJO** — `AssertionError: Recaudado: expected '<td class="px-3 py-2 align-middle tex…' not to match /\btruncate\b/` — **lo caza la guardia R63 que ya existía**, además del caso nuevo |

`ARBOL RESTAURADO: True`.

**La pregunta que el leader pidió responder explícitamente —«si nada lo caza, dilo»— tiene
respuesta: M1 y M2 ponen rojo.** No se repite lo de la 348, donde quitar un mínimo dejaba 74 de
74 en verde: ahora el ancho de esta columna está atado por un número que sale de una medición y
por un caso que lo compara contra ella.

---

## 7. Verde

- `pnpm typecheck` — **limpio**.
- `pnpm lint` — **0 errores**, 150 warnings preexistentes (`no-unused-vars` en tests ajenos);
  **ninguno en los dos archivos tocados**.
- `pnpm test:guardias` — **172 de 173 archivos verdes**. El único rojo es el heredado y
  autorizado: `superficie-de-uso` por `lib/actions/tarifas.ts:67 obtenerTarifa`.
- `ProductosTabla` + `ProductosTablaDinero` + `AnaliticaPage` + la guardia de no-sumable:
  **117 pasados, 17 saltados, 0 rojos**.

---

## 8. Lo dudoso, dicho

1. **El suelo de 17rem no lo caza el navegador, solo el test.** Con `unaLinea` puesto, el
   `min-content` de la columna ya vale 268 px siempre que haya una fila con pendiente: en ese
   caso quitar el mínimo **no cambiaría un píxel en pantalla**. El mínimo trabaja de verdad en el
   otro caso —páginas sin ninguna fila pendiente, o con números de pocas cifras—, donde impide
   que la columna encoja a 185 px y la tabla entera se reacomode al pasar de página. Es un suelo
   real, pero **menos load-bearing que el de la 348**, y conviene saberlo antes de tocarlo.
2. **272 px es ancho de sobra cuando no hay nada pendiente.** En la base local (sin cierres
   aprobados) la celda solo necesita 185 y se lleva 272. En producción la línea de pendiente es
   el caso común, pero si resultara ser raro, la palanca honesta es bajar el suelo a 11,5rem y
   aceptar que la columna cambie de ancho entre páginas.
3. **A 390 px no se arregló nada**, y es una decisión, no un olvido: la alternativa medida deja
   las cifras 120 px fuera de la pantalla. Si el humano también quiere el teléfono, lo que hay
   que discutir ahí es **el texto de las frases**, no el ancho — no hay ancho que dar.
4. **El caso de producción sigue sin verse con datos de producción.** Los `₡35.697` y el
   `Pendiente de cierre` de esta medición son **fabricados por mí** con los números de la
   captura, porque la base local no tiene un cierre aprobado ni una segunda tienda. Si en
   producción hay importes de siete dígitos o miles de órdenes, la frase pedirá **más** de 272 px
   y la columna crecerá sola —eso es lo que `unaLinea` garantiza—, pero el desborde será mayor
   que los 506 px medidos aquí.
5. **`min-content` en pantallas muy estrechas de ESCRITORIO no se midió.** Entre 390 (donde
   entra la vista apilada) y 1440 hay un rango; el punto de corte de `useIsMobile` decide cuál se
   monta y no se movió, pero un escritorio a 900 px pagará el mismo ensanche con menos sitio.
