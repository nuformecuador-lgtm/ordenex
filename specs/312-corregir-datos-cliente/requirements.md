# Ficha 312 — Corregir los datos del cliente de una orden

**Estado:** especificación con el alcance cerrado. Las cuatro preguntas de producto (P1–P4) y las
tres técnicas (T1–T3) fueron respondidas por el humano el **2026-08-28**; están recogidas abajo,
en §Preguntas resueltas, y ya no hay ninguna abierta.
**Zona:** fullstack. **SDD:** sí.

## Problema

La carga masiva entra con el destinatario o el teléfono mal escritos. Hoy la aplicación no
ofrece **ninguna** superficie para arreglarlo: la única vía es un `UPDATE` a mano contra
producción. Esta ficha pone esa corrección dentro de la app, con autorización por rol y ventana
de estado.

## Alcance cerrado por el humano (no se reabre)

| Decisión | Contenido |
| --- | --- |
| D1 — Campos | `destinatario`, `telefonoDest`, `producto`, `notas`. **Nada más.** Fuera dirección, ubicación, zona, monto, estatus y tienda. La dirección se deja fuera **a sabiendas** de que es el error de carga más caro. |
| D2 — Quién | `maestro` y `admin` desde el módulo de órdenes. `adminTienda` **solo** desde las cards de `/novedades`, sobre sus propias órdenes, y **en los DOS grupos** de esa pantalla (`devolucion` y `ayuda`). |
| D3 — Ventana | No se corrige si el estado está en `ESTADOS_TERMINALES` (`entregada`, `devuelta_a_tienda`, `incidente`) **más** `rechazada`. Exactamente esos cuatro valores. |
| D4 — Rastro | **NINGUNO.** Decidido el 2026-08-28: no hay nota en el hilo, ni tabla de auditoría, ni fila de historial, ni registro de qué cambió. Corregir deja solo el `updated_at` de la fila. **Lo que se pierde:** no se puede saber quién corrigió qué, ni cuál era el valor anterior. Detalle y motivo, abajo. |
| D5 — Teléfono/WhatsApp | Esta ficha **no toca el módulo de chat**. La conversación anterior se queda donde está, intacta; los mensajes nuevos entran ya por el número corregido. Si el número estaba mal escrito, ese hilo viejo es una conversación con otra persona y **no sirve de nada**: no se migra, no se fusiona y no se borra. |

### D4, al detalle — la ausencia de rastro es una decisión, no un olvido

Decidido por el humano el **2026-08-28**, en respuesta a la pregunta P1 de la versión anterior de
este documento. Palabras literales: *«no veo necesario avisar que se corrigió un dato»*.

En consecuencia, y de forma deliberada:

- **no** se publica ninguna nota en el hilo de la orden;
- **no** se crea ninguna tabla ni columna de auditoría;
- **no** se escribe fila alguna en el historial de estado;
- **no** se guarda en ningún sitio qué campo cambió, ni cuál era su valor anterior.

Corregir deja **únicamente** el `updated_at` de la fila de la orden.

**Lo que esto cuesta, escrito para quien lea esto en tres meses:** después de una corrección
**no se puede saber quién la hizo, qué campo tocó, ni cuál era el valor anterior**. Si algún día
hace falta responder «¿este teléfono siempre fue este?», la respuesta no estará en el sistema.
Se aceptó ese coste a cambio de no construir —ni mantener— un rastro que nadie pidió leer.
Quien quiera reabrirlo tiene la alternativa completa evaluada y descartada en `design.md` §8/B.

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
orden e informar el desenlace como «sin cambios».

**R5** — CUANDO una corrección se aplica, el sistema NO DEBE modificar ningún otro dato de la
orden: ni el estado, ni la dirección, ni las coordenadas, ni zona/provincia/cantón/distrito, ni
el monto a cobrar, ni la tienda, ni el mensajero asignado, ni el día de reparto, ni el número
de guía, ni el número de remisión.

**R6** — El sistema NO DEBE rechazar ni recortar `producto` ni `notas` por longitud: DEBE aceptar
cualquier valor que la carga masiva aceptaría para esos mismos campos. *(Un tope que la carga no
tiene produciría el caso absurdo «se pudo cargar pero no se puede corregir».)*

### Autorización

**R7** — SI la petición llega sin sesión válida, ENTONCES el sistema DEBE responder
`unauthenticated` sin construir el servicio ni tocar ninguna fila.

**R8** — MIENTRAS el actor autenticado tenga rol `maestro` o `admin`, el sistema DEBE permitirle
corregir cualquier orden viva cuyo estado esté dentro de la ventana de R11, sin restricción de
tienda.

**R9** — MIENTRAS el actor autenticado tenga rol `adminTienda`, el sistema DEBE permitirle
corregir ÚNICAMENTE órdenes cuya tienda dueña sea él mismo Y cuyo estado sea el de alguno de los
grupos que `/novedades` lista (el de la devolución anclada o el de la ayuda de la tienda); en
cualquier otro caso DEBE responder `forbidden`.

**R10** — SI el actor tiene un rol distinto de `maestro`, `admin` o `adminTienda` (`mensajero`,
`adminSatelite`, `apiKey`), ENTONCES el sistema DEBE responder `forbidden` sin escribir nada.

### Ventana de estado

**R11** — SI el estado actual de la orden es `entregada`, `devuelta_a_tienda`, `incidente` o
`rechazada`, ENTONCES el sistema DEBE rechazar la corrección sin escribir nada.

**R12** — SI la orden no existe, o está borrada lógicamente, o pertenece a otra tienda cuando el
actor es `adminTienda`, ENTONCES el sistema DEBE devolver el MISMO resultado opaco que devuelve
por rol no autorizado, sin distinguir cuál de los casos ocurrió.

**R13** — CUANDO el estado de la orden cambie entre el momento en que el sistema la lee y el
momento en que escribe, el sistema NO DEBE aplicar la corrección y DEBE informarlo como
conflicto, sin dejar ningún efecto parcial.

### Ausencia de rastro (D4)

**R14** — CUANDO una corrección se aplica, el sistema DEBE escribir ÚNICAMENTE en la fila de esa
orden y en NINGUNA otra tabla: ni en el historial de estado, ni en el hilo de notas de la orden,
ni en ninguna tabla de auditoría.

**R15** — CUANDO una corrección se aplica, el sistema DEBE dejar como único rastro la marca de
última modificación (`updated_at`) de la fila corregida.

**R16** — Ningún módulo de esta feature DEBE escribir en registros (`console`, logs de servidor
o de navegador) el destinatario, el teléfono, el producto ni las notas de una orden.

### Teléfono y WhatsApp

**R17** — CUANDO se corrija `telefonoDest`, el sistema DEBE guardarlo con el mismo tratamiento
que le da la carga masiva al número que entra por el archivo.

**R18** — SI el número corregido no produce ningún dígito utilizable al normalizarlo con la
normalización de WhatsApp del sistema, ENTONCES el sistema DEBE responder `validation_error` sin
escribir nada.

**R19** — CUANDO se corrija `telefonoDest`, el sistema NO DEBE modificar, mover ni borrar la
conversación de WhatsApp que la orden ya tuviera: sus filas y sus mensajes DEBEN quedar tal cual
estaban.

**R20** — CUANDO llegue un mensaje entrante desde el número CORREGIDO, y la orden esté viva y con
mensajero asignado, el sistema DEBE resolverlo a esa orden.

**R21** — CUANDO llegue un mensaje entrante desde el número ANTERIOR, el sistema NO DEBE
resolverlo a esa orden.

### Superficies

**R22** — El listado de órdenes DEBE ofrecer la corrección como acción POR FILA únicamente a los
roles de R8 y únicamente sobre filas cuyo estado esté dentro de la ventana de R11.

**R23** — Las cards de `/novedades` DEBEN ofrecer la corrección en LOS DOS grupos de esa pantalla,
`devolucion` y `ayuda`.

**R24** — SI el estado de una fila no se conoce o no está dentro de la ventana de R11, ENTONCES
la superficie NO DEBE ofrecer la corrección sobre esa fila (fallo cerrado: la ausencia de dato
no habilita).

**R25** — El sistema DEBE revalidar en el servidor el rol, la pertenencia y el estado en CADA
petición de corrección, con independencia de lo que la superficie haya ofrecido.

**R26** — CUANDO se abra la superficie de corrección sobre una orden, DEBE presentar los cuatro
campos precargados con los valores actuales de esa orden.

**R27** — SI la orden ya tiene número de guía asignado, ENTONCES la superficie DEBE advertir,
ANTES de confirmar, que la etiqueta ya impresa conserva los datos anteriores.

**R28** — CUANDO la corrección incluya el teléfono, la superficie DEBE advertir, ANTES de
confirmar, que la conversación de WhatsApp anterior no se traslada al número nuevo.

**R29** — CUANDO la corrección se aplique con éxito, la superficie DEBE releer el estado DEL
SERVIDOR y mostrar los valores nuevos; no DEBE pintarlos desde estado local optimista.

**R30** — CUANDO el servidor rechace la corrección, la superficie DEBE conservar lo tecleado,
mostrar un motivo accionable y NO reflejar ningún cambio; el motivo NO DEBE exponer
identificadores internos ni el detalle de por qué se rechazó cuando el resultado del servidor es
opaco (R12).

---

## Fuera de alcance (declarado)

- **Todo rastro de la corrección** (D4): nota en el hilo, tabla de auditoría, fila de historial o
  cualquier registro de qué cambió y quién lo cambió. Decidido el 2026-08-28; el coste está
  escrito arriba, en «D4, al detalle».
- Corregir la **dirección**, la ubicación, la zona, el monto, el estatus o la tienda (D1).
- Re-geocodificar (consecuencia de lo anterior: sin dirección editable no hay re-geocodificación).
- Reimprimir la etiqueta. R27 **avisa** y nada más (respuesta a P4): reimprimir es el gesto que ya
  existe en la fila del listado (`EtiquetaOrdenAccion`) y esta ficha no lo cambia ni lo duplica
  dentro del modal.
- Fusionar, migrar o borrar hilos de chat de WhatsApp (D5, y ver §5 de `design.md`).
- Cambiar nada del módulo de chat, incluido el panel del mensajero (respuesta a T2; ver
  `design.md` §5.4).
- Corrección por LOTE. Los cuatro campos son propios de cada orden.
- Un tope de longitud propio para `producto` o `notas` (R6, respuesta a P3).

---

## Preguntas resueltas (2026-08-28)

Se dejan escritas con su respuesta —y no se borran— porque cada una explica por qué el spec dice
lo que dice.

**P1 — ¿Qué rastro deja la corrección?**
**Respuesta: ninguno.** «No veo necesario avisar que se corrigió un dato». Se retiran la nota
automática, el formato «valor viejo → nuevo», la atribución al autor y toda dependencia con el
hilo de notas. Ver D4 y `design.md` §6. De paso desaparece la incoherencia que este spec había
detectado (escribir un rastro donde el propio autor no puede leerlo): ya no se escribe nada.

**P2 — ¿El `adminTienda` puede corregir también desde el grupo de AYUDA?**
**Respuesta: sí, desde los dos grupos.** Motivo del humano: en `ayuda_tienda` la tienda ya
reprograma, rechaza y escribe en el hilo, así que ahí toma decisiones de más peso que arreglar un
nombre. R9 y R23 recogen la decisión.

**P3 — ¿Tope de longitud para `producto` y `notas`?**
**Respuesta: sin tope**, igual que la carga (R6). Un tope que la carga no tiene crearía el caso
absurdo «se pudo cargar pero no se puede corregir».

**P4 — ¿El modal debe ofrecer reimprimir la etiqueta?**
**Respuesta: no, basta con avisar.** R27 se queda tal cual; la acción de etiqueta ya está en la
fila.

**T1 — ¿Guardar el teléfono en forma canónica (E.164)?**
**Respuesta: no.** Se guarda como lo guarda la carga: texto recortado. Canonizar solo desde esta
superficie dejaría la columna con dos formatos según por dónde entró el dato. R17.

**T2 — Dos hilos de chat por orden tras corregir el número.**
**Respuesta: no hay nada que arreglar y no se toca el módulo de chat.** El hilo viejo es
desechable. Y la lectura del panel ya está blindada: ver `design.md` §5.4, con la medición.

**T3 — ¿Ampliar la ventana de estados?**
**Respuesta: no.** Se queda con los cuatro valores de D3.

**Preguntas abiertas vivas: ninguna.**

---

## Trazabilidad

Cada `R<n>` de este documento (R1–R30) tiene su test nombrado en `tasks.md`. Un requisito sin test
es un fallo de la feature (`docs/specs.md` §Trazabilidad).
