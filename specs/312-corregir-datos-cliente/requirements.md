# Ficha 312 — Corregir los datos del cliente de una orden

**Estado:** borrador de especificación (pendiente de aprobación humana).
**Zona:** fullstack. **SDD:** sí.

## Problema

La carga masiva entra con el destinatario o el teléfono mal escritos. Hoy la aplicación no
ofrece **ninguna** superficie para arreglarlo: la única vía es un `UPDATE` a mano contra
producción. Esta ficha pone esa corrección dentro de la app, con autorización por rol, ventana
de estado y rastro en el hilo de la orden.

## Alcance cerrado por el humano (no se reabre)

| Decisión | Contenido |
| --- | --- |
| D1 — Campos | `destinatario`, `telefonoDest`, `producto`, `notas`. **Nada más.** Fuera dirección, ubicación, zona, monto, estatus y tienda. La dirección se deja fuera **a sabiendas** de que es el error de carga más caro. |
| D2 — Quién | `maestro` y `admin` desde el módulo de órdenes. `adminTienda` **solo** desde la card de `/novedades`, y solo sobre sus propias órdenes, las que llegan ahí **por una devolución**. |
| D3 — Ventana | No se corrige si el estado está en `ESTADOS_TERMINALES` (`entregada`, `devuelta_a_tienda`, `incidente`) **más** `rechazada`. |
| D4 — Rastro | Nota automática en el **hilo de notas** de la orden (`orden_nota`), con valor viejo → nuevo, autor y fecha. **NO** se escribe en `orden_historial_estado`: eso es historial de ESTADO, y corregir un dato no es transicionar. |
| D5 — Teléfono/WhatsApp | El hilo de chat existente **se conserva** y se le anota la corrección; los mensajes nuevos entran ya por el número corregido. Coherente con la 311: un cambio de número es **evidencia, no continuidad**. |

---

## Requisitos (EARS)

### Alcance de la corrección

**R1** — El sistema DEBE aceptar como campos corregibles de una orden EXACTAMENTE
`destinatario`, `telefonoDest`, `producto` y `notas`.

**R2** — SI la entrada trae cualquier clave que no sea uno de los cuatro campos de R1,
ENTONCES el sistema DEBE responder `validation_error` sin leer ni escribir ninguna fila.

**R3** — SI la entrada no trae ninguno de los cuatro campos de R1, ENTONCES el sistema DEBE
responder `validation_error` sin escribir nada.

**R4** — CUANDO ninguno de los campos recibidos difiera del valor ya almacenado (comparados
tras el mismo recorte que se aplica al guardar), el sistema DEBE terminar SIN escribir en la
orden y SIN crear ninguna nota, e informar el desenlace como «sin cambios».

**R5** — CUANDO una corrección se aplica, el sistema NO DEBE modificar ningún otro dato de la
orden: ni el estado, ni la dirección, ni las coordenadas, ni zona/provincia/cantón/distrito, ni
el monto a cobrar, ni la tienda, ni el mensajero asignado, ni el día de reparto, ni el número
de guía, ni el número de remisión.

### Autorización

**R6** — SI la petición llega sin sesión válida, ENTONCES el sistema DEBE responder
`unauthenticated` sin construir el servicio ni tocar ninguna fila.

**R7** — MIENTRAS el actor autenticado tenga rol `maestro` o `admin`, el sistema DEBE permitirle
corregir cualquier orden viva cuyo estado esté dentro de la ventana de R10, sin restricción de
tienda.

**R8** — MIENTRAS el actor autenticado tenga rol `adminTienda`, el sistema DEBE permitirle
corregir ÚNICAMENTE órdenes cuya tienda dueña sea él mismo Y cuyo estado sea el de la
devolución anclada que `/novedades` lista en su grupo `devolucion`; en cualquier otro caso DEBE
responder `forbidden`.

**R9** — SI el actor tiene un rol distinto de `maestro`, `admin` o `adminTienda` (`mensajero`,
`adminSatelite`, `apiKey`), ENTONCES el sistema DEBE responder `forbidden` sin escribir nada.

### Ventana de estado

**R10** — SI el estado actual de la orden es `entregada`, `devuelta_a_tienda`, `incidente` o
`rechazada`, ENTONCES el sistema DEBE rechazar la corrección sin escribir nada.

**R11** — SI la orden no existe, o está borrada lógicamente, o pertenece a otra tienda cuando el
actor es `adminTienda`, ENTONCES el sistema DEBE devolver el MISMO resultado opaco que devuelve
por rol no autorizado, sin distinguir cuál de los casos ocurrió.

**R12** — CUANDO el estado de la orden cambie entre el momento en que el sistema la lee y el
momento en que escribe, el sistema NO DEBE aplicar la corrección y DEBE informarlo como
conflicto, sin dejar ningún efecto parcial.

### Rastro

**R13** — CUANDO una corrección se aplica, el sistema DEBE crear en el hilo de notas de esa
orden UNA nota que enumere, por cada campo corregido y solo por esos, la etiqueta del campo, el
valor anterior y el valor nuevo.

**R14** — CUANDO el sistema crea la nota de R13, DEBE atribuirla al usuario autenticado que
ejecutó la corrección, con el rol con el que la ejecutó y con la fecha y hora en que ocurrió.

**R15** — CUANDO una corrección se aplica, el sistema NO DEBE registrar ninguna fila en el
historial de estado de la orden.

**R16** — El sistema DEBE aplicar la corrección y crear su nota de forma ATÓMICA: no DEBE existir
ningún desenlace en el que la orden quede corregida sin nota, ni una nota sin corrección
aplicada.

**R17** — El cuerpo de la nota de R13 NO DEBE exceder el tope de cuerpo del hilo de notas; SI la
composición completa no cabe, ENTONCES el sistema DEBE recortarla por el final dejando una marca
visible de que se recortó.

**R18** — Ningún módulo de esta feature DEBE escribir en registros (`console`, logs de servidor
o de navegador) el destinatario, el teléfono, el producto ni las notas de una orden.

### Teléfono y WhatsApp

**R19** — CUANDO se corrija `telefonoDest`, el sistema DEBE guardarlo con el mismo tratamiento
que le da la carga masiva al número que entra por el archivo.

**R20** — SI el número corregido no produce ningún dígito utilizable al normalizarlo con la
normalización de WhatsApp del sistema, ENTONCES el sistema DEBE responder `validation_error` sin
escribir nada.

**R21** — CUANDO se corrija `telefonoDest`, el sistema NO DEBE modificar, mover ni borrar la
conversación de WhatsApp que la orden ya tuviera: sus mensajes DEBEN seguir siendo consultables
tal cual estaban.

**R22** — CUANDO llegue un mensaje entrante desde el número CORREGIDO, y la orden esté viva y con
mensajero asignado, el sistema DEBE resolverlo a esa orden.

**R23** — CUANDO llegue un mensaje entrante desde el número ANTERIOR, el sistema NO DEBE
resolverlo a esa orden.

### Superficies

**R24** — El listado de órdenes DEBE ofrecer la corrección como acción POR FILA únicamente a los
roles de R7 y únicamente sobre filas cuyo estado esté dentro de la ventana de R10.

**R25** — La card de `/novedades` DEBE ofrecer la corrección únicamente en el grupo de
`devolucion`.

**R26** — SI el estado de una fila no se conoce o no está dentro de la ventana de R10, ENTONCES
la superficie NO DEBE ofrecer la corrección sobre esa fila (fallo cerrado: la ausencia de dato
no habilita).

**R27** — El sistema DEBE revalidar en el servidor el rol, la pertenencia y el estado en CADA
petición de corrección, con independencia de lo que la superficie haya ofrecido.

**R28** — CUANDO se abra la superficie de corrección sobre una orden, DEBE presentar los cuatro
campos precargados con los valores actuales de esa orden.

**R29** — SI la orden ya tiene número de guía asignado, ENTONCES la superficie DEBE advertir,
ANTES de confirmar, que la etiqueta ya impresa conserva los datos anteriores.

**R30** — CUANDO la corrección incluya el teléfono, la superficie DEBE advertir, ANTES de
confirmar, que la conversación de WhatsApp anterior no se traslada al número nuevo.

**R31** — CUANDO la corrección se aplique con éxito, la superficie DEBE releer el estado DEL
SERVIDOR y mostrar los valores nuevos; no DEBE pintarlos desde estado local optimista.

**R32** — CUANDO el servidor rechace la corrección, la superficie DEBE conservar lo tecleado,
mostrar un motivo accionable y NO reflejar ningún cambio; el motivo NO DEBE exponer
identificadores internos ni el detalle de por qué se rechazó cuando el resultado del servidor es
opaco (R11).

---

## Fuera de alcance (declarado)

- Corregir la **dirección**, la ubicación, la zona, el monto, el estatus o la tienda (D1).
- Re-geocodificar (consecuencia de lo anterior: sin dirección editable no hay re-geocodificación).
- Reimprimir la etiqueta automáticamente. R29 **avisa**; reimprimir es el gesto que ya existe en
  el listado (`EtiquetaOrdenAccion`) y esta ficha no lo cambia.
- Fusionar, migrar o borrar hilos de chat de WhatsApp (D5, y ver §5 de `design.md`).
- Dar a `maestro`/`admin` lectura del hilo de notas (hoy no la tienen; ver Pregunta 1).
- Corrección por LOTE. Los cuatro campos son propios de cada orden.

---

## Preguntas abiertas

**P1 — `maestro`/`admin` escriben un rastro que no pueden leer.**
`OrdenNotaService.listar` solo admite `adminTienda` y `mensajero` (227/R12: «no hay vista de
supervisión», decisión P8). La nota de R13 la verán la tienda dueña y el mensajero asignado; el
`maestro` que corrigió **no**. ¿Se acepta así, o esta ficha debe abrir la lectura del hilo a los
roles de acceso total? Abrirla es tocar una decisión firmada de la 227, así que no se hace sin
respuesta.

**P2 — ¿El `adminTienda` puede corregir también desde el grupo de AYUDA?**
El encargo dice «las que llegan a novedades por una devolución», y así está escrito en R8 (solo
`devuelta`). Pero `/novedades` lista dos grupos, y en `ayuda_tienda` la tienda ya puede
reprogramar, rechazar y hablar por el hilo. ¿Se deja fuera a propósito o es un olvido?

**P3 — Tope de longitud de `producto` y `notas`.**
Ni la columna ni la carga masiva declaran uno (`requiredNonEmpty` / `.trim()`). Si la corrección
tampoco lo declara, un texto largo se guarda entero y solo se recorta en la nota (R17). ¿Se
quiere un tope explícito en la corrección, aunque diverja de lo que la carga admite?

**P4 — El aviso de la etiqueta (R29) frente a la guía ya impresa.**
Se avisa, y nada más. ¿Debe además ofrecerse reimprimir desde el mismo modal, o basta con que el
operador use la acción de etiqueta que ya está en la fila?

> Las preguntas puramente técnicas (forma canónica del teléfono, hilo de chat visible en el panel
> del mensajero) están al final de `design.md`, junto al análisis que las produce.

---

## Trazabilidad

Cada `R<n>` de este documento tiene su test nombrado en `tasks.md`. Un requisito sin test es un
fallo de la feature (`docs/specs.md` §Trazabilidad).
