# Ficha 389 — Una segunda hoja en el Excel de productos para repartir con proveeduría

> Requisitos en notación EARS. Sin detalles de implementación: el CÓMO vive en `design.md`;
> el desglose, en `tasks.md`. Cada `R<n>` termina mapeado a un test concreto
> (`tasks.md § Trazabilidad`).

## Contexto

Pedido del humano el 2026-09-07, sobre el archivo que descarga la tabla **detalle-productos** de
`/analitica` (la que trajo la 345, amplió la 347 y a la que la 388 le acaba de dar el selector de
columnas).

Textual: *«no quiero que dañes lo que ya se descarga, que es muy bueno; lo que quiero es añadir
otra hoja dejándoles fácil el cálculo»*. La hoja nueva debe dejar que la tienda ponga, **por
producto, qué porcentaje es de proveeduría y cuánto le queda a ella**, con el cálculo ya montado.

**El porcentaje solo lo saben ellos.** La hoja lo PIDE; Ordenex no lo calcula, no lo guarda y no
lo adivina.

### La DECISIÓN del humano sobre qué dinero entra (2026-09-07 — NO se reabre)

Se va con la **salida B más el aviso de A**:

- la hoja calcula **solo sobre las órdenes que llevaban UN ÚNICO producto**, que son aquellas en
  las que el importe **sí** es atribuible a ese producto;
- y **dice en la propia hoja** cuántas órdenes quedaron fuera y por qué;
- la **columna base del reparto es «Para la tienda»**.

**Queda DESCARTADA la salida C (prorratear** el importe entre los productos de una orden): Ordenex
**no sabe el precio de cada producto** —la orden lleva un solo `monto_cobrar`—, así que no es
deuda ni follow-up: **no se puede** sin pedirle el precio a la tienda.

### Lo MEDIDO (dado por cierto, no re-medir)

1. **Producción, 2026-09-07: 433 de 1337 órdenes vivas (32,4 %) parecen multiproducto** — proxy
   sobre el texto libre de `producto` (separador `|` o más de un `N *`). No es un caso raro: es
   **una de cada tres**. Una hoja que miente en un tercio de las filas es peor que una que cubre
   dos tercios y lo dice.
2. **Cinco de las seis columnas de dinero del archivo actual llevan la marca**
   `MARCA_NO_SUMABLE_ARCHIVO = "(no sumar: importe de la orden completa)"`. El importe que
   acompaña a un producto **es el de la orden entera**: si la orden lleva tres productos, los tres
   muestran el mismo importe. Multiplicarlo por un porcentaje **repartiría el mismo dinero tres
   veces**.
3. **Feature 204:** 14 de 66 órdenes acabaron con un céntimo de desviación al multiplicar importes
   en el navegador. De ahí la regla money-safe de todo este árbol.

### Lo confirmado EN EL ARCHIVO REAL (no en el índice del MCP)

1. `lib/utils/descarga-dataset.ts` — `construirDescarga(config, fecha)` es el despachador común;
   con `xlsx` produce **«libro de UNA hoja»**. **No importa `exceljs`**: el import dinámico vive
   dentro de `buildXlsxRows`.
2. `lib/utils/xlsx-template.ts` — `buildXlsxRows(columns, rows, sheetName)` es el único punto que
   toca `exceljs` en este camino. Emite EXACTAMENTE las columnas declaradas e **ignora cualquier
   otra clave presente en la fila**.
3. `lib/types/descarga.ts` — `DescargaConfig`, `DescargaColumna { clave, encabezado }`,
   `DescargaFila = Record<string, string|number|null>`. Módulo deliberadamente **sin dominio**.
4. `components/shared/DataTable.tsx` — `DataTableDescarga` es la configuración **OPT-IN** que la
   tabla pasa al control. La 314 ya la amplió una vez (`ambitoColumnas`).
5. `components/shared/DescargarDatasetButton.tsx` — arma el binario **en el navegador**, filtra
   por `visibles` (las columnas marcadas del ámbito) y pasa **las filas enteras**.
6. `app/(app)/analitica/_components/entregas/ProductosTabla.tsx` — la descarga **no declara
   `formatos`**, así que hoy esta tabla solo ofrece **`xlsx`** y descarga en un clic, sin menú.
   `conDinero = dinero && estadoDinero?.estado === "concedido"`.
7. `.../analitica-productos-descarga-columnas.ts` — las 11 columnas base, las 9 de dinero, los DOS
   ámbitos de la 388 y `filaDescargaAnaliticaProductos(fila, conDinero)`. Prohibido `Number(`,
   `parseFloat(`, `parseInt(`, `.toFixed(` sobre importes: lo vigila
   `tests/unit/analytics/dinero-producto-no-sumable.guardia.test.ts`, que **barre este archivo**.
8. `lib/services/ConteoProductosService.ts` — `ordenesQueAportan()` devuelve, por orden,
   `claves: readonly string[]` (las claves de producto **ya deduplicadas** con el MISMO parser que
   decide las filas). **`claves.length === 1` ES «orden de un único producto»**: no hay que
   inventar ningún criterio. `cifrasDelGrupo(ordenes)` produce el `DineroProductoDTO` de un grupo.
9. `lib/types/conteo-productos.ts` — `FilaProductoDTO.ordenes`, `.ordenesAcompanadas` (cuántas de
   sus órdenes llevaban **más de un** producto) y `ConteoProductosDTO.ordenes` /
   `.ordenesSinProducto`.
10. `lib/utils/dinero-por-producto.ts` — `repartoDeOrden([])` devuelve `tienda: null` y
    `ordenex: null`, **nunca `"0.00"`**. Toda la aritmética es `Prisma.Decimal`.

---

## 1 — Lo que NO cambia (la promesa que el humano pidió por escrito)

**R1.** DONDE la configuración de una descarga no declare la hoja de reparto, el sistema DEBE
producir un libro de **UNA sola hoja**, con el mismo nombre de hoja, los mismos encabezados, el
mismo orden de columnas y los mismos valores de celda que producía antes de esta ficha.

**R2.** El sistema NO DEBE alterar la hoja de datos existente al añadir la hoja de reparto: ni sus
columnas, ni su orden, ni sus encabezados, ni sus valores, ni su nombre, ni el nombre del archivo.

**R3.** MIENTRAS el formato elegido sea CSV, el sistema DEBE emitir **exactamente** el mismo
contenido que hoy —una sola tabla, sin hoja de reparto y sin ninguna fórmula—, **aunque la
configuración declare la hoja de reparto**.

**R4.** CUANDO una configuración declare la hoja de reparto y el formato sea `xlsx`, el sistema
DEBE producir un libro con exactamente DOS hojas: primero la de datos y después la de reparto.

**R5.** El sistema DEBE mantener la hoja de reparto como una capacidad OPT-IN de la descarga
común: ninguna de las demás tablas que comparten esa máquina DEBE cambiar su archivo por esta
ficha.

## 2 — Cuándo aparece la hoja

**R6.** DONDE el actor no tenga la concesión de dinero vigente para la lectura que está viendo, el
sistema NO DEBE añadir la hoja de reparto al archivo.

**R7.** SI el estado del dinero de la lectura es «límite excedido», ENTONCES el sistema NO DEBE
añadir la hoja de reparto: sin cifras no hay reparto que montar.

**R8.** El selector de columnas del archivo NO DEBE alterar la hoja de reparto: ocultar, mostrar o
reordenar columnas de la hoja de datos NO DEBE quitar, añadir ni reordenar ninguna columna de la
hoja de reparto.

**R9.** Las dos hojas DEBEN salir de UNA sola lectura de datos: el sistema NO DEBE consultar el
servidor una segunda vez para construir la hoja de reparto.

## 3 — Qué dinero entra (la decisión firmada)

**R10.** El sistema DEBE calcular la base del reparto ÚNICAMENTE sobre las órdenes que contenían
un único producto.

**R11.** El sistema DEBE identificar «orden de un único producto» con el MISMO parser de texto y
la MISMA deduplicación con que decide las filas de la tabla de productos, y NO con un segundo
criterio escrito aparte.

**R12.** La base del reparto de un producto DEBE ser **«Para la tienda»** —lo recaudado ya
liquidado menos lo que Ordenex le factura sobre ese recaudo— restringido a las órdenes liquidadas
que solo llevaban ese producto.

**R13.** El sistema NO DEBE repartir el importe de una orden entre los productos que esa orden
contenga.

**R14.** SI un producto no tiene ninguna orden liquidada de un solo producto, ENTONCES el sistema
DEBE dejar su base **VACÍA**, y NO DEBE escribir `0`, `0.00` ni ningún texto de relleno.

**R15.** Para todo recorte, el sistema DEBE contar el importe de cada orden **a lo sumo una vez**
en el conjunto de las bases de todas las filas de la hoja de reparto.

**R16.** El sistema DEBE indicar, por fila, **cuántas órdenes liquidadas de un solo producto**
respaldan su base.

**R17.** El sistema NO DEBE marcar la columna base de la hoja de reparto como no sumable, y DEBE
decir en su encabezado que solo cuenta las órdenes de un único producto.

## 4 — El aviso, DENTRO de la hoja

**R18.** La hoja de reparto DEBE decir, en el propio archivo, que solo usa las órdenes que
llevaban un único producto, y por qué.

**R19.** La hoja de reparto DEBE decir cuántas órdenes del recorte quedaron fuera, distinguiendo
los dos motivos: llevaban **más de un producto**, o **no tenían un producto interpretable**.

**R20.** Los tres conteos del aviso —órdenes de un solo producto, órdenes con más de un producto y
órdenes sin producto interpretable— DEBEN sumar exactamente el total de órdenes del recorte.

**R21.** El sistema NO DEBE contar ninguna orden más de una vez en ninguno de los conteos del
aviso.

**R22.** La hoja de reparto DEBE decir que la hoja de datos no cambió y que sus importes siguen
siendo los de la orden completa, que no se pueden sumar.

**R23.** La hoja de reparto DEBE decir que su base cuenta solo las órdenes ya liquidadas, y por
eso es menor que la columna homónima de la hoja de datos.

## 5 — El cálculo, montado en la hoja

**R24.** La hoja de reparto DEBE ofrecer, por fila, una celda EDITABLE para el porcentaje de
proveeduría, y el sistema NO DEBE escribir ningún valor en ella.

**R25.** CUANDO el usuario escriba el porcentaje en esa celda, la hoja DEBE actualizar sola la
parte de proveeduría y la parte que queda para la tienda, sin que Ordenex vuelva a generar el
archivo.

**R26.** Las celdas derivadas de la hoja de reparto DEBEN contener FÓRMULAS de hoja de cálculo, y
NO valores precalculados por Ordenex.

**R27.** MIENTRAS la celda del porcentaje de una fila esté vacía, las celdas derivadas de ESA fila
DEBEN quedar vacías, y NO DEBEN mostrar cero.

**R28.** Cada fórmula DEBE referirse a las celdas de SU PROPIA fila.

**R29.** Para toda fila, la parte de proveeduría más la parte que queda para la tienda DEBEN dar
exactamente la base de esa fila.

## 6 — Money-safe

**R30.** El sistema NO DEBE convertir ningún importe a número de coma flotante en ningún punto del
camino hasta la celda: la celda DEBE llevar los MISMOS dígitos con los que el importe llegó del
servidor.

**R31.** El sistema NO DEBE reformatear, redondear, recortar ni ampliar los decimales de ningún
importe al escribirlo en la hoja de reparto.

## 7 — El archivo

**R32.** El nombre de la hoja de reparto DEBE cumplir las reglas que Excel impone (sin
`* ? : \ / [ ]`, sin comilla simple al principio ni al final, no reservado, máximo 31 caracteres)
y DEBE ser el mismo en todas las descargas.

**R33.** Las filas de la hoja de reparto DEBEN ser las MISMAS y estar en el MISMO orden que las de
la hoja de datos.

---

## Decisiones SIN FIRMAR — **asunción del leader, NO firmadas por el humano**

Cada una lleva su vuelta atrás. Ninguna cambia el modelo de datos ni la decisión de la salida B.

| # | Asunción | Vuelta atrás |
| --- | --- | --- |
| **A1** | La hoja se llama **«Reparto proveeduría»**. | Cambiar un literal en el módulo de la hoja. Cero efectos: nada la referencia por nombre. |
| **A2** | La hoja lleva **fila de totales** con `SUM` para base, proveeduría y resto. Es legítimo aquí —y solo aquí— porque cada orden de un solo producto pertenece a **exactamente una** fila (R15), así que la suma NO cuenta plata dos veces. | Borrar la fila. Las fórmulas por fila no dependen de ella. |
| **A3** | La celda del porcentaje va con **formato de porcentaje** y la fórmula multiplica directo (`base × %`). | Cambiar el formato a número y la fórmula a `base × % / 100`. Un solo sitio. |
| **A4** | La hoja lleva **TODAS** las filas de la hoja de datos (R33), con la base vacía en las que no tienen ninguna orden de un solo producto — en vez de omitirlas. | Filtrar las filas sin base al proyectar. Rompe R33, que habría que retirar. |
| **A5** | La hoja lleva la columna **«Órdenes liquidadas con solo este producto»** (R16) para que una base vacía se explique sola. | Quitar la columna; R16 se retira con ella. |
| **A6** | **CSV ignora la hoja** en silencio (R3), sin avisar en pantalla. Hoy es **inalcanzable**: esta tabla no declara `formatos`, así que solo ofrece `xlsx`. | Si algún día esta tabla ofreciera CSV, añadir el aviso al menú de formato. |
| **A7** | La cifra nueva vive **dentro** del DTO de dinero que ya existe, no en una estructura paralela. | Sacarla a un mapa aparte; cuesta un campo más en la fila y duplica la garantía de R6/R7. |

## Preguntas abiertas

- **⟨Q1⟩ ¿La base es «Para la tienda» SOLO de lo liquidado?** Hoy esa columna significa
  exactamente eso (cierre aprobado con tarifa congelada); de lo pendiente **no existe** reparto,
  porque sin tarifa congelada no hay nada que derivar. Consecuencia: la base de la hoja 2 será
  menor que la columna «Para la tienda» de la hoja 1 **por dos motivos a la vez** (solo un
  producto **y** solo liquidado). R23 lo dice dentro de la hoja. **¿Es lo esperado?**
- **⟨Q2⟩ ¿El porcentaje es uno POR PRODUCTO o uno solo para toda la tienda?** El pedido dice «por
  producto», y así está escrito (una celda editable por fila). Si el acuerdo con proveeduría es el
  mismo para todo, una **celda única arriba** a la que apunten todas las fórmulas sería mucho más
  cómoda. ¿Se quiere además esa celda global?
- **⟨Q3⟩ ¿La hoja debe aparecer aunque NINGUNA fila tenga base?** Hoy sí: aparece con el aviso
  explicando por qué está vacía. La alternativa es no añadirla, pero entonces el usuario no sabe
  si falta la hoja o si no hay nada que repartir.
- **⟨Q4⟩ ¿Fila de totales, sí o no?** (A2). Es el único total de dinero que este árbol permitiría,
  y hace falta decirlo en voz alta porque la doctrina de la tabla es «ningún total al pie».
- **⟨Q5⟩ Nombres exactos** de la hoja y de sus siete columnas. Los de este spec son propuesta.
- **⟨Q6⟩ ¿Hace falta el mismo tratamiento en la otra dirección** —una hoja de reparto para las
  órdenes multiproducto si algún día la tienda nos da el precio unitario—? Hoy no se puede y no se
  plantea; se pregunta solo para que quede escrito que no se olvidó.
