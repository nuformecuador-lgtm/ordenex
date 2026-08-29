# Ficha 327 — Corregir la ubicación de una orden (fase 2 de la 312)

**Zona:** fullstack. **SDD:** sí. **Rama:** `feature/327-editor-ubicacion`.
**Extiende** la ficha 312 (`specs/312-corregir-datos-cliente/`), que ya está implementada y viva.
Esta ficha **no la reescribe**: le añade campos, y con ellos una consecuencia que la 312 no tenía —
**mueve dinero**.

> **Nota de procedencia.** La ficha 327 **no figura en `feature_list.json` de este árbol**
> (`R:/wt327`, medido: los ids registrados llegan hasta 323). La descripción que se especifica aquí
> es la del encargo del humano del 2026-08-28. Quien registre la ficha, que compare este documento
> con la `description` que acabe en el JSON.

## Problema

La 312 dejó corregir `destinatario`, `telefonoDest`, `producto` y `notas`. La dirección quedó fuera
**por decisión del humano de esa misma mañana** (D1 de la 312: «se deja fuera **a sabiendas** de que
es el error de carga más caro»). El humano reabre esa decisión el 2026-08-28 con su ejemplo:

> *«si el cliente puso mal su dirección, debo poder corregir ese dato»*

## Alcance cerrado por el humano (no se reabre)

| Decisión | Contenido |
| --- | --- |
| **D1 — Campos que gana** | `direccion`, `provinciaId`, `cantonId`, `distritoId` y `peso`. Se suman a los cuatro de la 312. |
| **D2 — Siguen fuera** | `montoCobrar`, `numRemision`, `cobraComision`, `estatusId`, `mensajeroAsignadoId`, `tiendaId`, `numGuia`. |
| **D3 — Sin rastro** | Igual que la 312 (su D4), **ratificado el 2026-08-28**. Ni nota, ni historial, ni auditoría. Ver la enmienda de D6. |
| **D4 — Roles y ventana** | **Los mismos de la 312**: `maestro`/`admin` desde el módulo de órdenes; `adminTienda` desde las cards de `/novedades`, sobre sus propias órdenes, en los DOS grupos. Ventana de estado: los mismos cuatro estados bloqueados. |
| **D5 — La zona se recalcula, avisando** | Al cambiar el distrito **la zona se recalcula**, pero **el sistema avisa antes de guardar**: enseña la zona nueva y el importe que pasaría a cobrarse, y el humano confirma. Sin ese aviso sería dinero cambiando en silencio — y encima sin rastro, porque esta familia no lo deja. |

### D6 — Enmienda declarada a la ficha 312

Dos requisitos de la 312 dejan de ser ciertos con esta ficha, y **se enmiendan aquí a propósito**
para que nadie los lea como un incumplimiento:

- **312/R5** («no DEBE modificar ningún otro dato de la orden: … ni la dirección, ni las
  coordenadas, ni zona/provincia/cantón/distrito…»). Esta ficha **sí** escribe dirección, provincia,
  cantón, distrito, zona y peso. Lo que sigue intacto es el resto de la enumeración: estado, monto a
  cobrar, tienda, mensajero asignado, día de reparto, número de guía y número de remisión (R24).
  Las **coordenadas** tampoco se escriben (R22): las escribe el trabajo de geocodificación.
- **312/R14** («DEBE escribir ÚNICAMENTE en la fila de esa orden y en NINGUNA otra tabla»). Esta
  ficha escribe **además** una fila en la cola de trabajos cuando la dirección cambia (R19). **Eso
  no contradice D3**: ese trabajo lleva **solo el id de la orden** (feature 91/R14), así que no
  registra quién corrigió qué ni cuál era el valor anterior. El resto de R14 sigue vigente en su
  totalidad: ni historial, ni hilo de notas, ni tabla de auditoría (R25).

---

## Requisitos (EARS)

### Alcance de la corrección

**R1** — El sistema DEBE aceptar como campos corregibles de una orden EXACTAMENTE los cuatro de la
ficha 312 (`destinatario`, `telefonoDest`, `producto`, `notas`) más `direccion`, `provinciaId`,
`cantonId`, `distritoId` y `peso`.

**R2** — SI la entrada trae `zonaId`, `estatusId`, `tiendaId`, `montoCobrar`, `cobraComision`,
`numGuia`, `numRemision` o `mensajeroAsignadoId`, ENTONCES el sistema DEBE responder
`validation_error` sin leer ni escribir ninguna fila.

**R3** — SI la entrada trae alguno de `provinciaId`, `cantonId` o `distritoId` pero no los tres,
ENTONCES el sistema DEBE responder `validation_error` sin escribir nada.

**R4** — El sistema NO DEBE permitir dejar la orden sin distrito: SI `distritoId` llega vacío o
nulo, ENTONCES DEBE responder `validation_error` sin escribir nada.

**R5** — El sistema DEBE derivar la zona de la orden a partir del distrito recibido, en el servidor,
y NO DEBE tomarla nunca de la entrada.

**R6** — SI el distrito recibido no pertenece al cantón recibido, o el cantón recibido no pertenece
a la provincia recibida, ENTONCES el sistema DEBE rechazar la corrección sin escribir nada.

**R7** — SI el distrito recibido no resuelve EXACTAMENTE una zona, ENTONCES el sistema DEBE rechazar
la corrección nombrando ese motivo y sin escribir nada.

**R8** — El sistema NO DEBE permitir vaciar la dirección: DEBE rechazar una dirección que quede sin
contenido tras recortarla, y DEBE guardar la que acepte con el mismo tratamiento que le da la carga
masiva.

**R9** — El sistema DEBE exigir que el peso corregido sea estrictamente mayor que cero, y NO DEBE
permitir dejar la orden sin peso desde esta superficie.

**R10** — CUANDO ninguno de los campos recibidos difiera del valor ya almacenado (comparados tras la
misma normalización que se aplica al guardar), el sistema DEBE terminar SIN escribir en la orden e
informar el desenlace como «sin cambios».

### El aviso del importe (D5)

**R11** — CUANDO la corrección cambie el distrito de la orden y la petición no traiga la
confirmación explícita del cambio, el sistema DEBE rechazarla SIN escribir nada y DEBE devolver, en
esa misma respuesta: la zona actual y la zona que resultaría, y para cada una el importe de
flete + IVA y el de comisión + IVA que se cobrarían.

**R12** — El sistema DEBE derivar esos dos importes con la MISMA regla de resolución de tarifa y la
MISMA aritmética con las que se factura el cierre del día, y NO DEBE calcularlos en el navegador.

**R13** — SI el par (tienda de la orden, zona resultante) no resuelve ninguna tarifa, ENTONCES el
sistema DEBE informarlo como «sin tarifa configurada» y NO DEBE presentarlo como un importe de cero.

**R14** — SI el flete de la ubicación propuesta sale de la tarifa normal porque el distrito está
marcado como especial pero no tiene monto pactado, ENTONCES el sistema DEBE señalar esa procedencia.

**R15** — CUANDO la petición traiga la confirmación explícita del cambio de ubicación, el sistema
DEBE aplicar la corrección y escribir la zona derivada junto con la geografía recibida.

**R16** — SI la orden ya tiene al menos un detalle congelado en un cierre, ENTONCES el sistema DEBE
advertirlo junto al aviso de R11, indicando que lo ya facturado no cambia y que el importe nuevo
rige a partir de ahora.

**R17** — CUANDO una corrección se aplique, el sistema NO DEBE modificar ni borrar ninguna fila de
detalle de cierre ni ningún movimiento de billetera.

**R18** — El sistema DEBE exigir para el aviso de R11 el mismo rol, la misma pertenencia y la misma
ventana de estado que exige para escribir, y NO DEBE devolver ningún dato de la orden a quien no los
cumpla.

### Re-geocodificación

**R19** — CUANDO la corrección cambie efectivamente la dirección de la orden, el sistema DEBE encolar
la re-geocodificación de esa orden.

**R20** — CUANDO la corrección no cambie la dirección de la orden, el sistema NO DEBE encolar ninguna
re-geocodificación.

**R21** — CUANDO la corrección cambie la dirección, el encolado y la escritura de la orden DEBEN
ocurrir en la misma transacción: SI una de las dos no se aplica, ENTONCES no DEBE quedar aplicada la
otra.

**R22** — CUANDO la corrección cambie la dirección, el sistema NO DEBE escribir las coordenadas ni el
resultado de geocodificación de la orden: DEBEN seguir siendo los anteriores hasta que el trabajo
encolado se ejecute.

**R23** — El trabajo encolado NO DEBE contener la dirección ni ningún otro dato personal de la orden.

### La puerta que no se abre (D2)

**R24** — El tipo con el que esta corrección escribe la orden NO DEBE poder expresar `estatusId`,
`tiendaId`, `montoCobrar`, `cobraComision`, `numGuia`, `numRemision` ni `mensajeroAsignadoId`.

**R25** — CUANDO una corrección se aplique, el sistema NO DEBE escribir en el historial de estado, ni
en el hilo de notas de la orden, ni en ninguna tabla de auditoría; la única escritura fuera de la
fila de la orden DEBE ser el trabajo de re-geocodificación de R19.

**R26** — Ningún módulo de esta feature DEBE escribir en registros (`console`, logs de servidor o de
navegador) la dirección, el destinatario, el teléfono, el producto ni las notas de una orden.

### Autorización y ventana (heredadas de la 312)

**R27** — El sistema DEBE aplicar a los campos nuevos exactamente los mismos roles y la misma ventana
de estado que la ficha 312 aplica a los cuatro campos anteriores, sin ampliarlos ni restringirlos.

**R28** — El sistema DEBE revalidar en el servidor el rol, la pertenencia y el estado en CADA
petición —tanto la que produce el aviso de R11 como la que escribe—, con independencia de lo que la
superficie haya ofrecido.

**R29** — CUANDO el estado de la orden cambie entre el momento en que el sistema la lee y el momento
en que escribe, el sistema NO DEBE aplicar la corrección y DEBE informarlo como conflicto, sin dejar
ningún efecto parcial.

**R30** — SI la orden no existe, o está borrada lógicamente, o pertenece a otra tienda cuando el
actor es `adminTienda`, ENTONCES el sistema DEBE devolver el MISMO resultado opaco, sin distinguir
cuál de los casos ocurrió.

### Superficies

**R31** — CUANDO se abra la superficie de corrección sobre una orden, DEBE presentar precargados la
dirección, la provincia, el cantón, el distrito y el peso actuales de esa orden, además de los cuatro
campos de la ficha 312.

**R32** — Las dos superficies de la ficha 312 (la acción por fila de `/ordenes` y las cards de
`/novedades`, en sus DOS grupos) DEBEN ofrecer los mismos nueve campos.

**R33** — CUANDO el servidor responda que falta confirmar el cambio de ubicación, la superficie DEBE
mostrar la zona resultante y los dos importes de R11 —y el aviso de R16 si aplica— ANTES de permitir
confirmar, y NO DEBE permitir guardar el cambio sin esa confirmación.

**R34** — CUANDO el servidor rechace la corrección, la superficie DEBE conservar lo tecleado, mostrar
un motivo accionable y NO reflejar ningún cambio; el motivo NO DEBE exponer identificadores internos
ni el detalle de por qué se rechazó cuando el resultado del servidor es opaco (R30).

**R35** — Ningún texto de la superficie DEBE prometer un registro de la corrección: no lo hay (D3).

**R36** — SI la orden ya tiene número de guía asignado, ENTONCES la superficie DEBE advertir, ANTES
de confirmar, que la etiqueta ya impresa conserva la dirección y los datos anteriores.

---

## Fuera de alcance (declarado)

- Los siete campos de D2. En particular **el monto a cobrar**: corregir una ubicación no lo toca.
- **Todo rastro** de la corrección (D3, heredado de 312/D4), con la única enmienda de D6.
- **Escribir coordenadas**: las escribe el trabajo de geocodificación de la feature 91, no esta
  ficha (R22).
- **Reimprimir la etiqueta.** R36 avisa y nada más, igual que 312/R27: la reimpresión ya es un gesto
  propio de la fila del listado.
- **Corregir la ubicación por LOTE.** La ubicación es propia de cada orden.
- **Cambiar la asignación** que la zona nueva pudiera implicar (mensajero, bodega satélite). La
  corrección escribe la zona; a quién le toca esa orden después lo deciden las pantallas de despacho
  que ya existen.
- **Ampliar `OrdenRepository.update`** para que pueda escribir la dirección. El camino vivo es otro
  (ver `design.md` §7) y ampliarlo no lo haría más corto.

---

## Preguntas abiertas

> **Estado: las cuatro están CERRADAS.** P1 y P2 las resolvió el humano el **2026-08-28**; P3 y P4
> las cerró el `backend_dev` ese mismo día, midiendo. Ninguna quedó pendiente para el frontend.

**P1 — Cuando la zona nueva no tiene tarifa, ¿basta con avisar o hay que bloquear?**
✅ **RESUELTA POR EL HUMANO EL 2026-08-28: se AVISA y se deja guardar.** El modal dirá «sin tarifa
configurada» en vez de un importe, que es como el resto del sistema trata una tarifa ausente
(coherente con la regla ya firmada de la feature 274: un par sin tarifa no bloquea, se muestra el
hueco y se sigue). **Riesgo aceptado, dicho en voz alta:** la corrección puede dejar una orden en una
zona por la que Ordenex **no facturará nada** hasta que alguien configure esa tarifa. La alternativa
—bloquear— dejaría la orden con la ubicación **equivocada** por un hueco de configuración que vive en
otra tabla. R13 y su test quedan como estaban.

**P2 — El `adminTienda` puede mover su propio flete.**
✅ **RESUELTA POR EL HUMANO EL 2026-08-28: SÍ puede.** El `adminTienda` corrige la ubicación de sus
propias órdenes aunque eso mueva su propio flete; ve el aviso con los dos importes y confirma. La
razón del humano: **es el mismo nivel de confianza que ya tiene para cargar órdenes y declarar su
monto a cobrar — no se le da una capacidad nueva de mover dinero, se le da la de arreglar un dato.**
El aviso de R11 y la confirmación de R33 se le exigen igual que a `maestro`, así que no puede hacerlo
sin verlo. No hay segunda aprobación, y no hace falta. D4 no se reabre.

**P3 — ¿Cuánto dura la ventana de coordenadas viejas, y molesta a alguien?**
✅ **CERRADA POR EL `backend_dev` EL 2026-08-28. Se deja como está (R22 no cambia), y esto es lo que
se midió** —porque «no molesta» sin número es una suposición—:

- **La ventana dura como mucho ~1 minuto.** El drenador de la cola es `/api/cron/procesar-jobs` con
  `schedule: "* * * * *"` (`vercel.json:13-14`): corre **cada minuto**. El job entra `pending` con
  `run_after = now()`, así que lo recoge el siguiente tick.
- **Sí hay una puerta que decide con coordenadas, y en ese minuto decidiría con las viejas.**
  `AsignabilidadCoordenadasService` tiene como primer paso de su árbol —normativo, `:7`— «R2
  coordenadas presentes → asignable». Una orden con la dirección nueva y las coordenadas anteriores
  pasa ese paso, y si alguien la asigna en ese intervalo, el optimizador la rutea al **punto viejo**.
- **Aun así no se limpian las coordenadas**, y el motivo está en `design.md` §7.3: ponerlas a `null`
  dejaría la orden **fuera** de esas mismas puertas hasta que corriera el trabajo, es decir, corregir
  un dato **bloquearía la operación**. Cambiar un ruteo equivocado de un minuto por un bloqueo
  cierto es peor negocio.
- **Lo que queda abierto es de operación, no de diseño:** si la cola se atasca (jobs `failed`
  acumulados), esa ventana deja de ser un minuto. Eso lo cubre el dead-letter de la feature 90 y no
  es alcance de esta ficha.

**P4 — ¿El aviso debe decir el importe con dos decimales, o el negocio los quiere enteros?**
✅ **CERRADA POR EL `backend_dev` EL 2026-08-28: escala 2, tal como salen, y NO se redondean.** La
ficha 305 fijó que **el monto a cobrar** es un entero de colones, con restricción en la base; el flete
y la comisión **no** tienen esa restricción, y su escala 2 es la que factura el cierre. El aviso
existe para enseñar **lo que se va a cobrar**: redondearlo para la pantalla haría que el número
mostrado y el facturado dejaran de coincidir, que es exactamente la clase de desajuste que costó
céntimos reales en la feature 204. El backend emite STRING escala 2 y la pantalla lo pinta con
`money()`. Si el negocio quiere verlos enteros, es una decisión de **presentación** y se toma en el
formateador, nunca en el cálculo.

---

## Trazabilidad

Cada `R<n>` de este documento (R1–R36) tiene su test nombrado en `tasks.md`, en la tabla
`R<n> → test`. Un requisito sin test es un fallo de la feature (`docs/specs.md` §Trazabilidad).
</content>
</invoke>
