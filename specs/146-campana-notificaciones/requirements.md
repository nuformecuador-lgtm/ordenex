# Feature 146 — Campana de notificaciones funcional · requirements.md

> Notación EARS. Cada `R<n>` debe terminar mapeado a un test concreto
> (`docs/specs.md` §Trazabilidad). Sin detalles de implementación: el CÓMO va en `design.md`.

## Contexto (una línea)

`components/shared/NotificationsBell.tsx` está montada en `PageHeader` con
`EXAMPLE_NOTIFICATIONS` quemadas y estado sólo local; hay que respaldarla con un modelo
`notificacion` real, cuatro productores de dominio y cuatro Server Actions.

## Decisiones vinculantes (cerradas; no se reabren)

- **D1** — Alcance v1: exactamente cuatro productores (orden rechazada por el destinatario,
  carga masiva terminada, postulación de mensajero pendiente, cierre de día por aprobar).
- **D2** — "Órdenes con más de 1 día sin asignación" queda **fuera de alcance**: sin cron
  nuevo, sin `JobTipo` nuevo, sin job de barrido, sin variable de entorno de umbral.
- **D3** — Refresco por **polling con SWR** (`refreshInterval` = 60 s) + revalidación al abrir
  el popover. **No** Supabase Realtime.
- **D4** — **Direccionamiento por ROL, lectura por usuario**: una fila de notificación por rol
  destinatario; una tabla aparte registra qué usuario la leyó/descartó. `leida_at` **no** vive
  en la fila de la notificación.
- **F1.4 (aprobada)** — Destinatarios por evento, alcance por `tienda_id`/`zona_id`,
  transaccionalidad del productor de rechazo, Server Action explícita de carga terminada, una
  fila por rol destinatario, ventana de 30 días sin purga, deduplicación por
  `(evento, entidad_id)`, `PAGE_SIZE = 50`, `REFRESH_INTERVAL_MS = 60_000` y `NotificationItem`
  como alias público. Detalle y justificación en `design.md` §10.

---

## 1. Modelo de datos y migración

**R1.** El sistema DEBE persistir cada notificación en una tabla `notificacion` con, al menos:
identificador, tipo de presentación (`alert` | `box` | `warning`), evento de dominio que la
originó, descripción, anexo opcional, referencia a la entidad de origen (tipo + identificador),
destinatario, alcance y marca de creación.

**R2.** El sistema DEBE registrar la lectura y el descarte de una notificación **por usuario**
en una tabla separada `notificacion_lectura`, de forma que exista a lo sumo una fila por
par (notificación, usuario).

**R3.** SI una notificación está dirigida a un rol, ENTONCES la lectura o el descarte por parte
de un usuario de ese rol NO DEBE alterar el estado de esa notificación para los demás usuarios
del mismo rol.

**R4.** El sistema DEBE rechazar, a nivel de esquema, toda fila de `notificacion` que no tenga
exactamente uno de los dos destinatarios posibles (rol o usuario).

**R5.** El sistema DEBE soportar en `notificacion` dos columnas de alcance opcionales e
independientes, `tienda_id` y `zona_id`, ambas nulas por defecto.

**R6.** CUANDO un evento tenga varios roles destinatarios, el sistema DEBE crear una fila de
`notificacion` por cada rol destinatario (un evento con tres roles produce tres filas).

**R7.** La migración DEBE ser aditiva: no altera ni elimina tablas, columnas ni enums
existentes.

**R8.** La migración DEBE incluir su `down.sql`, que revierte exactamente lo que crea (ambas
tablas, sus índices, sus enums y sus claves foráneas).

**R9.** El sistema DEBE habilitar Row Level Security en `notificacion` y en
`notificacion_lectura`; ninguna de las dos DEBE quedar accesible salvo por el rol de servicio.

**R10.** El sistema DEBE indexar `notificacion` de modo que el listado del actor (filtrado por
destinatario y alcance, ordenado por fecha de creación descendente) no requiera recorrido
secuencial de la tabla, y DEBE indexar `notificacion_lectura` por usuario.

**R11.** CUANDO se elimine un usuario, una tienda o una zona referenciada, el sistema DEBE
eliminar en cascada las filas de `notificacion` y `notificacion_lectura` que dependan de ella,
sin dejar filas huérfanas.

**R12.** La nueva carpeta de migración DEBE quedar registrada en la lista de exclusiones de
`tests/integration/db/zonas-migration.test.ts`, de modo que el invariante de orden de
migraciones siga en verde.

## 2. Alcance y visibilidad

**R13.** SI una notificación dirigida a un rol tiene `tienda_id` y `zona_id` nulos, ENTONCES el
sistema DEBE mostrarla a **todos** los usuarios de ese rol.

**R14.** SI una notificación dirigida a un rol tiene `tienda_id` con valor, ENTONCES el sistema
DEBE mostrarla únicamente al usuario que opera esa tienda.

**R15.** SI un usuario con rol `adminTienda` consulta su listado, ENTONCES el sistema NO DEBE
incluir notificaciones acotadas a una tienda distinta de la suya.

**R16.** SI una notificación dirigida a un rol tiene `zona_id` con valor, ENTONCES el sistema
DEBE mostrarla únicamente a los usuarios de ese rol asignados a esa zona, y NO DEBE mostrarla a
los usuarios del mismo rol asignados a otra zona.

**R17.** El sistema NO DEBE mostrar a un usuario ninguna notificación dirigida a un rol
distinto del suyo, con independencia del alcance.

## 3. Productores de eventos de dominio (D1 — exactamente cuatro)

**R18.** CUANDO una orden transiciona al estado `rechazada` por la gestión de un mensajero
(rechazo del destinatario), el sistema DEBE crear notificaciones de tipo `alert` que
referencien esa orden, dirigidas a: `maestro` (sin alcance), `admin` (sin alcance),
`adminTienda` acotada a la tienda dueña de la orden, y `adminSatelite` acotada a la zona de la
orden.

**R19.** SI una orden llega al estado `rechazada` por una vía que NO es la gestión del
mensajero (en particular, el escalado automático de devueltas por SLA), ENTONCES el sistema NO
DEBE crear ninguna notificación de rechazo.

**R20.** CUANDO la transacción que registra el cambio de estado a `rechazada` se revierta, el
sistema NO DEBE dejar creada ninguna de las notificaciones de ese rechazo.

**R21.** SI la creación de las notificaciones de rechazo falla, ENTONCES el sistema NO DEBE
persistir el cambio de estado asociado (emisión transaccional, todo o nada).

**R22.** CUANDO termina una carga masiva de órdenes —tanto la ejecutada por la interfaz como la
recibida por API key—, el sistema DEBE crear una notificación de tipo `box` dirigida al usuario
que la ejecutó, cuya descripción incluya el número de órdenes cargadas correctamente.

**R23.** CUANDO se registra una postulación de mensajero, el sistema DEBE crear notificaciones
de tipo `warning` sin alcance, dirigidas a los roles `maestro` y `admin`, referenciando al
postulante.

**R24.** CUANDO un mensajero envía su cierre del día a aprobación (incluidas las re-solicitudes
desde un cierre `vencido` o `rechazado`), el sistema DEBE crear notificaciones de tipo
`warning` referenciando ese cierre, dirigidas a `maestro` (sin alcance), `admin` (sin alcance)
y `adminSatelite` acotada a la zona destino del cierre.

**R25.** MIENTRAS falle un productor de carga masiva, postulación o cierre, el sistema DEBE
completar igualmente la operación de negocio que lo originó, sin propagar el error al usuario.

**R26.** El sistema NO DEBE crear notificaciones por eventos fuera de D1; en particular NO DEBE
existir ningún trabajo programado, tipo de job ni ruta de cron nueva asociada a esta feature.

**R27.** SI ya existe una notificación no leída por su destinatario para el mismo par
(evento, entidad de origen), ENTONCES el sistema NO DEBE crear otra notificación para ese
mismo par.

## 4. Server Actions

**R28.** CUANDO un usuario autenticado solicita su listado de notificaciones, el sistema DEBE
devolver las notificaciones visibles para él (§2) que no haya descartado, ordenadas de más
reciente a más antigua.

**R29.** El listado DEBE acotarse a las notificaciones creadas en los últimos 30 días y a un
máximo de 50 elementos.

**R30.** El listado DEBE indicar, por cada notificación, si el usuario que consulta ya la marcó
como leída, y DEBE incluir el total de no leídas por ese usuario dentro del mismo conjunto.

**R31.** CUANDO un usuario autenticado marca una notificación como leída, el sistema DEBE
registrar la lectura para ese usuario y esa notificación DEBE aparecer como leída en su
siguiente listado.

**R32.** CUANDO un usuario autenticado marca todas sus notificaciones como leídas, el sistema
DEBE registrar la lectura de todas las visibles y no descartadas por él, y su contador de no
leídas DEBE quedar en cero.

**R33.** CUANDO un usuario autenticado descarta una notificación, el sistema DEBE dejar de
incluirla en los listados de ESE usuario, sin eliminar la fila de `notificacion` ni afectar a
los demás destinatarios.

**R34.** SI se invoca cualquiera de las acciones sin sesión válida, ENTONCES el sistema DEBE
responder `unauthenticated` sin leer ni escribir datos de notificaciones.

**R35.** SI un usuario intenta marcar como leída o descartar una notificación que no le es
visible según §2, ENTONCES el sistema DEBE rechazar la operación y NO DEBE crear ninguna fila
de lectura.

**R36.** SI el identificador o los contadores recibidos por una acción no tienen el formato
esperado, ENTONCES el sistema DEBE responder `validation_error` sin tocar la base de datos.

**R37.** CUANDO se marca como leída o se descarta dos veces la misma notificación por el mismo
usuario, el sistema DEBE terminar con éxito y con una sola fila de lectura.

**R38.** Las operaciones DEBEN exponerse como Server Actions del propio proyecto, no como rutas
API internas consumidas por `fetch` desde el cliente.

**R39.** CUANDO el cliente informa que una carga masiva por interfaz terminó, el sistema DEBE
crear la notificación **únicamente** para el usuario autenticado que la ejecutó, y una segunda
invocación para la misma carga NO DEBE producir una notificación adicional.

## 5. Campana (frontend)

**R40.** El sistema NO DEBE mostrar notificaciones de ejemplo quemadas: la campana DEBE
poblarse exclusivamente con el resultado de la acción de listar.

**R41.** MIENTRAS haya notificaciones no leídas, la campana DEBE mostrar un distintivo con su
cantidad.

**R42.** SI la cantidad de no leídas supera 99, ENTONCES el distintivo DEBE mostrar `+99`.

**R43.** MIENTRAS no haya notificaciones no leídas, la campana NO DEBE mostrar el distintivo.

**R44.** SI el listado devuelto está vacío, ENTONCES la campana DEBE mostrar el estado vacío
("No tienes notificaciones") en lugar de la lista.

**R45.** CUANDO el usuario pulsa "Marcar todas como leídas", la campana DEBE invocar la acción
correspondiente y reflejar el contador en cero sin recargar la página; MIENTRAS no haya no
leídas, el control DEBE estar deshabilitado.

**R46.** CUANDO el usuario pulsa la "X" de una notificación, la campana DEBE invocar la acción
de descartar y retirar ese elemento de la lista sin recargar la página.

**R47.** El sistema DEBE revalidar el listado cada 60 segundos mediante `refreshInterval` de
SWR y cada vez que se abre el popover; NO DEBE usar Supabase Realtime ni ningún canal de
suscripción en vivo.

**R48.** SI la acción de listar falla o devuelve `unauthenticated`, ENTONCES la campana DEBE
seguir renderizándose sin distintivo y sin romper la cabecera de la página.

**R49.** CUANDO el usuario abre el popover, la campana DEBE mostrar cada notificación con el
icono correspondiente a su tipo (`alert` | `box` | `warning`), su descripción y su anexo si lo
tiene.

**R50.** El sistema DEBE conservar `NotificationItem` como tipo público exportado por el
componente, compatible con el DTO de la acción de listar, de modo que los consumidores
existentes sigan compilando.
</content>
</invoke>
