# Ficha 393 — El cierre de bodega cuenta la historia entera, en dos cascadas

> Requisitos en notación EARS. Sin detalles de implementación: el CÓMO vive en `design.md`;
> el desglose y las mutaciones, en `tasks.md`. Cada `R<n>` termina mapeado a un test concreto
> (`tasks.md § Trazabilidad`).
>
> **Revisión 2 (2026-09-08).** El humano explicó **para qué sirve** el número de la cascada B, y eso
> cambia su rango, su rótulo y dónde tiene que vivir. Ver «El pedido del 2026-09-08» más abajo.

## Contexto

Pedida por el humano el 2026-09-08 con dos capturas —la tarjeta del listado de cierres de bodega y
el panel «Detalle del cierre de bodega»—. Su frase: *«tiene que ser más claro… y según lo que veo
me falta info»*.

El corazón de la ficha es que **el orden que el humano describió y la contabilidad del sistema no
coinciden**, y las dos lecturas son verdad. Se le plantearon con cifras reales y eligió **las dos**:
*«creo que las 2 porque entre más detallado sea mucho mejor, así la gente sabe qué plata es para
quién»*. Van **separadas y rotuladas, nunca mezcladas** — mezcladas es como están hoy.

**Cascada A — de quién es el dinero** (medida sobre el cierre `ae93cdcd-…-4e803514934d`):
se recogió 126.089 → menos lo que cobra Ordenex 27.134,83 → **= para la tienda 98.954,17**;
y de lo de Ordenex: menos mensajeros 14.000, menos bodega 0 → **= neto de Ordenex 13.134,83**.

**Cascada B — lo que la satélite le entrega a la central:** se recogió 126.089 → menos el pago a
mensajeros 14.000 → menos lo que gana la satélite por rechazos 0 → **= 112.089**.

### El pedido del 2026-09-08 — para qué sirve el número

> *«Las satélite descuentan de lo que le deben entregar a la central el pago a los mensajeros, pero
> ese dato —la resta del total menos lo de los mensajeros y menos lo que gana la satélite— no se ve
> en ningún cierre, ni en la central ni en la de las satélite.»*

Esto **no es una mejora de claridad: es un número que hace falta para operar.** No es «lo que queda
en caja» ni «lo que queda tras los pagos»: es **lo que la satélite le entrega a la central**, que es
literalmente lo que la persona va a hacer con ese dinero. Y de ahí salen tres consecuencias que
gobiernan el resto de este documento:

1. **Tiene que estar en LA TARJETA, en las dos pantallas.** La bodega satélite **sólo ve la
   tarjeta**: su módulo (`ConsolidacionBodegaModule.tsx:442,450`) monta
   `CierresBodegaSolicitadosLista` **sin acción de abrir detalle**. Si el número vive en el panel, la
   satélite no lo ve nunca — y es precisamente ella quien lo necesita.
2. **La cascada A se queda en el detalle**, que es donde mira la central. Así la satélite ve **lo
   suyo** y nadie ve un margen que no le toca. Resuelve la pregunta de exposición sin un mecanismo
   nuevo.
3. **La fórmula ya está verificada y no calcula nada nuevo:**
   `total_general − total_pago_mensajero − total_ingreso_bodega_rechazos`. Los dos descuentos son
   exactamente los dos que la bodega registra, y **los dos ya existen como snapshots**.

---

## Lo confirmado EN EL ARCHIVO REAL (no en el índice del MCP, que devuelve de más)

Todo lo de abajo se leyó en disco el 2026-09-07/08. Es la base del diseño; si algo de esto fuera
falso al implementar, **PARAR**.

1. **`db/schema.prisma:1346-1374` — `cierre_bodega`** ya trae como SNAPSHOT `total_efectivo`,
   `total_simpe`, `total_transferencia`, `total_general`, `total_pago_mensajero` y
   `total_ingreso_bodega_rechazos`. `cierre_dia` (`:1291-1338`) trae los mismos seis.
2. **`db/schema.prisma:2229-2290` — `cierre_detail` congela las ENTRADAS de la fórmula**
   (tarifa, `monto_cobrar`, `cobra_comision`, `es_central`, `es_zona_especial`, `tienda_id`),
   **NO los conceptos derivados**. No existe columna con el ingreso de Ordenex por orden.
3. **`lib/utils/ingreso-ordenex.ts:145-187` — `derivarIngresoOrden`**: sólo `entregada` deriva
   flete + IVA + comisión + IVA; **sólo `rechazada`** deriva flete por rechazo + IVA; `devuelta` y
   `reprogramada` no derivan nada (ficha 301).
4. **`lib/utils/ingreso-ordenex.ts:282-320` — `totalesIngresoOrdenex`** suma esos conceptos por
   cierre con `Prisma.Decimal` y emite STRING escala 2. De ahí:
   `total = fleteConIva + comisionConIva + fleteDevolucionConIva`.
5. **`lib/utils/ingreso-ordenex.ts:352-358` — `pagoTiendaOrdenex` YA EXISTE**:
   `total_general − fleteConIva − comisionConIva`. **NO** resta el flete por rechazo, y su
   docstring dice por qué: un rechazo no recauda COD, así que ese dinero nunca entró en el total
   general.
6. **`lib/utils/ingreso-ordenex.ts:334-336` — `gananciaOrdenex` YA EXISTE**:
   `ingresoTotal − pagoMensajero`. **NO** resta `total_ingreso_bodega_rechazos`.
7. **`lib/services/CierresBodegaAdminService.ts:262-333`** ya devuelve `pagoTienda` y `ganancia`,
   agregados y por cada `cierre_dia`.
8. **`app/(app)/cierres-admin/_components/CierresBodegaAdminModule.tsx:520-640`** ya pinta
   «Pago a tienda» (`:564-569`) y «Ganancia» (`:550-555`) en el detalle. ⚠️ **La premisa original de
   la ficha —«los dos números no existen en ninguna pantalla»— es FALSA para el detalle**: existen,
   pero al final, sueltos, sin cascada y con nombres que no son los que el humano usa. **Lo que NO
   existe en ninguna parte es el número de la cascada B**, y eso sí es exacto.
9. **La tarjeta es `HojaResumen`** (`app/(app)/cierres-admin/_components/cierre-factura.tsx:596-784`),
   **compartida por CUATRO superficies**: cierre de mensajero (`:501`), cierre de bodega (`:800`),
   cierre propio del mensajero (`:848`, `audiencia="mensajero"`) y `cierre_dia` consolidable
   (`:890`). Sus tres columnas son `RESUMEN_METODOS_TITULO` / `RESUMEN_AJUSTES_TITULO` /
   `RESUMEN_FECHAS_TITULO` (`:206-208`), y la de «Ajustes» (`:736-752`) contiene el pago al
   mensajero y el ingreso de bodega por rechazos: **ninguno de los dos es un ajuste**.
10. **La tarjeta sólo recibe el SNAPSHOT** (`CierreBodegaResumen`,
    `lib/interfaces/services/ICierreBodegaService.ts:22-36`): totales por método, general,
    `totalPagoMensajero`, `totalIngresoBodegaRechazos`, `cantidadCierres`, fechas y motivo.
    **Los tres sumandos de la cascada B están; ninguno de los de la cascada A.**
11. **Las tres identidades del snapshot agregado se establecen al solicitar**
    (`lib/services/CierreBodegaService.ts:42-80,442-446`: `sumTotales`, `sumPagoMensajero`,
    `sumIngresoBodega` sobre los mismos `cierre_dia` que se vinculan en la misma transacción) y
    **nadie las mueve después**: `resolverCierreBodega`
    (`lib/repositories/CierresBodegaAdminRepository.ts:426-474`) «NO toca cierre_dia», y la
    corrección del desglose (`lib/repositories/CierresAdminRepository.ts:1339-1411`) exige
    `estado IN ESTADOS_ABIERTOS`, mientras que un consolidable es `aprobado`.
12. **`lib/utils/aporte-por-orden.ts:55-76` — el catálogo TOTAL de categorías de caja NO tiene
    ninguna del ingreso de bodega.** Y `specs/56-ingreso-bodega-rechazos/requirements.md:56-57` lo
    dice con todas las letras: la 56 *«sólo CALCULA / SNAPSHOTEA / MUESTRA el ingreso de bodega;
    NO lo asienta en ninguna caja ni ejecuta movimiento de dinero»*.
13. **`lib/utils/pago-mensajero.ts:13-23` — `pagoPorResultado` paga un importe FIJO por `entregada`
    (`tarifa.cobroEntregado`), INDEPENDIENTE de lo que se recaudó.** Y `computeTotales`
    (`lib/utils/cierre-totales.ts:77-105`) suma sólo las líneas de pago de las entregadas: una
    entrega sin líneas (orden prepagada, `monto_cobrar` nulo) **aporta cero al total y aun así
    paga**. De ahí sale, por construcción, el caso negativo de R36 — no es una hipótesis.
14. **El sistema YA modela «el efectivo no alcanzó»**: `repartirEfectivo` +
    `CENTRAL_DEBE_LABEL` / `CENTRAL_DEBE_NOTA` (`lib/services/CierreBodegaService.ts:96-127`,
    `cierre-detalle-shared.tsx:264-266`), **pero sólo ANTES de solicitar**, en la pantalla de
    consolidación. Un cierre de bodega ya creado no lo calcula.
15. **`tests/components/DineroIdentidadesEnPantalla.test.tsx`** (ficha 359) es el archivo que
    afirma que las restas cierran **leyendo lo pintado**, con un censo cerrado de 13 pantallas.
16. **`tests/unit/guards/flete-por-rechazo-censo.guardia.test.ts`** (ficha 338) es el precedente
    exacto de cómo se retira un nombre de dinero de toda la app, con autocomprobación.
17. **`app/(app)/cierres-admin/_components/cierres-bodega-descarga-columnas.ts:53-144`**: los
    cuatro listados proyectan `general`, `pagoMensajero` e `ingresoBodega`.

### Las dos trampas que esto destapa, y que son el diseño

**Trampa 1 — «lo que cobra Ordenex» son DOS números, no uno.** La identidad
`recaudado = lo que cobra Ordenex + para la tienda` sólo se cumple con el subconjunto DEDUCIBLE
(flete + IVA y comisión + IVA, de las entregadas). El **flete por rechazo + IVA** se le factura a
la tienda pero **no sale de lo recaudado** (hallazgos 3 y 5). Por eso, en un cierre con rechazos,
«recaudado − ingreso bruto» **NO da** «para la tienda», y una cascada que empiece por el bruto
enseña una resta que no cierra. La cascada A necesita una **línea puente** (R10).

**Trampa 2 — «Neto de Ordenex» NO es la «Ganancia» de hoy.** `gananciaOrdenex` = bruto − mensajeros
(hallazgo 6). El neto que el humano describió resta ADEMÁS el pago a la bodega. Coinciden en el
cierre medido **sólo porque ahí la bodega es 0**.

---

## 1 — Las dos cascadas existen, separadas y rotuladas

**R1.** El sistema DEBE presentar, en el detalle de un cierre de bodega, **dos** cascadas de dinero,
cada una en su propia región con su propio rótulo: una que responde **de quién es el dinero** y otra
que responde **cuánto le entrega la bodega satélite a la central**.

**R2.** El sistema NO DEBE mezclar líneas de las dos cascadas en una misma región: ninguna línea
puede pertenecer a las dos a la vez en la misma región.

**R3.** MIENTRAS se muestre la cascada «de quién es el dinero», el sistema DEBE mostrar
**«Para la tienda»** y **«Neto de Ordenex»** como sus dos resultados, visualmente destacados frente
a las líneas que los componen.

**R4.** MIENTRAS se muestre la cascada «lo que va a la central», el sistema DEBE mostrar su
resultado —**«Para la central»**— visualmente destacado frente a las líneas que lo componen.

**R5.** El sistema DEBE mostrar cada línea sustraendo de una cascada de forma que se lea que **se
resta** (signo o rótulo explícito), y no como un dato suelto más.

## 2 — Que la resta se vea, y dé

**R6.** El sistema DEBE hacer que, con las cifras **tal como se pintan en la pantalla**, se cumpla:
`lo recaudado − (flete + IVA) − (comisión COD + IVA) = Para la tienda`.

**R7.** El sistema DEBE hacer que, con las cifras **tal como se pintan en la pantalla**, se cumpla:
`(flete + IVA) + (comisión COD + IVA) + (flete por rechazo + IVA) = lo facturado por Ordenex`.

**R8.** El sistema DEBE hacer que, con las cifras **tal como se pintan en la pantalla**, se cumpla:
`lo facturado por Ordenex − pago a mensajeros − pago a la bodega satélite = Neto de Ordenex`.

**R9.** El sistema DEBE hacer que, con las cifras **tal como se pintan en la pantalla**, se cumpla:
`lo recaudado − pago a mensajeros − lo que gana la bodega satélite = Para la central`.

**R10.** El sistema DEBE mostrar la línea que enlaza «lo que Ordenex cobra sobre lo recaudado» con
«lo que Ordenex facturó» —el flete por rechazo + IVA— **siempre**, también cuando valga cero, y con
la nota de que ese cobro **no sale de lo recaudado**.

**R11.** SI cualquiera de los dos resultados de la cascada A es negativo, ENTONCES el sistema DEBE
pintarlo con su signo y señalarlo como deuda, sin convertirlo en cero ni ocultarlo.

## 3 — Money-safe (feature 204: 14 de 66 órdenes con un céntimo de desviación)

**R12.** El sistema DEBE derivar **en el servidor**, con aritmética decimal exacta, todos los
importes nuevos de las dos cascadas, y exponerlos como STRING de dos decimales.

**R13.** Los componentes que pintan las cascadas NO DEBEN realizar ninguna operación aritmética
sobre importes: reciben cada línea ya derivada y sólo la formatean.

**R14.** El sistema NO DEBE convertir ningún importe a coma flotante en ningún punto del camino
(sin `Number(`, `parseFloat(`, `parseInt(` ni `.toFixed(` sobre importes en los módulos que esta
ficha toca).

## 4 — Que cuadre al consolidar varios días

**R15.** El sistema DEBE derivar la cascada agregada de un cierre de bodega **a partir de los
snapshots del propio cierre de bodega**, y la cascada de cada `cierre_dia` a partir de **sus
propios** snapshots.

**R16.** MIENTRAS los snapshots agregados de un cierre de bodega sean la suma exacta de los de sus
`cierre_dia`, el sistema DEBE producir un «Para la tienda», un «Neto de Ordenex» y un «Para la
central» agregados **exactamente iguales** a la suma de los de cada día.

**R17.** El sistema NO DEBE recalcular ni corregir en pantalla un agregado para que cuadre con la
suma de los días: cada nivel se lee de su propio snapshot.

## 5 — La tarjeta: donde vive el número que hace falta para operar

**R18.** El sistema DEBE mostrar, en la tarjeta desplegada de un cierre de bodega, la cascada «lo
que va a la central» completa: lo recaudado, el pago a mensajeros, lo que gana la bodega satélite y
el resultado **«Para la central»**.

**R38.** El sistema DEBE mostrar esa cascada, con **el mismo rótulo y el mismo valor**, en las
**dos** pantallas donde aparece la tarjeta de un cierre de bodega: la del maestro
(`CierresBodegaAdminModule` / `CierresBodegaResueltosLista`) y la del `adminSatelite`
(`ConsolidacionBodegaModule` / `CierresBodegaSolicitadosLista`).

**R19.** El sistema NO DEBE rotular «Ajustes» ningún bloque de la tarjeta de un cierre de bodega.

**R20.** El sistema DEBE entregar a la tarjeta el resultado de la cascada **ya derivado por el
servidor**; la tarjeta NO DEBE calcularlo.

**R21.** El sistema NO DEBE alterar el comprobante compacto de las otras tres superficies que lo
comparten (cierre de mensajero del admin, cierre propio del mensajero y `cierre_dia`
consolidable): ni sus rótulos, ni sus líneas, ni sus valores, ni su nombre accesible.

**R22.** El archivo que se descarga de un listado de cierres de bodega DEBE llevar **«Para la
central»** con el mismo rótulo y el mismo valor que la tarjeta muestra, sin alterar el orden ni el
contenido de las columnas que ya existían.

## 6 — El caso raro, dicho en la pantalla

**R36.** SI «Para la central» es negativo —los descuentos superan lo recaudado en ese cierre—
ENTONCES el sistema DEBE pintarlo con su signo, marcarlo como atención y acompañarlo de una nota
que diga qué significa: que la satélite **no entrega nada** y que la diferencia la pone la central.
El sistema NO DEBE convertirlo en cero, recortarlo a cero ni ocultarlo.

**R37.** SI el **efectivo** recaudado no cubre los dos descuentos —aunque «Para la central» sea
positivo— ENTONCES el sistema DEBE decirlo junto al resultado: los descuentos se pagan en efectivo
y parte de lo recaudado pudo entrar por SINPE o transferencia.

**R26.** El sistema DEBE acompañar el resultado «Para la central» con una nota que diga de qué
resta sale, en el lenguaje de quien la hace: lo recaudado menos el pago a los mensajeros y menos lo
que gana la bodega satélite.

**R27.** El sistema DEBE acompañar la línea de lo que gana la bodega satélite con una nota que diga
que es **lo que se le reconoce por los rechazos**, no un movimiento de caja registrado (hallazgo 12).

## 7 — Que las dos superficies cuenten la misma historia

**R23.** El sistema DEBE nombrar con **el mismo rótulo** una misma cifra en la tarjeta y en el
detalle de un cierre de bodega.

**R24.** El sistema NO DEBE mostrar, dentro de una misma superficie del cierre de bodega, la misma
cifra bajo dos nombres distintos.

**R25.** El sistema DEBE nombrar el importe de `total_ingreso_bodega_rechazos`, en las superficies
del cierre de bodega, **desde el punto de vista de quien mira** —lo que gana la bodega satélite por
los rechazos, que Ordenex le paga— y no repitiendo el nombre de la columna.

## 8 — Lo que NO cambia

**R28.** El sistema NO DEBE requerir ninguna migración de base de datos para esta ficha: los tres
snapshots que las cascadas necesitan ya existen y el resto es resta.

**R29.** El sistema NO DEBE alterar el panel de totales por método de pago (efectivo / SINPE /
transferencia / general) ni los valores que hoy muestra.

**R30.** El sistema NO DEBE alterar el detalle ni la tarjeta de un cierre de **mensajero**.

**R31.** El sistema NO DEBE cambiar el valor de ningún importe que hoy ya se muestra: esta ficha
añade líneas, las agrupa y las renombra; no recalcula dinero existente.

**R39.** El sistema NO DEBE mostrar la cascada «de quién es el dinero» en ninguna superficie que
alcance el `adminSatelite`: el margen de Ordenex vive en el detalle, que sólo abre el maestro.

## 9 — Accesibilidad y texto

**R32.** El sistema DEBE exponer cada cascada como una región con nombre accesible propio y estable,
distinto del de la otra cascada.

**R33.** El sistema DEBE mantener todo el texto visible de las cascadas en constantes separadas de
la lógica (i18n-ready), como el resto de este módulo.

## 10 — Que no vuelva a romperse

**R34.** El sistema NO DEBE dejar, en el detalle de un cierre de bodega, ninguna tarjeta suelta que
repita una cifra que ya es línea de una cascada.

**R35.** El sistema DEBE impedir, con una comprobación que recorre el árbol de archivos, que el
rótulo «Ajustes» reaparezca en una superficie del cierre de bodega.

> **Total: 39 requisitos** (R1–R39). R36–R39 entraron en la revisión 2.

---

## Decisiones

### Firmadas por el humano (2026-09-08)

| # | Decisión |
| --- | --- |
| **H1** | La cascada B **va en la tarjeta**, en las dos pantallas. Es el número que la satélite necesita para operar, y la satélite **sólo ve la tarjeta**. |
| **H2** | La cascada A **se queda en el detalle**. La satélite ve lo suyo; nadie ve un margen que no le toca. |
| **H3** | La fórmula de la cascada B es `total_general − total_pago_mensajero − total_ingreso_bodega_rechazos`, y su significado es **lo que la satélite le entrega a la central**. |

### Tomadas SIN firma del humano

Marcadas así a propósito. Cada una lleva su vuelta atrás.

| # | Decisión | Por qué | Vuelta atrás |
| --- | --- | --- | --- |
| **D2′** | El resultado se llama **«Para la central»**. *(Sustituye a D2 de la revisión 1, «Queda tras los pagos», que a su vez había descartado «Queda en caja».)* | Dice **a dónde va** el dinero, que es lo que el humano describió, y **rima con «Para la tienda»** de la cascada A: dos preguntas de la misma familia, dos rótulos de la misma forma. Se descarta «Entrega a la central» porque «entrega/entregada» es vocabulario cargado en esta app (el desenlace de una gestión) y colisionaría en la misma pantalla. Se descarta «Queda en caja» porque lo recaudado incluye SINPE y transferencia. | Cambiar una constante. |
| **D3′** | La línea de `total_ingreso_bodega_rechazos` se llama **«Gana la bodega satélite»** **sólo en las superficies del cierre de bodega**. | En un cierre de bodega la bodega responsable es siempre la satélite. Y es el verbo que usó el humano: *«menos lo que gana la satélite»*. En un cierre de **mensajero** la bodega puede ser la central, así que allí no se toca. | Revertir la constante nueva. |
| **D4** | Las tarjetas sueltas del detalle agregado —«Ingreso bruto», «Pago a mensajeros», «Ganancia», «Ingreso de bodega por rechazos», «Pago a tienda»— **se absorben** en las cascadas. | R24: hoy la misma cifra aparece dos veces con nombres distintos, y eso es justo lo que el humano no entiende. | Volver a montarlas: los componentes siguen existiendo para el cierre de mensajero. |
| **D5** | La primera línea de cada cascada **reusa el rótulo del total que ya está en esa superficie** («Total» en la tarjeta, «Total general» en el detalle) en vez de estrenar un «Lo recaudado». | R24: dos nombres para la misma cifra en la misma pantalla es el defecto que se viene a arreglar. | Si el humano prefiere «Lo recaudado», hay que cambiarlo **también** en el rótulo existente. |
| **D6** | En el caso negativo (R36) **el rótulo NO cambia**: sigue diciendo «Para la central», con signo, tono de atención y su nota. | Una cifra, un nombre (R24). Cambiar el rótulo según el signo obliga al lector a reconocer dos filas distintas que son la misma. Y **no se reusa «Central debe»**: esa etiqueta ya significa otra cosa muy concreta en la consolidación (el pago que el efectivo no cubrió, `repartirEfectivo`), y darle un segundo significado es exactamente lo que R24 prohíbe. | Estrenar un rótulo propio para el negativo. |
| **D7** | **«Para la central» SÍ va al archivo de descarga** de los tres listados de cierre de bodega. *(Invierte la duda de la revisión 1, que lo dejaba como pregunta abierta.)* | Con el uso real encima: la persona lo usa para **cuadrar con la central**, y cuadrar se hace en una hoja, no mirando una pantalla. La doctrina del árbol ya lo dice: descargar significa «esto que estoy viendo, entero». La columna va **la última** y ninguna existente se mueve, así que un consumidor que lea por posición no se rompe. | Quitar la columna y las dos líneas de las guardias de orden. |

---

## Preguntas abiertas

**Q4 — ¿Se renombra `INGRESO_BODEGA_RECHAZOS_LABEL` en toda la app, como se hizo con «Flete por
rechazo» en la 338?** Con D3′ quedan dos nombres para la misma columna según por qué pantalla se
entre («Gana la bodega satélite» en el cierre de bodega, «Ingreso de bodega por rechazos» en el del
mensajero). Es defendible —son dos contextos con dos bodegas distintas— pero es exactamente la clase
de decisión que el humano firmó una vez en la 338.

**Q6 — «Total» en la tarjeta, «Total general» en el detalle: ¿se unifican?**
Es la misma cifra con dos nombres según la superficie —hoy ya, antes de esta ficha—. D5 lo deja
como está para no tocar las otras tres superficies del comprobante (R21).

**Q7 — Si «Para la central» sale negativo, ¿basta con decirlo, o hay que hacer algo?**
R36 decide qué se **enseña**. Lo que no decide es si ese cierre debe poder aprobarse tal cual, o si
la central quiere un aviso en la cola de pendientes. Esta ficha **no toca el flujo de aprobación**;
si el humano quiere una puerta, es ficha aparte.

**Q8 — ¿La nota de R37 («el efectivo no cubre los descuentos») tiene que ir también en la tarjeta
del maestro, o sólo en la de la satélite?** Se especifica **en las dos** (R38: mismo rótulo, mismo
valor, misma nota) por coherencia; si el maestro la encuentra ruidosa, se recorta por `audiencia`
con el mecanismo que ya existe.

---

### Preguntas CERRADAS en la revisión 2

- ~~Q1 — ¿La tarjeta lleva también «Para la tienda» y «Neto de Ordenex»?~~ **No** (H2). La tarjeta
  lleva la cascada B completa (H1); la A vive en el detalle. **Sigue sin haber migración.**
- ~~Q2 — ¿El adminSatelite debe ver el margen de Ordenex?~~ **No** (H2, R39).
- ~~Q3 — ¿«Queda tras los pagos» o «Queda en caja»?~~ Ninguna: **«Para la central»** (D2′).
- ~~Q5 — ¿El archivo de descarga puede ganar una columna?~~ **Sí, y debe** (D7, R22).
