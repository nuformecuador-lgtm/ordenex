# Ficha 364 — la barra y el KPI dicen el mismo número del mismo hecho

Rama `fix/364-barra-con-decimal`, árbol principal. Sólo capa de presentación: ni backend, ni base,
ni rutas de API. **El KPI no se toca**: es el que el humano eligió como bueno.

## El pedido

> «elijo el dato real, el del KPI, que se muestren los decimales»

Sobre `/analitica` › «Detalle · Movimiento de las órdenes»: el KPI «Efectividad de entrega» decía
**29,5 %** y el segmento «Entregadas» de la barra «Detalle gestión», a un palmo, decía **30 %**.
La misma razón —259 de 877— escrita dos veces con dos números.

## Lo primero: MEDIR si la palanca escrita en el módulo bastaba

La cabecera de `porcentajes.ts` prometía que «si algún día hace falta un decimal, se cambia
`ESCALA` y el método sigue valiendo igual». **Para el dibujo es cierto; para el texto es falso**, y
el punto difícil de la ficha era comprobarlo antes de creérselo.

Se comparó, sobre repartos reales y construidos, **lo que escribiría la cuota del resto mayor**
contra **lo que escribe el KPI para la misma razón** (`maximumFractionDigits: 1`):

| conjunto medido | partes | ESCALA=100 (hoy) | ESCALA=1000 (la palanca) |
|---|---|---|---|
| 20.000 variantes del caso real (877 órdenes, 6 segmentos) | 119.674 | **93,6 %** difieren · máx **0,651 pp** | **9,4 %** difieren · máx **0,068 pp** |
| las 148.950 composiciones exhaustivas de k=2..4, T≤40 | 529.720 | **84,9 %** · máx 0,750 pp | **8,4 %** · máx 0,075 pp |
| 200.000 repartos aleatorios de 6 partes, total 50..2000 | 1.192.554 | **90,2 %** · máx 0,806 pp | **7,9 %** · máx 0,082 pp |
| el caso de producción de la 290, `[1,0,0,1,0,231]` | 3 | 3 de 3 · máx 0,571 pp | 1 de 3 · máx 0,058 pp |

Corrido dos veces con semillas distintas; las dos tablas coinciden en el segundo decimal. La copia
del algoritmo usada para parametrizar `ESCALA` se validó contra el módulo real en 20.000 repartos
aleatorios: idéntica en los 20.000.

**Y EL CASO QUE EL HUMANO MIRÓ SIGUE DENTRO DEL 9 %:**

```
  [entregada 259/877] ESCALA=100 : barra=30%    kpi=29,5%  DISCREPAN
  [entregada 259/877] ESCALA=1000: barra=29,6%  kpi=29,5%  DISCREPAN
```

Subir la escala **no resuelve su problema**: cambia «30 %» por «29,6 %» y sigue contradiciendo al
KPI. Por eso el arreglo no está en el formato.

## El arreglo, en el ORIGEN

`components/private/analytics/porcentajes.ts` pasa a devolver **tres números con tres oficios**:

- `exacta` — la razón `valor / total`, sin tocar. **Es lo que se ESCRIBE**, y es literalmente la
  misma cifra que formatea el KPI (`calcularEfectividad` devuelve `entregadas / total`). Coinciden
  por construcción: no hay redondeo intermedio que pueda separarlas.
- `cuota` — la razón repartida por resto mayor. Suma exactamente 1. **Es GEOMETRÍA.**
- `ancho` — la cuota con las astillas de la 290. Suma exactamente 1. Es lo que se DIBUJA.

`textoDePeso` lee `exacta`; el ancho de la franja sigue saliendo del resto mayor, que es donde la
suma a 100 significa algo. Se renombró `fraccion` → `cuota` a propósito: el defecto de esta ficha
fue que un campo llamado «fracción» se leyó como «la fracción del todo» cuando era «la cuota
redondeada», y el nombre nuevo hace visible el error. Se **retiró** `porcentajesDeReparto`, que
exportaba justo esa cuota bajo el nombre «porcentajes» (no la usaba ningún consumidor: sólo su
propio test).

### Dos decisiones de detalle, las dos medidas

1. **`ESCALA` sube a 1000, pero sólo para el dibujo.** Con 100, una franja rotulada «29,5 %» se
   pintaba al 30 % de la barra: 3 px de desacuerdo entre lo que se lee y lo que se ve sobre 600 px.
   Con 1000 la geometría queda a la misma precisión que el texto. La suma exacta a 100 % vale igual
   a cualquier escala.
2. **`ASTILLA` deja de derivarse de `ESCALA`** (`0.5 / ESCALA` → `0.005` absoluto). Era una trampa
   real: con la escala en 1000, la fórmula vieja habría encogido la astilla a 0,05 % = **0,3 px**,
   deshaciendo la 290 en silencio al tocar una constante que parecía no tener que ver. Lo que fija
   ese mínimo es el píxel, no la granularidad del reparto. Está cazado por la mutación M6.
3. **El umbral del «menor que» se le PREGUNTA al formateador** en vez de suponerlo. Era
   «un punto entero» escrito a mano en `porcentajes.ts`: una suposición sobre la precisión de
   `formato.ts`, que es exactamente la clase de desacuerdo entre dos módulos que produjo esta
   ficha. Ahora `pasoEscribible(formatear)` busca el paso más fino que ese formateador escribe
   distinto del cero. Consecuencia: con un decimal el aviso dice **«<0,1 %»**, no «<1 %», y el caso
   de la 290 (1 de 233 = 0,429 %) ya **no necesita el «<»**: dice «0,4 %». Lo que no se movió es el
   compromiso de la 290/291: **nunca un «0 %» pegado a una cifra que no es cero**.

## El PRECIO, medido

La suma de los textos deja de dar 100 exacto. Sobre los mismos repartos:

| conjunto | suma exactamente 100,0 | desviación máxima | reparto |
|---|---|---|---|
| caso real 877, 6 segmentos (20.000 variantes) | **45,0 %** | **−0,2 pp** | −0,2: 2,4 % · −0,1: 50,8 % · 0,0: 45,0 % · +0,1: 1,8 % |
| exhaustivo k=2..4, T≤40 (148.950) | 70,1 % | +0,2 pp | −0,1: 16,2 % · 0,0: 70,1 % · +0,1: 13,6 % · +0,2: 0,1 % |
| aleatorio 6 partes (200.000) | 54,6 % | **+0,3 pp** | −0,2: 0,9 % · −0,1: 21,4 % · 0,0: 54,6 % · +0,1: 22,2 % · +0,2: 1,0 % · +0,3: 0,005 % |

**En el caso reportado la columna dirá 99,9 %** (29,5 + 2,3 + 9,1 + 3,4 + 0,9 + 54,7). El tope no es
una impresión: con seis partes redondeadas a un decimal, cada una se desvía como mucho medio décimo,
así que la columna no puede irse de 6 × 0,05 = **0,3 pp**. Control: con el resto mayor a puntos
enteros la suma daba 100 en **50.000 de 50.000** repartos, o sea que el intercambio es real.

**La barra NO paga ese precio**: sigue midiendo 100 % exacto, y eso está medido en el navegador
(abajo). El intercambio es sólo tipográfico: antes el texto sumaba 100 y mentía sobre cada parte;
ahora cada parte dice la verdad y la columna puede desviarse un décimo. **La decisión final es del
humano**; el número está aquí para que la tome con él.

Detalle no medible con los volúmenes de hoy: el «<0,1 %» sólo aparece con un total **por encima de
2.000** órdenes y una parte de 1 (1/2001 = 0,0499 % → «0 %»). En los 370.000 repartos medidos, con
totales hasta 2.000, no salió ni una vez. La guarda sigue haciendo falta el día que el volumen crezca.

## Alcance del cambio (radio de explosión)

`textoDePeso` es la única función que escribe un peso, y la usan **las tres gráficas**:
`GraficaReparto` (la barra de la ficha), `GraficaDonut` y `GraficaRanking`. Las tres pasan a decir
la razón exacta. Es deliberado —el defecto era el mismo en las tres— y en las otras dos ni siquiera
cuesta geometría: el donut lo pinta recharts con el valor CRUDO y la barra del ranking mide
`valor / mayor`, así que ahí la cuota del resto mayor no gobernaba ningún dibujo. Lo que pierden es
que su columna de porcentajes sume 100 clavado.

## Verificación

### El test que exige la ficha, y falla hoy

`tests/unit/components/analytics-kpi-y-barra.test.ts` (nuevo). No recalcula nada: produce las dos
cadenas con las **mismas funciones que las producen en pantalla** y a partir de UNA sola lista de
filas —`calcularEfectividad` + `formatearValor` por un lado, `plegarEnDesenlaces` +
`pesosDeReparto` + `textoDePeso` por el otro—. Ejecutado sobre el módulo de HEAD:

```
AssertionError: el número de la barra y el del KPI no dicen lo mismo (259 de 877):
expected '30%' to be '29,5%' // Object.is equality
```

Con el arreglo, 11/11 en verde. No se queda en el caso suelto: comprueba las **3.059 composiciones**
de hasta 14 órdenes en 4 buckets (con el conteo asertado, para que un bucle vacío no pase en verde).

### Lo que no se puede perder

Mismo archivo: los anchos siguen sumando exactamente 100 en los repartos que redondeados
ingenuamente dan 99, 98, 101 y 102 —y que el caso **es** de los incómodos se afirma, no se supone—,
con astillas de por medio, y en los **39.710 repartos** de tres partes hasta 60 órdenes.

### Mutaciones — 6 aplicadas, 6 muertas, 6 revertidas

Todas con la misma disciplina: `sha256` del archivo antes y después. El pristino es
`ffe4de30a080f1bd3262b80b34e8d424d6bda9949ac20f979929d5c9d703a088`, y las seis vueltas atrás lo
recuperaron exacto.

| # | mutación | tests rojos | línea de fallo real |
|---|---|---|---|
| **M1** | `textoDePeso` escribe `peso.cuota` en vez de `peso.exacta` (el defecto de la ficha, a escala 1000) | 8 | `el número de la barra y el del KPI no dicen lo mismo (259 de 877): expected '29,6%' to be '29,5%'` |
| **M2** | `ESCALA = 100` — **vuelta a puntos enteros** (obligatoria) | 4 | `expected [ 340, 330, 330 ] to deeply equal [ 334, 333, 333 ]` · `expected [ 10, +0, +0, +0, +0, 990 ] to deeply equal [ 4, +0, +0, 4, +0, 992 ]` |
| **M3** | la astilla ya no se le cobra al mayor — **rompe la suma a 100** (obligatoria) | 3 | `expected 100.2 to be close to 100, received difference is 0.20000000000000284` |
| **M4** | los puntos sobrantes del resto mayor no se reparten — **rompe la suma a 100** por el otro lado | 10 | `expected 99.9 to be close to 100` · `expected 998 to be 1000` |
| **M5** | `pasoEscribible` devuelve `0.01` fijo (el umbral se supone en vez de preguntarse) | 5 | `expected '1(<1%)' to be '1(<0,1%)'` |
| **M6** | `ASTILLA = 0.5 / ESCALA` (la trampa que abre subir la escala) | 2 | `expected 0.004 to be greater than or equal to 0.005` |

Ninguna sobrevivió en verde.

### Navegador — 1440 y 390, un solo servidor de desarrollo

El HTML medido es el que **pinta el componente de verdad** (volcado desde un render de
`GraficaReparto` con el caso real de 877 órdenes, en sus dos versiones: la de HEAD y la nueva), y se
inyecta en una página servida por el dev server para heredar su CSS y su tipografía (medido:
`14px Poppins` y `gap=8px`, o sea Tailwind vivo). Las animaciones se desactivan: el primer fotograma
de `grafica-barra-crece` deja la barra en `scaleX(0)` y medirla ahí da 0 px.

| viewport | versión | líneas | alto `ul` | entrada más ancha | desborde (ul / caja / li) | palabras partidas | barra |
|---|---|---|---|---|---|---|---|
| 1440 | vieja «30 %» | 1 | 20 px | 193,5 px | 0 / 0 / 0 | **0** | 1375,95 de 1376 px |
| 1440 | nueva «29,5 %» | 1 | 20 px | **205,1 px** (+11,6, +6,0 %) | 0 / 0 / 0 | **0** | 1375,95 de 1376 px |
| 1440 | nueva + espacio fino `U+202F` | 1 | 20 px | **206,9 px** (+13,4, +6,9 %) | 0 / 0 / 0 | **0** | — |
| 390 | vieja «30 %» | 5 | 116 px | 193,5 px | 0 / 0 / 0 | **0** | 325,95 de 326 px |
| 390 | nueva «29,5 %» | 5 | 116 px | **205,1 px** | 0 / 0 / 0 | **0** | 325,94 de 326 px |
| 390 | nueva + espacio fino | 5 | 116 px | **206,9 px** | 0 / 0 / 0 | **0** | — |

Las palabras se miden con `Range.getClientRects()` palabra a palabra: una palabra con rectángulos a
distintas alturas está cortada. **Cero, en las seis combinaciones.** El decimal ensancha las
etiquetas un 6-7 % y **no cambia el número de líneas** ni a 1440 ni a 390: la más ancha (206,9 px)
cabe de sobra en los 326 px útiles de 390. No hizo falta `wrap-anywhere`.

La franja más pequeña (Incidentes, 8 de 877 = 0,9 %) pasa de 13,75 → 12,38 px a 1440 y de 3,25 →
2,92 px a 390: sigue siendo un rectángulo visible, y es **más fiel** que antes (la dibujaba al 1 %).

⚠ La fila «espacio fino» no lleva medida de barra a propósito: el `replace` que inserta `U+202F`
toca también el `width: 29.6%` del `style` inline y lo invalida. Es un artefacto del guion de
medida, no un hallazgo; los anchos de texto de esa fila sí son válidos.

### El cuarto sitio que afirmaba el contrato viejo, y lo encontró el gate

`tests/components/ConteoEntregasAnillo.test.tsx` › «los pesos suman 100 % aunque el reparto no sea
exacto» **no aparecía en mi barrido** —no nombra `GraficaReparto`, monta el anillo entero— y lo cazó
`./init.sh --rapido` en la primera pasada:

```
AssertionError: expected +0 to be 100
```

Su regex `/\((\d+)\s?%\)/` sólo casaba porcentajes ENTEROS: con «33,3 %» no casaba ninguno y sumaba
cero. Ese test **era** el contrato que la ficha cambia, así que se reescribió para afirmar el nuevo:
los tres tercios dicen «33,3 %» los tres (y ninguno se lleva el «34 %» del punto sobrante), y **la
barra sigue midiendo 100 %** — medido sobre las anchuras reales de los seis `div`, no sobre el texto.
Comprobado que sigue siendo load-bearing: con la mutación M1 vuelve a caer
(`Unable to find an element with the text: /Entregadas: 1\s\(33,3\s?%\)/`).

### Gate

`./init.sh --rapido` → **`== init OK ==`**, `INIT_EXIT=0`.

- `pnpm typecheck` — verde (con `.next/dev` borrado antes: matar el dev server deja sus tipos
  generados truncados).
- `pnpm lint` — **0 errores**, 149 warnings preexistentes (`no-unused-vars` en tests ajenos).
- Tests relacionados con el cambio: **91 archivos, todos verdes** — incluidos
  `analytics-kpi-y-barra` (11), `analytics-porcentajes` (22), `AnalyticsGraficaReparto` (8),
  `AnalyticsPesoBajoUnPunto` (10) y `ConteoEntregasAnillo` (16).
- Guardias: **179 de 180 archivos**, 2.735 de 2.736 tests. El único rojo es el heredado y tolerado
  del baseline: `superficie-de-uso.guardia` › `lib/actions/tarifas.ts:67 obtenerTarifa`.
- `CrearTiendaForm` no salió rojo en ninguna de las dos pasadas del gate.

## Lo dudoso, dicho

1. **El precio no lo he decidido yo.** La suma de los textos puede decir 99,9 o 100,1 (99,9 en el
   caso reportado). El humano pidió el dato real y eso es lo que se entrega, pero el intercambio es
   suyo: si prefiere que la columna sume 100 clavado, hay que volver al número que él llamó
   equivocado. El número está arriba para que decida con él.
2. **El radio de explosión son tres gráficas, no una.** El donut y el ranking también pasan a decir
   la razón exacta. Es coherente y en ellos no cuesta geometría, pero no es lo que la ficha pedía
   literalmente.
3. **El «<1 %» se convirtió en «<0,1 %»** y desaparece de los casos donde antes salía (0,429 % ahora
   se escribe). El compromiso de la 290/291 se conserva, pero el texto que un humano vio en pantalla
   cambia.
4. **`porcentajesDeReparto` se retiró.** No lo importaba ningún consumidor (verificado por grafo y
   por `grep` sobre `.ts`/`.tsx`), sólo su propio test. Si algo fuera de esos dos lo cargaba de forma
   dinámica, no lo he visto.
5. **Ajeno a la ficha, visto de paso:** `lib/repositories/ConteoEntregasRepository.ts` tiene dos
   `console.log('xyz query params', …)` / `console.log('xyz query', …)` de depuración vivos en el
   camino de la consulta. Es backend y no lo he tocado.
6. **No hay medida contra la base de producción.** El MCP de Supabase no está en mi juego de
   herramientas, así que el reparto real de los seis desenlaces se reconstruyó de lo que quedó
   escrito de la pantalla (877 órdenes, 259 entregadas, 38,7 % de efectividad de gestión → 80
   rechazadas) y el resto se barrió con 20.000 variantes. El segmento que el humano miró —el único
   cuyo valor exacto se conoce— es el que se afirma en el test.
