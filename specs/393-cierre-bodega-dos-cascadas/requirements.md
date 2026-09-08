# Ficha 393 — El cierre de bodega cuenta la historia entera, en dos cascadas

> Requisitos en notación EARS. Sin detalles de implementación: el CÓMO vive en `design.md`;
> el desglose y las mutaciones, en `tasks.md`. Cada `R<n>` termina mapeado a un test concreto
> (`tasks.md § Trazabilidad`).

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

**Cascada B — qué sale de la bodega:** se recogió 126.089 → menos mensajeros 14.000 → menos bodega
0 → **= queda 112.089**.

---

## Lo confirmado EN EL ARCHIVO REAL (no en el índice del MCP, que devuelve de más)

Todo lo de abajo se leyó en disco el 2026-09-07. Es la base del diseño; si algo de esto fuera falso
al implementar, **PARAR**.

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
   «Pago a tienda» (`:564-569`) y «Ganancia» (`:550-555`) en el detalle. ⚠️ **La premisa de la
   ficha —«los dos números no existen en ninguna pantalla»— es FALSA para el detalle**: existen,
   pero al final, sueltos, sin cascada y con nombres que no son los que el humano usa.
9. **La tarjeta es `HojaResumen`** (`app/(app)/cierres-admin/_components/cierre-factura.tsx:596-784`),
   **compartida por CUATRO superficies**: cierre de mensajero (`:501`), cierre de bodega (`:800`),
   cierre propio del mensajero (`:848`, `audiencia="mensajero"`) y `cierre_dia` consolidable
   (`:890`). Sus tres columnas son `RESUMEN_METODOS_TITULO` / `RESUMEN_AJUSTES_TITULO` /
   `RESUMEN_FECHAS_TITULO` (`:206-208`), y la de «Ajustes» (`:736-752`) contiene el pago al
   mensajero y el ingreso de bodega por rechazos: **ninguno de los dos es un ajuste**.
10. **La tarjeta sólo recibe el SNAPSHOT** (`CierreBodegaResumen`,
    `lib/interfaces/services/ICierreBodegaService.ts:22-36`): totales por método, general,
    `totalPagoMensajero`, `totalIngresoBodegaRechazos`, `cantidadCierres`, fechas y motivo.
    **No recibe nada del ingreso de Ordenex.**
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
    NO lo asienta en ninguna caja ni ejecuta movimiento de dinero»*. **El «pago a la bodega
    satélite» es un DEVENGO, no un egreso de caja.**
13. **`tests/components/DineroIdentidadesEnPantalla.test.tsx`** (ficha 359) es el archivo que
    afirma que las restas cierran **leyendo lo pintado**, con un censo cerrado de 13 pantallas.
14. **`tests/unit/guards/flete-por-rechazo-censo.guardia.test.ts`** (ficha 338) es el precedente
    exacto de cómo se retira un nombre de dinero de toda la app, con autocomprobación.
15. **`app/(app)/cierres-admin/_components/cierres-bodega-descarga-columnas.ts:53-144`**: los
    cuatro archivos de estos listados proyectan `general`, `pagoMensajero` e `ingresoBodega`.

### Las dos trampas que esto destapa, y que son el diseño

**Trampa 1 — «lo que cobra Ordenex» son DOS números, no uno.** La identidad
`recaudado = lo que cobra Ordenex + para la tienda` sólo se cumple con el subconjunto DEDUCIBLE
(flete + IVA y comisión + IVA, de las entregadas). El **flete por rechazo + IVA** se le factura a
la tienda pero **no sale de lo recaudado** (hallazgos 3 y 5). Por eso, en un cierre con rechazos,
«recaudado − ingreso bruto» **NO da** «para la tienda», y una cascada que empiece por el bruto
enseña una resta que no cierra. La cascada A necesita una **línea puente** que diga en qué se
diferencian los dos números.

**Trampa 2 — «Neto de Ordenex» NO es la «Ganancia» de hoy.** `gananciaOrdenex` = bruto − mensajeros
(hallazgo 6). El neto que el humano describió resta ADEMÁS el pago a la bodega. Coinciden en el
cierre medido **sólo porque ahí la bodega es 0**.

---

## 1 — Las dos cascadas existen, separadas y rotuladas

**R1.** El sistema DEBE presentar, en el detalle de un cierre de bodega, **dos** cascadas de dinero,
cada una en su propia región con su propio rótulo: una que responde **de quién es el dinero** y otra
que responde **qué sale de la bodega**.

**R2.** El sistema NO DEBE mezclar líneas de las dos cascadas en una misma región: ninguna línea
puede pertenecer a las dos a la vez en la misma región.

**R3.** MIENTRAS se muestre la cascada «de quién es el dinero», el sistema DEBE mostrar
**«Para la tienda»** y **«Neto de Ordenex»** como sus dos resultados, visualmente destacados frente
a las líneas que los componen.

**R4.** MIENTRAS se muestre la cascada «qué sale de la bodega», el sistema DEBE mostrar su resultado
—lo que queda tras los pagos— visualmente destacado frente a las líneas que lo componen.

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
`lo recaudado − pago a mensajeros − pago a la bodega satélite = lo que queda tras los pagos`.

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
`cierre_dia`, el sistema DEBE producir un «Para la tienda», un «Neto de Ordenex» y un «queda tras
los pagos» agregados **exactamente iguales** a la suma de los de cada día.

**R17.** El sistema NO DEBE recalcular ni corregir en pantalla un agregado para que cuadre con la
suma de los días: cada nivel se lee de su propio snapshot.

## 5 — La tarjeta del listado

**R18.** El sistema DEBE mostrar, en la tarjeta desplegada de un cierre de bodega, la cascada «qué
sale de la bodega» completa: lo recaudado, el pago a mensajeros, el pago a la bodega satélite y el
resultado.

**R19.** El sistema NO DEBE rotular «Ajustes» ningún bloque de la tarjeta de un cierre de bodega.

**R20.** El sistema DEBE entregar a la tarjeta el resultado de la cascada **ya derivado por el
servidor**; la tarjeta NO DEBE calcularlo.

**R21.** El sistema NO DEBE alterar el comprobante compacto de las otras tres superficies que lo
comparten (cierre de mensajero del admin, cierre propio del mensajero y `cierre_dia`
consolidable): ni sus rótulos, ni sus líneas, ni sus valores, ni su nombre accesible.

**R22.** El archivo que se descarga de un listado de cierres de bodega DEBE llevar el mismo
resultado nuevo que la tarjeta muestra, sin alterar el orden ni el contenido de las columnas que
ya existían.

## 6 — Que las dos superficies cuenten la misma historia

**R23.** El sistema DEBE nombrar con **el mismo rótulo** una misma cifra en la tarjeta y en el
detalle de un cierre de bodega.

**R24.** El sistema NO DEBE mostrar, dentro de una misma superficie del cierre de bodega, la misma
cifra bajo dos nombres distintos.

**R25.** El sistema DEBE nombrar el importe de `total_ingreso_bodega_rechazos`, en las superficies
del cierre de bodega, **desde el punto de vista de quien mira** —lo que Ordenex le paga a la bodega
satélite— y no repitiendo el nombre de la columna.

**R26.** El sistema DEBE acompañar el resultado de la cascada «qué sale de la bodega» con una nota
que diga que **no es efectivo en caja**: parte de lo recaudado entró por SINPE o transferencia.

**R27.** El sistema DEBE acompañar la línea del pago a la bodega satélite con una nota que diga que
es **lo que se le reconoce**, no un movimiento de caja registrado (hallazgo 12).

## 7 — Lo que NO cambia

**R28.** El sistema NO DEBE requerir ninguna migración de base de datos para esta ficha: los tres
snapshots que las cascadas necesitan ya existen y el resto es resta.

**R29.** El sistema NO DEBE alterar el panel de totales por método de pago (efectivo / SINPE /
transferencia / general) ni los valores que hoy muestra.

**R30.** El sistema NO DEBE alterar el detalle ni la tarjeta de un cierre de **mensajero**.

**R31.** El sistema NO DEBE cambiar el valor de ningún importe que hoy ya se muestra: esta ficha
añade líneas, las agrupa y las renombra; no recalcula dinero existente.

## 8 — Accesibilidad y texto

**R32.** El sistema DEBE exponer cada cascada como una región con nombre accesible propio y estable,
distinto del de la otra cascada.

**R33.** El sistema DEBE mantener todo el texto visible de las cascadas en constantes separadas de
la lógica (i18n-ready), como el resto de este módulo.

## 9 — Que no vuelva a romperse

**R34.** El sistema NO DEBE dejar, en el detalle de un cierre de bodega, ninguna tarjeta suelta que
repita una cifra que ya es línea de una cascada.

**R35.** El sistema DEBE impedir, con una comprobación que recorre el árbol de archivos, que el
rótulo «Ajustes» reaparezca en una superficie del cierre de bodega.

---

## Decisiones tomadas SIN firma del humano

Marcadas así a propósito. Cada una lleva su vuelta atrás.

| # | Decisión | Por qué | Vuelta atrás |
| --- | --- | --- | --- |
| **D1** | **La cascada A NO va en la tarjeta**; va completa en el detalle. La tarjeta lleva la cascada B completa. | La tarjeta sólo recibe el snapshot (hallazgo 10) y la cascada A necesita el ingreso de Ordenex, que **no está guardado** (hallazgo 2): habría que derivarlo desde cada `cierre_detail` de cada `cierre_dia` de cada tarjeta de la página — y el MISMO DTO alimenta la descarga **sin cota de filas**. | Si el humano la quiere en la tarjeta: o dos columnas de snapshot nuevas (**migración**, ver `design.md §8 A2`) o una acción propia por tarjeta (`§8 A3`). Es un cambio aditivo sobre lo que esta ficha deja. |
| **D2** | El resultado de la cascada B se llama **«Queda tras los pagos»**, no «Queda en caja». | Lo recaudado incluye SINPE y transferencia, que no son efectivo en la bodega; y el pago a la bodega no tiene movimiento de caja (hallazgo 12). «Queda en caja» sería una afirmación que el sistema no puede respaldar. | Cambiar la constante del rótulo. Una línea. |
| **D3** | La línea del `total_ingreso_bodega_rechazos` se llama **«Pago a la bodega satélite»** **sólo en las superficies del cierre de bodega**. En las del cierre de mensajero se queda como está. | En un cierre de bodega la bodega responsable es siempre la satélite (un cierre con destino central nunca se consolida). En un cierre de mensajero puede ser la central, y ahí «pago a la satélite» sería falso. | Revertir la constante nueva y volver a `INGRESO_BODEGA_RECHAZOS_LABEL`. |
| **D4** | Las cuatro tarjetas sueltas del detalle agregado —«Ingreso bruto», «Pago a mensajeros», «Ganancia», «Ingreso de bodega por rechazos», «Pago a tienda»— **se absorben** en las cascadas. | R24: hoy la misma cifra aparece dos veces con nombres distintos, y eso es justo lo que el humano no entiende. | Volver a montarlas: los componentes (`MontoDerivadoCard`, `PagoMensajeroTotal`, `IngresoBodegaRechazosTotal`) siguen existiendo para el cierre de mensajero. |
| **D5** | La primera línea de cada cascada **reusa el rótulo del total que ya está en esa superficie** («Total» en la tarjeta, «Total general» en el detalle) en vez de estrenar un «Lo recaudado». | R24: dos nombres para la misma cifra en la misma pantalla es el defecto que se viene a arreglar. | Si el humano prefiere «Lo recaudado», hay que cambiarlo **también** en el rótulo existente, no sólo en la cascada. |

---

## Preguntas abiertas

**Q1 — ¿La tarjeta tiene que llevar también «Para la tienda» y «Neto de Ordenex»?**
Es la pregunta que decide si esta ficha lleva migración o no. Hoy no puede llevarlos sin pagar uno
de los dos precios de `design.md §8` (columnas nuevas con backfill, o una consulta por tarjeta).
**La ficha se especifica con D1 (no van).** Si la respuesta es «sí», el alcance crece y hay que
volver a este spec.

**Q2 — ¿El adminSatelite debe ver el margen de Ordenex?**
La tarjeta de un cierre de bodega la ve también el `adminSatelite` en su propia pantalla
(`ConsolidacionBodegaModule.tsx:442,450`, vía `CierresBodegaSolicitadosLista`), **y esa pantalla no
tiene detalle que abrir**. Con D1 el satélite ve la cascada B y nunca la A, lo cual esquiva la
pregunta hoy; pero si Q1 sale «sí», habría que decidirlo. El mecanismo ya existe: la prop
`audiencia` de `HojaResumen` (`cierre-factura.tsx:587`) ya recorta lo que ve un mensajero.

**Q3 — ¿«Queda tras los pagos» o «Queda en caja»?** (ver D2). Si es «en caja», hay que decidir qué
hace la pantalla cuando el efectivo no alcanza para el pago a mensajeros — un caso que el sistema
ya modela en la consolidación (`repartirEfectivo` / «Central debe»,
`lib/services/CierreBodegaService.ts:96-127`) y que **el cierre de bodega ya cerrado no calcula**.

**Q4 — ¿Se renombra `INGRESO_BODEGA_RECHAZOS_LABEL` en toda la app, como se hizo con «Flete por
rechazo» en la 338?** Con D3 quedan dos nombres para la misma columna según por qué pantalla se
entre. Es defendible (son dos contextos distintos) pero es exactamente la clase de decisión que el
humano firmó una vez en la 338.

**Q5 — ¿El archivo de descarga de estos cuatro listados puede ganar una columna?**
R22 lo pide para que la tarjeta y su archivo no digan cosas distintas, pero cambia el encabezado de
un archivo que alguien puede estar pegando en una hoja. No se ha medido a cuántos consumidores
afecta.

**Q6 — «Total» en la tarjeta, «Total general» en el detalle: ¿se unifican?**
Es la misma cifra con dos nombres según la superficie —hoy ya, antes de esta ficha—. D5 lo deja
como está para no tocar las otras tres superficies del comprobante (R21).
