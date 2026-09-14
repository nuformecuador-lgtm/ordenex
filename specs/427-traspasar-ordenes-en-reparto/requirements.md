# 427 — Traspasar a otro mensajero lo que ya lleva encima · Requisitos

> **Pedido humano (2026-09-14, Carlos Restrepo), con un caso real encima:** el mensajero **Andy
> Cortés se enfermó a media jornada** y sus órdenes del día las tuvo que hacer **Carlos Eduardo**.
> La aplicación **no sabe hacerlo**: se resolvió escribiendo a mano contra producción.
>
> Notación EARS. Cada `R<n>` está mapeado a un test concreto en `tasks.md`.

---

## Estado medido del sistema antes de tocar nada

Base: `dev` @ `6cc87ad1`. Todo lo de esta tabla está leído **del archivo**, no del índice del grafo.

| Hecho | Dónde está medido |
| --- | --- |
| `DeshacerAsignacionService` admite **dos** estados de origen, no uno: `por_recoger` **y** `en_ruta_bodega_satelite` (`ORIGENES_REVERSIBLES`). La ficha decía «solo `por_recoger`» | `lib/services/DeshacerAsignacionService.ts:34-37` |
| Ninguno de los dos es `en_reparto`: **una orden ya recogida no tiene ninguna acción de traspaso ni de reversión**. Confirmado también en la barra de acciones de `/ordenes`, donde `case "en_reparto"` ofrece **solo** «Cambiar día de reparto» | `DeshacerAsignacionService.ts` + `app/(app)/ordenes/_components/OrdenesListado.tsx:688-690` |
| Los **únicos** escritores de `orden.mensajero_asignado_id` hoy son las dos asignaciones (central y satélite), la asignación de recolección y la limpieza del deshacer. Ninguno parte de `en_reparto` | `GuiaAsignacionService.ts:18-22`, `AsignacionSateliteService.ts`, `OrdenRepository.asignarBodegaLote/asignarSateliteLote/asignarRecoleccionLote/deshacerAsignacionLote` |
| El panel de chat del mensajero exige **dos** cosas: que la orden sea suya **y** que el hilo lo sea (`chat_conversacion.mensajero_id`). Mover solo la orden deja al destino con **hilo vacío**, `ventanaAbierta: false` y texto libre deshabilitado — sólo plantilla | `lib/actions/chat-whatsapp.ts:330-347` + `ChatConversacionRepository.findByOrdenParaMensajero` |
| El contador de no leídos del chat también cuelga de `chat_conversacion.mensajero_id` | `ChatConversacionRepository.contarNoLeidosPorMensajero` |
| Los **adjuntos** (`/api/chat/media/...`) NO cuelgan del hilo: se autorizan por `conversacion → orden → mensajero asignado`. Es la única pieza del chat que el movimiento de la orden ya arregla sola | `app/api/chat/media/[mensajeId]/route.ts:110-121` |
| `gestion_orden.mensajero_id` es **el actor** que registró la gestión y es independiente de `orden.mensajero_asignado_id` | `db/schema.prisma:1076` |
| La ruta optimizada se construye con las órdenes **`en_reparto` del mensajero** (`findParadasEnReparto`), y una orden en reparto sin fila de parada es una «parada sin optimizar» que la lectura muestra **al final** | `OrdenRepository.ts:3184-3200` + `db/schema.prisma:2639-2643` |
| Ya existe el encolado de reoptimización **dentro de la transacción del escritor** (outbox), con dos espacios de claves disjuntos. Hoy solo lo usa `GestionOrdenRepository` | `lib/services/jobs/optimizacion-ruta-encolado.ts` |
| Una orden `sin_gestionar` pertenece al cierre de su mensajero por un **predicado vivo** (`orden.mensajero_asignado_id = cierre.mensajero_id AND estatus = sin_gestionar`) hasta que el cierre se aprueba | `db/schema.prisma:2372-2378` |
| `fecha_reparto` se escribe y se limpia **siempre** en la misma sentencia que `asignado_at`, con **una sola** excepción declarada (`corregirDiaRepartoLote`) | `tests/unit/guards/fecha-reparto-acompana-asignado-at.guardia.test.ts` |
| Las listas de «qué lleva encima el mensajero» son un **censo cerrado de 8 miembros** y cada una declara su decisión sobre `ayuda_tienda` | `tests/unit/guards/carga-del-mensajero.guardia.test.ts:167-286` |
| La línea de tiempo de una orden ya **fusiona dos fuentes** (transiciones + correcciones de día) con un discriminante `clase`, y su `Record` de rangos está escrito para **no compilar** si aparece una tercera clase | `lib/services/OrdenHistorialService.ts:31-81` |
| Escribir en `orden_historial_estado` pasa por un choke point que **valida la transición**: `en_reparto → en_reparto` no existe en el inventario y reventaría | `lib/repositories/registrar-cambio-estado.ts` + `lib/types/order-status-transiciones.ts` |
| El rastro con **motivo** de una operación manual sobre una orden ya tiene forma canónica en este repo: tabla propia (`orden_dia_reparto_cambio`, `gestion_fecha_reprogramacion_cambio`), porque `historial_accion` deja fuera todo texto libre | `db/schema.prisma:3140-3242` |
| `/ordenes` ya tiene filtro por **mensajero asignado** (encadenado a zona) y por **estado**, y tamaño de página de hasta **50** | `OrdenesListado.tsx:283-287`, `OrdenesModule.tsx:58` |
| El canal de avisos existe y ya avisa **a un mensajero concreto** por algo que le cambió la bodega: `emitirDiaRepartoCorregido`, **fuera de la transacción y best-effort** | `lib/notificaciones/emitir.ts:400-459` + `CorreccionDiaRepartoService.ts:185-214` |
| `deshacerAsignacionLote` lleva escrito un `TODO(146)`: «productor de notificación al mensajero desasignado», con el destinatario ya pre-leído | `OrdenRepository.ts:4496-4503` |
| La clave de deduplicación de avisos es UNIQUE sobre `(evento, entidad_id, destinatario_rol, destinatario_usuario_id)`, **no mira el estado de lectura**, y `crear` absorbe el choque devolviendo `null`: elegir mal la entidad silencia el segundo aviso **para siempre y sin ruido** (lo pagaron las fichas 262, 403 y 409) | `db/schema.prisma:2749-2759`, `20260914120000_*/migration.sql:30-59` |
| El catálogo de elegibilidad de push es `satisfies Record<NotificacionEvento, PerfilPush>`: un evento nuevo **no compila** hasta que se decide si empuja y a qué rol | `lib/notificaciones/push-elegibles.ts:176` |
| Los notificadores reales se inyectan **explícitamente** en el composition root; el default del servicio es un **no-op** | `lib/notificaciones/notificadores.ts:10-19` |

**Números del caso real (2026-09-14), que son el caso de prueba:** 31 órdenes `en_reparto` movidas ·
31 conversaciones · 0 filas en `orden_mensajero_meta` · 37 entregadas intactas · 24
`devolviendo_a_tienda` que **no** se movieron a propósito · 1 ruta optimizada de 31 paradas que quedó
obsoleta.

---

## Vocabulario

- **Origen**: el mensajero que hoy tiene la orden asignada (`orden.mensajero_asignado_id`).
- **Destino**: el mensajero que la recibe.
- **Lote**: el conjunto de órdenes seleccionadas para un mismo traspaso.
- **Lleva encima**: estados en los que el paquete está físicamente con el mensajero.

---

## Requisitos

### Alcance: qué se traspasa y quién lo dispara

**R1.** MIENTRAS el actor autenticado tenga rol `maestro` o `admin`, el sistema DEBE permitirle
traspasar a otro mensajero un **lote de órdenes seleccionadas** que un mismo mensajero lleva encima,
en una sola operación.

**R2.** MIENTRAS el actor tenga rol `mensajero`, `adminTienda`, `adminSatelite` o sea una credencial
de API, el sistema DEBE responder `forbidden` al traspaso y NO DEBE ejecutar ninguna lectura ni
ninguna escritura de órdenes, de conversaciones ni de rastro.

**R3.** MIENTRAS el actor tenga rol `mensajero`, el sistema NO DEBE ofrecerle ninguna superficie para
traspasarse órdenes a sí mismo ni para quitárselas.

**R4.** El sistema DEBE admitir como traspasables **exactamente** los estados `en_reparto` y
`ayuda_tienda`, y ningún otro.

**R5.** SI el lote contiene una orden en cualquier otro estado —incluidos `por_recoger`,
`devolviendo_a_tienda` y `sin_gestionar`—, ENTONCES el sistema DEBE rechazar el lote **completo**
indicando el estado de cada orden rechazada, y NO DEBE mover ninguna orden del lote.

**R6.** SI las órdenes del lote no tienen todas **el mismo** mensajero de origen, ENTONCES el
sistema DEBE rechazar el lote completo y NO DEBE mover ninguna.

**R7.** SI el mensajero destino es el mismo que el de origen, ENTONCES el sistema DEBE rechazar la
operación sin efectos.

**R8.** El sistema DEBE derivar el mensajero de origen **de las órdenes**, y NO DEBE aceptarlo del
cliente.

### Guardas sobre el mensajero destino

**R9.** SI el mensajero destino no tiene rol `mensajero`, o no pertenece a la zona de alguna de las
órdenes del lote, ENTONCES el sistema DEBE rechazar la operación sin efectos.

**R10.** SI el mensajero destino no tiene vehículo asociado, o su estado de cuenta no admite
trabajo, ENTONCES el sistema DEBE rechazar la operación sin efectos, con un motivo propio por cada
causa.

**R11.** SI el mensajero destino está bloqueado por cierres pendientes, ENTONCES el sistema DEBE
rechazar el traspaso sin efectos, con el mismo motivo que emiten hoy las dos asignaciones.

**R12.** MIENTRAS el mensajero **de origen** esté bloqueado por cierres pendientes, el sistema DEBE
permitir el traspaso igualmente: quitarle trabajo a quien está atascado no es dárselo.

**R13.** SI el mensajero destino tiene una recolección en tienda pendiente, ENTONCES el sistema DEBE
rechazar el traspaso sin efectos.

**R14.** El sistema DEBE permitir el traspaso **aunque** alguna orden del lote haya agotado su tope
de intentos de entrega, y **aunque** alguna no tenga coordenadas: ninguna de las dos cosas puede
dejar un paquete en manos de quien ya no puede entregarlo.

### Efectos del traspaso

**R15.** CUANDO un traspaso se confirme, el sistema DEBE dejar cada orden del lote asignada al
mensajero destino.

**R16.** CUANDO un traspaso se confirme, el sistema DEBE **conservar sin cambios** el estado de cada
orden, su día de reparto, su número de guía y su marca de prioridad.

**R17.** CUANDO un traspaso se confirme, el sistema DEBE registrar el instante de esa (re)asignación
en cada orden movida.

**R18.** CUANDO un traspaso se confirme, el sistema DEBE dejar **todas** las conversaciones de chat
de las órdenes movidas a nombre del mensajero destino, de forma que el destino vea el hilo completo
y pueda escribir en él con las reglas de ventana de siempre, y el origen deje de verlo en su panel.

**R19.** CUANDO un traspaso se confirme, el sistema DEBE dejar esas conversaciones como **no leídas**
para el mensajero destino.

**R20.** CUANDO un traspaso se confirme, el sistema NO DEBE alterar ninguna gestión ya registrada
sobre esas órdenes: el mensajero que la registró sigue siendo el mismo, y el cierre que la contenga
sigue conteniéndola con los mismos importes.

**R21.** CUANDO un traspaso se confirme, el sistema NO DEBE escribir ninguna transición en el
historial de estados de la orden ni añadir ningún hito al rastreo público.

**R22.** CUANDO un traspaso se confirme, el sistema NO DEBE modificar las marcas privadas del
mensajero de origen sobre esas órdenes («gestionar más tarde»).

**R23.** El sistema DEBE aplicar el traspaso como **todo-o-nada**: o se mueven todas las órdenes del
lote con sus conversaciones y su rastro, o no se mueve ninguna.

**R24.** SI entre la validación y la escritura una orden del lote deja de estar en un estado
traspasable, deja de pertenecer al mensajero de origen o queda borrada, ENTONCES el sistema DEBE
rechazar el lote completo sin efectos e indicar el motivo por orden.

### Rastro

**R25.** CUANDO un traspaso se confirme, el sistema DEBE registrar, **por cada orden movida**, quién
la traspasó, desde qué mensajero, hacia qué mensajero, con qué motivo y en qué instante.

**R26.** El rol del actor registrado en ese rastro DEBE quedar **congelado** en el instante del
traspaso, y DEBE seguir diciendo lo mismo aunque después se cambie el rol vivo de esa persona.

**R27.** CUANDO un mismo acto de traspaso alcance varias órdenes, el sistema DEBE registrar todas
sus filas bajo **un mismo identificador de lote**, distinto del de cualquier otro acto.

**R28.** El sistema DEBE exigir un **motivo** de entre 10 y 300 caracteres para traspasar, validado
antes de tocar ningún dato; SI falta o no cumple, ENTONCES NO DEBE escribir nada.

**R29.** El sistema DEBE mostrar cada traspaso en la **línea de tiempo de la orden**, ordenado
cronológicamente junto a las transiciones de estado y las correcciones de día, y nombrando al
mensajero de origen, al de destino y a quien lo ejecutó.

**R30.** El rastro de traspasos DEBE ser inmutable: un traspaso posterior **añade** una entrada y
nunca altera una anterior.

**R31.** SI el rastro de un traspaso no se puede escribir, ENTONCES el sistema NO DEBE dejar la
orden movida; y SI una orden no se mueve, ENTONCES NO DEBE dejar rastro de esa orden.

### La ruta optimizada

**R32.** CUANDO un traspaso se confirme, el sistema DEBE dejar programado el recálculo de la ruta
optimizada **de los dos** mensajeros, el de origen y el de destino.

**R33.** CUANDO un traspaso se confirme, el sistema DEBE informar en pantalla de que la ruta del
mensajero destino queda pendiente de recalcularse y de que, hasta entonces, las paradas nuevas
aparecen al final de su recorrido.

### La pantalla

**R34.** MIENTRAS la sesión sea de rol `maestro` o `admin`, el sistema DEBE ofrecer en `/ordenes` la
acción de traspaso sobre una selección de órdenes en `en_reparto` o en `ayuda_tienda`, y sobre
ninguna otra.

**R35.** CUANDO el actor vaya a confirmar un traspaso, el sistema DEBE decirle **cuántas** órdenes se
mueven, **desde quién** y **hacia quién**, antes de ejecutarlo.

**R36.** CUANDO un traspaso termine correctamente, el sistema DEBE informar de cuántas órdenes y
cuántas conversaciones se movieron, y DEBE releer el listado del servidor.

**R37.** SI un traspaso falla, ENTONCES el sistema DEBE mostrar un mensaje accionable por causa, sin
exponer identificadores internos ni datos del destinatario.

### Los avisos a los dos mensajeros

> **Decisión del humano (2026-09-14): sí se avisa, y a los dos.** El motivo, con sus palabras: el
> destino se encuentra 31 órdenes nuevas en el teléfono sin que nadie se lo diga.

**R38.** CUANDO un traspaso se confirme, el sistema DEBE avisar al mensajero **destino** con **un
solo** aviso por acto, que diga **cuántas** órdenes recibe y **de quién** — nunca uno por orden.

**R39.** CUANDO un traspaso se confirme, el sistema DEBE avisar al mensajero **de origen** con **un
solo** aviso por acto, que diga **cuántas** órdenes dejan de ser suyas y **hacia quién**.

**R40.** El sistema NO DEBE incluir en esos avisos el motivo escrito por quien traspasó, ni ningún
dato del destinatario de las órdenes (nombre, dirección, teléfono ni monto).

**R41.** SI la emisión de cualquiera de los dos avisos falla, ENTONCES el traspaso DEBE seguir
aplicado y su resultado DEBE seguir siendo de éxito.

**R42.** CUANDO las mismas órdenes se traspasen dos veces al mismo mensajero en **actos distintos**,
el sistema DEBE emitir el aviso las dos veces, aunque el primero siga sin leerse.

**R43.** DONDE el mensajero destino tenga disponible el canal de avisos push, el sistema DEBE
entregarle por ese canal el aviso de R38; y NO DEBE interrumpir por push al mensajero de origen con
el de R39.

---

## Fuera de alcance, dicho para que no se cuele

- **No** se toca el deshacer asignación de la ficha 149: `por_recoger` y `en_ruta_bodega_satelite`
  siguen teniendo su acción y sólo esa.
- **No** se mueven las órdenes `devolviendo_a_tienda` (decisión del humano: ahí el problema es dónde
  está la caja, no el sistema).
- **No** se reasigna nada automáticamente: el traspaso siempre lo decide una persona.
- **No** se cambia el cálculo del ranking ni de la analítica (D2).

---

## Decisiones cerradas (2026-09-14, Carlos Restrepo)

**No queda ninguna pregunta abierta.** Las seis que este spec planteó están decididas; se dejan
escritas con su fecha y su motivo para que nadie las lea como descuidos ni las reabra sin datos
nuevos.

**D1 — El `adminSatelite` queda FUERA de esta ficha.**
Hoy asigna (`AsignacionSateliteService`) y deshace (149) dentro de su zona, pero **no tiene ninguna
superficie donde ver una orden `en_reparto`**: su pantalla (`/recepcion-satelite`) trabaja sobre
`en_bodega_satelite`, paquetes que aún no ha recogido nadie. Abrirlo exige acotar por zona **las
órdenes y los mensajeros** y añadir su guarda de bodega bloqueada: es otra superficie, **no un `||`
más**. R2 lo deja en `forbidden`. → **Seguimiento S1.**

**D2 — El efecto sobre el ranking se ACEPTA TAL CUAL, con el efecto sobre la mesa.**
El denominador del ranking cuenta las órdenes por `mensajero_asignado_id` y día de reparto; el
numerador cuenta entregas por gestión. Tras un traspaso, **quien cede ve subir su porcentaje del
día** (pierde denominador y conserva sus entregas) y **quien recibe lo ve bajar hasta que entregue**.
En el caso real son 31 órdenes, y el podio reparte premio. **Esta ficha no toca nada del ranking ni
de la analítica**: es una decisión tomada, no un descuido ni un efecto que se descubrió tarde.

**D3 — Sí se avisa, y a LOS DOS mensajeros.** Entra en esta ficha (R38-R43), por el canal que ya
existe (146/410) y con el precedente exacto de `emitirDiaRepartoCorregido`: **fuera de la
transacción y best-effort**, porque un aviso caído no puede revertir un traspaso legítimo.

**D4 — `ayuda_tienda` entra en los estados traspasables.**
Ese estatus significa literalmente «el mensajero pidió ayuda y **el paquete sigue con él, en la
calle**» (235/R1): es el mismo hecho físico que motiva la ficha. Y este repo ya pagó una vez el
olvido de `ayuda_tienda` en las listas de «lo que lleva encima» — de ahí la guardia
`carga-del-mensajero`, a la que esta ficha añade su noveno miembro.

**D5 — Se acepta el límite de la página (50).**
Con 31 órdenes cabe en una sola pasada. La consecuencia, dicha: **un lote mayor son dos actos, con
dos identificadores de rastro distintos** (y, por R38/R39, dos avisos a cada mensajero). «Seleccionar
las N del filtro» es alcance que nadie ha pedido.

**D6 — Una sola fuente de rastro: la tabla propia.**
No se añade el traspaso al catálogo de `/histórico/acciones`. Precedente de las fichas 262 y 371: el
motivo es texto libre tecleado por una persona y R5 de la 362 lo deja fuera de esa tabla a propósito.
→ **Seguimiento S2.**

## Seguimiento (fuera de esta ficha)

**S1.** Traspaso para el `adminSatelite` dentro de su zona: exige superficie propia donde vea sus
órdenes en reparto, alcance por zona de órdenes **y** mensajeros, y su guarda de bodega bloqueada.

**S2.** Si algún día se quiere el traspaso en `/histórico/acciones`: es un valor de
`HistorialAccionTipo`, su migración de enum, su etiqueta y su entrada en el censo de
`tests/unit/guards/historial-accion-escrituras-cubiertas.guardia.test.ts`.
