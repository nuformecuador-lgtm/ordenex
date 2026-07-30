# Feature 157 (Recolección en tienda por el mensajero · QR) · requirements.md

> Zona: `fullstack` · Complexity: high · `depends_on`: 155 (y por transitividad 153 y 154).
> Este spec ASUME aplicadas las features **153** (`en_ruta` → `en_reparto`), **154** (alta de
> `por_recolectar_en_tienda` + familia de historial `recoleccion_tienda` + grafo v2) y **155**
> (creación bifurcada: la tienda SIN fulfillment nace con guía en `por_recolectar_en_tienda`).

## Contexto (leer antes de los requisitos)

**Qué cierra esta feature.** Una orden de una tienda sin fulfillment nace en
`por_recolectar_en_tienda`: ya tiene `num_guia` y etiqueta, pero el paquete sigue físicamente en
la tienda. Falta el tramo que la saca de ahí. Un mensajero va a la tienda, recoge los paquetes y,
al escanear el QR de cada etiqueta, la orden pasa a `en_ruta_bodega_central`. De ahí en adelante
el camino ya existe: la bodega central la recibe por QR (feature 138) y queda en
`en_bodega_central`.

**Decisión del humano ya cerrada (2026-07-28), no se reabre.** Las órdenes por recolectar **se le
asignan** al mensajero con el mecanismo que ya existe (`mensajero_asignado_id` + el apartado de
`mis-asignaciones`). NO hay bolsa libre por zona/tienda ni modelo de lote de recolección nuevo.

**Condición que es el corazón de la feature.** «El módulo de gestión debe cambiar cuando es este
caso». Una recolección **no es una entrega**: no hay cobro (`monto_cobrar`/SINPE), no hay resultado
de gestión (entregada / reprogramada / devuelta / rechazada), no hay causa de devolución ni
evidencia fotográfica de entrega. La acción es **una sola**: escanear el QR y confirmar la
recolección.

**Nombres de estado y familia usados en este spec** (post-153/154):

| Rol en este flujo | `value` |
| --- | --- |
| Origen (paquete en la tienda, ya numerado) | `por_recolectar_en_tienda` |
| Destino (recolectado, viajando a la central) | `en_ruta_bodega_central` |
| Familia de historial de la transición | `recoleccion_tienda` |
| Estado de reparto (renombrado por la 153) | `en_reparto` |

**Alcance en tres piezas.** (A) asignabilidad de las órdenes por recolectar desde el listado del
maestro/admin; (B) apartado y panel PROPIOS del mensajero en `mis-asignaciones`, distintos del
panel de gestión de entrega; (C) el escáner y la transición.

Todos los rechazos son **sin efectos en datos**. La transición efectiva es atómica y deja rastro
en el historial de estados.

---

## Requisitos (EARS)

### Bloque A — Asignación de recolecciones (maestro / admin)

**R1 (Ubicuo).** El sistema DEBE listar, en la vista de revisión de órdenes de `maestro`/`admin`,
un apartado propio con las órdenes en estado `por_recolectar_en_tienda`.

**R2 (Ubicuo).** El apartado de R1 DEBE mostrar por fila el nombre del mensajero asignado a la
orden, o un indicador de "sin asignar" cuando la orden no tiene mensajero asignado.

**R3 (Por evento).** CUANDO un actor con rol `maestro` o `admin` selecciona una o más órdenes del
apartado de R1 y confirma la asignación de un mensajero, el sistema DEBE fijar el mensajero
asignado de TODAS las órdenes del lote a ese mensajero.

**R4 (Ubicuo).** La asignación de R3 NO DEBE cambiar el estado de la orden (permanece en
`por_recolectar_en_tienda`), NO DEBE asignar ni reasignar `num_guia`, y NO DEBE producir ningún
registro de cambio de estado en el historial de la orden.

**R5 (Condicional).** SI alguna orden del lote no existe, está borrada, o no está en
`por_recolectar_en_tienda`, ENTONCES el sistema DEBE rechazar la operación COMPLETA como conflicto
—indicando el motivo por orden— sin aplicar ningún efecto (todo-o-nada por lote).

**R6 (Condicional).** SI el mensajero indicado no es un usuario existente con rol `mensajero`,
ENTONCES el sistema DEBE rechazar la asignación como error de validación, sin efectos.

**R7 (Condicional).** SI el mensajero indicado está bloqueado por un cierre pendiente
(`solicitado` / `vencido`), ENTONCES el sistema DEBE rechazar la asignación como conflicto con un
motivo accionable, sin efectos.

**R8 (Condicional).** SI el rol del actor no es `maestro` ni `admin`, ENTONCES el sistema DEBE
rechazar la asignación como no autorizada (`forbidden`), sin tocar datos; SI no hay sesión válida,
ENTONCES DEBE rechazarla como no autenticada (`unauthenticated`), sin tocar datos.

**R9 (Ubicuo).** El sistema NO DEBE exigir que la orden tenga coordenadas geocodificadas para
asignarle una recolección: una recolección no es una parada de la ruta de reparto.

**R10 (Por evento).** CUANDO la asignación de R3 resulta efectiva, el sistema DEBE refrescar el
apartado de R1 de modo que las órdenes afectadas muestren ya su mensajero asignado (R2).

---

### Bloque B — Apartado y panel PROPIOS del mensajero

**R11 (Por evento).** CUANDO un actor con rol `mensajero` abre "Mis asignaciones", el sistema DEBE
presentar las órdenes en `por_recolectar_en_tienda` que tiene asignadas en un apartado PROPIO,
separado del apartado "Por recoger" y del apartado "En reparto / por gestionar".

**R12 (Ubicuo).** El sistema NO DEBE mostrar a un mensajero, en el apartado de R11, ninguna orden
que no tenga a ese mensajero como mensajero asignado.

**R13 (Ubicuo).** El apartado de R11 DEBE mostrar por orden únicamente datos pertinentes a una
recolección: número de guía, número de remisión, tienda de origen, producto y destinatario; y NO
DEBE mostrar monto a cobrar ni ningún otro dato de cobro.

**R14 (Ubicuo).** El sistema DEBE agrupar las órdenes del apartado de R11 por tienda de origen.

**R15 (Ubicuo).** El sistema DEBE ofrecer, desde el apartado de R11, un medio de contacto
telefónico con la tienda de origen.

**R16 (De estado).** MIENTRAS el mensajero opera sobre el apartado de R11, el sistema NO DEBE
ofrecer el flujo de gestión de entrega: sin selección de resultado (entregada / reprogramada /
devuelta / rechazada), sin causa de devolución, sin captura de evidencias fotográficas, sin fecha
de reprogramación y sin selector de método de pago.

**R17 (Ubicuo).** El sistema DEBE ofrecer, para el apartado de R11, EXACTAMENTE una acción de
negocio: confirmar la recolección de una orden a partir de su código QR, con la entrada manual del
número de guía como vía equivalente.

**R18 (Ubicuo).** El sistema NO DEBE fijar ni consultar el puntero de gestión 1-a-1
(`orden_en_gestion_id`) al confirmar una recolección: el mensajero DEBE poder confirmar
recolecciones consecutivas sin escoger ni liberar ninguna orden.

**R19 (Por evento).** CUANDO el mensajero escanea un QR de etiqueta que codifica
`/paquete/<numGuia>`, el sistema DEBE extraer el `num_guia` del texto y disparar la confirmación de
recolección con ese valor.

**R20 (Condicional).** SI el texto escaneado o el número tecleado no resuelve a un entero positivo,
ENTONCES el sistema DEBE rechazarlo como código inválido en el borde, sin invocar la lógica de
negocio.

**R21 (Condicional).** SI el `num_guia` resuelto no corresponde a ninguna orden del apartado de
R11 del propio mensajero, ENTONCES el sistema DEBE informarlo con un mensaje claro y NO DEBE
confirmar ninguna recolección.

**R22 (Por evento).** CUANDO una confirmación de recolección resulta efectiva o idempotente, el
sistema DEBE refrescar el apartado de R11 de modo que esa orden deje de figurar en él.

**R23 (Por evento).** CUANDO una confirmación de recolección devuelve un resultado, el sistema DEBE
notificar al mensajero con un mensaje distinto y claro por cada resultado posible (efectiva,
idempotente, no encontrada, estado inválido, código inválido, no autorizada, no autenticada,
conflicto, bloqueo por cierre pendiente).

**R24 (De estado).** MIENTRAS el mensajero esté bloqueado por un cierre pendiente
(`solicitado` / `vencido`), el sistema DEBE mantener el apartado de R11 visible como
solo-lectura y NO DEBE ofrecer sus controles de confirmación (defensa suave; R31 es la defensa
real).

**R25 (Ubicuo).** El sistema DEBE mantener sin cambios el flujo y los campos del panel de gestión
de entrega para las órdenes en reparto: esta feature añade una superficie nueva, no modifica la
existente.

---

### Bloque C — Confirmación de la recolección (transición)

**R26 (Ubicuo).** El sistema DEBE ofrecer una confirmación de recolección que transicione una orden
desde `por_recolectar_en_tienda` a `en_ruta_bodega_central`.

**R27 (Por evento).** CUANDO un actor con rol `mensajero` confirma la recolección de una orden
identificada por su `num_guia`, y esa orden existe, no está borrada, está en
`por_recolectar_en_tienda` y tiene a ese actor como mensajero asignado, el sistema DEBE
transicionarla a `en_ruta_bodega_central`.

**R28 (Por evento).** CUANDO se ejecuta una recolección efectiva (R27), el sistema DEBE registrar
la transición en el historial de estados dentro de la MISMA operación atómica que el cambio de
estado (si una falla, ambas se revierten), clasificada con la familia de origen
`recoleccion_tienda`.

**R29 (Condicional).** SI el rol del actor no es `mensajero`, ENTONCES el sistema DEBE rechazar la
confirmación como no autorizada (`forbidden`), sin tocar datos; SI no hay sesión válida, ENTONCES
DEBE rechazarla como no autenticada (`unauthenticated`), sin tocar datos.

**R30 (Condicional).** SI no existe ninguna orden con el `num_guia` indicado, o la orden está
borrada, o su mensajero asignado no es el actor, ENTONCES el sistema DEBE responder con un ÚNICO
resultado indistinguible ("no encontrada"), sin tocar datos y sin revelar la existencia ni ningún
dato de una orden ajena.

**R31 (Condicional).** SI el mensajero está bloqueado por un cierre pendiente
(`solicitado` / `vencido`), ENTONCES el sistema DEBE rechazar la confirmación como conflicto con un
motivo accionable, sin tocar datos.

**R32 (Condicional).** SI la orden es del actor y ya está en `en_ruta_bodega_central`, ENTONCES el
sistema DEBE responder de forma idempotente ("ya recolectada"), sin re-transicionar y sin añadir
historial.

**R33 (Condicional).** SI la orden es del actor pero su estado actual no es
`por_recolectar_en_tienda` (ni el idempotente de R32), ENTONCES el sistema DEBE rechazar la
confirmación indicando el estado actual, sin tocar datos.

**R34 (De estado · concurrencia).** MIENTRAS dos confirmaciones concurrentes intentan recolectar la
misma orden, el sistema DEBE garantizar que a lo sumo UNA transiciona —guardia por estado de origen
y por mensajero asignado impuesta en la propia escritura—; la otra DEBE resolverse como "ya
recolectada" o como conflicto, y NUNCA DEBE producir doble entrada de historial.

**R35 (Ubicuo).** El sistema DEBE conservar sin cambios `num_guia` y `mensajero_asignado_id` de la
orden durante la confirmación de recolección: la confirmación solo cambia el estado.

---

### Bloque D — No contaminación de los flujos de dinero, cierre y reparto

**R36 (Ubicuo).** El sistema NO DEBE producir ningún registro de gestión ni ningún movimiento de
dinero (wallet, pago al mensajero, ingreso de bodega) como consecuencia de una recolección.

**R37 (Ubicuo).** El sistema NO DEBE contar una orden en `por_recolectar_en_tienda` asignada a un
mensajero como orden pendiente de gestión: no DEBE bloquear el gate de "Solicitar cierre" del
mensajero ni DEBE ser convertida a `sin_gestionar` por el corte diario.

**R38 (Ubicuo · sujeto a la pregunta abierta Q1 de `design.md`).** El sistema NO DEBE contabilizar
la asignación de una recolección en el denominador ("asignadas hoy") del ranking diario del
mensajero.

**R39 (Ubicuo).** El sistema DEBE excluir las órdenes del apartado de R11 de la ruta optimizada,
del mapa de paradas y de los KPIs de reparto del mensajero (`pendientes`, `por cobrar`,
`total a cobrar`).

**R40 (Ubicuo).** El sistema DEBE dejar sin efecto para las recolecciones el filtro por
cantón/distrito del portal del mensajero (el cantón/distrito de la orden es el del DESTINO de
entrega, no el de la tienda donde se recoge), y sus órdenes NO DEBEN aportar opciones a ese filtro.

### Bloque E — Manifiesto de la recolección por la vía SESIÓN (heredado de la 155)

> **Traspaso decidido por el humano el 2026-07-29.** Lo levantó el review de la feature 155
> (`progress/review_155.md` §5.7) y **no lo rompió esa feature**: la 155 cumple su R24 al pie de la
> letra, entregando el manifiesto por el canal de **API key**, que es el que no tiene cookie de
> sesión. El hueco es de la vía **sesión** y su causa está en la 159: el commit `b2181e7` dejó
> `OrdenesCargaResumenPaso.tsx` **huérfano** (sigue pidiendo `flujo="carga_masiva"`, con test vivo
> que lo asevera) y el modal monta `OrdenesCargaResumen` directo. Resultado hoy: **una tienda que
> carga por UI en la rama (b) no puede obtener su manifiesto por ninguna vía.**

**R41 (Ubicuo).** Una tienda que crea órdenes por la **carga masiva de la UI** (vía sesión) y cuyo
interruptor de fulfillment está en `false` DEBE poder obtener el manifiesto del lote recién creado,
con el mismo flujo `recoleccion_tienda` y el mismo servicio único que ya usa el canal de API key.

**R42 (Ubicuo).** El sistema NO DEBE duplicar la construcción del manifiesto: la vía sesión y la vía
API key DEBEN compartir el servicio que lo arma, y su única diferencia legítima es cómo se resuelve
el actor (cookie de sesión frente a API key).

**R43 (Condicional).** SI se decide dar consumidor a `OrdenesCargaResumenPaso.tsx`, ENTONCES su
`flujo` DEBE dejar de ser `carga_masiva` fijo y pasar a depender de la rama de creación; SI se
decide retirarlo, ENTONCES el botón de manifiesto de la **feature 148** que cuelga de él DEBE quedar
enganchado en el contenedor que sí se monta, y su test vivo actualizarse en el mismo commit.

> **Lo que ESTA feature no hereda:** el **aviso a integradores** del cambio de estado inicial de la
> 155. El humano lo declaró **NO necesario** el 2026-07-29. No es deuda de la 157 ni de nadie.

---

## Trazabilidad (mapa requisito → prueba; lo completa el implementer)

Cada `R<n>` debe terminar mapeado a un test concreto en
`progress/impl_157-recoleccion-tienda-qr.md`.

- **R3–R9, R26–R37**: tests unitarios de servicio (dobles, sin DB/HTTP).
- **R4, R28, R34, R35**: tests de integración del repositorio (transacción, guardias del `WHERE`,
  ausencia/presencia de fila de historial, concurrencia).
- **R8, R20, R29**: tests de la Server Action (borde: zod + sesión).
- **R1, R2, R10, R11, R13–R19, R21–R25, R39, R40**: tests de componente.
- **R12, R30**: test de aislamiento entre mensajeros (orden ajena).
- **R38**: test unitario del agregador de ranking (una recolección asignada hoy no suma al
  denominador).

---

## Preguntas abiertas

> Estas quedan para la puerta de aprobación humana. No se han rellenado con supuestos silenciosos:
> donde hay un supuesto, está declarado como tal.

1. **Qué mensajeros son elegibles para una recolección.** Las asignaciones existentes
   (`asignarDesdeBodega`, `AsignacionSateliteService`) filtran el mensajero por la **zona de la
   orden**, que es la zona de ENTREGA, no la de la tienda donde se recoge. Para una recolección ese
   filtro no significa nada. Opciones: (a) cualquier mensajero activo; (b) mensajeros de la zona
   central/GAM, por ser la bodega central el destino del viaje; (c) mensajeros de la zona de la
   tienda —dato que hoy no se usa para nada en el flujo de órdenes—. **Supuesto provisional del
   diseño:** (a) cualquier mensajero activo y no bloqueado, con la validación de rol de R6. Si el
   humano elige (b) o (c), R6 gana una condición de zona.

2. **Dirección física de recogida.** El modelo NO tiene dirección de la tienda: `Usuario`
   (db/schema.prisma:83-101) tiene `nombre` y `telefono`, pero ninguna columna de dirección. R13/R15
   se limitan por eso a nombre + teléfono. ¿Es suficiente para que el mensajero llegue a la tienda,
   o hay que añadir el dato al modelo (migración fuera del alcance actual)?

3. **¿Puede maestro/admin confirmar una recolección?** R29 la restringe al rol `mensajero` (el acto
   físico es suyo). ¿Debe existir un camino de respaldo para maestro/admin cuando el mensajero no
   puede escanear (teléfono sin cámara, sin datos)?

4. **Reasignación y desasignación.** R3 sobreescribe el mensajero asignado si la orden ya tenía uno.
   ¿Es el comportamiento deseado, o hace falta una acción explícita de "desasignar" / un aviso al
   mensajero anterior?

5. **Aviso al mensajero.** ¿La asignación de una recolección debe emitir una notificación al
   mensajero (infraestructura de la feature 146)? **Supuesto:** fuera de alcance de esta feature.

6. **Recolección parcial.** Si el mensajero llega a la tienda y solo hay 8 de las 10 órdenes
   asignadas, las 2 restantes quedan en `por_recolectar_en_tienda` con él asignado indefinidamente.
   ¿Hace falta un mecanismo para devolverlas al pool (desasignar) o un estado/aviso de "no estaba en
   la tienda"? **Supuesto:** fuera de alcance; se resuelve reasignando (pregunta 4).
