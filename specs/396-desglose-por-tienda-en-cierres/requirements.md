# Ficha 396 — «Pago a tienda» dice de quién es cada parte

> Requisitos en notación EARS. Sin detalles de implementación: el CÓMO vive en `design.md`; el
> desglose y las mutaciones, en `tasks.md`. Cada `R<n>` termina mapeado a un test concreto
> (`tasks.md § Trazabilidad`).
>
> **Revisión 3 (2026-09-08).** Las ocho preguntas abiertas están **firmadas** y las dos mediciones
> bloqueantes **hechas**. No queda ninguna pregunta abierta.

## Lo primero, porque cambia cómo se lee todo lo demás

**Esto NO es un defecto de dinero. Es de presentación.** Medido en producción el 2026-09-08 sobre
un cierre de dos tiendas: `wallet_tienda_movimiento` tiene los movimientos **separados por tienda**,
cada uno con sus propias cifras (`cod_recaudado`, `flete`, `comision_cod`, `iva_flete`,
`iva_comision_cod`) — una tienda con `18.990` recaudado / `2.800` de flete, la otra con `108.785` /
`16.800`. **A nadie se le paga mal, y ninguna cifra del ledger cambia con esta ficha.**

El total agrupado **es correcto como total**. Lo que no dice es de quién es cada parte.

## El problema, en una frase

**El cierre es del MENSAJERO, no de la tienda.** Un mensajero reparte para quien le toque ese día,
así que un cierre puede llevar órdenes de varias tiendas. El detalle del cierre enseña
**«Pago a tienda»** —singular— como **un solo número** que es la suma de todas ellas, y **no lo dice
en ninguna parte**. Quien lo mira cree estar viendo lo que se le paga a *una* tienda. El humano se
confundió leyendo esa pantalla, y de ahí sale la ficha.

**Medido en producción el 2026-09-08: de 56 cierres, 39 tienen UNA tienda y 17 tienen DOS.**
Casi un tercio. Ninguno tiene tres o más *a día de hoy*, pero nada en el modelo lo impide.

Y el **cierre de bodega** agrega **N mensajeros × M tiendas** en el mismo rótulo, así que ahí el
mismo defecto es mayor.

---

## Decisiones firmadas por el humano (2026-09-08)

Ocho firmas. **Se acatan tal cual; no se reabren.**

| | Pregunta | Firma |
|---|---|---|
| **Q1** | ¿Qué se desglosa? | **Lo recaudado y lo que se le paga**, por tienda. Ampliada por Q7 |
| **Q2** | ¿Pago al mensajero e ingreso de bodega? | **Quedan AGREGADOS.** Repartirlos sería inventar un criterio que nadie ha decidido — **decisión del leader**, no corregida |
| **Q3** | ¿La descarga? | **NO se toca.** Se acepta entero el hallazgo: el Excel ya va desagregado |
| **Q4** | ¿También el cierre de bodega? | **SÍ, LAS DOS A LA VEZ** — *en contra de la recomendación del leader*, ver abajo |
| **Q5** | ¿Umbral? | **Sólo con DOS O MÁS tiendas.** Con una sola, la pantalla se queda exactamente como está |
| **Q6** | ¿Orden de las tiendas? | **Por importe, de mayor a menor** — **decisión del leader**, no corregida |
| **Q7** | ¿`pagoTienda` o `ganaLaTienda`? | **LAS DOS.** Tres cifras por tienda: lo recaudado, lo que se le paga hoy, y lo que gana en total |
| **Q8** | ¿Matriz tienda × mensajero en el agregado de bodega? | **NO.** Una fila por tienda. El detalle por mensajero ya existe un nivel más abajo |

### El rastro de Q4, porque explica el tamaño de esta ficha

**Q4 se firmó EN CONTRA de la recomendación del leader.** El leader recomendó dejar el cierre de
bodega para una ficha propia, con este argumento: **probar primero la forma en el detalle del
mensajero** —una superficie, un nivel— y llevarla a la bodega después, ya validada.

El humano prefirió arreglar los dos de una vez. Su motivo, con sus palabras:
**«necesito que esto que son cierres quede perfecto»**.

Es su decisión y se acata. **Consecuencia directa y medida:** el alcance pasa de **1 superficie** a
**3** (detalle del mensajero + los dos niveles del detalle de bodega). Dentro de un año, esto
explica por qué la ficha es del tamaño que es.

### El rastro de Q7, porque deroga una guardia de este mismo documento

La revisión 2 escribió **R5 prohibiendo una tercera cifra por tienda**, para que el desglose no
creciera solo. **Q7 firma exactamente esa tercera.**

**La guardia no se relajó: se movió, y se movió por firma.** El humano dio su motivo, y coincide con
el del leader: *desglosar una cifra y dejar la otra agregada es exactamente el fallo que estamos
arreglando, un nivel más abajo.* R5 sigue viva y sigue haciendo su trabajo — ahora prohibiendo la
**cuarta**, con la misma fuerza con la que ayer prohibía la tercera. Un tope se mueve **cuando
alguien lo firma y queda escrito**, nunca de paso.

---

## Las dos mediciones bloqueantes: HECHAS (2026-09-08, contra producción)

### M-A — Cardinales de los cierres de bodega

**14 cierres de bodega. Máximo 2 tiendas (media 1,29) y máximo 2 mensajeros (media 1,14).**

Por debajo del umbral de 4 que el spec había puesto para escalar la decisión, así que **la tanda de
bodega sigue adelante sin volver a consultar**.

⚠️ **Son cardinales JÓVENES y hay que decirlo.** Producción se vació a propósito el 2026-08-25, así
que ese «máximo 2» es **lo que ha pasado hasta hoy, no una garantía**. Nada en el modelo impide un
cierre de bodega con seis tiendas.

**¿Depende el diseño de que sean pocos?** La **corrección no**: la derivación es una partición y da
igual que haya 2 tiendas o 20. La **legibilidad sí**: el modal de bodega ya monta dos cascadas por
nivel y por mensajero, y con seis tiendas por nivel se vuelve un muro. Por eso el umbral de revisión
**se queda escrito como aviso permanente** (`tasks.md § T0.4`): si un día el máximo llega a 4, se
mira la pantalla antes de seguir añadiendo.

### M-B — ¿El snapshot agregado de bodega es la suma de sus días?

**CERO cierres** donde `cierre_bodega.total_general` difiera de la suma de sus `cierre_dia`. La
identidad se sostiene en los 14, igual que midió la ficha 393.

⚠️ **Sigue siendo una MEDICIÓN, no una regla**, exactamente como lo dejó escrito la 393
(`CierresBodegaAdminService.ts:358-363`). Si un día dejara de cuadrar, **es un descuadre real que la
pantalla debe enseñar (R21), no un fallo del desglose que haya que corregir forzando el minuendo**.
La consulta de comprobación se queda a mano en `tasks.md § T0.5`.

---

## Lo confirmado EN EL ARCHIVO REAL (no en el índice del MCP, que miente en las dos direcciones)

Leído en disco el 2026-09-08, **después** de que la mitad de servidor de la ficha 395 se mergeara
(PR #753). Si algo de esto fuera falso al implementar, **PARAR**.

### El detalle del cierre del mensajero

1. **`lib/services/CierresAdminService.ts:662-763`** — `verCierreDetalle` deriva `totalesIngreso`
   (:664), `ganancia` (:671) y `pagoTienda` (:675-679), este último con
   `pagoTiendaOrdenex(resumen.totales.general, totalesIngreso.fleteConIva,
   totalesIngreso.comisionConIva)`: **un solo número para todo el cierre**.
2. **LA 395 YA ESTÁ AHÍ** (:681-751): añadió `cobradoSobreRecaudado` (:692), `netoOrdenex` (:703),
   `ganaLaTienda` (:713) y el booleano `fleteRechazoYaCobradoATienda` (:723). Los cuatro viajan en
   el DTO (`ICierresAdminService.ts:350-403`). **Esta ficha se apoya en ellos; no los reinventa.**
3. **`lib/utils/ingreso-ordenex.ts:390` — `ganaLaTienda` es NUEVA de la 395**:
   `total_general − ingresoTotal`. Su docstring dice, con estas palabras, que **NO es
   `pagoTiendaOrdenex` y que confundirlas es el fallo que la 395 arregla**. Con las cifras reales de
   producción del 2026-09-08 la diferencia entre las dos es **₡10.848,00**. **Q7 firma que las dos
   se desglosan.**
4. **`lib/utils/ingreso-ordenex.ts:352-358` — `pagoTiendaOrdenex`** sigue intacta, pura y
   money-safe. Su docstring dice por qué NO descuenta el flete por rechazo.

### El detalle del cierre de bodega

5. **`lib/services/CierresBodegaAdminService.ts:266-387` — `verCierreBodegaDetalle` tiene DOS
   niveles, y los dos sufren el mismo defecto:**
   - **Por mensajero** (:287-341): un `pagoTienda` por cada `cierre_dia` (:312-316). Es
     **exactamente el mismo caso** que el detalle del mensajero.
   - **Agregado de toda la bodega** (:352-356): un `pagoTienda` que suma **todas las tiendas de
     todos los mensajeros**. Es el peor de los tres.
6. **`CierresBodegaAdminModule.tsx:666-756`** monta `CascadaDinero` **dos veces por nivel**, una vez
   para el agregado y una vez **por cada mensajero**. El `pagoTienda` entra por `lineasCascadaDueno`
   (:244-256) con el rótulo `PARA_LA_TIENDA_LABEL`.
7. **`CierresBodegaAdminRepository.ts:353-356` usa `DETALLE_ADMIN_SELECT`** —el mismo `select` que
   el detalle del mensajero— y el mismo mapper. **Lo que se arregle en la proyección sirve para los
   dos, gratis.**

### El dato y su camino

8. **`db/schema.prisma:2241-2307` — `cierre_detail`** congela por fila `tiendaId` (`tienda_id`,
   `:2250`) y `tiendaNombre` (`tienda_nombre`, `:2284`). **La materia prima existe y está
   congelada.**
9. **`lib/repositories/CierresAdminRepository.ts:164-194` — `DETALLE_ADMIN_SELECT` proyecta
   `tiendaNombre` pero NO `tiendaId`.** La columna existe; la consulta no la lee. **Es el único
   hueco real.**
10. **`CierresAdminRepository.ts:1267-1282`** — cada gestión se empareja con SU fila congelada por
    `ordenId`, y **si falta la fila es un error DURO** (`CierreDetalleFaltanteError`). **Toda
    gestión del detalle tiene tienda**; no hay caso «gestión sin tienda».
11. **`lib/utils/cierre-totales.ts:77-105` — `computeTotales`** produce `total_general` sumando las
    **líneas de pago (`g.pagos`) de las gestiones `entregada`**, y sólo de ésas.
12. **`lib/services/WalletTiendaFeedService.ts:100-138`** agrupa por `d.tiendaId` del snapshot.
    **El agrupamiento por tienda ya existe en el sistema**; lo que no existe es en la pantalla.
13. **`lib/utils/dinero-por-producto.ts:200-273` — `repartoDeOrden`** ya parte el mismo importe por
    OTRA dimensión (el producto) reusando `pagoTiendaOrdenex` sobre subconjuntos. **Precedente
    directo del patrón**, con su invariante escrita.
14. **LA DESCARGA NO SUFRE ESTE DEFECTO — medido, no supuesto.** Nivel Resumen
    (`cierres-admin-descarga-columnas.ts:52-89`): Estado · Mensajero · Fecha · Destino · Total
    general · Pago mensajero · Ingreso bodega · Motivo — **ninguna columna «Pago a tienda»**. Nivel
    Detalle (`cierres-gestiones-fundida-descarga-columnas.ts:244-276`): una fila **por gestión**,
    con **«Tienda»** en la 12ª. **Ya está desagregada.** Por eso Q3 se firmó «no se toca».

## Alcance

**DENTRO (3 superficies):**
1. El detalle del cierre del MENSAJERO en `/cierres-admin` (`CierresAdminModule` →
   `CierreFacturaDetalle`).
2. El detalle del cierre de BODEGA, **nivel por mensajero** (`CierresBodegaAdminModule`).
3. El detalle del cierre de BODEGA, **nivel agregado**.

**FUERA (y dicho a propósito):**
- El ledger, las wallets y los movimientos: no se toca ni una fila. El dinero ya está bien.
- La vista del mensajero (`CierreDiaModule`): no pinta «Pago a tienda» (el corte `esMensajero` sigue
  en `cierre-factura.tsx:1810`).
- Las descargas (Q3, punto 14).
- La matriz tienda × mensajero en el agregado de bodega (Q8).
- La tarjeta del listado de cierres de bodega que ve la satélite: pinta «Para la central», no
  «Pago a tienda».
- **Meter el flete por rechazo dentro del cierre.** Ver «Consecuencia» al final.

---

## Requisitos

### A. La verdad del rótulo

**R1.** SI un cierre tiene órdenes de **dos o más** tiendas, ENTONCES el sistema DEBE indicar,
junto al importe rotulado «Pago a tienda», que es un **total agregado de varias tiendas** y **de
cuántas**.

**R2.** SI un cierre tiene órdenes de **exactamente una** tienda, ENTONCES el sistema NO DEBE
mostrar ni la marca de R1 ni el desglose: esa pantalla se queda **exactamente como está hoy**.

**R3.** El sistema DEBE emitir todo texto nuevo desde una constante exportada única, nunca desde un
literal escrito en el componente.

### B. El desglose por tienda

**R4.** SI un cierre tiene órdenes de **dos o más** tiendas, ENTONCES el sistema DEBE mostrar, por
cada una de esas tiendas y con su nombre, **tres** cifras: **lo recaudado** de esa tienda, **lo que
se le paga** a esa tienda, y **lo que esa tienda gana en total**.

**R5.** El sistema NO DEBE mostrar por tienda ninguna cifra de dinero distinta de esas tres.

> ⚠️ **Esta guardia nació prohibiendo la TERCERA cifra** (revisión 2). La tercera —«lo que gana en
> total»— entró el **2026-09-08 por firma explícita del humano (Q7)**, no porque la guardia se
> relajara. Hoy prohíbe la **cuarta** con la misma fuerza. Una guardia que se ensancha en silencio
> deja de ser una guardia: el tope se mueve cuando alguien lo firma y queda escrito.

**R6.** El sistema DEBE agrupar las gestiones por la **tienda congelada en el snapshot del cierre**
(`cierre_detail`), nunca por la tienda VIVA de la orden.

**R7.** El sistema DEBE identificar cada grupo por el **identificador** de la tienda, y usar su
nombre congelado únicamente para mostrarlo.

**R8.** CUANDO el sistema liste las tiendas del desglose, DEBE ordenarlas por **el importe que se
les paga, de mayor a menor**, con un criterio de desempate declarado que haga la secuencia
reproducible.

> Q6 firmó «por importe». De las tres cifras, la que ordena es **lo que se le paga**: es la del
> rótulo que da nombre a la ficha. **Decisión del leader**, declarada aquí para que no quede
> ambigua.

**R9.** SI una tienda aparece en el cierre **sin haber recaudado nada** (por ejemplo, sólo con
rechazos), ENTONCES el sistema DEBE incluirla igualmente en el desglose y contarla para el umbral de
R1/R2, con su recaudado en cero y sus otras dos cifras con el signo que les corresponda.

### C. Las identidades — lo que impide que esto se rompa sin que nadie se entere

**R10.** El sistema DEBE garantizar que la **suma de lo que se paga a cada tienda es exactamente
igual** al importe agregado «Pago a tienda» de ese mismo nivel, sin diferencia de ningún céntimo.

**R11.** El sistema DEBE garantizar que la **suma de lo que gana cada tienda es exactamente igual**
al importe agregado «lo que gana la tienda» de ese mismo nivel.

**R12.** El sistema DEBE garantizar que la **suma de lo recaudado atribuido a cada tienda es
exactamente igual** al `total general` de ese mismo nivel.

**R13.** El sistema DEBE atribuir a cada tienda lo recaudado con **exactamente el mismo criterio**
con el que se calcula el total general (mismas gestiones, misma fuente del importe), de modo que
R12 sea cierta por construcción y no por coincidencia.

**R14.** El sistema DEBE calcular todo importe del desglose con **aritmética exacta en el
servidor** y entregarlo como cadena de escala 2. NINGÚN importe del desglose puede sumarse,
restarse ni redondearse en el navegador.

**R15.** El sistema DEBE derivar cada cifra por tienda con **la misma función** que produce su
equivalente agregado, aplicada al subconjunto de esa tienda, y NO con una fórmula escrita aparte.

### D. Lo que NO es por tienda

**R16.** El sistema NO DEBE repartir entre las tiendas el **pago al mensajero** ni el **ingreso de
bodega por rechazos**: son del cierre entero y no existe un reparto decidido.

**R17.** MIENTRAS se muestre el desglose por tienda, el sistema DEBE indicar que esos dos importes
**no están repartidos** y son del cierre completo.

**R18.** El sistema NO DEBE alterar ningún importe hoy visible. En particular DEBEN seguir dando
exactamente el mismo valor: `total general`, `Total Ordenex`, `Pago al mensajero`, `Ganancia`,
`Ingreso de bodega por rechazos`, el agregado «Pago a tienda», y los cuatro campos que la ficha 395
acaba de añadir (`cobradoSobreRecaudado`, `netoOrdenex`, `ganaLaTienda`,
`fleteRechazoYaCobradoATienda`).

### E. El cierre de bodega (Q4, Q8)

**R19.** MIENTRAS el detalle de un cierre de bodega esté abierto, el sistema DEBE aplicar R1-R17 al
**nivel por mensajero** de cada cierre del día incluido, con el mismo criterio de umbral: dos o más
tiendas **de ese mensajero**.

**R20.** MIENTRAS el detalle de un cierre de bodega esté abierto, el sistema DEBE aplicar R1-R17 al
**nivel agregado de toda la bodega**, agrupando por tienda **a través de todos los mensajeros
incluidos**, y emitiendo **una sola fila por tienda** (Q8: no hay cruce tienda × mensajero).

**R21.** El sistema DEBE derivar el desglose de cada nivel de **sus propias gestiones**, y NUNCA de
sumar el de otro nivel ni de repartir el de un nivel superior. SI las dos vías dieran distinto,
ENTONCES la pantalla DEBE mostrar el descuadre, no maquillarlo.

**R22.** El sistema DEBE usar **los mismos rótulos y el mismo componente** en las tres superficies:
la misma plata no puede leerse distinta según por qué pantalla se entre.

### F. Alcance, permisos y no regresión

**R23.** El sistema NO DEBE exponer a ningún rol un dato que no viera ya en esa misma pantalla: el
nombre de la tienda de cada orden ya se muestra por fila en los dos detalles, y el desglose sólo lo
agrega.

**R24.** El sistema DEBE mantener intactas las dos puertas de alcance: la del detalle del mensajero
(fuera de alcance → «no encontrada») y la del detalle de bodega (rol sin acceso total →
«forbidden»). El desglose no puede consultarse por ningún otro camino.

**R25.** El sistema NO DEBE modificar el esquema de la base de datos: esta ficha **no lleva
migración**.

**R26.** El sistema DEBE dejar la vista del cierre del **mensajero** (`/cierre-dia`) sin cambios
visibles.

**R27.** El sistema DEBE dejar las **descargas de cierres** (ambos niveles, las dos pantallas) sin
cambios: ni una columna nueva, ni una que cambie de sitio o de encabezado.

**Total: 27 requisitos.**

---

## Consecuencia que esta ficha habilita (no es trabajo de aquí)

El **flete por rechazo no se descuenta dentro del cierre**: se le carga a la wallet de la tienda al
APROBARLO. El motivo es exactamente el de esta ficha — **el bote es común**, así que descontarlo
dentro del cierre se lo estaría quitando a la otra tienda. Está escrito en el docstring de
`pagoTiendaOrdenex` (`lib/utils/ingreso-ordenex.ts:338-351`) y en `dinero-por-producto.ts:194-199`.

**Si algún día se quiere meter el flete por rechazo dentro del cierre, ESTA ficha es el
prerrequisito**: sin saber qué parte del bote es de cada tienda, no se le puede descontar a la que
corresponde. Queda dicho como consecuencia, no como alcance.

Con Q7 dentro, además, la pantalla ya enseña por tienda **las dos caras de ese flete**: lo que se le
paga hoy (que no lo descuenta) y lo que gana en total (que sí). Quien un día tome esa decisión
tendrá el número delante.

---

## Preguntas abiertas

**Ninguna.** Las ocho están firmadas y las dos mediciones bloqueantes, hechas.
