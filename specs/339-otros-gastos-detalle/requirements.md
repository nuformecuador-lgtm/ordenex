# Ficha 339 — «Otros gastos de Ordenex» deja de esconder el gasto más grande

> Requisitos en notación EARS. Sin detalles de implementación: el CÓMO vive en `design.md`.
> Cada `R<n>` termina mapeado a un test concreto en `tasks.md § Trazabilidad`.

## Contexto medido (2026-08-31, contra producción)

La tarjeta «Cómo se compone la ganancia de Ordenex» (`/wallet`) pinta una fila
**«Otros gastos de Ordenex» = 227.300,00**, que es el **100 % de los egresos** del periodo. Dentro
hay **9 movimientos de `egreso_pago_mensajero`**: pagos a mensajeros, una categoría con nombre
propio, no un residuo. El humano abrió la wallet y preguntó «¿cómo sé cuáles son estos gastos? no
existe un detalle ni una claridad».

Tres hechos confirmados **en el archivo real**, no derivados del índice:

1. `lib/types/wallet.ts` — `WALLET_EGRESO_DESGLOSADO_SEED` tiene **cuatro** categorías con fila
   propia (`egreso_gasto_fijo`, `egreso_gasto_variable`, `egreso_sueldo`, `egreso_indemnizacion`).
   Todo egreso propio que no esté ahí **cae en «otros» por construcción**: hoy
   `egreso_pago_mensajero`, `egreso_ajuste` y el reservado `egreso_gasto`.
2. Es el **único cubo genérico** de la wallet: `OTROS_EGRESOS_LABEL` sólo aparece en
   `DesgloseEgresosLista.tsx`. Del lado de los **ingresos no hay cubo** —
   `WALLET_INGRESO_PROPIO_SEED` los enumera todos, y hasta «Ajuste (ingreso)» tiene su fila. La
   asimetría es sólo del lado del gasto.
3. **El código ya lo vio a medias.** El docstring de `DESCRIPCION` en `ComposicionGananciaCard.tsx`
   cuenta que la primera versión del texto se callaba el pago a mensajeros y se corrigió porque una
   lista parcial de lo que entra induce a error sobre dinero. Se arregló el TEXTO y se dejó la FILA
   llamándose «Otros». **Esta ficha termina ese arreglo.**

Riesgo vivo que la ficha también cierra: el diálogo «Registrar movimiento» de `/wallet` escribe
`egreso_ajuste` y le promete al usuario, por `nombreEnElLibro`, que el movimiento se llamará «Ajuste
(egreso)». Hoy ese gasto **no se encuentra por su nombre en esta tarjeta**: cae en el cubo. Hay 0 en
producción, así que todavía no ha mordido.

---

## 1 — Las filas: cada gasto con su nombre

**R1.** El sistema DEBE mostrar, en la columna de egresos de la tarjeta «Cómo se compone la ganancia
de Ordenex», una fila propia y rotulada para los **pagos a mensajeros**.

**R2.** El sistema DEBE mostrar, en esa misma columna, una fila propia y rotulada para los **ajustes
de egreso** de la caja.

**R3.** El sistema DEBE rotular la fila de los ajustes de egreso con el mismo concepto que el diálogo
«Registrar movimiento» promete que tendrá ese movimiento, de modo que quien registró un gasto a mano
pueda encontrarlo por su nombre.

**R4.** El importe de cada fila de la columna de egresos DEBE ser el total de su concepto sobre el
MISMO conjunto que la tarjeta está mostrando.

**R5.** El sistema DEBE rotular cada fila con su etiqueta legible y NUNCA con el valor del enum de la
categoría.

**R6.** El sistema DEBE mantener el orden de las filas DECLARADO, y NO el orden de magnitud de sus
importes.

## 2 — «Otros» sólo cuando de verdad queda algo

**R7.** MIENTRAS no quede ningún egreso propio sin fila propia con importe distinto de cero, el
sistema NO DEBE pintar la fila «Otros gastos de Ordenex».

**R8.** SI queda al menos un egreso propio sin fila propia y su total es distinto de cero, ENTONCES
el sistema DEBE pintar la fila «Otros gastos de Ordenex» con ese total.

**R9.** El sistema DEBE decidir en el SERVIDOR si la fila «Otros gastos de Ordenex» se pinta; el
navegador NO DEBE comparar importes para tomar esa decisión.

**R10.** DONDE se pinte la fila «Otros gastos de Ordenex», el sistema DEBE acompañarla de un texto
que diga que ahí hay dinero de un concepto que la tarjeta todavía no sabe nombrar.

## 3 — Las cifras no se mueven

**R11.** La suma de las filas de la columna de egresos DEBE ser igual, importe a importe, al total de
egresos que esa misma columna muestra.

**R12.** El total de egresos DEBE valer EXACTAMENTE lo mismo antes y después de esta ficha: sacar los
pagos a mensajeros y los ajustes de «Otros» no cambia ninguna cifra agregada.

**R13.** Toda categoría de egreso propio del catálogo DEBE aportar su importe a EXACTAMENTE una fila:
ni a dos, ni a ninguna.

**R14.** El sistema NO DEBE cambiar el valor de ninguna de las cifras agregadas de la caja (las del
resumen de la caja ni los cuatro conceptos del desglose de egresos).

## 4 — Abrir una fila y ver lo que hay dentro

**R15.** CUANDO una persona abre una fila de concepto de la tarjeta, el sistema DEBE mostrar los
movimientos que componen el importe de esa fila.

**R16.** Cada movimiento del detalle DEBE mostrar su **fecha**, su **concepto**, su **descripción** y
su **importe**.

**R17.** SI un movimiento no tiene descripción, ENTONCES el sistema DEBE mostrar en su lugar el
origen legible del movimiento, de modo que ninguna fila del detalle quede muda.

**R18.** El detalle de una fila DEBE contener EXACTAMENTE los movimientos cuyo importe compone esa
fila: ni uno de más ni uno de menos.

**R19.** La suma de los importes de TODOS los movimientos del detalle de una fila DEBE ser igual al
importe que esa fila muestra.

**R20.** El detalle DEBE respetar los filtros vigentes de la wallet (tipo, categoría y rango de
fechas): el detalle y el importe de la fila hablan siempre del mismo conjunto.

**R21.** MIENTRAS una fila esté cerrada, el sistema NO DEBE leer sus movimientos.

**R22.** CUANDO se abre una fila, el sistema DEBE leer exactamente una página de movimientos.

**R23.** El sistema DEBE dar a cada fila abierta su propia página y su propio estado: abrir dos filas
a la vez no DEBE hacer que una pise a la otra.

**R24.** El sistema DEBE dar al control que abre cada fila un nombre accesible que identifique SU
fila, y NO un texto genérico repetido.

**R25.** SI el detalle de una fila no tiene ningún movimiento, ENTONCES el sistema DEBE decirlo con
un estado vacío explícito.

**R26.** SI la lectura del detalle de una fila falla, ENTONCES el sistema DEBE contar el fallo DENTRO
de esa fila y el resto de la tarjeta DEBE seguir mostrándose.

## 5 — El detalle pagina, y el total lo da el servidor

**R27.** El sistema DEBE paginar el detalle de una fila.

**R28.** CUANDO el conjunto de una fila supera el tamaño de página, el sistema DEBE ofrecer navegar a
las páginas siguientes.

**R29.** El sistema DEBE tomar el tamaño de página del detalle y su tope máximo de la CONFIGURACIÓN;
la pantalla NO DEBE declarar ninguno de los dos como literal.

**R30.** El sistema DEBE ser capaz de sobreescribir ese tamaño de página y ese tope por variable de
entorno, y SI el valor de entorno no es un entero positivo, ENTONCES DEBE caer en el valor por
defecto.

**R31.** El número total de movimientos de una fila DEBE venir del SERVIDOR y NUNCA del largo de la
página que se está pintando.

**R32.** SI el borde recibe un tamaño de página mayor que el tope configurado, ENTONCES DEBE
rechazarlo como error de validación y NO DEBE devolver ningún movimiento.

**R33.** El sistema DEBE acotar la lectura del detalle en la CONSULTA A LA BASE, y NO filtrando en
memoria lo que la base ya devolvió.

## 6 — Dinero: ni una operación nueva

**R34.** Los importes DEBEN cruzar la frontera servidor→navegador como texto.

**R35.** El navegador NO DEBE convertir ningún importe a número ni operar aritméticamente con él, ni
en la tarjeta ni en el detalle.

**R36.** El sistema NO DEBE mostrar en el detalle ningún subtotal de la página visible.

**R37.** El sistema NO DEBE introducir ninguna resta con signo ni ninguna definición nueva de signo
en la derivación de las cifras de la caja.

## 7 — Alcance

**R38.** SI el actor no tiene acceso total, ENTONCES la lectura del detalle DEBE responder denegado y
NO DEBE devolver ningún movimiento.

**R39.** El sistema DEBE evaluar el permiso ANTES de consultar la base.

**R40.** El sistema NO DEBE cambiar el alcance por rol vigente ni añadir permisos nuevos.

## 8 — Lo que la tarjeta dice de sí misma

**R41.** La descripción de la tarjeta DEBE nombrar TODOS los conceptos que entran en la ganancia,
incluidos los ajustes, o no enumerar ninguno.

**R42.** La descripción de la tarjeta DEBE seguir diciendo qué NO entra en la ganancia (el dinero de
las tiendas).

---

## Fuera de alcance (declarado)

- No se toca el **libro de movimientos** de la caja, ni sus filtros, ni su descarga.
- No se toca `DesgloseEgresosDTO` ni el camino que lo sirve: los cuatro conceptos de las fichas
  45/158 siguen viniendo por donde vienen hoy.
- No se toca `/mi-wallet`, `/wallet/tiendas` ni `/wallet/mensajeros`.
- No se añade ninguna migración, ninguna columna ni ningún valor de enum.
- El detalle **no ofrece descarga propia** (motivo en `design.md § 9`).

---

## Preguntas abiertas

> Ninguna bloquea la implementación: cada una lleva el valor por defecto que `design.md` asume, y
> cambiarlo cuesta una línea. Se listan porque son decisiones visibles que el humano puede querer.

**Q1 — ¿Se abren también las filas de la columna de INGRESOS?**
La decisión escrita dice «**cada fila** se puede abrir», y la evidencia medida es toda del lado de
los egresos. El mecanismo cuesta lo mismo para las dos columnas y una asimetría nueva sería
exactamente el defecto que esta ficha diagnostica, así que **el diseño asume que SÍ: las 7 filas de
ingreso también abren**. Si se quiere acotar sólo a egresos, se retira el cableado de la columna
izquierda y los `R15`–`R26` pasan a hablar sólo de la derecha.

**Q2 — ¿Dónde va la fila «Pagos a mensajeros» dentro de la columna?**
El orden declarado de la columna es «del más recurrente al más excepcional» (no por magnitud, `R6`).
El pago a mensajeros se emite en CADA aprobación de cierre, así que es el más recurrente de todos, y
además es el concepto que la ficha existe para sacar a la luz: **el diseño lo pone PRIMERO**, antes
de «Gastos fijos». Si se prefiere conservar intacto el orden actual y añadirlo al final, es un
cambio de una línea en la lista de filas y de una línea en la aserción literal de su test.

**Q3 — ¿El día que «Otros» aparezca con importe, basta con que se pinte?**
El diseño resuelve `R10` con una pista de texto en la propia fila. NO se emite aviso, ni toast, ni
insignia de alerta. Si se quiere que ese caso grite más (es, por definición, dinero que el sistema no
sabe clasificar), hay que decirlo: el sitio donde se decide es el mismo componente.

**Q4 — `egreso_gasto` se queda como el único residuo posible.**
Es una categoría **reservada sin ningún escritor en el árbol** (medido: sólo aparece en catálogos —
`lib/types/wallet.ts` y `lib/analytics/metrics.ts` —, ningún servicio la emite). Por eso, tras esta
ficha, «Otros» vale 0,00 y desaparece. No se propone retirarla del enum: quitar un valor de un enum
de Postgres no es reversible con una migración barata y esta ficha no lo pide. Queda dicho para que
nadie lo lea como un olvido.
