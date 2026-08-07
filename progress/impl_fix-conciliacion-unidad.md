# Impl: fix — el cuadre de conciliación se pintaba como conteo, no como dinero

Defecto de producción VIVO, sin SDD (es un fix con su caso de regresión).
Rama `fix/conciliacion-unidad-moneda`, worktree `lote-135`, desde `origin/dev @ 3713e743`.

## 1. Lo que medí (eslabón a eslabón, no de oídas)

| # | Eslabón | Medido |
|---|---------|--------|
| 1 | `lib/analytics/metrics.ts:659` | `conciliacion_cierres` declara `unidad: "conteo"`. **Correcto**: la métrica cuenta cierres. También declara `unidadDeConteo: "moneda"`, que el DTO **no publica** |
| 2 | `lib/services/AnaliticaFinancieraService.ts:273` | `cabecera()` copia `unidad: consulta.metrica.unidad` del catálogo → el DTO de esta métrica sale con `unidad: "conteo"` |
| 3 | `PanelConciliacion.tsx:140` (antes del fix) | `formatearValor(aNumero(cifra.importe), datos.unidad)` sobre `cuadre.totalSnapshot`, `cuadre.totalLedger` y `cuadre.diferencia` — los tres son **importes** |
| 4 | `components/private/analytics/formato.ts:73-74` | `case "conteo": numero(valor, { maximumFractionDigits: 0 })` — redondea a entero y no pone símbolo de moneda |

Sonda de formato con la configuración por defecto del repo (`es-CR` / `CRC`,
`lib/config/moneda.ts`), corrida con `node -e`:

```
1560.5  moneda="₡1 560,50"  conteo="1 561"
1500    moneda="₡1 500,00"  conteo="1 500"
60.5    moneda="₡60,50"     conteo="61"
```

Es decir: el cuadre pintaba `1 561` donde el importe era ₡1 560,50, y un descuadre de
₡60,50 se anunciaba como **«61»**. En la pantalla que existe para cuadrar dinero.

**Por qué ningún test lo vio (medido, no supuesto).** `tests/components/PanelConciliacion.test.tsx`
declaraba `unidad: "moneda"` en su doble: un DTO que el servicio no produce. Corregí SOLO
esa línea, sin tocar producción, y corrí el archivo:

```
antes (doble mentiroso, código con el defecto):  7 passed (7)
con la unidad real, código con el defecto:       2 failed | 5 passed (7)
```

Los dos rojos, ambos por `Unable to find an element with the text: ₡1 560,50`:
- «muestra los conteos por nivel y estado POR SEPARADO y las tres cifras del cuadre»
- «el resto de la tabla y el cuadre se renderizan IGUALMENTE (el panel nunca se apaga)»

## 2. El arreglo

`app/(app)/analitica/_components/financiero/PanelConciliacion.tsx`.

Elegí **declarar la unidad por cifra en un solo sitio** en vez de escribir un `"moneda"`
suelto en la línea 140. El criterio («los cuatro totales por método y las tres cifras del
cuadre son dinero; los cierres son conteo») ya estaba escrito en `COLUMNAS_CONCILIACION`
(4× `"moneda"`, 1× `"conteo"`) y en la línea del aviso (`"conteo"`). Un literal más habría
dejado el mismo criterio escrito en **seis** sitios del mismo archivo.

Ahora hay un `UNIDAD = { importe: "moneda", conteo: "conteo" }` (`as const satisfies
Record<string, MetricaUnidad>`) del que leen las tres cosas: las columnas de la tabla, el
aviso de descuadre y el cuadre. `datos.unidad` ya no aparece en el código del archivo —
solo en dos comentarios que explican por qué no se usa.

Lo que **no** toqué: la línea del aviso sigue contando cierres descuadrados con la unidad
de conteo (ahí es correcto), y la columna `cantidad` sigue siendo conteo.

## 3. Los dos casos que hubo que reescribir, y por qué

El aviso del encargo era exacto: con la unidad de verdad, dos de los siete casos solo
podían pasar afirmando el redondeo. Para ponerlos en verde sin arreglar producción habría
que haber escrito `"1 561"` y `"1 500"` como esperados — es decir, **fijar el bug en la
suite**. No se hizo. Los dos casos conservan sus afirmaciones en dinero (`₡1 560,50`,
`₡1 500,00`), que es lo correcto, y ahora pasan porque el panel formatea bien:

- «muestra los conteos … y las tres cifras del cuadre»: mismas afirmaciones, más un
  comentario que dice que antes pasaban por el motivo equivocado.
- «el resto de la tabla y el cuadre se renderizan IGUALMENTE»: se le añadió la tercera
  cifra (`₡60,50`, la diferencia), que es justo la que un humano lee para ir a buscarla al
  libro y la que el defecto más deformaba.

Además el doble dejó de escribir la unidad a mano: la **copia del catálogo**
(`getMetrica("conciliacion_cierres").unidad`), que es la misma fuente que usa `cabecera()`.
Si alguien vuelve a inventarla, ya no puede.

## 4. El caso de regresión y la mutación de control

Caso nuevo: «pinta el descuadre con sus decimales y su símbolo (₡60,50), NO redondeado a
«61»». Afirma **el texto que se lee en pantalla** —los tres literales `₡1 560,50`,
`₡1 500,00`, `₡60,50`, escritos a mano y no derivados de `formatearValor`, para que el
esperado no salga de la misma función que se comprueba— y además que las formas
redondeadas (`1 561`, `1 500`, `61`) **no están** en la sección. Sin esa segunda mitad, un
panel que pintara las dos cosas seguiría en verde. Ninguno de esos tres valores aparece en
la tabla, así que si salen es porque salieron del cuadre.

Caso hermano: «la cabecera del DTO real declara `conteo`», que deja la premisa medida
escrita como caso en vez de como comentario.

**Mutación de control.** Se revirtió el arreglo (`UNIDAD.importe` → `datos.unidad`) con un
`node -e` que aborta si no encuentra el objetivo:

| | |
|---|---|
| con el arreglo | `9 passed (9)` |
| con la mutación | `3 failed \| 6 passed (9)` — el caso nuevo y los dos reescritos |
| tras restaurar | `9 passed (9)` |

Restauración **verificada por hash** (no por lectura): `sha256` del archivo antes de mutar
= `44b69be005570a5be9fb681300a821c7bd3bea301e3688f068944fbdd3be9d22`; tras mutar
`780570ea…`; tras restaurar, `44b69be0…` de nuevo, idéntico. Y `grep datos.unidad` sobre el
archivo restaurado solo devuelve las dos líneas de comentario.

## 5. El barrido de la región financiera (medido)

Sonda sobre el catálogo (`METRICAS`) cruzada con `IDS_FINANCIERAS_SERVIDAS`:

```
financiera (10):  moneda x9   cod_recaudado, ingreso_flete, ingreso_comision_cod,
                              ingreso_iva, egresos, dinero_en_caja, ganancia_ordenex,
                              cuenta_por_pagar_tienda, cuenta_por_pagar_mensajero
                  conteo x1   conciliacion_cierres
operativa (15):   conteo x9 · porcentaje x4 · segundos x2   (ninguna de dinero)
```

Sitios que formatean con la unidad de la **cabecera** del DTO (`grep` de `datos.unidad` y de
`formatearValor(` en todo el árbol de producción):

1. `PanelConciliacion.tsx:140` — **el defecto**, arreglado.
2. `TableroFinanciero.tsx:474` (`unidad={datos.unidad}`, que se hilva a `KpiCard`,
   `TotalDelDto`, las tres gráficas y `SerieTextual`) — **no está roto hoy**: ahí solo
   llegan DTOs `tipo: "vistas"`, porque `seccionesDePanel` desvía el `tipo: "conciliacion"`
   a `PanelConciliacion` antes; y las 9 métricas que producen `vistas`
   (`AnaliticaFinancieraService`, cinco `return … tipo: "vistas"`) declaran las 9
   `unidad: "moneda"`.
3. `PanelOperativo.tsx:243,260` (`preparado.unidad`) — región operativa: **no hay dinero
   que deformar**, ninguna de sus 15 métricas es `moneda`.

Toda columna de tabla de la región declara su unidad **por columna** con literal `"moneda"`
(`adaptar.ts` `COLUMNA_BRUTO`/`COLUMNA_NETO`; `PanelConciliacion` `COLUMNAS_CONCILIACION`):
ninguna celda usa la unidad de cabecera.

**Conclusión medida:** `conciliacion_cierres` es la **única** métrica del catálogo (25 en
total) que publica dinero declarando una `unidad` que no es `moneda`, y es además la única
con forma de DTO propia. El defecto solo podía aparecer donde apareció. **No hay que
arreglar ningún otro panel.**

## 6. Un segundo doble mentiroso, encontrado en el barrido

`tests/components/TableroFinanciero.test.tsx:342` construía el mismo DTO de
`conciliacion_cierres` con `unidad: "moneda"`. Es test, no producción, y con el arreglo ya
puesto no cambia un solo píxel del render — pero afirmaba algo falso sobre el productor, que
es exactamente lo que costó las 7 horas del 2026-08-06. Corregido a `"conteo"` (commit
aparte).

Dato incómodo: el doble del contrato,
`tests/unit/analytics/financiera-contratos.test.ts:111`, **ya declaraba `"conteo"`** desde
siempre. La verdad estaba escrita a un directorio de distancia de los dos dobles que
mentían.

## 7. Qué queda sin cubrir (abierto, no resuelto aquí)

- ~~**El riesgo latente de `TableroFinanciero.tsx:474`.**~~ **CERRADO en la tanda 2**, ver §8.
- **Publicar `unidadDeConteo` en `CabeceraFinanciera`: DESCARTADO** (decisión del
  coordinador, 2026-08-07). Lo había anotado como «causa raíz»; **no lo es**. La unidad con
  la que se pinta una cifra concreta es propiedad de **esa cifra**, no de la métrica que la
  contiene — que es justamente lo que este fix establece. Hacerla viajar en el DTO
  devolvería al panel una señal **de cabecera** ambigua, que es el mecanismo por el que se
  equivocó. Es otra forma de la misma señal equivocada, no su cura. No se hace.
- **No hay comprobación de extremo a extremo.** Lo verificado es render en jsdom con dobles;
  nadie ha vuelto a mirar la pantalla de producción con datos reales tras el despliegue.
- **El texto exacto (`₡…`) del caso de regresión asume la configuración por defecto**
  (`es-CR`/`CRC`). Si alguien cambia `MONEDA_LOCALE`/`MONEDA_CURRENCY`, ese caso se pone
  rojo — está dicho en el propio archivo, y es la señal correcta: es la única afirmación de
  la suite sobre el texto que ve un humano.
- **Las cuatro claves de dinero del DTO siguen escritas dos veces** en
  `PanelConciliacion.tsx` (`COLUMNAS_CONCILIACION` y `CLAVES_TOTAL`, cuyo comentario dice
  «declaradas una vez»). No es el criterio de unidad y no es este defecto; lo dejo anotado
  y no lo toqué en un fix de producción.

## 8. Tanda 2 — la guardia que cierra el riesgo latente

`tests/unit/analytics/financiera-unidad-de-vistas.guardia.test.ts` (13 casos).

### La premisa, verificada ANTES de escribir nada

El encargo pedía parar si la premisa era falsa. No lo es. Sonda que arma el servicio real
con los dobles de la 127 (`tests/unit/services/_dobles-analitica-financiera.ts`) y consulta
las 10 métricas financieras del catálogo, leyendo el discriminante del DTO **que el
productor devuelve de verdad**:

```
cod_recaudado, ingreso_flete, ingreso_comision_cod, ingreso_iva, egresos,
dinero_en_caja, ganancia_ordenex, cuenta_por_pagar_tienda,
cuenta_por_pagar_mensajero        tipo=vistas        unidad=moneda
conciliacion_cierres              tipo=conciliacion  unidad=conteo
```

Y en las 10, `dto.unidad === catalogo.unidad`: la cabecera copia el catálogo, sin excepción.
El desvío de `seccionesDePanel` es tan limpio como parecía: una sola rama,
`datos.tipo === "conciliacion"` → `<PanelConciliacion>`.

### De dónde saca cada mitad (ninguna lista escrita al lado)

- **Qué métricas llegan por el camino de `vistas`:** se le pregunta **al productor**. La
  guardia arma el servicio con los dobles y consulta cada métrica de
  `listarMetricas({ dominio: "financiera" })`, leyendo `datos.tipo`. Una métrica nueva entra
  en el censo sola; si una existente cambia de forma de DTO, se ve el mismo día.
- **Qué unidad declara cada una:** del catálogo, la misma fuente que copia `cabecera()`.

### Lo que afirma

1. Ninguna métrica de `tipo: "vistas"` declara una unidad que no sea `moneda`. El mensaje
   nombra a la infractora y dice **por qué importa** («sus importes se pintarían redondeados
   y sin moneda, como le pasó al cuadre de conciliación en producción»).
2. Y la recíproca: toda métrica cuya unidad no es dinero **no** llega por `vistas`. Sin
   esta, la regla 1 seguiría verde el día que `conciliacion_cierres` empezara a publicar
   vistas — y ese día el defecto vuelve por la puerta grande.
3. **No puede pasar por vacío** (lección de la tanda H de la 184): rojo si el dominio
   financiero del catálogo está vacío, si alguna métrica no respondió `ok` y se cayó del
   censo en silencio, o si alguna de las dos familias de DTO queda sin representantes. No se
   fija el número de métricas: una métrica nueva no debe poner rojo un guardia por existir.
4. **La premisa sigue viva:** por texto sobre `TableroFinanciero.tsx`, que el desvío del DTO
   de conciliación existe (comparación **y** `<PanelConciliacion`, no una mención en prosa);
   y un contrapeso incómodo a propósito: que `unidad={datos.unidad}` sigue ahí. Si alguien lo
   retira —declarando la unidad por cifra, como se hizo en `PanelConciliacion`—, ese caso se
   pone rojo para obligar a releer la guardia antes de darla por buena o retirarla.
5. **Autocomprobación** (7 casos): los detectores son funciones puras y se ejercitan contra
   censos sintéticos. Marcan `porcentaje` y `segundos`, no solo `conteo`; **no** marcan la
   métrica desviada aunque su unidad no sea dinero; y se afirma por escrito la limitación de
   que con censo vacío no marcan nada — por eso hacen falta los casos de cobertura.

### Mutación de control

Se cambió en el catálogo `lib/analytics/metrics.ts:436` la unidad de `ingreso_flete` (métrica
de vistas) de `"moneda"` a `"conteo"`:

| | |
|---|---|
| catálogo intacto | `13 passed (13)` |
| con la mutación | `2 failed \| 11 passed` — las dos reglas, nombrando `ingreso_flete` |
| tras restaurar | `13 passed (13)` |

Los 5 casos de cobertura y los 7 de autocomprobación siguieron verdes durante la mutación,
que es lo correcto: miden otra cosa. Restauración **verificada por hash**:
`1ff18fe07d0ff34f78ebf3d63294086f83658d36ae65c91a3ad533aa94065c17` antes, `30c40e40…`
mutado, `1ff18fe0…` de nuevo tras restaurar; y `git status` no lista `metrics.ts` como
modificado.

### Lo que esta guardia NO cubre

- Vigila el **catálogo**, no la pantalla: si alguien escribiera en el tablero un
  `formatearValor(importe, "conteo")` a mano, esta guardia no lo vería (sí lo vería el censo
  de `tests/unit/guards/tablero-financiero.guardia.test.ts` solo si el literal fuera de
  moneda, que no es el caso). Queda anotado.
- Depende de que los dobles de la 127 sigan sirviendo las 10 métricas. Si dejaran de
  hacerlo, el caso «ninguna se cayó del censo en silencio» se pone rojo — que es la conducta
  querida, pero es una dependencia real de este archivo sobre
  `tests/unit/services/_dobles-analitica-financiera.ts`.

## Archivos tocados

- `app/(app)/analitica/_components/financiero/PanelConciliacion.tsx` (producción)
- `tests/components/PanelConciliacion.test.tsx`
- `tests/components/TableroFinanciero.test.tsx`
- `tests/unit/analytics/financiera-unidad-de-vistas.guardia.test.ts` (tanda 2)
- `progress/impl_fix-conciliacion-unidad.md` (este archivo)
