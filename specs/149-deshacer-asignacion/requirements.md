# Feature 149 — Deshacer asignación a mensajero o bodega antes de la recogida

> Requisitos en notación EARS. Sin detalles de implementación (esos viven en `design.md`).
> Cada `R<n>` debe poder verificarse con al menos un test (`tasks.md` fija la trazabilidad).

## Glosario acotado a esta feature

- **Deshacer asignación**: revertir la ÚLTIMA transición de asignación/ruteo de UNA orden,
  devolviéndola a la bodega desde la que se asignó, mientras el paquete no haya salido de esa
  bodega ni haya sido recibido en otra.
- **Caso (a)**: la orden está en `por_recoger` (asignada a un mensajero que aún no la recogió).
- **Caso (b)**: la orden está en `en_ruta_bodega_satelite` (ruteada a una bodega satélite que
  aún no la recibió).
- **Destino derivado**: estado al que vuelve la orden, obtenido del historial (`R11`-`R15`).
- **Acceso total**: rol `maestro` o `admin` (`esAccesoTotal`, `lib/auth/acceso-total.ts`).
- **Lote**: conjunto de órdenes enviado en UNA invocación de la acción.

---

## 1. Autorización por rol y por zona

**R1.** El sistema DEBE permitir deshacer una asignación ÚNICAMENTE a los roles `maestro`,
`admin` y `adminSatelite`; ningún otro rol (`adminTienda`, `mensajero`, `apiKey`, cualquier rol
futuro) DEBE poder ejecutarla.

**R2.** CUANDO un actor cuyo rol no es `maestro`, `admin` ni `adminSatelite` invoque la acción de
deshacer, el sistema DEBE responder `forbidden` y NO DEBE modificar el estado, el mensajero
asignado, el historial ni encolar webhooks de ninguna orden del lote.

**R3.** CUANDO un actor con acceso total (`maestro`/`admin`) invoque la acción, el sistema DEBE
aceptarla para órdenes de CUALQUIER zona, sin restricción de zona.

**R4.** MIENTRAS el actor tenga rol `adminSatelite`, el sistema DEBE rechazar con `forbidden` el
lote completo si alguna orden del lote tiene `zona_id` distinto de la zona del actor resuelta
server-side, sin efectos sobre ninguna orden del lote.

**R5.** MIENTRAS el actor tenga rol `adminSatelite`, el sistema DEBE rechazar con `forbidden` el
lote completo si el destino derivado (R11-R15) de alguna orden del lote NO es
`en_bodega_satelite`, sin efectos sobre ninguna orden del lote.

**R6.** SI el actor tiene rol `adminSatelite` y no tiene zona asignada, ENTONCES el sistema DEBE
responder `sin_zona` y NO DEBE modificar ninguna orden.

**R7.** SI la invocación llega sin sesión válida, ENTONCES el sistema DEBE responder
`unauthenticated` antes de leer o escribir cualquier dato de órdenes.

---

## 2. Caso (a): orden asignada a mensajero (`por_recoger`)

**R8.** CUANDO se deshace la asignación de una orden en `por_recoger`, el sistema DEBE fijar su
estado al destino derivado (R11-R15) y DEBE dejar `mensajero_asignado_id` en NULL.

**R9.** CUANDO se deshace la asignación de una orden en `por_recoger`, el sistema DEBE dejar
`asignado_at` en NULL, de modo que se conserve el invariante «`asignado_at` no nulo si y solo si
hay mensajero asignado».

---

## 3. Caso (b): orden ruteada a bodega satélite (`en_ruta_bodega_satelite`)

**R10.** CUANDO se deshace el ruteo de una orden en `en_ruta_bodega_satelite`, el sistema DEBE
fijar su estado a `en_bodega_central` y DEBE dejar `mensajero_asignado_id` y `asignado_at` en
NULL (idempotente: en este estado ya son NULL).

---

## 4. Derivación del estado destino

**R11.** El sistema DEBE derivar el estado destino de UNA orden leyendo, de su historial de
estados, la fila MÁS RECIENTE cuyo estado de destino sea el estado ACTUAL de la orden, y tomando
el estado de ORIGEN de esa fila. El destino NUNCA DEBE derivarse de la zona de la orden ni de
ninguna otra regla que no sea esa lectura.

**R12.** El sistema DEBE normalizar el estado de origen leído según esta tabla CERRADA:

| Estado de origen leído del historial | Destino de la reversión |
| --- | --- |
| `en_bodega_central` | `en_bodega_central` |
| `en_bodega_satelite` | `en_bodega_satelite` |
| `en_fulfillment` | `en_bodega_central` |
| `en_preparacion` | `en_bodega_central` |

**R13.** SI la orden no tiene ninguna fila de historial cuyo destino sea su estado actual, O si
esa fila tiene estado de origen nulo (fila de creación), O si el estado de origen leído no
aparece en la tabla de R12, ENTONCES el sistema DEBE rechazar esa orden con `conflict` y un
motivo que indique que no se pudo derivar el estado de origen, y NO DEBE adivinar un destino ni
escribir nada (fallo CERRADO).

**R14.** SI la normalización de R12 produce `en_bodega_central` para una orden cuya zona NO es la
zona central (GAM), ENTONCES el sistema DEBE rechazar esa orden con `conflict` y un motivo que
señale la incoherencia zona/destino, sin efectos.

**R15.** SI la normalización de R12 produce `en_bodega_satelite` para una orden cuya zona SÍ es
la zona central (GAM), ENTONCES el sistema DEBE rechazar esa orden con `conflict` y un motivo que
señale la incoherencia zona/destino, sin efectos.

---

## 5. Bloqueos

**R16.** SI el estado actual de una orden del lote no es `por_recoger` ni
`en_ruta_bodega_satelite`, ENTONCES el sistema DEBE rechazarla con `conflict` y un motivo que
nombre el estado actual. Esto incluye, sin ser exhaustivo: `en_ruta` (ya recogida),
`en_bodega_satelite` (ya recibida por la satélite), `entregada`, `reprogramada`, `devuelta`,
`rechazada`, `sin_gestionar` (ya gestionadas o cortadas).

**R17.** SI una orden del lote está borrada (`deleted_at` no nulo), ENTONCES el sistema DEBE
rechazarla con `conflict` y motivo «orden borrada», sin efectos.

**R18.** SI un identificador del lote no corresponde a ninguna orden, ENTONCES el sistema DEBE
rechazarlo con `conflict` y motivo «orden no existe», sin efectos.

**R19.** MIENTRAS el mensajero asignado a una orden tenga un cierre de día en estado bloqueante
(`solicitado`, `vencido` o `rechazado`), el sistema DEBE permitir igualmente deshacer la
asignación de esa orden (decisión Q1 del gate F1.4, CERRADA): el cierre pendiente NO es causa de
rechazo de esta acción. El sistema DEBE, al mismo tiempo, seguir rechazando la ASIGNACIÓN de
órdenes a ese mismo mensajero por las vías existentes (generar guía, asignar desde bodega,
asignar desde satélite): la asimetría entre asignar y deshacer es deliberada y DEBE ser
verificable.

**R20.** El sistema DEBE aplicar la política TODO-O-NADA por lote: si al menos una orden del lote
es rechazada por cualquier motivo (R2, R4-R7, R13-R18, R21, R22), NINGUNA orden del lote DEBE
quedar modificada, ni en estado, ni en mensajero, ni en historial, ni en webhooks encolados.

**R21.** CUANDO el estado de una orden cambie entre la validación y la escritura (carrera con
recogida, recepción satélite o corte), el sistema DEBE detectarlo por la guarda de escritura por
estado de origen, DEBE revertir el lote completo y DEBE responder `conflict` con el detalle por
orden, sin efectos parciales.

---

## 6. Motivo obligatorio

**R22.** El sistema DEBE exigir un `motivo` de texto libre en toda invocación: tras recortar
espacios, DEBE tener entre 10 y 300 caracteres. SI el motivo falta, está vacío, o queda fuera de
ese rango, ENTONCES el sistema DEBE responder `validation_error` con el error asociado al campo
`motivo` y NO DEBE modificar ninguna orden.

**R23.** CUANDO una orden transicione efectivamente, el sistema DEBE persistir el `motivo`
recortado en la columna `motivo` de la fila de historial de esa transición, de modo que sea
legible en la línea de tiempo de la orden.

**R24.** El sistema DEBE aplicar el MISMO `motivo` a todas las órdenes de un mismo lote (un
motivo por invocación, no uno por orden).

---

## 7. Trazabilidad: nuevo tipo de origen y guardia de transiciones

**R25.** El sistema DEBE clasificar estas transiciones con un tipo de origen de historial NUEVO y
propio, `deshacer_asignacion`, distinguible en la línea de tiempo de `asignacion_bodega`,
`asignacion_satelite`, `ruteo_satelite`, `generacion_guia`, `ajuste_estado` y `deshacer_gestion`.

**R26.** El sistema DEBE tratar `deshacer_asignacion` como un origen que NUNCA enlaza una gestión
(su fila de historial nace sin enlace a gestión) y cuyo destino nunca es `devuelta`; en
consecuencia NO DEBE formar parte del conjunto de orígenes «con gestión» y NO DEBE alterar el
conteo de intentos de devolución de ninguna orden.

**R27.** El sistema DEBE declarar en el inventario cerrado de transiciones legales EXACTAMENTE
estas tres aristas nuevas, y ninguna más:

| # | Origen | Destino | Vía | Rol |
| --- | --- | --- | --- | --- |
| 43 | `por_recoger` | `en_bodega_central` | `deshacer_asignacion` | maestro/admin |
| 44 | `por_recoger` | `en_bodega_satelite` | `deshacer_asignacion` | maestro/admin/adminSatelite (de la zona) |
| 45 | `en_ruta_bodega_satelite` | `en_bodega_central` | `deshacer_asignacion` | maestro/admin |

**R28.** El sistema DEBE seguir rechazando como transición ILEGAL cualquier par no declarado que
esta feature pudiera sugerir, en particular `por_recoger -> en_fulfillment`,
`por_recoger -> en_preparacion`, `en_ruta_bodega_satelite -> en_fulfillment`,
`en_ruta_bodega_satelite -> en_preparacion`, `en_ruta -> por_recoger`,
`en_bodega_satelite -> en_ruta_bodega_satelite` y `en_ruta -> en_bodega_central`.

**R29.** El sistema DEBE conservar `num_guia` intacto: la reversión NUNCA DEBE poner `num_guia` a
NULL ni consumir un nuevo valor de la secuencia de guías.

**R30.** El sistema NO DEBE modificar el flag `prioridad` de la orden al deshacer una asignación.
En consecuencia, una orden que fue liberada como prioritaria y luego asignada conserva
`prioridad = false` (el valor que dejó la asignación) tras la reversión: la pérdida del flag es
una LIMITACIÓN CONOCIDA Y ACEPTADA (decisión Q2 del gate F1.4, CERRADA), no un defecto. El
sistema NO DEBE encender `prioridad` al deshacer ni DEBE historificar el flag.

---

## 8. Bitácora y webhook

**R31.** CUANDO una orden transicione efectivamente, el sistema DEBE registrar EXACTAMENTE UNA
fila de historial con: la orden, el estado de origen real, el estado destino, el usuario que
ejecutó la acción como actor, el tipo de origen `deshacer_asignacion` y el motivo (R23), en la
MISMA transacción que el cambio de estado.

**R32.** CUANDO una orden transicione efectivamente, el sistema DEBE encolar la notificación de
cambio de estado (webhook) por el mismo mecanismo que el resto de transiciones, en la MISMA
transacción; SI la transacción se revierte, ENTONCES no DEBE quedar ninguna notificación
encolada.

**R33.** SI una orden no transiciona (rechazada o perdedora de una carrera), ENTONCES el sistema
NO DEBE dejar fila de historial ni notificación encolada para esa orden.

---

## 9. Interfaz de usuario

**R34.** DONDE el usuario tenga acceso total y esté en el listado de órdenes, el sistema DEBE
ofrecer una acción por lote «Deshacer asignación» sobre una selección cuyas órdenes estén en
`por_recoger` o en `en_ruta_bodega_satelite`.

**R35.** DONDE el usuario tenga rol `adminSatelite` y esté en su módulo de bodega satélite, el
sistema DEBE mostrar las órdenes de SU zona en `por_recoger` y DEBE ofrecer sobre ellas una
acción por lote «Deshacer asignación».

**R36.** El sistema NO DEBE ofrecer la acción «Deshacer asignación» al `adminSatelite` sobre
órdenes en `en_ruta_bodega_satelite` (caso (b) es competencia de la bodega central).

**R37.** MIENTRAS el campo de motivo no contenga un texto válido según R22, el sistema DEBE
mantener deshabilitado el botón de confirmación de la acción.

**R38.** CUANDO la acción termine con éxito, el sistema DEBE releer el estado del servidor de
modo que las órdenes revertidas desaparezcan de la superficie de origen y aparezcan en la de la
bodega correspondiente, y DEBE informar cuántas órdenes se revirtieron.

**R39.** CUANDO la acción falle, el sistema DEBE mostrar un mensaje accionable, distinto por
causa, que permita al operador saber qué hacer: sin permiso, zona ajena, orden ya recogida o ya
recibida, orden borrada, sin historial para derivar el origen, incoherencia zona/destino, motivo
inválido y catálogo de estados incompleto.

**R40.** El sistema NO DEBE exponer en los mensajes de error identificadores internos (UUID de
orden, de estado o de usuario) ni datos personales del destinatario.

---

## 10. Aviso al mensajero desasignado — DIFERIDO A LA FEATURE 146

**R41.** El sistema NO DEBE, en esta feature, emitir ningún aviso al mensajero cuya orden fue
retirada: el único efecto visible para él DEBE ser la desaparición de la orden de su listado de
asignaciones. DONDE exista el canal de notificaciones de la feature 146 (campana de
notificaciones, hoy `pending`), el sistema DEBERÁ notificar al mensajero desasignado con el
siguiente contrato, que esta feature NO implementa:

| Campo | Valor |
| --- | --- |
| Disparador | reversión exitosa de una orden en `por_recoger` (caso (a)) |
| Destinatario | el usuario que figuraba en `mensajero_asignado_id` ANTES de la reversión |
| Contenido | «La orden `<num_guia>` fue retirada de tus asignaciones» |
| Caso (b) | NO aplica: no hay mensajero asignado en `en_ruta_bodega_satelite` |

La decisión Q5 del gate F1.4 (CERRADA) es: SÍ se quiere el aviso, pero se DIFIERE a la 146 porque
el canal no existe. El punto de enganche del productor de la notificación está marcado con un
comentario-ancla en `design.md` §3.2 y DEBE existir en el código como comentario `TODO(146)` en
ese mismo punto, para que la feature 146 lo encuentre.

---

## Decisiones del gate F1.4

Las siete preguntas abiertas de la versión previa de este documento fueron RESUELTAS por el
humano el 2026-07-28. Quedan registradas, con su justificación, en
`design.md` §8 «Decisiones del gate F1.4 (CERRADAS 2026-07-28)». No hay preguntas abiertas
pendientes en esta feature.
</content>
</invoke>
