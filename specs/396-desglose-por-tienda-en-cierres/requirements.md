# Ficha 396 — «Pago a tienda» dice de quién es cada parte

> Requisitos en notación EARS. Sin detalles de implementación: el CÓMO vive en `design.md`; el
> desglose y las mutaciones, en `tasks.md`. Cada `R<n>` termina mapeado a un test concreto
> (`tasks.md § Trazabilidad`).
>
> **Revisión 2 (2026-09-08).** Las seis preguntas abiertas de la revisión 1 están **firmadas**. El
> alcance CRECIÓ: entra el cierre de bodega. Ver «Decisiones firmadas».

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

Estas seis cerraron las preguntas abiertas de la revisión 1. **Se acatan tal cual; no se
reabren.**

| | Pregunta | Firma |
|---|---|---|
| **Q1** | ¿Qué se desglosa? | **Lo recaudado Y lo que se le paga, por tienda.** Dos cifras. Ni una sola, ni la cascada entera |
| **Q2** | ¿Pago al mensajero e ingreso de bodega? | **Quedan AGREGADOS.** Repartirlos sería inventar un criterio que nadie ha decidido — **decisión del leader**, no corregida por el humano |
| **Q3** | ¿La descarga? | **NO se toca.** Se acepta entero el hallazgo: el Excel ya va desagregado y ahí no hay defecto |
| **Q4** | ¿También el cierre de bodega? | **SÍ, LAS DOS A LA VEZ** |
| **Q5** | ¿Umbral? | **Sólo con DOS O MÁS tiendas.** Con una sola, la pantalla se queda exactamente como está |
| **Q6** | ¿Orden de las tiendas? | **Por importe, de mayor a menor** — **decisión del leader**, no corregida por el humano |

### El rastro de Q4, porque explica el tamaño de esta ficha

**Q4 se firmó EN CONTRA de la recomendación del leader.** El leader recomendó dejar el cierre de
bodega para una ficha propia, con este argumento: **probar primero la forma en el detalle del
mensajero** —una superficie, un nivel— y llevarla a la bodega después, ya validada.

El humano prefirió arreglar los dos de una vez. Su motivo, con sus palabras:
**«necesito que esto que son cierres quede perfecto»**.

Es su decisión y se acata. **Consecuencia directa y medida:** el alcance pasa de **1 superficie** a
**3** (detalle del mensajero + los dos niveles del detalle de bodega), y con ello la complejidad de
la ficha deja de ser `media`. Dentro de un año, esto explica por qué la ficha es del tamaño que es.

---

## Lo confirmado EN EL ARCHIVO REAL (no en el índice del MCP, que miente en las dos direcciones)

Leído en disco el 2026-09-08, **después** de que la mitad de servidor de la ficha 395 se mergeara
(PR #753). Si algo de esto fuera falso al implementar, **PARAR**.

### El detalle del cierre del mensajero

1. **`lib/services/CierresAdminService.ts:662-763`** — `verCierreDetalle` deriva `totalesIngreso`
   (:664), `ganancia` (:671) y `pagoTienda` (:675-679). El `pagoTienda` es
   `pagoTiendaOrdenex(resumen.totales.general, totalesIngreso.fleteConIva,
   totalesIngreso.comisionConIva)`: **un solo número para todo el cierre**.
2. **LA 395 YA ESTÁ AHÍ** (:681-751): añadió `cobradoSobreRecaudado` (:692), `netoOrdenex` (:703),
   `ganaLaTienda` (:713) y el booleano `fleteRechazoYaCobradoATienda` (:723). Los cuatro viajan en
   el DTO (`ICierresAdminService.ts:350-403`). **Esta ficha se apoya en ellos; no los reinventa.**
3. **`lib/utils/ingreso-ordenex.ts:390` — `ganaLaTienda` es NUEVA de la 395**:
   `total_general − ingresoTotal`. Su docstring dice, con estas palabras, que **NO es
   `pagoTiendaOrdenex` y que confundirlas es el fallo que la 395 arregla**. Ver Q7.
4. **`lib/utils/ingreso-ordenex.ts:352-358` — `pagoTiendaOrdenex`** sigue intacta, pura y
   money-safe. Su docstring dice por qué NO descuenta el flete por rechazo.

### El detalle del cierre de bodega

5. **`lib/services/CierresBodegaAdminService.ts:266-387` — `verCierreBodegaDetalle` tiene DOS
   niveles, y los dos sufren el mismo defecto:**
   - **Por mensajero** (:287-341): un `pagoTienda` por cada `cierre_dia` (:312-316). Es
     **exactamente el mismo caso** que el detalle del mensajero.
   - **Agregado de toda la bodega** (:352-356): un `pagoTienda` que suma **todas las tiendas de
     todos los mensajeros**. Es el peor de los tres.
6. **`CierresBodegaAdminModule.tsx:666-756`** monta `CascadaDinero` **dos veces por nivel** (la
   cascada «Lo que va a la central» y la «De quién es el dinero»), una vez para el agregado y una
   vez **por cada mensajero**. El `pagoTienda` entra por `lineasCascadaDueno` (:244-256) con el
   rótulo `PARA_LA_TIENDA_LABEL`.
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
    con **«Tienda»** en la 12ª. **Ya está desagregada.** Por eso Q3 se firmó como «no se toca».

## Alcance

**DENTRO (3 superficies):**
1. El detalle del cierre del MENSAJERO en `/cierres-admin` (`CierresAdminModule` →
   `CierreFacturaDetalle`).
2. El detalle del cierre de BODEGA, **nivel por mensajero** (`CierresBodegaAdminModule`).
3. El detalle del cierre de BODEGA, **nivel agregado**.

**FUERA (y dicho a propósito):**
- El ledger, las wallets y los movimientos: no se toca ni una fila. El dinero ya está bien.
- La vista del mensajero (`CierreDiaModule`): no pinta «Pago a tienda» (punto 6 de la revisión 1;
  el corte `esMensajero` sigue en `cierre-factura.tsx:1810`).
- Las descargas (Q3, punto 14).
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
cada una de esas tiendas y con su nombre, **dos** cifras: **lo recaudado** de esa tienda y **lo que
se le paga** a esa tienda.

**R5.** El sistema NO DEBE mostrar por tienda ninguna cifra de dinero distinta de esas dos.

**R6.** El sistema DEBE agrupar las gestiones por la **tienda congelada en el snapshot del cierre**
(`cierre_detail`), nunca por la tienda VIVA de la orden.

**R7.** El sistema DEBE identificar cada grupo por el **identificador** de la tienda, y usar su
nombre congelado únicamente para mostrarlo.

**R8.** CUANDO el sistema liste las tiendas del desglose, DEBE ordenarlas por **el importe que se
les paga, de mayor a menor**, con un criterio de desempate declarado que haga la secuencia
reproducible.

### C. Las identidades — lo que impide que esto se rompa sin que nadie se entere

**R9.** El sistema DEBE garantizar que la **suma de lo que se paga a cada tienda es exactamente
igual** al importe agregado «Pago a tienda» de ese mismo nivel, sin diferencia de ningún céntimo.

**R10.** El sistema DEBE garantizar que la **suma de lo recaudado atribuido a cada tienda es
exactamente igual** al `total general` de ese mismo nivel.

**R11.** El sistema DEBE atribuir a cada tienda lo recaudado con **exactamente el mismo criterio**
con el que se calcula el total general (mismas gestiones, misma fuente del importe), de modo que
R10 sea cierta por construcción y no por coincidencia.

**R12.** El sistema DEBE calcular todo importe del desglose con **aritmética exacta en el
servidor** y entregarlo como cadena de escala 2. NINGÚN importe del desglose puede sumarse,
restarse ni redondearse en el navegador.

**R13.** El sistema DEBE derivar cada cifra por tienda con **la misma función** que produce su
equivalente agregado, aplicada al subconjunto de esa tienda, y NO con una fórmula escrita aparte.

### D. Lo que NO es por tienda

**R14.** El sistema NO DEBE repartir entre las tiendas el **pago al mensajero** ni el **ingreso de
bodega por rechazos**: son del cierre entero y no existe un reparto decidido.

**R15.** MIENTRAS se muestre el desglose por tienda, el sistema DEBE indicar que esos dos importes
**no están repartidos** y son del cierre completo.

**R16.** El sistema NO DEBE alterar ningún importe hoy visible. En particular DEBEN seguir dando
exactamente el mismo valor: `total general`, `Total Ordenex`, `Pago al mensajero`, `Ganancia`,
`Ingreso de bodega por rechazos`, el agregado «Pago a tienda», y los cuatro campos que la ficha 395
acaba de añadir (`cobradoSobreRecaudado`, `netoOrdenex`, `ganaLaTienda`,
`fleteRechazoYaCobradoATienda`).

### E. El cierre de bodega (Q4)

**R17.** MIENTRAS el detalle de un cierre de bodega esté abierto, el sistema DEBE aplicar R1-R15 al
**nivel por mensajero** de cada cierre del día incluido, con el mismo criterio de umbral: dos o más
tiendas **de ese mensajero**.

**R18.** MIENTRAS el detalle de un cierre de bodega esté abierto, el sistema DEBE aplicar R1-R15 al
**nivel agregado de toda la bodega**, agrupando por tienda **a través de todos los mensajeros
incluidos**.

**R19.** El sistema DEBE garantizar que, en el nivel agregado, la **suma de lo que se paga a cada
tienda es exactamente igual** al «Pago a tienda» agregado de la bodega.

**R20.** El sistema DEBE derivar el desglose de cada nivel de **sus propias gestiones**, y NUNCA de
sumar el de otro nivel ni de repartir el de un nivel superior. SI las dos vías dieran distinto,
ENTONCES la pantalla DEBE mostrar el descuadre, no maquillarlo.

**R21.** El sistema DEBE usar **los mismos rótulos y el mismo componente** en las tres superficies:
la misma plata no puede leerse distinta según por qué pantalla se entre.

### F. Alcance, permisos y no regresión

**R22.** El sistema NO DEBE exponer a ningún rol un dato que no viera ya en esa misma pantalla: el
nombre de la tienda de cada orden ya se muestra por fila en los dos detalles, y el desglose sólo lo
agrega.

**R23.** El sistema DEBE mantener intactas las dos puertas de alcance: la del detalle del mensajero
(fuera de alcance → «no encontrada») y la del detalle de bodega (rol sin acceso total →
«forbidden»). El desglose no puede consultarse por ningún otro camino.

**R24.** El sistema NO DEBE modificar el esquema de la base de datos: esta ficha **no lleva
migración**.

**R25.** El sistema DEBE dejar la vista del cierre del **mensajero** (`/cierre-dia`) sin cambios
visibles.

**R26.** El sistema DEBE dejar las **descargas de cierres** (ambos niveles, las dos pantallas) sin
cambios: ni una columna nueva, ni una que cambie de sitio o de encabezado.

**Total: 26 requisitos.**

---

## Consecuencia que esta ficha habilita (no es trabajo de aquí)

El **flete por rechazo no se descuenta dentro del cierre**: se le carga a la wallet de la tienda al
APROBARLO. El motivo es exactamente el de esta ficha — **el bote es común**, así que descontarlo
dentro del cierre se lo estaría quitando a la otra tienda. Está escrito en el docstring de
`pagoTiendaOrdenex` (`lib/utils/ingreso-ordenex.ts:338-351`) y en `dinero-por-producto.ts:194-199`.

**Si algún día se quiere meter el flete por rechazo dentro del cierre, ESTA ficha es el
prerrequisito**: sin saber qué parte del bote es de cada tienda, no se le puede descontar a la que
corresponde. Queda dicho como consecuencia, no como alcance.

---

## Preguntas abiertas — las dos que abre la revisión 2

Las seis de la revisión 1 están firmadas (ver arriba). Estas dos nacen de lo que se midió al
ajustar el spec, y **no las contesto yo**.

### Q7 — ¿«lo que se le paga» es `pagoTienda` o `ganaLaTienda`?

**No es una duda tipográfica: la ficha 395 acaba de separar esas dos cifras y de decir, en el
docstring de `ganaLaTienda` (`ingreso-ordenex.ts:360-392`), que confundirlas es el fallo que ella
viene a arreglar.** Son dos preguntas distintas sobre el mismo cierre:

- **`pagoTienda`** = lo que se le paga **de este dinero**. No resta el flete por rechazo, porque
  ese flete nunca entró en lo recaudado: se le cobra aparte, contra su wallet.
- **`ganaLaTienda`** = lo que le queda **después** de que también le cobren aquel flete.

Con las cifras reales de producción del 2026-09-08 la diferencia es **₡10.848,00**.

Q1 se firmó con las palabras **«lo que se le paga»**, y la ficha entera nace del rótulo
**«Pago a tienda»**. Por eso **este spec toma `pagoTienda`**, y sólo esa.

Lo que queda por decidir es la consecuencia: **tras la 395, la pantalla muestra las DOS cifras
agregadas.** Si se desglosa una y la otra se queda agregada, ¿confunde? Las opciones son (a)
desglosar sólo `pagoTienda` —lo que este spec asume—, (b) desglosar las dos (pasa de 2 a 3 cifras
por tienda y contradice R5), o (c) desglosar sólo `pagoTienda` y **rotular** que la otra sigue
siendo del cierre entero.

**No bloquea la tanda de servidor** (`design.md §5`: el contrato emite las cifras; la pantalla
decide cuáles pinta).

### Q8 — En el nivel AGREGADO de la bodega, ¿hace falta decir qué mensajero trajo cada parte?

**Aquí SÍ aparece una dimensión nueva, y es la que Q4 trae consigo.** En el detalle del mensajero
el desglose tiene una sola dimensión (tienda). En el **nivel agregado de la bodega** hay dos, y se
cruzan: **una misma tienda puede venir de varios mensajeros**.

R18 dice que se agrupa por tienda a través de todos los mensajeros — o sea, **una fila por tienda**.
Lo que no está decidido es si además hace falta **«de esta tienda, cuánto trajo cada mensajero»**:

| | Qué se ve | Coste |
|---|---|---|
| **a) Sólo por tienda** (lo que R18 asume) | Una fila por tienda en el agregado | Ninguno extra. Pero el cruce tienda×mensajero no se puede leer en ningún sitio |
| **b) Tienda × mensajero** | Por cada tienda, cuánto puso cada mensajero | El desglose pasa a ser una matriz; el modal ya monta 2 cascadas por nivel y por mensajero |

**No la resuelvo.** Si la respuesta es (b), el alcance de esta ficha vuelve a crecer y hay que
volver a hablar del tamaño.

**Nota:** el nivel **por mensajero** de la bodega no tiene esta duda — ahí la dimensión mensajero
está fijada por la sección, así que es el mismo caso que el detalle del mensajero (R17).
