# Ficha 360 — los KPI de porcentaje dicen sobre qué número se calculan

Rama `feature/360-kpi-con-su-base`, worktree `R:\wt\349`. Sólo capa de presentación: ni backend,
ni base, ni rutas de API.

## El pedido

> «es importante que estos KPI de porcentajes muestren el número sobre el cual toman los
> porcentajes, eso daría un dato mucho más exacto; puede ser ahí mismo en el KPI pero con una
> fuente más pequeña»

Sobre la fila de `/analitica` › «Detalle · Movimiento de las órdenes»: «Efectividad de entrega
29,5 %» y «Efectividad de la gestión 38,7 %» no decían de cuántas órdenes salían.

## Qué gana base y qué no

| KPI / cifra | ¿Base? | Por qué |
|---|---|---|
| **Efectividad de entrega** (`KpisEfectividad`) | **Sí** — «(877 órdenes)» | Es el caso reportado. |
| **Efectividad de la gestión** (`KpisEfectividad`) | **Sí** — «(entregadas y rechazadas de 877 órdenes)» | Ídem, y además nombra su numerador (abajo). |
| «Entregadas» y «En proceso» (misma fila) | No | Su cifra YA **es** un conteo de órdenes. Un «(877 órdenes)» junto a un «259» sería el denominador de nada. |
| «Ciclo de vida promedio» (misma fila) | Ya la tenía | No se le añade nada: se le cambia **de dónde sale el texto** (módulo compartido). |
| Tabla de productos: «Efectividad de entrega» y «% de rechazo» por fila | **No** | **Su base ya está en pantalla, en la misma fila**: la columna «Órdenes». Está medido, no supuesto — `ProductosTabla.test.tsx` › «FICHA 346 · las columnas de conteo suman la columna Órdenes» comprueba sobre las CELDAS PINTADAS que `entregadas + rechazadas + otros + en proceso = Órdenes`, y en ese mismo caso los dos porcentajes son 3/24 = 12,5 % y 2/24 = 8,3 %. Repetir «de 24 órdenes» dentro de dos celdas sería escribir un número que ya está seis columnas a la izquierda, en una tabla de **diez columnas** que a 390 px ya lleva dos arreglos apilados (ficha 348). Ahí la base no informa: estorba. |
| «Tasa de entrega» del tablero operativo (`catalogo-paneles.ts`) | **No, y es otra ficha** | Dos motivos, los dos medidos. (1) Es un **gráfico de líneas**, no una tarjeta: la base sería un dato por punto, que pide tooltip, no rótulo. (2) Su denominador **no son órdenes sino GESTIONES** — `lib/analytics/metrics.ts:349` lo dice con todas las letras: «una orden reprogramada y luego entregada aporta dos gestiones». Escribir ahí «(N órdenes)» sería exactamente el dato decorativo-y-falso que esta ficha combate. Además el agregado del periodo ya modela su denominador aparte (`TotalTablero.sinGestiones`, ficha 182): darle base es tocar ESE contrato, con su propio rótulo y su propia decisión. |
| Ranking (`/ranking`, `/ranking/historico`) | No | Ya lleva su base en la columna de al lado: «conteo crudo (entregadas/asignadas)». |
| Anillos y barras (`GraficaDonut`, `GraficaReparto`, `GraficaRanking`) | No | `textoDePeso` ya escribe el conteo junto al porcentaje («Detalle gestión · 877»). |
| `BarraComposicionCaja` (`/wallet`) | No | No es un KPI de porcentaje: es una banda de composición, y su nombre accesible ya enuncia las dos porciones con su importe. |

Barrido hecho sobre `unidad="porcentaje"` / `formatearValor(_, "porcentaje")` en `app/` y
`components/`, y sobre las nueve apariciones de `<KpiCard`.

## Cómo se garantiza que la base sale del MISMO sitio que el porcentaje

`calcularEfectividad(porStatus)` devuelve `total` **en el mismo objeto** que `efectividad` y
`efectividadGestion`, y el componente lo destructura de esa única llamada. La otra fuente posible
—`datos.total`, que el DTO trae HECHO— **hoy vale exactamente lo mismo** (`ConteoPorStatusDTO`
promete que es la suma de los `conteo`), y por eso un test que se limite a comparar cifras pasa
igual lea la que lea.

El test que lo ata mete a propósito un DTO **descuadrado** (`porStatus` suma 100, `total` dice
999) y exige que el rótulo diga «(100 órdenes)». No es un caso real y el test lo dice: es una
sonda, y es la única forma de distinguir las dos fuentes.

Lo que ese test **no** puede distinguir, dicho: una re-suma local de `porStatus` daría el mismo
número siempre, así que es indistinguible por comportamiento. Contra eso sólo hay el comentario
del archivo.

## La segunda decisión: el numerador de «Efectividad de la gestión»

`efectividadGestion = (entregadas + rechazadas) / total`. Comparte denominador con su vecina —a
propósito, para que la diferencia entre las dos sea el peso de los rechazos— pero **no comparte
numerador**.

Poner la base sola convertía la mejora en trampa: con «38,7 %» y «(877 órdenes)» a la vista,
cualquiera multiplica y obtiene 339; sin decir de qué son, la lectura natural es «339 entregadas»,
que **contradice el 259 de la tarjeta de al lado**. Así que el rótulo lo nombra:
«(entregadas y rechazadas de 877 órdenes)».

No se escribe la fórmula. Un rótulo de KPI se lee de un vistazo, no se resuelve; basta con que
nadie deduzca un numerador equivocado.

## Una sola manera de escribir una base

`app/(app)/analitica/_components/entregas/base-del-kpi.ts` (nuevo). Compone las cuatro bases de la
fila: la cifra pasa por `formatearValor(_, "conteo")` —como ya hace el resto de la analítica al
escribir conteos en prosa (`ProductosTabla.textoUniverso`)—, el sustantivo concuerda con su cifra
y el texto va entre paréntesis al final del rótulo.

`CicloVidaKpi` se reengancha a ese módulo. Antes componía su base con un `${}` local; era la única
tarjeta con base y ahora son tres, en dos archivos distintos. Efecto lateral medido y buscado: su
base pasa a llevar separador de miles, así que un periodo de 1.234 órdenes ya no se lee
«(1234 órdenes cerradas)» al lado del «1 234» de la tarjeta vecina.

Lo que **no** se hizo: ni línea suelta debajo de la tarjeta (se probó y se retiró el 2026-08-19),
ni `<span>` con tamaño propio dentro del rótulo (`KpiCardProps.etiqueta` es `string` y ese mismo
string alimenta el `sr-only` del estado de carga; meterle un nodo sería un segundo mecanismo).
La «fuente más pequeña» que pidió el humano ya la da el patrón: el rótulo es `text-sm` (14 px)
frente a los `text-2xl` de la cifra.

## Los dos estados frágiles

Regla, la misma que ya cuidaba `CicloVidaKpi`:

- consulta **en vuelo** o **error** → **ninguna base**. Un «(0 órdenes)» ahí es una afirmación de
  negocio que nadie ha hecho.
- `n = 0` → **sí** se escribe «(0 órdenes)», porque es lo que **explica el guion** de la cifra:
  no es que falte el dato, es que no entró ninguna orden.

Ojo a la condición: **no** es `hayDato` (que pide `total > 0` para decidir si se pinta la CIFRA),
sino `datos !== null && mensaje === null`.

## Navegador — medido, no razonado

Servidor de desarrollo levantado en este worktree, uno solo, y **apagado al terminar**.

⚠ **`pnpm dev` (Turbopack) NO ARRANCA en un worktree con `node_modules` por junction**: panic
`Symlink [project]/node_modules is invalid, it points out of the filesystem root`. Se arranca con
`pnpm exec next dev --webpack` y funciona. Y hay que navegar a **`localhost`**, no a `127.0.0.1`:
con la IP, Next bloquea `/_next/webpack-hmr` por *cross-origin dev resource*, la app **no
hidrata**, el submit del login sale nativo (`GET /login?`) y no se registra ni un POST. (La receta
de la memoria decía «espera tras networkidle»; hace falta además que la espera vaya **antes** de
rellenar los campos.)

Sonda: se entra por el rótulo, se sube a su `Card` y de ahí a la fila; el partido de palabras se
mide con `Range.getClientRects()` por término (dos `top` distintos = palabra partida).

**1440 px** — fila `grid … items-start … lg:grid-cols-5`, columnas de **208 px**:

| tarjeta | alto | rótulo | líneas | partidas |
|---|---|---|---|---|
| Efectividad de entrega (67 órdenes) | 148 | 40 px | 2 | — |
| Efectividad de la gestión (entregadas y rechazadas de 67 órdenes) | 148 | 80 px | 4 | — |
| Entregadas | 148 | 20 px | 1 | — |
| En proceso | 148 | 20 px | 1 | — |
| Ciclo de vida promedio (9 órdenes cerradas) | 148 | 40 px | 2 | — |

`tops` = {267} y `bottoms` = {415}: **las cinco empiezan y acaban a la misma altura**. No hay alto
roto ni fila dentada. `overflow-wrap: normal`, `word-break: normal`, `scrollWidth == clientWidth`:
**ni una palabra partida y ningún desbordamiento**. Comprobado también que **`wrap-anywhere` no
llega a estos rótulos** — el aviso de la ficha era pertinente y la clase no está.

**390 px** — una columna de 310 px. Alturas 88 / **108** / 88 / 88 / 108. El rótulo de la gestión
ocupa 2 líneas. Sin partidas y sin desbordamiento.

**Control «sin la ficha»** (mismos rótulos, sin base, forzados por DOM): fila de **108 px** a 1440
y **524 px** a 390. Es decir, el coste medido es **+40 px a 1440** y **+20 px a 390**, y sale
entero del rótulo de la gestión (4 líneas en 208 px).

**Peor caso forzado** (base de cinco cifras, «12 345»): a 1440 la fila **sigue en 148 px** y a 390
**sigue en 544**. La base más larga no empeora nada.

**Alternativas medidas para acortar el rótulo de la gestión** (columna real de 208 px):

| texto | líneas @1440 | fila | ¿desborda? |
|---|---|---|---|
| `… (entregadas y rechazadas de 877 órdenes)` **(elegido)** | 4 | 148 | no |
| `… (entregas y rechazos de 877 órdenes)` | 3 | 128 | no |
| `… (entregadas+rechazadas de 877 órdenes)` | 3 | 128 | **SÍ** |
| `… (877 órdenes)` (sin numerador) | 2 | 108 | no |

Se descarta `entregadas+rechazadas`: el token de 21 caracteres **desborda la tarjeta** a 1440. Se
descarta `entregas y rechazos` pese a ahorrar 20 px: «entregas» y «rechazos» son **gestiones**, y
ése es justo el vocabulario del denominador del OTRO indicador de la pantalla (`tasa_entrega`).
Aquí el numerador son **órdenes** clasificadas por su último desenlace; el ahorro de una línea no
paga sugerir un denominador que no es.

Queda dicho como lo dudoso de la ficha: 4 líneas de rótulo sobre 1 de cifra es denso, y quitar el
numerador lo dejaría en 2 líneas. Es la única palanca que un humano podría querer mover, y la
tabla de arriba dice exactamente lo que cuesta.

## Mutaciones — 6 aplicadas, 6 muertas, 0 supervivientes

Cada una se aplicó con autocomprobación (la mutación se verifica en disco antes de correr) y se
revirtió. Ninguna sobrevivió en verde.

| # | Mutación | Cae en |
|---|---|---|
| 1 (obligatoria) | La base sale de **otra fuente**: `rotuloEfectividad(datos?.total ?? 0)` | `KpisEfectividad.test.tsx` › «la base sale de la misma cuenta que el porcentaje, no del `total` del DTO» — *Unable to find … «Efectividad de entrega (100 órdenes)»* |
| 2 (obligatoria) | Se escribe **mientras carga**: `seConoceLaBase = mensaje === null` | ídem › «con la consulta EN VUELO no escribe ninguna base» — *Unable to find … «Efectividad de entrega»* (aparece con base) |
| 3 | Con `n = 0` **desaparece**: `seConoceLaBase = hayDato` | ídem › «con cero órdenes SÍ escribe la base» — *Unable to find … «Efectividad de entrega (0 órdenes)»* |
| 4 | El rótulo de la gestión **deja de nombrar su numerador** | 5 casos, entre ellos › «la de gestión nombra su numerador» — *Unable to find … «(entregadas y rechazadas de 877 órdenes)»* |
| 5 | La cifra **no pasa por `formatearValor`** (`${n}` crudo) | `KpisEfectividad` › «la base lleva el separador de miles…» y `CicloVidaKpi` › «la base pasa por el formateador…» — *Unable to find … «(1 234 órdenes)»* |
| 6 | El sustantivo **deja de concordar** (siempre plural) | `KpisEfectividad` › «concuerda en singular…» y `CicloVidaKpi` › «concuerda en singular…» — *Unable to find … «(1 orden)»* |

Nota de proceso: el revert automático de la mutación 4 **se negó** («2 coincidencias de la cadena
origen») en vez de restaurar a ciegas la cadena equivocada; se restauró a mano y se reconfirmó el
verde antes de seguir. Las mutaciones 5 y 6 se **repitieron sobre árbol limpio**, porque la
primera pasada corrió con la 4 aún aplicada y sus fallos estaban contaminados.

## Verificación

- `pnpm typecheck` — **verde**, sin salida.
- `pnpm lint` — **0 errores**, 145 warnings, todos preexistentes (`no-unused-vars` en tests).
  No aparece el rojo heredado de `superficie-de-uso`.
- `pnpm exec vitest run tests/components/{KpisEfectividad,CicloVidaKpi,ProductosTabla}.test.tsx
  tests/unit/analytics/` → **168 archivos, 2.142 tests, todos verdes**.
- Navegador: arriba.

Un test preexistente hubo que **actualizarlo**, y es señal correcta: `Las tarjetas de efectividad`
› «pintan el porcentaje y las dos cifras» asertaba `getByText("Efectividad de entrega")` con match
**exacto**, y la base entrando lo puso en rojo. Se reescribió al rótulo entero (no a una
subcadena, que habría anulado la aserción) y se le añadió que las dos tarjetas de conteo **no**
llevan base.

## Lo dudoso, en una lista

1. **4 líneas de rótulo** en la tarjeta de gestión a 1440 (+40 px de fila). Medido, no roto, pero
   denso; la tabla de alternativas dice qué cuesta cada recorte.
2. La **re-suma local de `porStatus`** como fuente de la base es indistinguible por
   comportamiento: ningún test puede cazarla.
3. `page.tsx` documenta `items-start` «para que una tarjeta de dos líneas no se estire al alto de
   la de al lado». **Medido: no es lo que pasa** — `KpiCard` lleva `h-full`, que resuelve contra
   el área de la fila, así que las cinco tarjetas miden 148 px igual. No se toca (no es de esta
   ficha y el resultado visible es bueno), pero el comentario describe algo que no ocurre.
4. Turbopack no arranca en worktree con `node_modules` por junction. Es un obstáculo de
   herramienta, no de esta ficha, pero volverá a costarle la vuelta a quien lo intente.

## Archivos

Creados:
- `app/(app)/analitica/_components/entregas/base-del-kpi.ts`
- `progress/impl_360.md`

Modificados:
- `app/(app)/analitica/_components/entregas/KpisEfectividad.tsx`
- `app/(app)/analitica/_components/entregas/CicloVidaKpi.tsx`
- `tests/components/KpisEfectividad.test.tsx`
- `tests/components/CicloVidaKpi.test.tsx`

Sin commit: lo hace el leader.
