# Feature 106 — API: lectura, detalle (con evidencias) y cancelación de órdenes por API key

Requisitos en notación EARS. Cada `R<n>` termina mapeado a un test concreto en
`tasks.md` (columna `R<n>→test`, `docs/specs.md` §Trazabilidad). Sin detalles de
implementación: el CÓMO vive en `design.md`.

**Alcance:** backend puro, canal integrador. Tres endpoints bajo
`app/api/ordenes/api-key/`, autenticados por API key en el header
`Authorization: Bearer ordx_...` (MISMO patrón que la feature 88):

1. **Listado** paginado de TODAS las órdenes cuyo *owner* es el usuario dedicado de la
   key presentada, y solo esas.
2. **Detalle** de UNA orden, que incluye las evidencias de entrega/rechazo (feature 36)
   resueltas como URLs firmadas de corta duración.
3. **Cancelación** (update de estado) de una orden, permitida SOLO si su estado actual es
   `en_bodega` o `en_ruta_bodega_principal`.

**Reutiliza (verificado contra el código, no supuesto):**
- El *owner* ya está en la orden: `orden.tienda_id = actor.usuarioId` = el usuario
  dedicado de la API key (`BulkOrdenService.cargarViaApi:280`, D4 de la feature 88). No
  se introduce un identificador de scoping aparte.
- Autenticación: `ApiKeyAuthService.autenticar(rawKey)` → `{status:'ok', apiKeyId,
  actor:{usuarioId, rol}}` | `unauthenticated` (401) | `forbidden` (403).
- Plantilla estructural del endpoint por key: `app/api/ordenes/api-key/carga/route.ts`.
- Errores: `lib/errors` (feature 10).
- Evidencias: `gestion_orden.evidencia_storage_path` + `evidencia_content_type` (feature
  36), bucket privado `gestion-evidencias` (`gestionConfig.EVIDENCIA_BUCKET`); se firman
  con `SupabaseSignedUrlProvider` (feature 22), TTL `gestionConfig.SIGNED_URL_TTL_SECONDS`
  (5 min).
- Choke point de cambios de estado: `appendCambioEstado`
  (`lib/repositories/registrar-cambio-estado.ts`, feature 49); por ahí se emiten los
  webhooks de la feature 104 (transactional outbox dentro de la misma tx).

**Fuera de alcance (follow-up, declarado):** cualquier otra mutación por API distinta de
la cancelación; edición de datos de la orden; rate-limiting; paginación por cursor;
descarga directa (proxy) del binario de la evidencia; UI.

> **Gate F1.4 CERRADO (aprobado, decisiones humanas).** Ver `design.md` §"Decisiones del
> gate F1.4 (CERRADO)". Resumen: (a) la cancelación **reutiliza el estado existente
> `devuelta_origen`** — NO se crea el estado `cancelada` ni se migra el enum de estatus;
> (b) el marcador `"cancelada por tienda"` se registra **SOLO en la bitácora de estados
> (`orden_historial_estado.motivo`) vía `appendCambioEstado`** — NO se escribe nada en
> `gestion_orden` (su esquema no se toca); (c) el verbo del endpoint de cancelación es
> **PUT**; (d) identificador = `num_guia`; (e) paginación `offset/limit`, tope 100 por
> página; (f) signed URL TTL = 5 min.

---

## Bloque A — Autenticación (transversal a los tres endpoints)

**R1.** CUANDO llega una petición a cualquiera de los tres endpoints sin header
`Authorization`, o con un esquema distinto de `Bearer`, o con token vacío, el sistema
DEBE responder `401 Unauthorized` sin consultar la base de datos de órdenes.

**R2.** CUANDO llega una petición con un `Bearer <key>` que no corresponde a ninguna
`api_key` registrada, el sistema DEBE responder `401 Unauthorized` (indistinguible de "no
presentó key").

**R3.** SI la key existe pero su usuario dedicado no está `activo`, ENTONCES el sistema
DEBE responder `403 Forbidden` y NO ejecutar ninguna lectura ni mutación de órdenes.

**R4.** El sistema DEBE resolver el *owner* de la petición como `actor.usuarioId`
devuelto por la autenticación, y NUNCA aceptar el owner/tienda desde el cuerpo, la query
o los headers de la petición.

**R5.** El sistema DEBE tratar la API key como secreto: NUNCA la escribe (ni su hash) en
`console.*`, ni en el cuerpo de una respuesta de error, ni en logs (R6 de la feature 88).

---

## Bloque B — Listado (GET colección)

**R6.** CUANDO un owner autenticado solicita el listado, el sistema DEBE devolver
únicamente las órdenes cuyo `tienda_id` es igual a `actor.usuarioId`, y ninguna otra.

**R7.** El sistema DEBE aplicar el scope por owner en la capa de REPOSITORIO (el `WHERE`
por `tienda_id`), no solo en el borde HTTP.

**R8.** MIENTRAS existan órdenes de otros owners en la base, el sistema DEBE excluirlas
del listado aunque la petición incluya parámetros de query manipulados (p. ej. un
`tiendaId`/`owner` en la query): esos parámetros NO deben poder ampliar el scope.

**R9.** El sistema DEBE paginar el listado con `offset`/`limit` (tope 100 ítems por
página) y validar esos parámetros en el borde; SI son inválidos (fuera de rango o no
numéricos), ENTONCES el sistema DEBE responder `400`/`422` con detalle por campo, sin
ejecutar la consulta.

**R10.** El sistema DEBE devolver, junto a los ítems, la información de paginación
(`limit`, `offset`, `total`) necesaria para recorrer todas las páginas de forma
determinista y estable entre páginas.

**R11.** El sistema DEBE excluir del listado las órdenes borradas (`deleted_at IS NOT
NULL`).

---

## Bloque C — Detalle (GET recurso)

**R12.** CUANDO un owner autenticado solicita el detalle de una orden que le pertenece
por su `num_guia`, el sistema DEBE devolver los datos de esa orden incluyendo su estado
actual.

**R13.** SI no existe ninguna orden con el `num_guia` solicitado, ENTONCES el sistema
DEBE responder `404 Not Found`.

**R14.** SI existe una orden con ese `num_guia` pero su `tienda_id` NO es
`actor.usuarioId`, ENTONCES el sistema DEBE responder `404 Not Found` (misma respuesta
que R13: no se filtra la existencia de recursos ajenos).

**R15.** DONDE la orden tenga una gestión con resultado `entregada` o `rechazada` con
evidencia (`evidencia_storage_path` no nulo), el detalle DEBE incluir esa(s) evidencia(s)
representada(s) como URL(s) firmada(s) de corta duración.

**R16.** El sistema DEBE resolver las evidencias como URLs firmadas contra el bucket
privado; NUNCA DEBE exponer la ruta cruda del objeto en el bucket, ni el nombre del
bucket, ni datos personales de terceros (p. ej. el mensajero) en la respuesta.

**R17.** Las URLs firmadas de evidencia DEBEN expirar en 5 minutos
(`gestionConfig.SIGNED_URL_TTL_SECONDS`); el sistema DEBE firmarlas con la credencial de
servidor, nunca desde el cliente.

**R18.** SI una orden no tiene evidencias (nunca fue entregada ni rechazada, o la gestión
no adjuntó archivo), ENTONCES el detalle DEBE devolver una colección de evidencias vacía,
no un error.

---

## Bloque D — Cancelación (PUT de estado)

**R19.** MIENTRAS el estado actual de la orden sea `en_bodega` o
`en_ruta_bodega_principal`, CUANDO el owner solicita cancelarla mediante `PUT`, el sistema
DEBE transicionar la orden al estado existente `devuelta_origen` y responder éxito con el
nuevo estado.

**R20.** SI el estado actual de la orden es cualquier otro distinto de `en_bodega` o
`en_ruta_bodega_principal` (incluida una orden ya en `devuelta_origen`), ENTONCES el
sistema DEBE rechazar la cancelación con `409 Conflict` y NO modificar el estado.

**R21.** CUANDO la cancelación procede (R19), el cambio de estado DEBE registrarse a
través del choke point `appendCambioEstado`, en la MISMA transacción que actualiza
`orden.estatus_id`, de modo que quede en la bitácora de estados y dispare los webhooks de
la feature 104.

**R22.** El sistema DEBE registrar la transición de cancelación con `estatus_origen_id` =
estado previo real, `estatus_destino_id` = `devuelta_origen`, `actor_usuario_id` =
`actor.usuarioId` y `origen_tipo` = `cancelacion_api`.

**R23.** SI no existe orden con el `num_guia`, o existe pero no pertenece al owner,
ENTONCES la cancelación DEBE responder `404 Not Found` (mismo criterio que R13/R14: no se
filtra existencia ajena).

**R24.** El sistema DEBE excluir de la cancelación las órdenes borradas (`deleted_at IS
NOT NULL`): se tratan como inexistentes (`404`).

**R25.** El sistema DEBE ejecutar la lectura del estado actual, la escritura del nuevo
estado y el registro en la bitácora (R21/R26) de forma ATÓMICA (una sola transacción), de
manera que dos cancelaciones concurrentes no produzcan doble registro ni un webhook
duplicado.

**R26.** CUANDO la cancelación procede (R19), el sistema DEBE persistir el marcador
`motivo = "cancelada por tienda"` en la fila de la bitácora de estados
(`orden_historial_estado.motivo`, columna real `motivo`, `String?`) escrita por
`appendCambioEstado`. Ese `motivo` es el MARCADOR SEMÁNTICO que distingue esta cancelación
de integrador de una devolución real, dado que ambas terminan en el estado
`devuelta_origen`. El sistema NO DEBE escribir ninguna fila en `gestion_orden` al cancelar.

---

## Bloque E — Modelo de datos (habilitador de la cancelación)

**R27.** El sistema DEBE disponer del valor de `origen_tipo` `cancelacion_api` en el
catálogo de orígenes de transición (`ORDEN_HISTORIAL_ORIGEN_TIPO_SEED` + enum Postgres
`orden_historial_origen_tipo`), sembrado de forma idempotente.

**R28.** La ÚNICA migración de esta feature DEBE agregar el valor `cancelacion_api` al enum
Postgres `orden_historial_origen_tipo` (`ADD VALUE IF NOT EXISTS`) con su `down.sql`
(docs/architecture.md §Migraciones), documentando la irreversibilidad parcial del `ADD
VALUE` (patrón feature 104). NO se migra el enum de estatus de orden (se reutiliza
`devuelta_origen`) ni la tabla `gestion_orden` (no se toca su esquema).
