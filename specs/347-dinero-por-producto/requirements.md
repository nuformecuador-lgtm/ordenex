# Ficha 347 — Cuánta plata movió cada producto, y cómo se dividió

> Requisitos en notación EARS. Sin detalles de implementación: el CÓMO vive en `design.md`;
> el desglose, en `tasks.md`. Cada `R<n>` termina mapeado a un test concreto
> (`tasks.md § Trazabilidad`).

## Contexto

Dos pedidos del humano el 2026-09-01, sobre la MISMA superficie: la tabla de productos de
`/analitica` que trajo la ficha 345 y arregló la 346.

**A) El dinero.** Textual: «falta saber cuanto dinero se ha podido recaudar de las entregas que
se han hecho de ese producto y cual es el desgloce de ese dinero, es decir cuanta plata se
recogio y esa plata que se recogio como se dividio entre ordenes y la tienda».

**B) La claridad.** Textual, viendo la tabla ya desplegada: «falta claridad en que es la columna
de otros resultados». La columna dice CUÁNTAS pero no QUÉ son.

Esta ficha **levanta el límite de la 345** («nada de dinero por producto»). El límite pasa a ser
otro: **no inventar el reparto**.

### Lo MEDIDO en producción antes de escribir este spec (dado por cierto, no re-medir)

1. **El dinero se cobra por ORDEN**, y **el 12 % de las órdenes lleva varios productos**. **No
   existe el precio unitario en ninguna parte**: `orden.producto` sólo trae `cantidad * nombre`.
2. Restringirse a órdenes de un solo producto **vacía los productos grandes**:
   `BASE C` — 19 entregadas, **1 sola** iba sin compañía → ₡15.900 atribuibles de ₡393.433;
   `BASE DE COLAGENO | MAQUILLAJE HIDRATANTE | BASE DE ALTA COBERTURA` — 8 entregadas, **las 8
   acompañadas** → no mostraría **nada**; `Base Dr` — 23 entregadas, 17 solas, ₡344.800 de
   ₡469.186; `Creatina Monohidratada` — 9 de 9 solas, atribución perfecta.
3. **Segundo límite:** de 6 entregadas de `Crema Especial MLX`, **sólo 3 tienen la tarifa
   CONGELADA** (están dentro de un cierre). Para las otras 3, lo que se lleva Ordenex es
   **proyección, no hecho**.
4. Impacto del defecto que arregló la 346, para dimensionar por qué importa la claridad de (B):
   **37 de 86 filas producto × tienda no sumaban (43 %)**, escondiendo **105 órdenes**; la peor
   ocultaba 9.

### La DECISIÓN del humano sobre la atribución (no se reabre)

**El importe COMPLETO de la orden cuenta en CADA producto que contiene**, rotulado «recaudado en
órdenes que incluyen este producto», y **cada fila dice cuántas de sus órdenes iban
acompañadas**. Consecuencia que la pantalla **tiene que decir**: esa columna **NO se puede sumar
hacia abajo**. Descartadas explícitamente: repartir proporcionalmente (inventa precios) y
limitarse a órdenes de un solo producto (vacía productos reales).

### Lo confirmado EN EL ARCHIVO REAL (no en el índice del MCP)

1. `lib/utils/ingreso-ordenex.ts` — `derivarIngresoOrden(input, tarifa)` es **la** fórmula de lo
   que cobra Ordenex; `pagoTiendaOrdenex(totalGeneral, fleteConIva, comisionConIva)` es **la**
   fórmula de lo que se le paga a la tienda, y su docstring declara que **NO descuenta el flete
   de devolución**. `resolverFlete` elige el monto. Todo money-safe con `Prisma.Decimal`.
2. `lib/utils/aporte-por-orden.ts` — `CRITERIO_DE_APORTE`, `CRITERIO_COD_RECAUDADO`,
   `satisfaceCriterio`, `criterioDeFuente` y `aporteDeOrden`. Su cabecera declara la corrección
   de premisa: **`cierre_detail` congela las ENTRADAS de la fórmula, no los importes derivados**.
3. `lib/repositories/CierreAporteRepository.ts` — la traducción del criterio a `where` de Prisma,
   y la decisión de **replicar el `where` del feed exactamente** (la subconsulta de gestiones va
   sin `anulada_at IS NULL`, porque el productor tampoco la lleva).
4. `db/schema.prisma` — `cierre_detail` (`:2175`) congela `monto_cobrar`, `cobra_comision`,
   `es_central`, `es_zona_especial`, `tienda_id`, `tarifa_id` y las 9 columnas de tarifa; es
   INMUTABLE y se escribe **al SOLICITAR** el cierre. `cierre_dia.estado` (`CierreEstado`,
   `:1212`) es `solicitado | aprobado | rechazado | vencido`. `gestion_orden.monto_recibido`
   (`:986`) es el TOTAL recaudado en esa gestión. `@@index([ordenId])` de `cierre_detail` existe
   justamente para «trazar en qué cierres apareció una orden»: **una orden puede tener más de una
   fila congelada**.
5. `lib/analytics/metrics.ts` — `ALCANCE_PRODUCTOS` (maestro/admin `total`, `adminTienda`
   `acotado`, `adminSatelite` y `mensajero` `prohibido`) y las dos tablas de la 122.
6. `tests/unit/analytics/alcance-dinero.guardia.test.ts` — «ninguna métrica financiera declara
   alcance acotado» y «no hay adaptador de alcance para las tablas de dinero»
   (`wallet_movimiento`, `wallet_tienda_movimiento`, `pago_mensajero_movimiento`, `cierre_dia`,
   `cierre_bodega`). **Ver §1 y `design.md §3`: aquí hay un choque de doctrina que se resuelve
   en el spec, no en la implementación.**
7. `lib/services/DetalleMovimientoService.ts` — `ROL_TIENDA = "adminTienda"` y
   `verDetalleDeMiMovimiento`: **el repo YA sirve dinero acotado a la tienda**, fuera del
   catálogo de métricas.
8. `lib/analytics/entregas-conteo.ts` — `claveConPrefijo(prefijo, consulta)` compone la clave de
   caché con **filtro + rango + alcance y NADA MÁS**; `claveDeConteoHoyGestion` es el precedente
   de añadir un componente propio sin tocar el cuerpo compartido.
9. `app/(app)/analitica/_components/entregas/efectividad.ts` — `calcularEfectividad` devuelve
   `entregadas`, `rechazadas`, `otrosDesenlaces`, `enProceso`, `total` y los tres porcentajes.
10. `app/(app)/analitica/_components/entregas/ConteoEntregasAnillo.tsx` — `etiquetaDeDesenlace`
    ya existe y está **exportada**: pluraliza y capitaliza el `value` del catálogo sin tabla de
    etiquetas escrita a mano.
11. `components/shared/DataTable.tsx` — soporta `renderExpanded` + `expandAriaLabel` (fila que se
    abre), que es el patrón de las fichas 343 y 344.
12. `lib/config/moneda.ts` — `money(value: string | null)` formatea un importe **que llega como
    STRING**; `formatearValor(_, "moneda")` de `components/private/analytics/formato.ts` recibe
    un `number` y **NO sirve** para este camino.
13. `tests/fixtures/money-safe.ts` — `LLAMADAS_PROHIBIDAS_EN_DINERO`: `Number(`, `parseFloat(`,
    `parseInt(`, `.toFixed(`.

---

## 1 — Quién ve el dinero

**R1.** El sistema DEBE declarar quién puede ver el dinero por producto en UNA sola tabla rol →
alcance, **distinta** de la que gobierna el volumen, exhaustiva sobre los cinco roles lectores de
analítica, de modo que omitir un rol NO compile.

**R2.** Para CADA rol, el alcance del dinero por producto DEBE ser `prohibido` o EXACTAMENTE el
mismo que el rol tiene declarado para el volumen de productos. El sistema NO DEBE admitir ninguna
otra combinación.

> R2 es lo que cierra el choque con la guardia de dinero: el dinero **nunca** se recorta con un
> criterio propio. O se sirve con el mismo recorte que ya aplica el análisis de productos, o no
> se sirve. Ver `design.md §3`.

**R3.** MIENTRAS el actor tenga acceso total (`maestro`, `admin`), el sistema DEBE calcular el
dinero sobre las órdenes de TODAS las tiendas.

**R4.** MIENTRAS el actor sea `adminTienda`, el sistema DEBE calcular el dinero ÚNICAMENTE sobre
las órdenes de su propia tienda.

**R5.** SI el alcance del dinero para el rol del actor es `prohibido`, ENTONCES el sistema NO
DEBE devolver NINGUNA cifra de dinero por producto: ni recortada, ni agregada, ni en cero, ni
como dato ausente calculado a partir de datos reales.

**R6.** SI el alcance del dinero para el rol del actor es `prohibido`, ENTONCES el sistema NO
DEBE renderizar ninguna columna, panel ni control de dinero en la tabla de productos; y DEBE
seguir renderizando las columnas de volumen que ese rol sí tenga concedidas.

**R7.** El recorte por rol del dinero DEBE viajar en el `WHERE` de la consulta a la base, y NO
aplicarse en memoria sobre filas ya traídas.

**R8.** El sistema NO DEBE aceptar la concesión del dinero por la entrada del cliente: una clave
del filtro que pretenda concederla DEBE ser un error de validación.

**R9.** La entrada de caché de esta lectura DEBE distinguir el alcance del dinero: dos peticiones
con el MISMO filtro y el MISMO alcance de datos pero con distinta concesión de dinero NO DEBEN
compartir entrada de caché.

**R10.** CUANDO el sistema deniegue una lectura de dinero por producto, DEBE dejar rastro con el
motivo y SIN ids ajenos, PII ni contenido de la sesión, y responder al cliente sin revelar cuál
de los motivos fue.

## 2 — Qué es cada cifra

**R11.** El sistema DEBE dar, por producto y tienda, **lo recaudado**: la suma de lo que las
gestiones de ENTREGA cobraron en las órdenes del recorte que contienen ese producto.

**R12.** El sistema DEBE atribuir a cada producto el importe COMPLETO de la orden, sin repartirlo
entre los productos que la orden contenga.

**R13.** El sistema DEBE dar, por producto y tienda, **cuántas de esas órdenes llevaban más de un
producto**.

**R14.** El sistema DEBE dar, por producto y tienda, **cuánto se quedó Ordenex** de lo recaudado:
el flete y su IVA, más la comisión sobre el cobro contra entrega y su IVA.

**R15.** El sistema DEBE dar, por producto y tienda, **cuánto es de la tienda**: lo recaudado
menos lo que Ordenex le factura sobre ese recaudo.

**R16.** El sistema NO DEBE escribir NINGUNA fórmula de dinero nueva: toda cifra de esta ficha
DEBE derivarse con las funciones que ya producen el ingreso de Ordenex y el pago a la tienda en
el cierre.

**R17.** El sistema DEBE derivar el dinero de una orden a partir de las ENTRADAS CONGELADAS de
esa orden en su cierre, y NO de la tarifa vigente hoy.

**R18.** SI una orden aparece en más de un cierre, ENTONCES el sistema DEBE derivar su aporte por
CADA par (cierre, orden) con las gestiones de ESE cierre, y sumar los resultados; y NO DEBE
contar esa orden más de una vez en ningún conteo de órdenes.

**R19.** El sistema DEBE dar, por producto y tienda, **el cobro de retorno de las órdenes
rechazadas** (flete de devolución más su IVA) como una cifra APARTE, y NO DEBE incluirla en el
reparto de lo recaudado.

> Justificación, y responde a la pregunta explícita del encargo: un rechazo **no recauda** cobro
> contra entrega, así que no hay plata recogida que repartir; y la función que calcula el pago a
> la tienda **no descuenta** ese flete, por decisión ya escrita. Meterlo dentro rompería la
> igualdad de R20.

**R20.** Para todo producto y toda tienda, **lo que se quedó Ordenex más lo que es de la tienda
DEBE ser exactamente igual a lo recaudado ya liquidado**, sin margen de redondeo.

**R21.** Para todo producto y toda tienda, **lo recaudado ya liquidado más lo recaudado aún no
liquidado DEBE ser exactamente igual a lo recaudado**, sin margen de redondeo.

**R22.** Todo importe DEBE cruzar la frontera como cadena de texto con dos decimales, y el
navegador NO DEBE convertirlo a número, sumarlo, restarlo ni recalcularlo.

**R23.** El sistema NO DEBE emitir una cifra de dinero derivada de una orden cuya tarifa no esté
congelada.

**R24.** El conjunto de resultados de gestión que aportan a cada cifra DEBE derivarse de la
declaración única del criterio de aporte, y NO de una lista escrita en la consulta ni en la
pantalla.

**R25.** El sistema DEBE producir las mismas cifras para la misma entrada: sin reloj, sin orden
de llegada de filas y sin dependencia del entorno.

## 3 — Lo liquidado y lo pendiente

**R26.** El sistema DEBE distinguir el dinero LIQUIDADO —el de órdenes cuyo cierre ya fue
aprobado y tienen sus entradas congeladas— del dinero de órdenes entregadas que todavía no.

**R27.** MIENTRAS una orden entregada no esté liquidada, el sistema NO DEBE emitir para ella
ninguna cifra de reparto entre Ordenex y la tienda.

**R28.** El sistema DEBE dar, por producto y tienda, lo recaudado que aún no está liquidado y
cuántas órdenes lo componen.

**R29.** La pantalla DEBE mostrar el reparto Ordenex/tienda identificado como referido ÚNICAMENTE
a lo ya liquidado, y DEBE mostrar al lado lo que queda pendiente.

**R30.** SI un producto no tiene NINGUNA orden liquidada, ENTONCES la pantalla NO DEBE mostrar
`0,00` en el reparto: DEBE mostrar el marcador de dato ausente.

**R31.** El sistema NO DEBE proyectar, estimar ni extrapolar el reparto de una orden no
liquidada.

## 4 — El detalle orden por orden

**R32.** CUANDO se abra una fila de producto, el sistema DEBE mostrar las ÓRDENES que componen
sus cifras de dinero, con cuánto aporta cada una.

**R33.** MIENTRAS una fila esté cerrada, el sistema NO DEBE realizar ninguna lectura de su
detalle.

**R34.** CUANDO haya dos filas abiertas a la vez, cada panel DEBE mantener su propia página y su
propio estado, sin pisarse.

**R35.** El grano de una fila del detalle DEBE ser la ORDEN: si una orden aporta por varias
gestiones o por varios cierres, DEBE aparecer UNA vez con la suma de sus aportes.

**R36.** Cada fila del detalle DEBE identificar su orden por el número con el que se habla de
ella, y DEBE poder llevar a esa orden.

**R37.** Cada fila del detalle DEBE decir el resultado de las gestiones que la hicieron aportar y
si esa orden está liquidada o pendiente.

**R38.** **La suma de los aportes del detalle DEBE ser exactamente igual a la cifra de la fila**,
para cada una de las cifras de dinero.

**R39.** El detalle NO DEBE incluir órdenes cuyo aporte sea cero en TODAS las cifras de dinero.

**R40.** El número de órdenes del detalle DEBE contarlo el servidor sobre el conjunto entero, y
NO DEBE ser el número de filas de la página que se está pintando.

**R41.** El detalle DEBE paginar, con el tamaño de página y su tope tomados de la configuración y
NUNCA de un literal de pantalla.

**R42.** SI el conjunto del detalle está vacío, ENTONCES el sistema DEBE decirlo con un estado
explícito, y NO con una tabla en blanco ni con un error.

**R43.** El detalle DEBE respetar el MISMO alcance por rol que la fila: una tienda NO DEBE poder
abrir el detalle de un producto de otra tienda, ni recibir en él ninguna orden ajena.

**R44.** SI la petición del detalle nombra una tienda que el alcance del actor no le concede,
ENTONCES el sistema DEBE denegar la lectura, y NO devolver un resultado vacío.

## 5 — Que «no se puede sumar» sea comprobable

**R45.** La pantalla DEBE advertir que las cifras de dinero son de la ORDEN completa y que una
orden con varios productos cuenta entera en cada uno, de modo que la columna NO se pueda leer
como sumable.

**R46.** La pantalla NO DEBE mostrar ningún total, subtotal ni promedio al pie de ninguna columna
de dinero de esta tabla.

**R47.** El sistema DEBE impedir por verificación automática que se añada un total al pie de una
columna de dinero de esta tabla: introducirlo DEBE poner en rojo un test.

**R48.** La verificación de R47 DEBE incluir una autocomprobación que demuestre que detectaría un
total introducido a propósito; sin ella, la verificación no cuenta como cumplida.

**R49.** El archivo descargable DEBE decir en el encabezado de cada columna de dinero que esa
columna no es sumable, porque el aviso de pantalla no viaja con el archivo.

## 6 — «Otros resultados»: qué son, no cuántas

**R50.** La tabla DEBE mostrar, junto al conteo de «Otros resultados» de cada fila, **de qué
desenlaces se compone**, con su nombre y su cantidad.

**R51.** La composición DEBE derivarse del desglose por desenlace que la respuesta ya trae, y NO
de una lista de desenlaces escrita en la pantalla, en la etiqueta ni en el archivo.

**R52.** CUANDO el catálogo gane un desenlace nuevo, ese desenlace DEBE aparecer en la
composición sin tocar la pantalla.

**R53.** La composición NO DEBE incluir los desenlaces que ya tienen columna propia, ni las
órdenes que todavía no tienen desenlace.

**R54.** SI el conteo de «Otros resultados» de una fila es cero, ENTONCES la pantalla NO DEBE
pintar ninguna composición para esa fila.

**R55.** La composición DEBE nombrar cada desenlace con su etiqueta legible y NUNCA con el valor
interno del catálogo, reutilizando el mecanismo de etiquetas que ya existe.

**R56.** El orden de la composición DEBE ser determinista: la misma fila DEBE producir siempre el
mismo texto.

**R57.** La composición DEBE ser legible sin apuntar, sin pasar el cursor por encima y sin abrir
nada: DEBE estar disponible en un teléfono táctil.

**R58.** El archivo descargable DEBE incluir la composición de «Otros resultados» sin añadir una
columna por desenlace, de modo que un desenlace nuevo del catálogo NO cambie el número ni el
orden de las columnas del archivo.

## 7 — La pantalla

**R59.** Las cifras de dinero DEBEN responder al MISMO filtro (rango y facetas) que el resto de
la sección de entregas, y DEBEN releerse cuando el filtro cambie.

**R60.** CUANDO se pulse el control de actualizar de la analítica, las cifras de dinero y el
detalle abierto DEBEN volver a leerse de la base y no servirse de la lectura guardada.

**R61.** MIENTRAS la lectura esté en curso, la pantalla DEBE mostrar un estado de carga y NO
ceros ni importes de la lectura anterior.

**R62.** SI la lectura falla, está denegada o la sesión no es válida, ENTONCES la pantalla DEBE
mostrar el mensaje que corresponda a ese estado y NO una tabla con importes en cero.

**R63.** Los importes DEBEN pintarse completos: la pantalla NO DEBE truncar, recortar ni abreviar
ninguna cifra de dinero en ningún ancho de pantalla.

**R64.** Las cifras de dinero DEBEN estar disponibles en la vista de teléfono con el mismo
detalle que en la de escritorio: ni un dato menos.

**R65.** La pantalla DEBE mostrar el instante en que estas cifras se leyeron de la base.

## 8 — La descarga

**R66.** El archivo de la tabla de productos DEBE incluir las cifras de dinero cuando el actor
las tenga concedidas.

**R67.** SI el actor no tiene el dinero concedido, ENTONCES el archivo NO DEBE contener ninguna
columna de dinero, ni vacía ni en cero.

**R68.** El archivo DEBE contener EXACTAMENTE las columnas declaradas y en el orden declarado.

**R69.** El archivo NO DEBE contener ningún identificador interno (uuid), ni correo, ni teléfono,
ni ruta de almacenamiento.

**R70.** El archivo DEBE escribir un importe ausente como celda vacía, y NUNCA como `0`.

**R71.** El archivo DEBE salir de las MISMAS filas que la pantalla está mostrando, sin una
segunda consulta a la base.

**R72.** El detalle orden por orden DEBE poder descargarse, con su propio contrato de columnas y
del producto abierto, no del recorte entero.

## 9 — Frontera, coste y caché

**R73.** SI la entrada no valida, ENTONCES el sistema NO DEBE consultar la base ni resolver el
alcance.

**R74.** El sistema DEBE excluir de todo cálculo las órdenes borradas.

**R75.** El sistema NO DEBE escribir una versión nueva de las condiciones de recorte del tablero:
DEBE reutilizar las que ya existen.

**R76.** El sistema DEBE acotar por configuración cuántas órdenes puede traer esta lectura, y SI
el recorte las supera, ENTONCES DEBE decirlo con un estado explícito y NO servir una cifra
calculada sobre un conjunto truncado.

**R77.** El sistema DEBE servir esta lectura desde la caché de lecturas vivas de la analítica,
con una clave de prefijo PROPIO que no colisione con las otras lecturas de la sección, y su tag
DEBE quedar cubierto por el control de actualizar.

**R78.** Las cifras de dinero y las de volumen de una misma fila DEBEN corresponder al MISMO
instante de lectura: la pantalla NO DEBE poder mostrar en una misma fila un conteo de un corte y
un importe de otro.

**R79.** El sistema NO DEBE añadir tabla, columna, índice, migración ni política de seguridad a
nivel de fila: esta ficha SÓLO LEE.

---

## Preguntas abiertas

**Q1 — Qué cuenta como «recaudado»: ¿sólo las entregas, o todo lo cobrado?**
El pedido dice «de las entregas que se han hecho de ese producto», y el diseño toma eso al pie de
la letra: `monto_recibido` de las gestiones cuyo resultado es `entregada`. Pero el ledger por
tienda acumula `monto_recibido` de **toda** gestión del cierre, entregada o no
(`CRITERIO_COD_RECAUDADO` en `lib/utils/aporte-por-orden.ts`), así que un abono cobrado en una
reprogramación **existe en la wallet y no aparecería aquí**. **No hay medición** de cuántas
gestiones no-entregadas tienen `monto_recibido > 0` en producción: es dato desconocido y no se
inventa. ¿Se prefiere (a) sólo entregas —lo especificado—, (b) todo el recaudo con el rótulo
cambiado, o (c) las dos cifras?

**Q2 — Qué es «liquidado»: cierre APROBADO, o basta con que exista el snapshot.**
El diseño exige **cierre aprobado**, porque es el instante en que el dinero se mueve de verdad
(es de donde salen los movimientos de wallet que la 344 explica). Pero `cierre_detail` se escribe
al **solicitar**, así que hay un tercer estado —snapshot congelado, cierre aún sin aprobar— en el
que la tarifa ya no puede cambiar pero el dinero no ha salido. La medición del encargo («sólo 3
de 6 tienen la tarifa congelada») no distingue los dos. ¿Se acepta que un cierre solicitado y no
aprobado cuente como PENDIENTE?

**Q3 — Las gestiones anuladas en el dinero.**
Se replica el `where` del feed **exactamente**, que es la decisión escrita y probada de la 344: la
subconsulta de gestiones del cierre va **sin** `anulada_at IS NULL`, porque el productor del
importe tampoco la lleva. Consecuencia visible: la columna de desenlace de la misma fila **sí**
usa sólo gestiones vigentes (regla de la 345), así que una gestión anulada después de aprobar el
cierre puede aportar dinero sin aparecer en el conteo de entregadas. ¿Se acepta esa asimetría —es
lo que de verdad pasó con la plata— o se prefiere que el dinero ignore las anuladas y deje de
cuadrar con la wallet?

**Q4 — El tope de órdenes de la lectura de dinero.**
El análisis de volumen está acotado por el CATÁLOGO de productos (R57 de la 345); el de dinero no
puede estarlo: hay que derivar orden por orden. R76 exige un tope configurable, pero **no hay
número escrito en el repo**. Con las 768 órdenes medidas hoy no hay problema. ¿Qué número se pone
—y en qué momento esto pasa a ser un rollup?

**Q5 — ¿La descarga del detalle entra en esta ficha?**
El humano pidió el detalle orden por orden; la descarga del detalle es precedente de la 344, no
un pedido de esta ficha (R72). Es la pieza más barata de recortar si se quiere reducir alcance:
cuesta un contrato de columnas con su `toEqual` a mano y una entrada más en dos censos vivos.
¿Se queda?

**Q6 — El rótulo de lo que se queda Ordenex.**
El diseño usa «Cobró Ordenex» y «Para la tienda». No son términos que existan hoy en pantalla con
ese nombre exacto —la wallet los llama «Flete», «Comisión COD» y «Pago a la tienda»—. ¿Se
prefieren los nombres de la wallet, aun a costa de que la fila lleve cuatro columnas en vez de
dos?

**Q7 — Un producto puede tener dinero y no tener fila.**
Si el parser produjera para una orden liquidada una clave que no existe entre las filas de
volumen del mismo recorte, ese dinero no tendría dónde pintarse. Con una sola lectura y un solo
parser eso no puede pasar por construcción, y el diseño lo aprovecha (§4). Queda escrito por si
alguien propone volver a separarlo en dos lecturas: entonces sí podría pasar, y haría falta
decidir qué se hace con ese dinero huérfano.
