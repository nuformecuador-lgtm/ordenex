# Feature 368 — Asignación por lote no aborta completa por una orden no geocodificable

> Lee también `design.md` (el cómo) y `tasks.md` (el desglose). Ficha `fullstack`, `sdd: true`.

## Origen, medido

El humano reportó «Dirección no encontrada» al intentar asignar 4 órdenes en bodega satélite.
Medido: solo **1 de 4** (NA-138) fallaba el gate de asignabilidad por coordenadas (feature 92,
`geocode_status = ZERO_RESULTS`) — pero el gate aborta el **lote completo**, así que las otras 3,
ya asignables, se bloquean con ella. No es un patrón sistémico: **2/958** órdenes en 14 días, una
sola tienda (`progress/current.md`, entrada 2026-09-03).

## Precisiones verificadas en el código, no supuestas

1. **El gate ya es por-orden.** `AsignabilidadCoordenadasService.evaluar` (feature 92) devuelve un
   `Map<ordenId, EstadoAsignabilidad>` con una entrada por cada orden recibida, nunca omite
   ninguna (`lib/interfaces/services/IAsignabilidadCoordenadasService.ts`). El problema no es el
   gate: es que sus DOS consumidores tratan el resultado como todo-o-nada.
2. **Solo DOS escritores lo consultan, y son los dos que esta ficha toca.**
   `GuiaAsignacionService.asignarDesdeBodega` (bodega central) y `AsignacionSateliteService.asignar`
   (bodega satélite). `generarGuia`, `rutearABodegaSatelite`, `asignarRecoleccion` y
   `desasignarRecoleccion` **no invocan el gate** (comentarios feature 156/R12/R19 y feature 157/R9
   en `GuiaAsignacionService.ts`, `AsignacionSateliteService.ts`): esta ficha no los toca.
3. **El contrato "todo-o-nada" está documentado explícitamente como decisión previa, no como
   accidente.** `GuiaAsignacionService.gateCoordenadas` (método privado, `:159-190`) lo dice en su
   docstring: *"TODO-O-NADA POR LOTE: es el contrato ya vigente de estos services (una sola orden
   conflictiva aborta el lote entero sin efectos), no se cambia aqui."* Esta ficha es exactamente la
   que sí lo cambia — solo para el motivo de coordenadas (ver Bloque B).
   `AsignacionSateliteService.asignar` tiene el mismo patrón, mismo comentario, en su bloque
   `4b` (`:253-268`).
4. **Los cinco motivos no-`asignable` son un vocabulario cerrado.**
   `EstadoAsignabilidad` (`lib/interfaces/services/IAsignabilidadCoordenadasService.ts`) es una unión
   cerrada de seis literales: `asignable` y cinco de rechazo —
   `direccion_no_geocodificable`, `geocodificacion_agotada`, `geocodificacion_en_curso`,
   `geocodificacion_encolada`, `geocodificacion_no_encolable`. Los dos writers usan
   `motivoAsignabilidad(estado)` (que devuelve el literal tal cual) para llenar
   `DetalleConflicto.motivo`.
5. **El mapeo motivo → mensaje de usuario ya existe y es compartido.**
   `app/(app)/_components/geocodificacion-motivo-messages.ts` (feature 93/R9) traduce los cinco
   motivos a dos mensajes fijos, sin PII: `MSG_DIRECCION_NO_ENCONTRADA` ("Dirección no encontrada")
   para los dos motivos DEFINITIVOS, y `MSG_DIRECCION_EN_VALIDACION` para los tres TRANSITORIOS. Hoy
   solo expone `geocodificacionMotivoMessage(error)`, que **agrega** todos los motivos de un
   `detalle` en un único mensaje para todo el lote (gana el definitivo). Para el éxito parcial hace
   falta un mensaje **por orden bloqueada**, no uno agregado — ver `design.md` §6.
6. **El identificador visible ya viaja al cliente, sin tocar el backend.** Los dos modales
   (`AsignarBodegaModal.tsx`, `AsignarSateliteModal.tsx`) reciben `ordenes: OrdenListItemDTO[]` /
   `RecepcionSateliteDTO[]` como snapshot al abrirse, y **ambos tipos ya traen `numRemision`**
   (`lib/types/orden.ts:295`, `RecepcionSateliteDTO`). Los `ordenIds` que se mandan al servidor son
   `ordenes.map(o => o.id)` — exactamente ese mismo snapshot. El cliente puede mapear
   `ordenId → numRemision` con los datos que ya tiene, sin que el backend necesite exponer
   `numRemision` en `DetalleConflicto`.
7. **La escritura del lote ya admite un subconjunto sin ningún cambio de mecanismo.**
   - `OrdenRepository.asignarBodegaLote` (bodega central) hace `updateMany({ where: { id: { in:
     ordenIds } }, ... })` dentro de una única `$transaction`, sin guarda por estado en el `WHERE`
     (la validación de estado ya corrió en el service). Pasarle un subconjunto de ids en vez del
     lote completo asigna exactamente ese subconjunto, atómicamente, sin ningún cambio de firma ni
     de mecanismo transaccional.
   - `OrdenRepository.asignarSateliteLote` (bodega satélite) hace un `UPDATE ... WHERE id IN (...)
     AND estatus_id = origen AND zona_id = zona AND deleted_at IS NULL RETURNING id` dentro de una
     `$transaction`, y devuelve `rows.length`. Mismo razonamiento: un subconjunto de ids escribe
     exactamente ese subconjunto.
   - **Conclusión (responde la pregunta de transaccionalidad):** no hace falta ningún mecanismo
     transaccional nuevo. Filtrar `ordenIds` a las asignables ANTES de llamar al método de
     escritura ya existente basta; cada llamada sigue siendo una única transacción atómica sobre el
     subconjunto que recibe.
8. **La bodega satélite ya tiene una detección de carrera que hoy reporta `conflict` tras escribir
   parcialmente.** Si `asignarSateliteLote` devuelve `count !== ordenIds.length` (alguna orden
   cambió de estado/zona entre la lectura y la escritura), el service re-lee y devuelve `conflict`
   — pero el `UPDATE` **ya se comprometió** para las órdenes que sí ganaron la guarda, porque corre
   dentro de su propia `$transaction` que confirma al retornar. Es un comportamiento preexistente,
   no introducido por esta ficha, y no se endurece aquí (ver R17 y `design.md` §5). La bodega
   central (`asignarBodegaLote`) no tiene esta comprobación porque su `WHERE` no está guardado por
   estado.
9. **Ningún otro motivo de `DetalleConflicto` en `asignarDesdeBodega` / `AsignacionSateliteService.
   asignar` es hoy independiente entre órdenes de la misma forma que las coordenadas.** Los
   verificados en el código:
   - Por-orden pero de **estado/pertenencia** (indican una selección obsoleta o inválida, no un dato
     intrínseco de la orden): `orden no existe`, `orden borrada`, `MSG_ORDEN_REPROGRAMADA_BLOQUEADA`,
     `estado de origen no permitido: <x>`, `orden de zona no-GAM` / `zona_ajena`.
   - **A nivel de mensajero o de lote completo** (no varían por orden dentro del mismo lote, porque
     el lote comparte un único `mensajeroId`): mensajero sin vehículo, mensajero no asignable por
     estado, mensajero bloqueado por cierres, mensajero con recolección/reparto pendiente, bodega
     satélite bloqueada.
   - `MSG_TOPE_INTENTOS_ASIGNACION` (tope de intentos, feature 276) sí es un dato por-orden
     (`contarIntentosEnLote`), pero **no es el problema reportado** y hoy sigue todo-o-nada; ver
     Bloque B para la decisión y su justificación.

## Vocabulario

| Término | Qué significa aquí |
| --- | --- |
| **asignable** | Estado que devuelve el gate de coordenadas cuando la orden puede recibir mensajero (`EstadoAsignabilidad === "asignable"`). |
| **bloqueada (por coordenadas)** | Orden cuyo estado de asignabilidad es uno de los cinco motivos de rechazo del gate (ver precisión 4). |
| **éxito total** | Todas las órdenes del lote son asignables; se asigna el lote completo (comportamiento vigente). |
| **éxito parcial** | El lote tiene mezcla de asignables y bloqueadas por coordenadas; se asignan las asignables y se reportan las bloqueadas. **Es el comportamiento nuevo de esta ficha.** |
| **fallo total** | Ninguna orden del lote es asignable por coordenadas (o el lote fue rechazado por cualquier otro motivo ya vigente); no se asigna nada. |
| **todo-o-nada** | El comportamiento previo a esta ficha: una sola orden no asignable abortaba el lote entero. Sigue vigente para todos los motivos que NO son de coordenadas (Bloque B). |

---

# Requisitos

## Bloque A — El lote se asigna parcialmente cuando el motivo es de coordenadas

**R1.** CUANDO `asignarDesdeBodega` evalúe un lote en el que, tras superar el resto de guardas del
método, al menos una orden resulte bloqueada por el gate de coordenadas y al menos una orden
resulte asignable, el sistema DEBE asignar el mensajero a las órdenes asignables y NO DEBE
modificar las órdenes bloqueadas.

**R2.** CUANDO `AsignacionSateliteService.asignar` evalúe un lote en las mismas condiciones que R1
(mezcla de asignables y bloqueadas por coordenadas, tras superar el resto de sus guardas), el
sistema DEBE aplicar el mismo comportamiento que R1.

**R3.** SI, tras superar el resto de guardas del lote, NINGUNA orden resulta asignable por
coordenadas, ENTONCES el sistema DEBE rechazar el lote completo sin ningún efecto sobre ninguna
orden (comportamiento vigente, sin cambios).

**R4.** SI todas las órdenes del lote resultan asignables por coordenadas, ENTONCES el sistema DEBE
asignar el lote completo (comportamiento vigente, sin cambios).

**R5.** El sistema DEBE aplicar el mismo criterio de asignación parcial y el mismo vocabulario de
motivo (los cinco literales de `EstadoAsignabilidad`) en la bodega central y en la bodega satélite.

## Bloque B — Alcance: SOLO el motivo de coordenadas, nada más

**R6.** El comportamiento de asignación parcial (R1/R2) DEBE aplicar EXCLUSIVAMENTE a los cinco
motivos que emite el gate de asignabilidad por coordenadas (precisión 4). Ningún otro motivo de
rechazo activa asignación parcial.

**R7.** Los motivos de rechazo por-orden de estado/pertenencia ya vigentes — orden no existe, orden
borrada, orden reprogramada, estado de origen no permitido, orden de zona no-GAM / zona ajena —
DEBEN seguir abortando el lote completo sin ningún efecto, sin cambios de esta ficha. *(Justificación:
señalan una selección obsoleta o inválida —la pantalla del operador quedó desactualizada—, no un
dato intrínseco de la orden que sea independiente del resto del lote; ver `design.md` §7 para la
alternativa descartada de generalizar.)*

**R8.** Los motivos de rechazo a nivel de mensajero o de lote ya vigentes — mensajero sin vehículo,
mensajero no asignable por su estado, mensajero bloqueado por cierres, mensajero con
recolección/reparto pendiente, bodega satélite bloqueada, tope de intentos de entrega — DEBEN
seguir abortando el lote completo sin ningún efecto, sin cambios de esta ficha, y DEBEN seguir
evaluándose ANTES que el gate de coordenadas (orden de guardas vigente, sin alterar).

**R9.** Esta ficha NO DEBE alterar el comportamiento de `generarGuia`, `rutearABodegaSatelite`,
`asignarRecoleccion` ni `desasignarRecoleccion`: ninguno de los cuatro invoca el gate de
coordenadas (precisión 2).

## Bloque C — Qué le dice el sistema al operador

**R10.** CUANDO el resultado de un lote sea de asignación parcial, el sistema DEBE identificar cada
orden bloqueada por su identificador visible (`numRemision`), nunca por su id interno ni por su
dirección.

**R11.** CUANDO el resultado de un lote sea de asignación parcial, el sistema DEBE mostrar, por cada
orden bloqueada, un motivo en el mismo vocabulario de usuario que ya usa
`geocodificacion-motivo-messages.ts` para el rechazo total: el mensaje DEFINITIVO ("Dirección no
encontrada") para los motivos `direccion_no_geocodificable` / `geocodificacion_agotada`, o el
mensaje de EN VALIDACIÓN para los otros tres, sin agregarlos: cada orden bloqueada lleva el mensaje
de SU propio motivo, no el mensaje "ganador" de todo el lote.

**R12.** CUANDO el resultado de un lote sea de asignación parcial, el sistema DEBE informar cuántas
órdenes se asignaron y cuántas quedaron bloqueadas, en el mismo lugar donde hoy se confirma un
lote asignado con éxito total.

**R13.** CUANDO el resultado de un lote sea de asignación parcial, el sistema DEBE seguir
permitiendo descargar el manifiesto de las órdenes efectivamente asignadas, igual que en un éxito
total.

**R14.** Ningún mensaje nuevo de esta ficha DEBE exponer la dirección de la orden, su id interno, ni
ningún otro dato que el rechazo total equivalente no exponga ya hoy.

## Bloque D — Contrato de la respuesta

**R15.** El sistema DEBE distinguir tres desenlaces posibles para un lote de asignación (central o
satélite): éxito total, éxito parcial y fallo total. El desenlace de éxito parcial DEBE llevar tanto
las órdenes que se asignaron como las que quedaron bloqueadas, cada una con su motivo.

**R16.** El desenlace de fallo total (R3, y el resto de motivos del Bloque B) DEBE conservar
exactamente la forma de respuesta ya vigente (sin ningún campo nuevo), para no alterar el
invariante que hoy asumen sus consumidores: "fallo total = cero efectos sobre datos".

**R17.** SI la escritura guardada de la bodega satélite no llega a cubrir todas las órdenes que el
gate de coordenadas marcó como asignables (carrera de concurrencia: alguna cambió de estado o de
zona entre la lectura y la escritura), ENTONCES el sistema DEBE tratarlo como el fallo total de
carrera ya vigente hoy para ese caso — nunca reportar éxito total ni parcial de más — y DEBE incluir
en su detalle tanto las órdenes que perdieron la carrera como las que ya venían bloqueadas por
coordenadas, para no perder esa información en el caso compuesto. *(Precisión 8: este caso es
preexistente y no se endurece aquí; ver `design.md` §5.)*

## Bloque E — Supersede la regla anterior, no la borra en silencio

**R18.** Esta ficha SUPERA la regla "todo-o-nada por lote" documentada en el docstring de
`GuiaAsignacionService.gateCoordenadas` (`:159-190`, cita en precisión 3) y en el bloque `4b` de
`AsignacionSateliteService.asignar` (`:253-268`) — EXCLUSIVAMENTE para el motivo de coordenadas.
Donde esos comentarios decían "una sola orden conflictiva aborta el lote entero, no se cambia
aquí", la regla vigente desde esta ficha es "las asignables se asignan, las bloqueadas se
reportan". El resto de lo que esos comentarios y los comentarios "TODO-O-NADA" vecinos (feature
271/R29-R30, feature 276/R19) describen para los DEMÁS motivos del mismo método sigue vigente sin
cambios (R7/R8).

**R19.** Ningún comentario del código que siga afirmando "todo-o-nada" para el motivo de
coordenadas específicamente DEBE sobrevivir sin reescribirse para declarar la regla vigente desde
esta ficha, nombrándola y su fecha.

---

## Trazabilidad rápida

| Requisitos | Ver en `design.md` |
| --- | --- |
| R1–R5 | §3 (lógica de los dos servicios) |
| R6–R9 | §7 (alcance, con la alternativa descartada de generalizar) |
| R10–R14 | §6 (UI: los dos modales y el mapper por-motivo) |
| R15–R17 | §2 (contrato de tipos) y §5 (el caso de carrera) |
| R18–R19 | §8 (qué comentarios se reescriben) |

---

## Preguntas abiertas

**Q1 — Texto exacto de los mensajes nuevos** (el toast de éxito parcial y el bloque de "órdenes
bloqueadas" del panel de resultado). R11/R12 fijan el **contenido obligatorio**, no las palabras.
Un texto propuesto vive en `design.md` §6.3 y es, siguiendo la convención de este repo, contrato de
test (los literales se afirman escritos a mano, nunca comparados contra la función que los genera).
Pendiente de que el humano los lea en la puerta `spec_ready`; no bloquea el resto de la
implementación porque el contenido obligatorio (R10-R14) ya está resuelto por evidencia.
