# 346 — el desglose de la tabla de productos no sumaba la columna «Órdenes»

Rama `fix/346-desglose-no-suma`. Arreglo **acotado, sin spec**. Frontend puro: no se ha tocado
backend, base de datos ni ninguna ruta de API.

## El defecto

Captura del humano (2026-08-29, `/analitica` → Productos, `Crema Especial MLX`):

| Unidades | Órdenes | Entregadas | Rechazadas | En proceso | Efectividad | % rechazo |
|---|---|---|---|---|---|---|
| 29 | **24** | 3 | 2 | 13 | 12,5 % | 8,3 % |

3 + 2 + 13 = **18**. Faltaban **6** órdenes que no aparecían en ninguna columna.

`DESENLACES` (`lib/types/conteo-entregas.ts`) tiene CINCO: `entregada`, `devuelta`, `rechazada`,
`reprogramada`, `incidente`. `calcularEfectividad` contaba `entregadas` y `rechazadas` por
igualdad y `enProceso` por NEGACIÓN (`!CON_DESENLACE.has(status)`). Las órdenes con uno de los
otros tres desenlaces no eran ninguno de los dos cubos por igualdad **y** tampoco eran
`enProceso` —porque sí tienen desenlace—: caían entre las dos reglas y se evaporaban.

**Lo que NO estaba roto y no se ha tocado:** los tres porcentajes. `efectividad` (3/24 = 12,5 %),
`efectividadGestion` y `tasaRechazo` (2/24 = 8,3 %) ya usaban el universo entero como
denominador, decisión razonada en la cabecera del archivo desde 2026-08-18.

## El arreglo

**Un cubo nuevo, `otrosDesenlaces`, expuesto por `calcularEfectividad`** — aditivo, con la misma
forma que la ficha 345 con `rechazadas`: la función ya sabía cuáles eran y las tiraba al volver.

    entregadas + rechazadas + otrosDesenlaces + enProceso === total    (SIEMPRE)

**Se DERIVA de `DESENLACES`, no se escribe:** la condición es `CON_DESENLACE.has(status) &&
status !== ENTREGADA && status !== RECHAZADA`. No hay ninguna lista de estados escrita a mano, que
es justo lo que prohíbe la cabecera del archivo: con
`["devuelta","reprogramada","incidente"]` literal, el sexto desenlace que gane el catálogo se
volvería a evaporar en silencio. La regla por NEGACIÓN de `enProceso` queda **intacta, letra por
letra**; las cuatro reglas se escriben sueltas (no como cadena `else if`) para que cada una
conserve su motivo al lado.

**El significado de los tres porcentajes no cambia.** `KpisEfectividad` desestructura solo
`entregadas, enProceso, efectividad, efectividadGestion, total`: la fila de KPIs de arriba no se
mueve ni una cifra.

**Rótulo elegido: «Otros resultados».** No «Otros» —así se llama en el anillo de al lado el cubo
de lo que NO tiene desenlace, que aquí se llama «En proceso»: dos rótulos iguales con significados
contrarios en la misma pantalla se leen uno por el otro—. Y no «Devueltas y reprogramadas»: una
etiqueta que enumera miente el día que el catálogo gane un desenlace.

**Un segundo aviso en la pantalla**, debajo del de multiproducto: «Cada orden cuenta en un solo
grupo: entregadas, rechazadas, otros resultados y en proceso suman la columna Órdenes.» El defecto
era invisible —quien sumaba y le faltaban seis no podía saber si el error era suyo o de la tabla—;
con la frase la igualdad es una promesa comprobable a simple vista.

**La descarga a Excel pasa de 9 a 10 columnas:** entra `otros_resultados` («Otros resultados»)
entre `rechazadas` y `en_proceso`. En una hoja de cálculo el defecto era peor que en pantalla,
porque la fila invita a sumarse. Los tres `toEqual` literales del contrato se han reescrito **a
mano**, no derivados de la constante.

## Archivos

Producción:

- `app/(app)/analitica/_components/entregas/efectividad.ts` — campo `otrosDesenlaces` + su regla.
- `app/(app)/analitica/_components/entregas/ProductosTabla.tsx` — columna «Otros resultados»
  (7 cifras → 8, en escritorio y en la pila del teléfono) + `PRODUCTOS_TEXTOS.avisoDesglose`.
- `app/(app)/analitica/_components/entregas/analitica-productos-descarga-columnas.ts` — décima
  columna del archivo.

Verificación:

- `tests/unit/analytics/efectividad-suma.test.ts` — **NUEVO**, 11 casos.
- `tests/components/ProductosTabla.test.tsx` — 2 casos nuevos (escritorio y teléfono) + la lista
  de celdas de R28 y la de encabezados, actualizadas.
- `tests/unit/descarga/analitica-productos-descarga-columnas.test.ts` — los tres `toEqual` del
  contrato a mano + 2 casos nuevos de cuadre.
- `tests/unit/analytics/efectividad-rechazo.test.ts` — el caso que afirmaba «la suma NO tiene por
  qué dar el total» reescrito: su aserción era CIERTA y su conclusión estaba mal.

## El test de la suma, y su rojo de antes

`tests/unit/analytics/efectividad-suma.test.ts`. Es una PROPIEDAD por tres vías, y las tres se
alimentan de `DESENLACES` de verdad (nunca de una lista escrita en el test):

1. `it.each(DESENLACES)` — un desenlace a la vez. Si alguno se queda fuera de los cubos, su caso
   se pone rojo **con su nombre en el título**.
2. Las **16.384** combinaciones de conteos `{0,1,2,3}` sobre los 5 desenlaces y 2 estados en
   curso (`4^7`), recorridas en base 4. Determinista, sin biblioteca y sin semilla.
3. Un **SEXTO desenlace** inyectado en el catálogo con `vi.doMock` + `vi.resetModules()`: prueba
   que el cubo se DERIVA. Un arreglo con lista literal pasa (1) y (2) y falla aquí — medido, ver
   mutación 5.

Rojo antes del arreglo (código revertido con `git checkout --`, test intacto). El renglón que
reproduce la aritmética del humano:

    FAIL tests/unit/analytics/efectividad-suma.test.ts > FICHA 346 · `Crema Especial MLX`,
      la captura del 2026-08-29 > las seis órdenes que faltaban ya están, y el desglose suma 24
    AssertionError: expected 18 to be 24 // Object.is equality
      ❯ tests/unit/analytics/efectividad-suma.test.ts:215:28

Y los otros siete rojos de la misma corrida (8 de 11 casos rojos):

    × `devuelta`: ...      AssertionError: expected +0 to be 7
    × `reprogramada`: ...  AssertionError: expected +0 to be 7
    × `incidente`: ...     AssertionError: expected +0 to be 7
    × y con las CINCO mezcladas ...            expected 4 to be 15
    × las 16.384 combinaciones ...             { repartosRotos: 16128 } vs { repartosRotos: 0 }
    × un SEXTO desenlace ...                   expected undefined to be 5
    × y sin tocar el catálogo ...              expected undefined to be 0

## Mutaciones (5, todas revertidas)

| # | Mutación | Rojo medido |
|---|---|---|
| 1 | `&& fila.status !== "devuelta"` en la condición del cubo nuevo (deja fuera uno de los tres desenlaces perdidos) | 6 casos. `efectividad-suma`: `` `devuelta`: expected +0 to be 7``; `Crema`: `expected 20 to be 24`; 16.384 combos: `repartosRotos: 12288`. `ProductosTabla`: `expected 2 to be 6` (escritorio) y `expected '2' to be '6'` (teléfono) |
| 2 | `if (CON_DESENLACE.has(fila.status))` a secas: `entregada` y `rechazada` se cuentan dos veces | 10 casos. `` `entregada`: expected 14 to be 7``; `Crema`: `expected 29 to be 24`; combos: `repartosRotos: 15360`; el archivo: `expected NaN…`/`to deeply equal` |
| 3 | `ProductosTabla`: la columna nueva lee `e.enProceso` en vez de `e.otrosDesenlaces` | 3 casos. `expected 13 to be 6`, `expected '13' to be '6'`, y R28 (`toEqual` de celdas) |
| 4 | Se borra `otros_resultados` de las columnas del archivo y de la proyección | 4 casos. Las DIEZ claves, los DIEZ encabezados, la proyección, y `FICHA 346 · la fila del archivo SUMA: expected NaN to be 24` |
| 5 | `["devuelta","reprogramada","incidente"].includes(status)` — la lista literal que la cabecera prohíbe | **1 caso, y es el que importa**: `un SEXTO desenlace cae en «otros»: expected +0 to be 5`. Los otros 10 pasan. Es la prueba de que la exigencia «derívalo, no lo escribas» está realmente atada |

Tras cada mutación, el archivo se restauró desde copia y se volvió a medir verde.

## Navegador — 390 y 1440

⚠️ El servidor de desarrollo que había en el puerto 3000 (PID 7160, de este mismo repo) devolvía
**500 en todas las rutas**: `.next/dev/server/pages-manifest.json` y `.../pages/_app/build-manifest.json`
no existían. Se bajaron los cuatro procesos, `rm -rf .next` y se arrancó **UNO** solo
(`pnpm dev > dev.log 2>&1`). No se levantó ningún segundo servidor.

Chromium (Playwright), sesión `admin.qa@ordenex.test`, `/analitica` con datos LOCALES reales
(25 filas en la primera página). Medido antes y después del arreglo sobre **los mismos datos**:

| | 1440×900 antes | 1440×900 después | 390×844 antes | 390×844 después |
|---|---|---|---|---|
| `documentElement.scrollWidth` vs `clientWidth` | 1440 / 1440 | 1440 / 1440 | 390 / 390 | 390 / 390 |
| **Desborde horizontal** | **0 px** | **0 px** | **0 px** | **0 px** |
| Ancho de la tabla | 1102 px | 1102 px | 308 px | 308 px |
| Contenedor con scroll horizontal | ninguno | ninguno | ninguno | ninguno |
| Celdas que desbordan su caja | 0 | 0 | 0 | 0 |
| Palabras partidas a mitad (medidas con `Range.getClientRects()`) | 0 | 0 | 0 | 0 |

- **1440:** la columna «Producto» cede 387 → **323 px** para hacerle sitio a «Otros resultados»
  (113 px). La tabla no crece: sigue en 1102 px dentro del hueco de la página.
- **390:** la vista de teléfono son DOS columnas —«Producto» 155 px y «Resultado» 153 px— y esos
  anchos son **idénticos** antes y después. Era el riesgo real (la 343/344 midieron 309 px en un
  hueco de 284, y 674 px fuera), y no se materializa porque el ancho mínimo de la pila lo fija la
  etiqueta más larga, «Efectividad de entrega», que ya estaba. La cifra nueva es una línea más en
  la pila; ni una palabra se parte.

**Y el cuadre sobre datos reales, medido en el DOM de las 25 filas pintadas:**

- **Antes del arreglo: 9 de 25 filas no sumaban.** `Parche Antivarices` 3 vs 4 órdenes, `Gel de
  Abejas` 2 vs 4, `Lima Eléctrica` 3 vs 4, `Nebulizador Inalámbrico` 1 vs 2, `Spray Analgésico
  Dental` 1 vs 2, y cuatro filas de 1 orden que sumaban **0**.
- **Después: 0 de 25.** Las mismas 9 filas cuadran, con «Otros resultados» entre 1 y 2.

## Gate

- `pnpm typecheck` — **verde** (0 errores).
- `pnpm lint` — **0 errores**, 144 warnings heredados; **ninguno** en los archivos tocados.
- `pnpm exec vitest run --changed origin/dev` — 9 archivos, **120 pasan**, 17 skipped.
- `pnpm exec vitest run guard` — 171 archivos, **2568 pasan**, **1 rojo**: el heredado
  `superficie-de-uso.guardia` por `lib/actions/tarifas.ts:67 obtenerTarifa`. Es el único
  tolerado y viene de `dev`.
- `tests/unit/analytics` + `tests/unit/descarga` + los tres componentes de la vertical: 202
  archivos, 2255 casos, todos verdes.

## Lo dudoso, dicho

1. **El desglose de las seis órdenes perdidas de `Crema Especial MLX` no está medido.** El
   encargo dice «4 devueltas + 3 reprogramadas», que son **7**, y la captura solo permite deducir
   **6** (24 − 3 − 2 − 13; y el 12,5 % = 3/24 y el 8,3 % = 2/24 confirman el 24 por dos vías
   independientes). Los tests usan 4 + 2 = 6 y **dicen por escrito que ese reparto no es dato
   medido**: ninguna aserción depende de él, solo del total. Si alguien tiene el desglose real,
   se cambian dos números y no se mueve nada más. Conviene saber de dónde salió el 7.
2. **La palabra del rótulo.** «Otros resultados» es una decisión de implementación, no firmada por
   nadie. Si el humano prefiere «Otros desenlaces» o «Otros cierres», es cambiar
   `PRODUCTOS_COLUMNAS.otrosResultados`, el encabezado del archivo y los dos `toEqual` a mano.
3. **El aviso nuevo en pantalla** (`avisoDesglose`) es una línea de texto que nadie pidió. Va
   porque el defecto era invisible, pero es lo primero que se puede quitar si se considera ruido.
4. **`dev.log` contenía la `QA_PASSWORD` en claro** (Next registra los argumentos de las Server
   Actions, incluida `login`). El archivo está gitignored y sus 8 líneas se han redactado en
   sitio. Es un tropiezo del entorno, no del cambio, pero conviene no publicarlo nunca.
5. **El árbol de trabajo quedó con el servidor de desarrollo levantado** en el puerto 3000 y
   `.next` recién reconstruido. Si otra sesión dependía del anterior, ya no existe: estaba roto.
