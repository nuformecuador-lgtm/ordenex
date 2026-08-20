# Feature 240 — El rechazo manual de la tienda y la limpieza de la card de novedades

> **Lo que esta ficha cierra, en una frase:** hoy `devuelta → rechazada` **sólo la dispara el cron**,
> el botón que dice «Rechazar» es una **maqueta desde el 2026-08-12** —avisa por toast y no muta
> nada— y «Habilitar» aparece **justo en las cards que vienen de un cierre**, al revés de lo que el
> pedido humano decía. Esta ficha abre la arista para la tienda, cablea el botón, borra la celda
> equivocada de la tabla y **pone la guardia que impide que un botón vuelva a quedarse en maqueta
> dos semanas sin que nadie lo note**.
>
> **Fuentes leídas en el árbol, con archivo y línea. Donde falta un número está declarado como
> medición pendiente (T0), no rellenado:**
> `progress/auditoria_ayuda_tienda.md` §3, §4 y §6 ·
> `progress/design_pila_ayuda_tienda.md` §F6 ·
> `specs/236-ayuda-tienda-novedades/` (entera: montó `ACCIONES_POR_GRUPO`, el punto único del juego
> de botones) · `specs/237-gestion-tienda-ayuda/` (comparte con ésta `ACCIONES_POR_GRUPO`,
> `NovedadesModule`, `NovedadAcciones` y la familia de «gestión registrada por la tienda») ·
> `specs/239-devolucion-espera-cierre/` (de ahí viene la dependencia: la aprobación del cierre **es**
> la transición a `devuelta` y **arranca el reloj**) ·
> `specs/238-confirmacion-fisica-cierre/` como molde de forma y de rigor.
>
> **Base:** `origin/dev` con la **235, 236, 237, 238 y 239 ya dentro** (la 237 mergeada el
> 2026-08-20). La ficha **deja de estar bloqueada** con la entrada de la 237.

---

## Los tres defectos que arregla, verificados en el código

1. **El punto 12 está AL REVÉS, y hoy vive en una celda de una tabla.**
   `app/(app)/novedades/_components/novedad-acciones-catalogo.ts:104` —
   `devolucion: ["contacto", "reprogramar", "habilitar", "rechazar"]`. La 236 trasladó ahí la
   condición suelta `puedeHabilitar = esDevuelta || esAyuda` **sin arreglarla**, con su comentario y
   su dueño escritos (`:63-68`: «su dueño es la ficha 240… corregirlo pasa a ser borrar una palabra
   de esta línea»). Corregirlo es, literalmente, borrar `"habilitar"` de esa lista.
2. **«Rechazar» es una MAQUETA.** `NovedadesModule.tsx:278-280` — `avisarNoDisponible()` hace
   `toast.info("Esta acción todavía no está disponible.")` y se pasa como `onDevolver`
   (`:490`). El **rótulo** ya se corrigió el 2026-08-19 (`NovedadAcciones.tsx:141-149`: la etiqueta,
   el tooltip y el nombre accesible dicen «Rechazar»; la **prop** sigue llamándose `onDevolver`
   porque nombra la transición que faltaba decidir). Lo que falta es la mitad que hace algo.
3. **No hay guardia que impida repetirlo.** `superficie-de-uso.guardia.test.ts` cubre tres capas
   —acción sin superficie, componente sin quien lo monte, handler sin quien lo llame— y **ninguna de
   las tres ve una maqueta**: `avisarNoDisponible` está declarada, referenciada y montada. Su verde
   es correcto y no dice nada sobre si el botón hace algo.

## Lo que esta ficha NO arregla y por qué está escrito aquí

- **La transición `devuelta → rechazada` la produce hoy un solo sitio**
  (`DevolucionSlaRepository.escalarDevueltaSla`, arista #21). Abrirla a una persona **cambia quién
  puede mover dinero**: ver §C y **D1/D2**.
- **El botón «Notas» no vuelve** porque la 236 le dio a la lectura del hilo su propia acción
  (`conversacion`) y **sólo en el grupo de ayuda**. Esta ficha lo convierte en requisito con su
  test (R36), que es lo que la auditoría §3 echaba en falta.

---

## Vocabulario

| Término | Qué significa aquí |
| --- | --- |
| **la devolución anclada** | El estatus `devuelta`: la devolución que la aprobación del cierre confirmó (feature 239). Es donde corre el plazo y donde la tienda la ve. |
| **el rechazo** | El estatus `rechazada`: la orden no se entrega y el paquete vuelve a la tienda de origen por el flujo de devolución (139). |
| **el rechazo por plazo vencido** | Lo que hace el cron hoy: `escalarDevueltaSla`, familia `escalado_devuelta_sla`, con su gestión sintética. |
| **el rechazo manual** | Lo que esta ficha añade: la misma llegada a `rechazada`, decidida por la administración de la tienda dueña. |
| **la gestión sintética** | Fila de `gestion_orden` que **no nace de una visita**, creada con `cierre_id NULL` para que la recoja el siguiente cierre del mensajero. Ya existen dos productores: el cron (99) y la reprogramación de escritorio (100). |
| **la tabla de acciones** | `ACCIONES_POR_GRUPO`, el punto único donde se decide qué botones ofrece una fila de `/novedades` (feature 236, R18/R19). |
| **maqueta** | Un control visible cuyo handler no produce ninguna operación: sólo avisa. |

---

## A · La arista `devuelta → rechazada` para la tienda

**R1.** El sistema DEBE permitir que la administración de la tienda dueña de una orden lleve esa
orden desde la devolución anclada al rechazo.

**R2.** SI el actor no es la administración de la tienda dueña de esa orden, ENTONCES el sistema NO
DEBE aplicar el rechazo, NO DEBE dejar ningún efecto y NO DEBE revelar el estado de la orden.

**R3.** SI la orden no está en la devolución anclada en el instante de aplicar el rechazo, ENTONCES
el sistema NO DEBE dejar **ningún** efecto: ni cambio de estado, ni gestión, ni fila de historial, ni
movimiento de dinero.

**R4.** El sistema DEBE comprobar el estado de origen **en la misma sentencia que lo cambia**, de
modo que entre comprobar y escribir no quede ninguna ventana.

**R5.** CUANDO el rechazo se envía dos veces sobre la misma orden, el sistema DEBE producir sus
efectos **una sola vez**, sin ningún mecanismo de idempotencia distinto de la guarda de R4.

**R6.** El sistema DEBE declarar esa transición en el catálogo de transiciones con una **familia de
origen propia**, distinta de la del rechazo por plazo vencido y distinta de la de una gestión del
mensajero, y DEBE declararla **en el mismo cambio que su productor**.

**R7.** El sistema NO DEBE declarar ninguna otra salida nueva de la devolución anclada.

---

## B · Lo que se escribe

**R8.** CUANDO el rechazo se aplica, el sistema DEBE registrar una gestión con resultado de rechazo,
**sin cierre asignado**, de modo que la recoja el siguiente cierre por el mismo mecanismo que vincula
las gestiones del mensajero.

**R9.** El sistema DEBE atribuir esa gestión **al mensajero de la última gestión de devolución
vigente de la orden**, y NO a la tienda que la registró.

**R10.** SI la orden no tiene ninguna gestión de devolución vigente de la que derivar ese mensajero,
ENTONCES el sistema NO DEBE aplicar el rechazo ni dejar efectos parciales.

**R11.** CUANDO el rechazo se aplica, el sistema DEBE registrar en el historial de estados **quién lo
decidió** —la persona de la tienda— y DEBE enlazar esa fila con la gestión creada.

**R12.** El sistema DEBE exigir un **motivo escrito** para aplicar el rechazo, y DEBE conservarlo
tanto en la gestión como en la fila de historial.

**R13.** El sistema NO DEBE exigir evidencia en imagen para este rechazo.

**R14.** CUANDO el rechazo se aplica, el sistema NO DEBE modificar el mensajero asignado de la orden,
ni su prioridad, ni ningún monto de la orden, ni el puntero de la orden en gestión de ningún
mensajero.

**R15.** El sistema DEBE escribir el cambio de estado, la gestión y la fila de historial en **una
sola transacción**, y la transición DEBE pasar por el punto único de registro de cambios de estado.

**R16.** El sistema NO DEBE atribuir a esa gestión ninguna causa de devolución ni ningún dato de
ubicación.

---

## C · El dinero

**R17.** El sistema DEBE hacer que el rechazo manual mueva **exactamente el mismo dinero** que el
rechazo por plazo vencido, **sin introducir aritmética monetaria nueva**.

**R18.** El sistema NO DEBE emitir ningún movimiento de dinero en el instante del rechazo: los
movimientos DEBEN producirse al aprobarse el cierre que recoja esa gestión.

**R19.** El sistema NO DEBE hacer que el rechazo manual sume un intento de entrega adicional sobre
una orden que ya contó el intento de su devolución.

**R20.** El sistema DEBE calcular y transportar todo importe con aritmética decimal y NO DEBE usar
números de coma flotante ni conversiones de texto a número para ningún monto.

**R21.** El sistema NO DEBE producir dos veces el ingreso de bodega por rechazo sobre la misma orden
por causa de un segundo envío, de una re-corrida o de una carrera con el cron.

**R22.** El sistema NO DEBE alterar la derivación de conceptos de ingreso a partir del resultado de
una gestión, de modo que el rechazo manual y el rechazo por plazo vencido facturen lo mismo.

---

## D · El reloj de la 239

**R23.** CUANDO la tienda rechaza a mano, el sistema DEBE dejar de considerar esa orden candidata del
proceso de plazo vencido, **sin ninguna escritura adicional destinada a detener el reloj**.

**R24.** El sistema NO DEBE re-anclar, borrar ni modificar el registro de anclaje de la devolución de
esa orden.

**R25.** El sistema NO DEBE exigir que el plazo de la devolución haya vencido para permitir el
rechazo manual.

**R26.** El sistema NO DEBE clasificar el rechazo manual como un rechazo por plazo vencido, ni
listarlo en la superficie de rechazos por plazo vencido.

---

## E · La pantalla: «Rechazar» deja de ser una maqueta

**R27.** MIENTRAS una orden esté en la devolución anclada, el sistema DEBE ofrecer sobre su fila una
acción de rechazo rotulada **«Rechazar»**.

**R28.** CUANDO la persona de la tienda usa esa acción, el sistema DEBE pedirle el motivo y DEBE
decirle **antes de confirmar** qué consecuencia económica tiene y que la decisión **no se puede
deshacer**.

**R29.** El sistema NO DEBE permitir confirmar el rechazo sin motivo, y DEBE decir **con texto** por
qué la confirmación está bloqueada.

**R30.** CUANDO el rechazo se aplica, el sistema DEBE dejar de listar esa orden en la superficie de
devoluciones y DEBE reflejarlo en su total.

**R31.** SI el rechazo no se aplica porque la orden ya no estaba en la devolución anclada, ENTONCES
el sistema NO DEBE afirmar que la rechazó y DEBE decir qué ocurrió.

**R32.** El sistema NO DEBE ofrecer en esa pantalla ninguna acción que no tenga detrás una operación
real.

---

## F · «Habilitar» sale de las cards que vienen de un cierre

**R33.** El sistema NO DEBE ofrecer la acción de devolver la orden a la ruta sobre las órdenes en la
devolución anclada.

**R34.** MIENTRAS una orden esté en el estatus de ayuda, el sistema DEBE seguir ofreciendo esa
acción sobre su fila.

**R35.** El sistema NO DEBE cambiar el contrato del resultado de esa acción ni lo que su servicio
escribe.

**R36.** El sistema NO DEBE ofrecer la lectura del hilo de notas sobre las órdenes en la devolución
anclada.

---

## G · La guardia que impide que un botón vuelva a quedarse en maqueta

**R37.** El sistema NO DEBE compilar si una acción de la pantalla de novedades se declara sin decir
**qué operación la produce**.

**R38.** El sistema DEBE fallar la verificación si una acción declara una operación que **no existe**
en el árbol, o que **ningún archivo de esa pantalla usa**.

**R39.** El sistema DEBE exigir un motivo escrito y legible para declarar que una acción no produce
ninguna operación, y DEBE fallar la verificación si ese motivo falta, es de relleno o es
telegráfico.

**R40.** La guardia DEBE probar sus propios detectores contra fuente con la infracción plantada, en
las dos direcciones, antes de afirmar nada sobre el árbol real.

---

## H · Lo que esta ficha NO cambia

**R41.** El sistema NO DEBE cambiar el proceso automático de plazo vencido: ni sus ventanas, ni su
anclaje, ni lo que escribe, ni a quién lo atribuye.

**R42.** El sistema NO DEBE cambiar lo que el mensajero ve ni puede hacer en su portal.

**R43.** SI el mensajero intenta deshacer una gestión que registró la tienda, ENTONCES el sistema NO
DEBE deshacerla y DEBE decirle por qué, **sin nombrar una pantalla que no corresponda a esa
gestión**.

**R44.** El sistema NO DEBE añadir ningún estado de orden, ninguna otra transición, ni ningún valor
al vocabulario público de eventos.

**R45.** El sistema NO DEBE emitir el aviso interno de «orden rechazada por el destinatario» por
causa de un rechazo manual de la tienda.

**R46.** Ningún registro de diagnóstico producido por esta feature DEBE contener datos personales,
teléfonos, direcciones, el cuerpo de una nota ni secretos.

**R47.** El sistema DEBE poder revertir la migración de esta feature, y SI al revertirla queda alguna
fila que use el valor nuevo, ENTONCES la reversión DEBE fallar de forma ruidosa en vez de borrar ese
rastro.

---

## Lo que YA funciona y NO se rehace

- **El punto único de los botones** (`ACCIONES_POR_GRUPO`) y su guardia
  (`tests/unit/guards/novedad-acciones-una-tabla.guardia.test.ts`). Esta ficha **borra y añade
  celdas**, no vuelve a las condiciones sueltas.
- **El molde de la transición de escritorio desde `devuelta`**:
  `GestionOrdenRepository.reprogramarDesdeDevuelta` (feature 100) ya hace exactamente esta forma
  —`updateMany` guardado, mensajero derivado de la gestión vigente, `cierre_id NULL`, append con
  actor = la tienda y familia propia—.
- **El borde y el servicio de escritorio**: `lib/actions/resolver-novedad.ts` y
  `ReprogramacionTiendaService` son el espejo exacto de lo que hace falta.
- **La derivación del dinero**: `ingresoBodegaPorResultado` (56) y `derivarIngresoOrden` (42/43)
  cobran a partir del `resultado`. Esta ficha **no escribe una línea de aritmética**.
- **El bloqueo del deshacer del mensajero** (237/D3): existe la guarda, el mensaje y su predicado por
  familia. Esta ficha **amplía el predicado**, no escribe una segunda guarda.
- **La ventana modal de escritorio** (`ReprogramarNovedadModal`) como molde de la de rechazo.

## Fuera de alcance

- **La reprogramación de escritorio de la 100** y su gestión sintética. Se **nombran** dos agujeros
  suyos (D6 y D7) porque esta ficha los hereda, pero **no se arreglan aquí**.
- **El desenlace de las órdenes no gestionadas**, único punto del pedido original que sigue abierto
  tras esta ficha.
- **Las guardas de bloqueo retiradas** (§5 de la auditoría, ficha 241).
- Cualquier cambio en el cron de plazo vencido, en el anclaje o en el portal del mensajero
  (R41/R42).

---

# Decisiones abiertas

Cada una lleva **qué se decide**, las opciones, **la recomendación con su porqué** y **qué se rompe
si se elige la otra**. Las marcadas **[FIRMA]** cambian producto o dinero y **no se implementan sin
respuesta humana**. Las que necesitan un número lo declaran como **medición de T0**, contra
producción, por MCP y **sólo lectura**: en esta pila medir ya mató una decisión entera antes de
llegar a firma.

---

**D1 · ¿Qué escribe el rechazo manual? [FIRMA — dinero]**

- **(a)** Paridad con el cron: transición guardada `devuelta → rechazada` **más una gestión sintética
  con resultado de rechazo**, `cierre_id NULL` y el `mensajero_id` de la última gestión `devuelta`
  vigente. Cobra lo mismo que el escalado por plazo.
- **(b)** Sólo la transición de estado, sin gestión: el rechazo manual no mueve dinero.
- **(c)** Una gestión con un `resultado` nuevo del enum, propio del rechazo manual.

**Recomendación: (a).** Tres razones, en orden de peso. (i) **El hecho físico es el mismo**: el
paquete no se entrega y vuelve por el flujo de devolución (bloque 139 al aprobar el cierre), así que
la bodega gana el mismo `cobroRechazado` que ganaría si el plazo lo hubiera escalado dos horas
después. (ii) **(b) crea un incentivo perverso y medible**: rechazar a mano saldría gratis y esperar
al plazo costaría, sobre exactamente la misma orden y el mismo paquete; además la fila no entraría en
ningún cierre y nadie podría auditar quién decidió el retorno. (iii) El molde existe **dos veces** en
el árbol (99 y 100) y esta ficha no escribiría aritmética nueva.

**Qué se rompe con (b):** el retorno del paquete deja de tener contrapartida contable, el detalle del
cierre no muestra la decisión, y `esRechazoSla`/el detalle de admin dejan de poder distinguir «lo
rechazó alguien» de «se venció». **Qué se rompe con (c):** un `resultado` nuevo del enum entra por la
puerta de atrás en los **cinco feeds de dinero**, en `computeTotales`, en `RESULTADOS_QUE_VUELVEN`
(238) y en `RESULTADOS_QUE_CUENTAN_COMO_INTENTO`, cada uno con su lista; es el cambio más caro de los
tres y el que menos aporta.

---

**D2 · El flete de devolución se va a cobrar DOS VECES, y ya pasa hoy. [FIRMA — dinero]**

**El hecho, leído en el código y no supuesto.** `derivarIngresoOrden`
(`lib/utils/ingreso-ordenex.ts:86-94`) emite `ingreso_flete_devolucion` + su IVA para **`devuelta`
Y `rechazada`**, y esa misma función alimenta el ingreso de Ordenex (42) y el **débito a la tienda**
(43, con `WALLET_TIENDA_DEBITA_FLETE_DEVOLUCION` en **`true` por defecto**). Una orden que fue
`devuelta` (cobrada en el cierre A) y luego se rechaza (gestión de rechazo en el cierre B) **paga el
flete de devolución dos veces**. Esto **no lo introduce esta ficha**: es la conducta actual del
escalado del cron desde la 99. Lo que esta ficha hace es **volverlo frecuente** (D1).

- **(a)** Paridad: se acepta, se declara y se mide (**M3** de T0). Si hace falta corregirlo, es
  **ficha aparte**, porque cambia lo que cobra el cron.
- **(b)** Corregirlo aquí: que una gestión de rechazo **que viene de una devolución ya facturada** no
  vuelva a emitir el flete de devolución.

**Recomendación: (a), con la medición delante.** (b) obliga a que una función **pura** —hoy
`(resultado, tarifa) → conceptos`, testeable sin DB— necesite saber **de dónde viene la orden**, es
decir su historial; y cambia el importe que el cron lleva cobrando desde la 99 sin ficha, sin firma y
sin aviso a nadie. Si **M3 devuelve un número distinto de cero**, la ficha aparte se abre **el mismo
día** y se lleva al humano con el importe exacto.

**Qué se rompe con (b):** se mueve dinero de un camino que esta ficha no posee; los tests de
`derivarIngresoOrden` y los de los cinco feeds dejan de describir la regla; y se pierde la propiedad
más valiosa de esa función, que es no depender de nada más que su entrada.

---

**D3 · La guardia que impide que un botón vuelva a quedarse en maqueta. [FIRMA ligera]**

- **(a)** Cada acción de la tabla declara **su productor** —una Server Action con su módulo— o
  declara explícitamente que **no produce ninguna operación, con motivo escrito**; una guardia nueva
  comprueba que el productor **existe** y que **algún archivo de la pantalla lo usa**.
- **(b)** Reutilizar `superficie-de-uso.guardia.test.ts` tal cual.
- **(c)** No poner guardia: bastaría con un test de componente que afirme que el botón llama a la
  acción.

**Recomendación: (a), reusando la familia y el mecanismo que el repo ya tiene.** No se inventa nada:
la **anotación con motivo junto al código** y su **caducidad** son literalmente la convención de
`superficie-de-uso` («la excepción va anotada junto al export, no en una allowlist… una excepción que
sobrevive a su motivo es basura»), y la comprobación de que **lo citado existe** es la de
`test-citado-desaparecido.guardia.test.ts`. Lo que se añade es el eslabón que falta: **la tabla ya es
el censo de lo que la fila ofrece (236/R18), así que es el sitio exacto donde reclamar el productor.**

**Por qué (b) no vale, medido:** `superficie-de-uso` tiene tres capas y **ninguna ve una maqueta**.
R-A mira acciones sin superficie: `avisarNoDisponible` no es una acción. R-B, componentes sin quien
los monte: `NovedadAcciones` está montado. R-C, funciones sin referencia dentro de su módulo:
`avisarNoDisponible` **se referencia** en `NovedadesModule.tsx:490`. Las tres estuvieron **verdes las
dos semanas** que el botón fue maqueta, y su verde era correcto.

**Qué la pone roja, dicho en cuatro casos:** (1) una acción nueva en la tabla sin productor → **no
compila** (R37); (2) un productor citado que no existe en `lib/actions/**` → roja (R38); (3) un
productor real que **ningún archivo de `app/(app)/novedades/` importa** → roja: es el cable cortado
(R38); (4) `sin-operacion` con motivo ausente, de relleno o de menos de 20 caracteres → roja (R39).

**Qué se rompe con (c):** un test de componente afirma que el botón llama a lo que el test le pasa
como doble; el día que alguien cambie el cableado por un toast, se cambia también el doble y el test
sigue verde. Es exactamente cómo esta maqueta convivió con la suite.

---

**D4 · Al retirar «Habilitar» de la devolución, ¿se toca algo del servidor? [FIRMA ligera —
coordinación con 236 y 237]**

- **(a)** Sólo se borra la celda de la tabla. El servicio no cambia: su rescate ya es un no-op
  deliberado fuera del estatus de ayuda.
- **(b)** Además, el servicio devuelve error cuando la orden no está en ayuda.

**Recomendación: (a), y con ella la respuesta explícita a la coordinación: esta ficha NO toca
`HabilitarNovedadResult`.** La 236 firmó `rescatada` con el humano el 2026-08-19 **precisamente
porque la 240 iba a volver sobre este tipo**, y lo dejó escrito en el propio archivo
(`lib/types/novedad-habilitar.ts:67-69`: «punto de coordinación con la ficha 240… si las dos fichas
escriben sin acordarlo, una sobrescribe a la otra en silencio»). La pregunta que aquel comentario
difería —«qué debe **además** mover Habilitar»— **se cierra por construcción al borrar la celda**:
con «Habilitar» viviendo sólo en el grupo de ayuda, lo que debe mover es exactamente lo que ya mueve,
el rescate. **No queda nada que decidir y no hay tipo que tocar.**

**Qué se rompe con (b):** se reabre D8 de la 236, firmada hace un día, donde `rescatada: false` es un
`ok` de pleno derecho porque **la nota sí se publicó**; con (b) habría que decidir si esa nota se
revierte —no se puede, el hilo es append-only— o si se miente sobre ella.

---

**D5 · ¿Motivo y evidencia obligatorios? [FIRMA]**

- **(a)** Motivo **obligatorio**, evidencia en imagen **no**.
- **(b)** Los dos obligatorios, como la 237.
- **(c)** Ninguno obligatorio, como la reprogramación de escritorio de hoy (motivo opcional).

**Recomendación: (a).** La evidencia de la 237 la aporta la tienda sobre un paquete **que sigue en la
moto**, y la foto describe el intento; aquí el paquete **ya volvió y ya fue escaneado físicamente**
al aprobar el cierre (238), así que pedirle una foto sería pedirle la foto de algo que no tiene
delante. El motivo sí, y no por simetría: es **la única línea que explica por qué se decidió un cobro
de hasta ₡1.000** (medido por la 237 el 2026-08-20) y el dato que alguien pedirá el día de la primera
disputa.

**Qué se rompe con (b):** la tienda no puede cumplir el requisito y el botón queda inservible, o —
peor— sube una foto de relleno y la evidencia deja de significar nada. **Qué se rompe con (c):** se
cobra el rechazo sin una sola línea que diga por qué, sobre el único camino donde la decisión es de
una persona y no del reloj.

---

**D6 · ¿Puede el mensajero deshacer el rechazo manual de la tienda? [FIRMA — dinero]**

- **(a)** No. Se **amplía** la guarda que la 237 firmó (D3/R38) para que cubra también esta familia.
- **(b)** Sí: no se toca nada.

**Recomendación: (a), y aquí con más motivo que en la 237.** La gestión nace con `mensajero_id` = ese
mensajero (es lo que la mete en su cierre, R9) y con `cierre_id NULL`, así que **pasa las ocho
guardias de `deshacerGestion`** exactamente igual que pasaba la de la 237
(`CierreDiaService.ts:578-603`). Sin ampliar la guarda, el mensajero devuelve a `en_reparto`
**reasignada a él** una orden cuyo paquete **está físicamente en la bodega**, y borra en silencio el
`cobroRechazado` que la tienda decidió. La 237 midió que deshacer se usa en **7 de 57 gestiones
(12 %)**: no es una precaución, es un agujero con caudal.

⚠️ **Dos cosas que hay que decidir con ella, y ninguna es cosmética:**
1. El mensaje actual **nombra una pantalla que no corresponde**: «la resolvió la tienda **desde su
   pantalla de ayuda**». Sobre un rechazo manual eso es falso. El mensaje pasa a no nombrar la
   pantalla; el repo tiene escrito lo que cuesta un dato que miente con formato de dato.
2. **El agujero hermano queda abierto y nombrado:** la gestión sintética de la **reprogramación de
   escritorio** (100, familia `reprogramacion_tienda`) **también** pasa las ocho guardias y **hoy se
   puede deshacer**. Es la pregunta que la auditoría §6 dejó como «no se pudo determinar»: aquí queda
   determinada. **No se arregla en esta ficha** —es dinero neutro (`reprogramada` no emite ningún
   concepto) y cambiar la conducta de la 100 sin pedirlo es alcance ajeno— pero se **mide** (M5) y se
   propone ficha.

**Qué se rompe con (b):** un rechazo cobrado desaparece sin rastro visible para quien lo decidió, y
la tienda ni se entera: la fila ya no está en ninguna de sus pestañas.

---

**D7 · El escaneo físico de la 238 va a pedir un paquete que ya está en la bodega. [FIRMA —
operación]**

**El hecho, leído en el código.** `CierresAdminRepository.findGestionesRetornablesDelCierre:786-794`
filtra por `{ cierreId, resultado IN RESULTADOS_QUE_VUELVEN, anuladaAt: null }` — **sin mirar la
familia**. La gestión sintética del rechazo manual cae en el siguiente cierre del mensajero y, al
aprobarlo, la ventana del 238 **exigirá escanear ese paquete**, que volvió físicamente **en el cierre
anterior**. Y la regla firmada de la 238 (su D2) es **sin escapatoria**: «un solo paquete perdido
devuelve el cierre entero».

**Esto ya ocurre hoy** con las gestiones sintéticas de la 99 y de la 100, y la 238 **no lo
consideró**: la palabra «sintética» no aparece en su spec.

- **(a)** Paridad: se acepta, se declara y se mide (**M6**). El paquete está en la estantería de la
  bodega desde la que se aprueba, así que es **fricción**, no un bloqueo imposible.
- **(b)** Enseñar a la 238 a excluir de la ventana las gestiones cuya familia no sea una visita real.

**Recomendación: (a) + medir + proponer ficha.** (b) toca el conjunto y la escritura de otra feature
—incluida su guardia `confirmacion-sin-lectores`— y ninguna de las dos es de esta ficha. Pero la
consecuencia se escribe **antes** de que ocurra, no se descubre en producción: es el recorrido de la
tanda «ver la app».

**Qué se rompe con (b) hecho aquí:** se cambia el conjunto que la 238 exige confirmar sin su ficha ni
su firma, y su guardia de «nace sin lectores» pasa a tener un lector nuevo que nadie autorizó.

---

**D8 · La familia de historial del rechazo manual. [FIRMA ligera]**

- **(a)** Familia propia, espejo de `reprogramacion_tienda`.
- **(b)** Reutilizar `escalado_devuelta_sla`.
- **(c)** Reutilizar `gestion`.

**Recomendación: (a), y con tres consecuencias que se declaran aquí para que sean decisiones y no
descubrimientos:** la familia **NO** entra en `ORIGEN_TIPOS_VISITA_REAL` (misma razón exacta que
`reprogramacion_tienda`: la orden **ya tiene contada** su gestión `devuelta` real, y sumar sería el
doble conteo que 160/R2 evitaba — R19); **NO** entra en `ORIGEN_TIPOS_CON_GESTION` (esa lista sólo
desambigua la nulidad del enlace, y nuestra fila nace con el enlace poblado, como
`escalado_devuelta_sla`); y **NO** entra en `ORIGENES_SIN_EVENTO_PUBLICO`, así que el integrador
recibe `rechazada` igual que hoy (R44).

**Qué se rompe con (b):** la pestaña «Rechazadas por plazo vencido» (102) listaría rechazos que **no
vencieron ningún plazo** —su predicado es exactamente esa familia
(`OrdenRepository.ts:3282`)— y `esRechazoSla` pasaría a mentir en el detalle del cierre y en la
descarga. **Qué se rompe con (c):** el historial **atribuiría al mensajero** la decisión de la tienda
—la única evidencia de quién decidió el cobro— y, además, `gestion` **sí** está en
`ORIGEN_TIPOS_VISITA_REAL`, así que el rechazo sumaría **un intento de más**, adelantando el escalado
de otras órdenes y cobrando antes de tiempo.

---

**D9 · Qué pasa con el reloj de la 239 cuando la tienda rechaza a mano. [FIRMA ligera]**

**La parte que no es una opción, porque está en el código:** el reloj **se detiene por
construcción**. `DevolucionSlaRepository.findDevueltasSla:62-67` toma como candidatas
**`estatus = devuelta`**; en cuanto la orden pasa a `rechazada` deja de ser candidata, sin una sola
escritura destinada a pararlo (R23). El ancla (`orden_historial_estado` con familia
`anclaje_devolucion`) **se queda donde está**, inmutable (R24): no se re-ancla ni se borra. Si algún
día esa orden volviera a `devuelta`, el `take 1` descendente tomaría el anclaje **más reciente**, que
es R15 de la 239 y ya funciona.

**Lo que sí es una decisión:** ¿puede la tienda rechazar **antes** de que el plazo venza?

- **(a)** Sí, en cualquier momento mientras la orden esté en la devolución anclada.
- **(b)** No: sólo cuando la ventana ya venció.

**Recomendación: (a).** El plazo existe para que **el sistema decida cuando nadie decide**; si la
dueña de la orden decide antes, el plazo sobra. Con (b) la tienda tendría un botón que **falla las
primeras 23 horas de cada 24** en el caso `not_found` y **los primeros 5 días** en los otros dos, y
descubriría el límite pulsándolo — que es justo lo que la 236 evitó al no ofrecer «Reprogramar» sobre
una orden en ayuda.

**Qué se rompe con (b):** hay que llevar la ventana del cron a la pantalla (un segundo sitio donde
vive el plazo, que es el defecto de forma que esta pila lleva cinco fichas cerrando) y la tienda
pierde la única palanca que tiene para no esperar por un paquete que ya sabe que no se entrega.

---

**D10 · Los textos. [FIRMA]**

Todo el copy junto, para firmarlo de una vez. Español con tildes, sin siglas ni jerga interna; en
particular **no se usa «SLA»** ni «acuerdo a nivel de servicio».

| Qué | Hoy | Recomendación |
| --- | --- | --- |
| Rótulo del botón | «Rechazar» *(ya correcto desde el 2026-08-19)* | **sin cambio** |
| Nombre accesible | «Rechazar la orden de \<destinatario\>» | **sin cambio** |
| Título de la ventana | *(no existe)* | **«Rechazar la orden»** |
| Descripción | *(no existe)* | **«El paquete de \<destinatario\> (\<guía\>) vuelve a tu bodega y la orden se cierra como rechazada.»** |
| Aviso fijo, siempre visible | *(no existe)* | **«Esto le cobra a tu tienda el flete de devolución y no se puede deshacer. Si preferís volver a intentar la entrega, usá “Reprogramar”.»** |
| Campo | *(no existe)* | **«Motivo del rechazo»**, obligatorio |
| Bloqueo con palabras | *(no existe)* | **«Escribí el motivo para poder rechazar.»** |
| Éxito | «Esta acción todavía no está disponible.» | **«Orden rechazada. El paquete vuelve a tu bodega.»** |
| Carrera perdida | — | **«Esta orden ya no estaba en devolución, así que no se rechazó. Actualizá la pantalla.»** |
| Deshacer bloqueado (mensajero) | «Esta orden la resolvió la tienda **desde su pantalla de ayuda**; solo ella puede corregirlo…» | **«Esta orden la resolvió la tienda; solo ella puede corregirlo. Escribile por el chat de la orden.»** |

**Por qué el aviso nombra el flete y no el `cobroRechazado`:** el `cobroRechazado` es **ingreso de
bodega**, no un cargo a la tienda —la 237 tuvo que corregir esa misma frase en su design el
2026-08-20—; lo que la tienda **sí** paga es el flete de devolución más su IVA, por otra vía y desde
otra tarifa. Decirle a la tienda que se cobra a sí misma ₡1.000 sería falso. **El importe concreto no
se escribe en el aviso** mientras M4 no lo diga: un número inventado en un aviso de dinero es peor
que ninguno.

**Qué se rompe si se elige otro texto:** si el aviso no dice «no se puede deshacer», D6 deja a la
tienda con una decisión irreversible que nadie le anunció; y si el éxito no dice a dónde va el
paquete, la fila desaparece de la pantalla sin que nada explique qué pasó con la mercadería.

---

## Preguntas abiertas que NO son decisiones, y conviene decirlo

- **No hay tabla nueva, ni columna, ni política RLS nueva.** La única migración es **un valor de
  enum** (D8), y va sola por obligación técnica (Postgres 55P04).
- **No hay backfill.** Esta ficha no reinterpreta ninguna fila existente.
- **No hay estado de orden nuevo** (R44). Si la guardia de transiciones exhaustivas se pone roja por
  un **estado**, alguien tocó algo que esta ficha no toca; si se pone roja por el **recuento de
  aristas**, es el rojo esperado de `design.md` §11.

---

## PUERTA HUMANA PASADA — 2026-08-20

### Firmadas por el humano

- **D1 y D2 — PARIDAD CON EL CRON, y el doble cobro se saca a una ficha aparte.** Se firmaron juntas
  al elegir «ficha aparte ya, y la 240 sigue»: esa opción decía literalmente que **la 240 avanza
  aceptando la paridad**.
  El argumento de D1 se sostiene solo: **sin gestión sintética, rechazar a mano saldría GRATIS y
  esperar al plazo costaría** — sobre el mismo paquete. Una asimetría así invita a usar el camino
  equivocado.
  Y el de D2 quedó **medido, no supuesto**: `M3 = 1`, no cero. La orden **63050** de **NUFORM** ya
  pagó el flete de devolución **dos veces** (₡2.200 + 13 %, el 22 y el 28 de julio, los dos cierres
  aprobados). **No lo introduce esta ficha** —viene de la 99 y lo dispara el cron— pero **esta ficha
  le abre una segunda puerta**. Sale a la **ficha 247**.
  ⚠️ **Sin devolución de dinero**: el humano confirmó que **producción se usa hoy como entorno de
  pruebas**, así que esos importes no son de una tienda real. Si eso cambia, **re-medir antes de
  arreglar**.

### Firmadas por el leader, con la recomendación del spec

- **D3 — la guardia anti-maqueta**, con `PRODUCTOR_POR_ACCION` sobre la tabla de la 236. Y el
  argumento que la justifica está **medido**: `superficie-de-uso` **por sí sola no ve una maqueta**
  —sus tres capas estuvieron verdes las dos semanas en que «Devolver» no hacía nada—.
- **D4 — «Habilitar»: sólo se borra la celda.** Esta ficha **NO toca `HabilitarNovedadResult`**, así
  que la coordinación que la 236/D8 dejó firmada queda cerrada **por construcción** y no por acuerdo.
- **D5 — motivo obligatorio, foto NO.** El paquete ya volvió y ya se escaneó (238): pedir foto sería
  pedirle a la tienda una prueba de algo que no tiene.
- **D6 — no se puede deshacer**, ampliando la guarda de 237/D3 a la familia nueva. Hallazgo hermano
  declarado: **la reprogramación de escritorio de la 100 SÍ se puede deshacer hoy** — ficha aparte.
- **D7 — se acepta y se mide**: la ventana física de la 238 pedirá escanear un paquete **que ya está
  en bodega**, porque `findGestionesRetornablesDelCierre` filtra por `resultado` sin mirar familia.
  **Ya pasa con las sintéticas de la 99 y la 100**; la 238 no lo consideró.
- **D8 — familia de historial propia** (`rechazo_tienda`), **fuera** de `ORIGEN_TIPOS_VISITA_REAL`:
  reusar `escalado_devuelta_sla` metería el rechazo en la pestaña «por plazo vencido» y reusar
  `gestion` sumaría un intento de más.
- **D9 — el rechazo manual NO espera al vencimiento.** El plazo existe para decidir **cuando nadie
  decide**; exigirlo dejaría un botón que falla las primeras 23 h de cada 24.
- **D10 — los textos**, con una precisión que costó una corrección en la 237: el aviso nombra **el
  flete de devolución** (lo que la tienda paga), **no** el `cobroRechazado`, que es ingreso de bodega.

### El reloj de la 239 — resuelto sin escribir código

**Se detiene por construcción.** `findDevueltasSla` toma candidatas con `estatus = devuelta`; al
pasar a `rechazada` la orden **sale del conjunto**. El ancla **no se toca** (es historia inmutable), y
**la carrera con el cron está cerrada por la misma guarda**: quien llegue segundo obtiene `count = 0`
y no crea gestión, así que **el `cobroRechazado` no se puede cobrar dos veces**.

