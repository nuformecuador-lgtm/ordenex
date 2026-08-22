# 263 · impl — el comprobante deja de contradecirse y la guía deja de pisar al destinatario

Rama `fix/263-comprobante-cierre`. **Sin commit y sin PR** (encargo explícito). Zona `frontend`,
`sdd: false`: presentación pura, sin tocar datos, contratos ni consultas.

---

## 1. Archivos

| Archivo | Qué |
| --- | --- |
| `app/(app)/cierres-admin/_components/cierre-factura.tsx` | Único archivo de producción. Cabecera por estado, tarjeta compacta sin guion, plantilla de rejilla en una constante. |
| `tests/components/CierreFacturaPapel.test.tsx` | +13 casos (6 de cabecera + R6, 2 de tarjeta compacta, 6 de anatomía de rejilla). |
| `specs/263-comprobante-cierre-presentacion/tasks.md` | Casillas marcadas: T1, T1b, T2, T3, T4, T5, T6, T8, T9. |

Ningún `aria-label` cambió (R6) — comprobado con `git diff`: la única línea del diff que
contiene «aria-label» es un comentario nuevo.

---

## 2. Bloque A — la cabecera dice la verdad (T1, T1b)

`FACTURA_FOLIO_LABEL_POR_ESTADO: Record<CierreEstado, string>` junto a los rótulos existentes:
`aprobado`/`rechazado` → «Comprobante»; `solicitado`/`vencido` → «Solicitud». Es exhaustivo a
propósito: un quinto estado pone el typecheck rojo en vez de heredar un rótulo en silencio.

**Dos criterios distintos, no uno** (design §2): el sustantivo lo decide `cierre.estado`; la
pieza «Resuelto» —rótulo, fecha y el separador `·`— la decide `cierre.resueltoAt !== null`. Así
el guion no puede reaparecer por ninguna combinación, e incluso una incoherencia (`aprobado` sin
fecha) se lee **rara y verdadera** en vez de rara y falsa.

En la tarjeta compacta (R13) la `LineaFecha` de «Resuelto» sólo se renderiza con fecha, y
«Solicitado» pasa a ser la `ultima` (pierde su borde punteado). El sustantivo de esa tarjeta
(«Cierre del día») **no se tocó**: ahí no había contradicción.

## 3. Bloque B — la rejilla (T4)

`grid-cols-[40px_1.4fr_1fr_1fr_24px]` estaba **duplicado literal** en `:1105` (la fila) y
`:1490` (la cabecera de columnas), dos rejillas independientes. Ahora hay **una constante**,
`FILA_GRID_COLS`, consumida por los dos sitios:

```
grid-cols-[auto_minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_24px]
```

y una segunda constante `FILA_GUIA_CELDA = "min-w-[80px] whitespace-nowrap tabular-nums"` que
sirve el **piso** a la celda de la guía en la fila **y** en la cabecera. `rg "grid-cols-\["` sobre
el archivo: quedan tres ocurrencias y **ninguna es la de la fila** —`:667` (`md:grid-cols-[1.2fr_1fr_1fr]`,
el desglose de la tarjeta compacta), `:1413` (`sm:grid-cols-[1.4fr_1fr]`, los dos totales de
cabecera) y la propia constante—, más una mención dentro de un comentario.

El destinatario es quien cede: `min-w-0` en el envoltorio y `truncate` en sus dos líneas
(precedente literal de la 258 — sin `min-w-0`, `truncate` no se activa nunca). La guía no lleva
`truncate`, `overflow-hidden` ni `break-*`.

---

## 4. Mutaciones — los rojos, con su mensaje REAL

Cuatro mutaciones, cada una revertida después; el archivo volvió byte a byte al mismo
`md5 5518f5bfe2ba0af796378106b8cb3006` tras cada una.

**(a) Cabecera revertida al comportamiento viejo** (las tres piezas siempre, `fecha(resueltoAt)`
con su guion, «Comprobante» fijo) → **3 casos rojos**:

```
Tests  3 failed | 12 passed | 20 skipped (35)

TestingLibraryElementError: Unable to find an element with the text: Solicitud #C1000001.   (×2: vencido y solicitado)

AssertionError: un guion no es un dato: es el hueco donde iría un dato […]:
  expected 'Cierre del díaSolicitadoBodega centra…' not to contain 'Resuelto'
Received: "…Comprobante #C1000001Solicitado 2026-08-13 · Resuelto —Total general₡8.000…"
```

El `Received` trae **literalmente la cadena que el humano reportó**: `Comprobante #… · Resuelto —`.

**(b) `LineaFecha` de la tarjeta compacta, incondicional otra vez** → **1 caso rojo**:

```
FAIL > Feature 263 — la tarjeta compacta tenía el MISMO guion (R13) >
      sin fecha de resolución, la columna «Fechas» no pinta la línea ni el guion
AssertionError: es el mismo defecto de la cabecera, en la misma pantalla, a nueve líneas […]:
  expected 'FechasSolicitado2026-08-13Resuelto—' not to contain 'Resuelto'
```

**(c) `40px` devuelto SÓLO a la cabecera de columnas** → el caso de los dos sitios rojo:

```
FAIL > la cabecera de columnas y la fila usan LA MISMA plantilla de rejilla (R10)
Expected: "grid-cols-[40px_1.4fr_1fr_1fr_24px]"
Received: "grid-cols-[auto_minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_24px]"
```

**(d) `truncate` movido del destinatario a la guía** → **2 casos rojos**:

```
FAIL > la celda de la guía no lleva `truncate`, `overflow-hidden` ni `break-*` (R7)
  expected 'text-[13px] font-medium text-foregrou…' not to contain 'truncate'
  Received: "text-[13px] font-medium text-foreground min-w-[80px] truncate whitespace-nowrap tabular-nums"
FAIL > el que cede es el destinatario, con elipsis, y por eso lleva `min-w-0` (R8)
  expected 'text-[13px] text-foreground' to contain 'truncate'
```

Con las cuatro revertidas: **35 passed (35)** en ese archivo.

---

## 5. T5 — la medición EN EL NAVEGADOR, con su autocomprobación

Playwright sobre `pnpm dev`, sesión `admin.qa@ordenex.test` para `/cierres-admin` y
`mensajero.qa@ordenex.test` para `/cierre-dia`. Cierre `70ebf5e2…73545e29` (13 gestiones); se
mide la pestaña **Reprogramadas (8 filas)**, que mezcla longitudes de guía distintas a la vez.

**Cómo se metieron las guías de 8 y 9 dígitos, dicho sin adornos:** la base local sólo tiene
guías de **6 dígitos**, y escribir en ella (`update orden set num_guia`) **me lo denegó el
clasificador de permisos**. Así que los valores se **inyectan en el DOM** antes de medir. Lo que
se mide es el layout real del navegador con el CSS real de la app; lo único que cambia es de
dónde viene el texto. Longitudes usadas: `354246291`, `987654321` (9), `35424629`, `87654321`
(8, y el primero es **el de la captura del humano**), `354246`, `123457` (6).

**La sonda, y la trampa que encontró de camino.** El criterio son dos cosas:
`scrollWidth > clientWidth + 1 || scrollHeight > clientHeight + 1` **sobre la celda de la guía,
la del destinatario y el `<button>` entero**, más que la guía se pinte en **una sola línea**
(`Range.getClientRects().length === 1`, porque una palabra partida CABE y le da verde al primer
criterio), más `digitosEnOrden`, más `left` alineado (±1 px) entre cabecera y todas las filas.

> ⚠️ **La primera versión comparaba cajas y el solapamiento NUNCA se disparaba.** Medido: en el
> estado ANTERIOR al arreglo la caja del `<span>` de la guía se queda clavada en su track de
> 40 px (`solapaCaja: false`) mientras el texto se sale y se pinta encima del vecino. Lo que
> invade al vecino es la **tinta**, no la caja; se mide con un `Range` sobre el nodo de texto.
> Corregido, la sonda pasó a reportar `solapa: true` en el estado viejo. Filtro de `sr-only`
> (`position: absolute`) incluido, aunque aquí ninguna celda lo es.

### Autocomprobación (obligatoria): la sonda contra el estado ANTERIOR

`git stash` del arreglo (la fila y la cabecera vuelven a `grid-cols-[40px_…]`), misma sonda:

| escenario | filas | ancho celda guía | MALOS | desalineados |
| --- | --- | --- | --- | --- |
| admin · 1440 / 1280 / 1024 / 768 / 390 | 8 | **40 px** | **8 / 8** en cada uno | 0 |
| mensajero · 1440 / 1280 / 1024 / 768 / 390 | 8 | **40 px** | **8 / 8** en cada uno | 0 |

Una fila de ejemplo del estado viejo:

```
{"guia":"35424629","recorteGuia":true,"solapa":true,"solapaCaja":false,
 "guiaEnUnaLinea":true,"anchoGuia":40,"desalineado":1}
```

La sonda **no da verde en las dos versiones**: reporta el defecto exacto de la ficha (recorte +
tinta encima del destinatario) en el caso de 8 dígitos y también en el de 9.

### Resultado con el arreglo — 0 solapamientos, 0 desalineados

| escenario | filas | ancho celda guía | MALOS | desalineados | cabecera solapa | elipsis en destinatario |
| --- | --- | --- | --- | --- | --- | --- |
| admin · 1440 | 8 | 80 px | **0** | **0** | false | 0 |
| admin · 1280 | 8 | 80 px | **0** | **0** | false | 0 |
| admin · 1024 | 8 | 80 px | **0** | **0** | false | 0 |
| admin · 768 | 8 | 80 px | **0** | **0** | false | 0 |
| admin · 390 | 8 | 80 px | **0** | **0** | false | 8 |
| mensajero · 1440 | 8 | 80 px | **0** | **0** | false | 0 |
| mensajero · 1280 | 8 | 80 px | **0** | **0** | false | 0 |
| mensajero · 1024 | 8 | 80 px | **0** | **0** | false | 0 |
| mensajero · 768 | 8 | 80 px | **0** | **0** | false | 0 |
| mensajero · 390 | 8 | 80 px | **0** | **0** | false | 8 |

`elipsisDest = 8` a 390 px **es el arreglo funcionando**, no un fallo: a ese ancho el que cede es
el nombre del destinatario, con elipsis, y la guía sigue entera (R8).

### El piso de 80 px, validado contra la tinta medida (R14)

Ancho real del número renderizado, medido en `@media print` sobre la misma hoja:

| guía | dígitos | tinta | celda | holgura |
| --- | --- | --- | --- | --- |
| `354246291` | 9 | **69,0 px** | 80 px | 11 px |
| `987654321` | 9 | 68,7 px | 80 px | 11,3 px |
| `35424629` | 8 (el de la captura) | **64,5 px** | 80 px | 15,5 px |
| `87654321` | 8 | 60,4 px | 80 px | 19,6 px |
| `354246` | 6 | 48,7 px | 80 px | 31,3 px |
| `123457` | 6 | 43,8 px | 80 px | 36,2 px |

**El dato que más duele y conviene dejar escrito:** con la caja de 40 px **ni siquiera las guías
de 6 dígitos cabían** (43,8–48,7 px). El defecto no esperaba a un número largo; ya estaba pasando
con todo lo que hay en la base local. El piso de 80 px se queda **tal cual**: la de 9 dígitos
cabe con 11 px de sobra, así que no hubo que subirlo ni remedir.

### Lo que se vio con los ojos

Captura de la hoja (`hoja-263.png`, en el scratchpad): la columna «Guía» muestra `354246291`,
`35424629`, `354246`, `987654321` completos, cada uno dentro de su columna y con aire hasta
«Karla Vargas» / «Mariana Solis», y la cabecera `Guía | Destinatario | Cobrado | Total Ordenex`
alineada con las filas.

Cabecera del documento leída del DOM en el navegador (cierre `aprobado`, R2 + R4):

```
Cierre del día / Aprobado / Bodega central · GAM · Mensajero Marco
Comprobante #73545E29
Solicitado 2026-08-12 · Resuelto 2026-08-20
```

---

## 6. T8 — regresión de impresión (feature 223)

`@media print` emulado sobre la hoja abierta con las 8 filas: **`break-inside: avoid` intacto en
las 8**, `recorteGuia: false` y `solapa: false` en todas, `desalineado: 1 px` (tolerancia ≤1).
PDF A4 generado en el scratchpad (`cierre-263.pdf`). **No se pudo rasterizar para mirarlo como
imagen** —no hay `poppler` en la máquina—, así que lo revisado a ojo es el PNG de la hoja; lo del
papel está medido, no mirado. Queda anotado como tal.

---

## 7. T9 — Gate, con la salida real

`./init.sh --rapido` **se negó solo**, que es lo que tiene que hacer:

```
Tu cambio toca cimientos, y para eso el modo rapido no alcanza:
    app/(app)/cierres-admin/_components/cierre-factura.tsx
✗ esto exige el gate completo. Corre: ./init.sh
INIT_EXIT=1
```

Gate completo, `INIT_EXIT` escrito **dentro** del log:

```
✓ node v24.13.0
✓ dependencias presentes
✓ regla max-2-por-zona respetada (in_progress=2)
✓ specs presentes para features sdd en vuelo
✖ 99 problems (0 errors, 99 warnings)
✓ lint paso
 Test Files  1297 passed (1297)
      Tests  17283 passed | 26 skipped (17309)
   Duration  357.56s
✓ test paso
! migraciones sin down.sql: 20260814120000_ruta_optimizada_trazado 20260814140000_ruta_parada_tramo 20260814160000_ruta_tramo_vivo_at
✓ .env presente
== init OK ==
INIT_EXIT=0
```

**Lint: 99 warnings, exactamente la línea base — no subió.** Ninguna guardia ajena se puso roja.
El aviso de `down.sql` es preexistente y de otras fichas.

---

## 8. Mapa `R<n> → dónde se demuestra` (confirmado)

| R | Dónde | Estado |
| --- | --- | --- |
| R1 | `CierreFacturaPapel.test.tsx` › «un cierre VENCIDO se rotula «Solicitud»…» + el caso `solicitado` | ✅ (muerto por mutación a) |
| R2 | idem › «aprobado y rechazado SÍ son comprobantes…» | ✅ + leído en el navegador |
| R3 | idem › «sin fecha de resolución NO se pinta la pieza «Resuelto», ni con guion» | ✅ (muerto por a) |
| R4 | idem › «con fecha de resolución se pintan las dos fechas…» | ✅ + leído en el navegador |
| R5 | idem › «el folio y la fecha de solicitud salen en los CUATRO estados» | ✅ |
| R6 | los casos de las features 217/223 que localizan por `role="region"`, intactos y verdes; + un caso propio | ✅ |
| R13 | idem › los dos casos de la tarjeta compacta | ✅ (muerto por b) |
| R7 | anatomía (guía sin `truncate`/`break-*`) + medición §5 (criterios 1 y 2) | ✅ (muerto por d) |
| R8 | anatomía (`truncate` + `min-w-0` en el destinatario) + `elipsisDest` a 390 px | ✅ (muerto por d) |
| R9 | **sólo** medición §5: 5 anchos × 2 audiencias, 0 solapamientos | ✅ |
| R10 | anatomía (los dos sitios comparten fragmento, leído del DOM) + `left` ±1 px | ✅ (muerto por c) |
| R11 | anatomía › «sin número de guía la celda sigue mostrando «—»» | ✅ |
| R12 | anatomía › el destinatario largo conserva texto en el DOM y en el `aria-label` | ✅ |
| R14 | **sólo** medición §5: 9 dígitos = 69 px de tinta en una celda de 80 px | ✅ |

---

## 9. Lo que queda abierto, dicho como lo que es

1. **La cabecera de un cierre VENCIDO no se vio en el navegador.** La base local tiene 6 cierres y
   los **seis** son `aprobado`; crear uno `vencido` exige escribir en la base y eso me lo denegó
   el clasificador de permisos. El caso está cubierto por la suite **y matado con la mutación
   (a)**, que reproduce el texto exacto de la captura. Si querés verlo en pantalla, hace falta un
   cierre sin resolver en local.
2. **Las guías de 8 y 9 dígitos se inyectaron en el DOM**, no se sembraron (mismo motivo de
   permisos). El layout medido es real; la procedencia del texto no.
3. **El PDF de impresión está medido, no mirado como imagen**: falta `poppler` para rasterizarlo.
4. **El piso de 80 px es una foto con fecha.** Se dimensionó contra la medición de producción del
   2026-08-21 (163 órdenes, todas de 8 dígitos) más un dígito de holgura. En ningún sitio del
   repo se declara que la guía tenga 8 dígitos para siempre: quien relea esto dentro de un año,
   ese número caducó el día que se midió. Si aparece una guía más larga que el piso, esa fila
   **crece** —queda un par de píxeles desalineada, feo pero legible— en vez de tapar al vecino.
5. **Sin commit y sin PR**, por encargo.
