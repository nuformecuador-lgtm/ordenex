# Ficha 396 — «Pago a tienda» dice de quién es cada parte

> Requisitos en notación EARS. Sin detalles de implementación: el CÓMO vive en `design.md`; el
> desglose y las mutaciones, en `tasks.md`. Cada `R<n>` termina mapeado a un test concreto
> (`tasks.md § Trazabilidad`).

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

## Lo confirmado EN EL ARCHIVO REAL (no en el índice del MCP, que miente en las dos direcciones)

Leído en disco el 2026-09-08. Si algo de esto fuera falso al implementar, **PARAR**.

1. **`lib/services/CierresAdminService.ts:661-676`** — `verCierreDetalle` deriva
   `totalesIngreso` (661), `ganancia` (668) y `pagoTienda` (672-676). El `pagoTienda` es
   `pagoTiendaOrdenex(resumen.totales.general, totalesIngreso.fleteConIva,
   totalesIngreso.comisionConIva)`: **un solo número para todo el cierre**.
2. **`lib/utils/ingreso-ordenex.ts:352-358` — `pagoTiendaOrdenex`** existe, es pura y money-safe
   (`Prisma.Decimal`, salida STRING escala 2). Su docstring dice por qué NO descuenta el flete por
   rechazo. **Ese archivo es el sitio donde vive una identidad de dinero: una identidad, un sitio.**
3. **`db/schema.prisma:2241-2307` — `cierre_detail`** congela por fila `tiendaId` (`tienda_id`,
   `:2250`) y `tiendaNombre` (`tienda_nombre`, `:2284`). **La materia prima ya existe y ya está
   congelada.**
4. **`lib/repositories/CierresAdminRepository.ts:164-194` — `DETALLE_ADMIN_SELECT` proyecta
   `tiendaNombre` pero NO `tiendaId`.** La columna existe; la consulta del detalle no la lee.
5. **`lib/repositories/CierresAdminRepository.ts:1267-1282`** — cada gestión del detalle se empareja
   con SU fila congelada por `ordenId`, y **si falta la fila es un error DURO**
   (`CierreDetalleFaltanteError`). Es decir: **toda gestión del detalle tiene tienda**; no hay caso
   «gestión sin tienda» que resolver.
6. **`lib/utils/cierre-totales.ts:77-105` — `computeTotales`** produce `total_general` sumando las
   **líneas de pago (`g.pagos`) de las gestiones `entregada`**, y sólo de ésas.
7. **`lib/services/WalletTiendaFeedService.ts:100-138`** agrupa por `d.tiendaId` del snapshot y
   emite un movimiento por `(tienda, concepto)`. **El agrupamiento por tienda ya existe en el
   sistema**; lo que no existe es en la pantalla.
8. **`lib/utils/dinero-por-producto.ts:200-273` — `repartoDeOrden`** ya parte el pago a tienda por
   OTRA dimensión (el producto) reusando `pagoTiendaOrdenex` sobre subconjuntos. **Precedente
   directo del patrón**, con su invariante escrita: `ordenex + tienda === liquidadoRecaudado`.
9. **`app/(app)/cierres-admin/_components/cierre-detalle-shared.tsx:324-335`** — `PAGO_TIENDA_LABEL`
   = `"Pago a tienda"` y `PAGO_TIENDA_NOTA`. La tarjeta se pinta en
   **`cierre-factura.tsx:1810-1818`**, dentro de `CierreFacturaDetalle`.
10. **`CierreFacturaDetalle` lo montan DOS pantallas**: `CierresAdminModule.tsx:1150-1168`
    (admin) y `app/(app)/cierre-dia/_components/CierreDiaModule.tsx` (mensajero). En la del
    mensajero la tarjeta **no se pinta** (`esMensajero` corta en `:1810`), así que esta ficha no
    toca lo que ve un mensajero.
11. **LA DESCARGA NO SUFRE ESTE DEFECTO — medido, no supuesto.** El selector tiene dos niveles
    (`DescargarCierresButton.tsx:93-127`):
    - **Resumen** (una fila por cierre): `cierres-admin-descarga-columnas.ts:52-89` →
      Estado · Mensajero · Fecha · Destino · Total general · Pago mensajero · Ingreso bodega ·
      Motivo. **No hay ninguna columna «Pago a tienda».**
    - **Detalle** (una fila por gestión): `cierres-gestiones-fundida-descarga-columnas.ts:244-276`
      → 31 columnas, entre ellas **«Tienda»** (`:257`), `Flete + IVA`, `Comisión + IVA`, `Recibido`
      y los tres medios de pago. **Ya está desagregada por gestión y ya dice de qué tienda es cada
      fila.**

    Conclusión medida: **el archivo no agrupa nada que oculte la tienda.** Añadirle una columna
    nueva sería trabajo adicional, no un arreglo — ver Q3.

## Alcance

**DENTRO:** el detalle del cierre del MENSAJERO en `/cierres-admin` (`CierresAdminModule` →
`CierreFacturaDetalle`) y la derivación que lo alimenta (`CierresAdminService.verCierreDetalle`).

**FUERA (y dicho a propósito):**
- El ledger, las wallets y los movimientos: no se toca ni una fila. El dinero ya está bien.
- El detalle del cierre de BODEGA (`CierresBodegaAdminModule`), que agrega N mensajeros × M
  tiendas — mismo defecto, más grande. Ver Q4.
- La vista del mensajero (`CierreDiaModule`): no pinta «Pago a tienda» (punto 10).
- La descarga: no se toca (punto 11). Ver Q3.
- **Meter el flete por rechazo dentro del cierre.** Ver «Consecuencia» al final.

---

## Requisitos

### A. La verdad del rótulo (el arreglo mínimo, y el que resuelve la confusión medida)

**R1.** MIENTRAS el detalle de un cierre esté abierto, el sistema DEBE mostrar, junto al importe
rotulado «Pago a tienda», **de cuántas tiendas se compone ese importe**.

**R2.** SI el cierre tiene órdenes de **exactamente una** tienda, ENTONCES el sistema DEBE mostrar
**el nombre de esa tienda** junto al importe.

**R3.** SI el cierre tiene órdenes de **dos o más** tiendas, ENTONCES el sistema DEBE indicar
explícitamente que el importe mostrado es un **total agregado de varias tiendas**, y NO puede
presentarlo con un rótulo en singular sin esa marca.

**R4.** El sistema DEBE emitir el rótulo y su marca desde una constante de texto única y exportada,
nunca desde un literal escrito en el componente.

### B. El desglose por tienda

**R5.** MIENTRAS el detalle de un cierre esté abierto, el sistema DEBE poder mostrar, **por cada
tienda con órdenes en ese cierre**, el importe que se le paga a **esa** tienda.

**R6.** El sistema DEBE agrupar las gestiones del cierre por la **tienda congelada en el snapshot
del cierre** (`cierre_detail`), nunca por la tienda VIVA de la orden.

**R7.** El sistema DEBE identificar cada grupo por el **identificador** de la tienda, y usar su
nombre congelado únicamente para mostrarlo.

**R8.** CUANDO el sistema liste las tiendas del desglose, DEBE hacerlo en un **orden determinista y
declarado**, de modo que dos lecturas del mismo cierre produzcan la misma secuencia.

**R9.** SI un cierre tiene órdenes de una sola tienda, ENTONCES el desglose DEBE seguir siendo
coherente con el total (una sola parte, igual al total) y NO puede hacer la lectura más larga o más
confusa que la de hoy.

### C. Las identidades — lo que impide que esto se rompa sin que nadie se entere

**R10.** El sistema DEBE garantizar que la **suma de los importes por tienda es exactamente igual**
al importe agregado «Pago a tienda» del mismo cierre, sin diferencia de ningún céntimo.

**R11.** El sistema DEBE garantizar que la **suma de lo recaudado atribuido a cada tienda es
exactamente igual** al `total general` del cierre.

**R12.** El sistema DEBE atribuir a cada tienda lo recaudado con **exactamente el mismo criterio**
con el que se calcula el total general del cierre (mismas gestiones, misma fuente del importe), de
modo que R11 sea cierta por construcción y no por coincidencia.

**R13.** El sistema DEBE calcular todo importe del desglose con **aritmética exacta en el servidor**
y entregarlo como cadena de escala 2. NINGÚN importe del desglose puede sumarse, restarse ni
redondearse en el navegador.

**R14.** El sistema DEBE derivar el importe por tienda con **la misma función** que produce el
importe agregado, aplicada al subconjunto de esa tienda, y NO con una fórmula escrita aparte.

### D. Lo que NO es por tienda

**R15.** El sistema NO DEBE repartir entre las tiendas el **pago al mensajero** ni el **ingreso de
bodega por rechazos**: son del cierre entero y no existe un reparto decidido.

**R16.** MIENTRAS se muestre el desglose por tienda, el sistema DEBE indicar que esos dos importes
**no están repartidos** y son del cierre completo.

**R17.** El sistema NO DEBE alterar ningún importe hoy visible: `total general`, `Total Ordenex`,
`Pago al mensajero`, `Ganancia`, `Ingreso de bodega por rechazos` y el propio agregado «Pago a
tienda» DEBEN seguir dando exactamente el mismo valor que antes de esta ficha.

### E. Alcance, permisos y no regresión

**R18.** El sistema NO DEBE exponer a ningún rol un dato que no viera ya en esa misma pantalla: el
nombre de la tienda de cada orden ya se muestra por fila en el detalle, y el desglose sólo lo
agrega.

**R19.** El sistema DEBE mantener la puerta de alcance del detalle intacta: un cierre fuera del
alcance del actor sigue respondiendo «no encontrada», y el desglose no puede consultarse por otro
camino.

**R20.** El sistema NO DEBE modificar el esquema de la base de datos: esta ficha **no lleva
migración**.

**R21.** El sistema DEBE dejar la vista del cierre del **mensajero** sin cambios visibles.

**R22.** El sistema DEBE dejar las **descargas de cierres** (ambos niveles) sin cambios: ni una
columna nueva, ni una que cambie de sitio o de encabezado.

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

## Preguntas abiertas — necesitan firma humana antes de implementar

### Q1 — ¿Qué se desglosa, y qué se deja agregado? (LA decisión de la ficha)

Enseñar cinco líneas por cada una de dos tiendas puede ser peor que el problema. Las opciones,
con su coste:

| | Qué se ve por tienda | Líneas nuevas (cierre de 2 tiendas) | Qué resuelve | Qué deja fuera |
|---|---|---|---|---|
| **A. Sólo el pago** | Su «Pago a tienda» | 2 | La confusión medida, entera | No se ve de dónde sale ese número por tienda |
| **B. Pago + lo recaudado** | Lo recaudado de esa tienda y su pago | 4 | Además, cuadrar contra lo que el mensajero trajo | Sigue sin verse lo que Ordenex cobró a cada una |
| **C. La cascada entera** | Recaudado − (flete+IVA) − (comisión+IVA) = pago | 8 | La historia completa por tienda | Panel largo; en 39 de 56 cierres sobra |
| **D. Sólo el rótulo (R1-R4)** | Nada; sólo se dice que es agregado y de cuántas | 0 | Que nadie lea mal el número | No dice cuánto es de cada una |

Los requisitos R1-R4 (opción D) están escritos como **firmes**: son ciertos en cualquiera de las
cuatro. R5-R14 describen el desglose y **su contenido depende de esta respuesta**.

**No la contesto yo.** ¿A, B, C o D?

### Q2 — ¿Se acepta que el pago al mensajero y el ingreso de bodega queden agregados?

R15/R16 lo dan por hecho: repartirlos sería **inventar un reparto que nadie ha decidido** (¿por
número de órdenes? ¿por importe recaudado? Las dos son defendibles y ninguna está firmada). Lo que
esta ficha propone es **decirlo en pantalla**, no repartirlo. ¿Se confirma?

### Q3 — ¿Y la descarga?

**Medido (punto 11 de arriba): la descarga NO tiene el defecto.** El nivel Detalle es una fila por
gestión y ya trae «Tienda»; el nivel Resumen no muestra «Pago a tienda» en absoluto. Por eso R22 dice
«no se toca».

La pregunta que queda no es un arreglo, es un añadido: **¿se quiere una columna «Pago a tienda» en
el nivel Resumen?** Si el cierre lleva dos tiendas, esa columna tendría el mismo problema que la
pantalla — una fila por cierre no puede llevar dos valores sin partirse en dos filas, y partirla
cambiaría el significado del nivel («una fila por cierre»). Por defecto: **no se hace**.

### Q4 — ¿Aplica también al detalle del cierre de BODEGA?

`CierresBodegaAdminModule` agrega **N mensajeros × M tiendas** en su propio «Pago a tienda»
(`CierresBodegaAdminService.ts:352`), así que ahí el mismo defecto es mayor. Está **fuera del
alcance** declarado arriba. ¿Se quiere en esta ficha (más superficie, misma derivación) o en una
propia?

### Q5 — ¿El desglose se pinta siempre, o sólo cuando hay dos o más tiendas?

39 de 56 cierres tienen una sola tienda. Pintar siempre da una lectura uniforme y hace el desglose
auditable en todos; pintar sólo con ≥2 evita una sección de una línea en el 70 % de los casos —pero
entonces R2 (decir el nombre de la tienda única) es lo único que queda ahí, y hay que confirmar que
basta.

### Q6 — Orden de las tiendas (R8): ¿por importe descendente, o por nombre?

Por importe pone arriba la que más pesa; por nombre es estable entre cierres distintos. Hace falta
elegir uno para que el test pueda afirmar contra una secuencia literal.
