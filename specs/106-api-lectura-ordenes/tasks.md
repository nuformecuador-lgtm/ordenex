# Feature 106 — Tasks

Checklist de pasos discretos y verificables. `[P]` = paralelizable (sin dependencia con
las tareas en curso de su bloque). Cada task trae su criterio de "hecho". Al final, el
mapa de trazabilidad `R<n>→test` que el reviewer verifica.

> Gate F1.4 CERRADO. La cancelación reutiliza `devuelta_origen` (sin migración de estatus)
> y el marcador `"cancelada por tienda"` se persiste SOLO en `orden_historial_estado.motivo`
> vía `appendCambioEstado` (NO se toca `gestion_orden`). ÚNICA migración: `origen_tipo`
> `cancelacion_api`.

---

## Bloque 0 — Reconocimiento (bloqueante, primero)

- [ ] **T1** — Confirmar en `db/schema.prisma`: (a) el tipo del enum
  `orden_historial_origen_tipo` (para el `ADD VALUE`); (b) que `devuelta_origen` está en
  `ORDER_STATUS_SEED` (verificado: sí — sin migración de estatus); (c) que
  `orden_historial_estado.motivo` existe (verificado: `String?`, columna `motivo`, línea
  941) y que `appendCambioEstado` persiste `motivo` (verificado:
  `registrar-cambio-estado.ts:33`). **Hecho:** documentado en `progress/impl_106.md`.
- [ ] **T2** — Confirmar que `lib/errors` exporta `NotFoundError` y `ConflictError` (o
  equivalentes) y sus códigos HTTP. **Hecho:** símbolos citados existen; si falta alguno,
  anotar el equivalente real (no inventar formato).

## Bloque A — Modelo de datos (una sola migración; depende de T1; commit propio)

- [ ] **T3** — Agregar `"cancelacion_api"` a `ORDEN_HISTORIAL_ORIGEN_TIPO_SEED`
  (`lib/types/orden-historial.ts`). **Hecho:** guard `_EnsureExhaustive` compila (exige que
  el enum Prisma tenga el valor → depende de T4). [R27]
- [ ] **T4** — Crear migración `db/migrations/<ts>_cancelacion_api_por_key/` con
  `migration.sql` (`ALTER TYPE "orden_historial_origen_tipo" ADD VALUE IF NOT EXISTS
  'cancelacion_api'`) y su `down.sql` (documenta la irreversibilidad parcial del `ADD
  VALUE`, patrón feature 104). **Hecho:** `pnpm db:migrate` aplica y `pnpm db:rollback`
  corre sin error; `pnpm db:generate` regenera el cliente. NO hay cambios en `gestion_orden`
  ni en el enum de estatus. [R28]

## Bloque B — Repositorio (depende de A; `[P]` entre sí una vez creado el archivo base)

- [ ] **T5 [P]** — `OrdenRepository.listByOwner({ ownerId, estatusId?, skip, take })` con
  `WHERE tienda_id = ownerId AND deleted_at IS NULL`. **Hecho:** test unitario del repo
  (mock Prisma) confirma que el `where` fuerza `tiendaId = ownerId` y `deleted_at: null`.
  [R6, R7, R11]
- [ ] **T6 [P]** — `OrdenRepository.findDetalleByNumGuiaForOwner(numGuia, ownerId)` que
  incluye gestiones con `resultado IN ('entregada','rechazada')` y `evidencia_storage_path
  != null`; devuelve `null` si no existe / borrada / de otro owner. **Hecho:** test unitario
  cubre pertenece / no existe / ajena / con y sin evidencia. (Nota: `gestion_orden` se LEE
  aquí; nunca se escribe.) [R12, R13, R14, R15, R18]
- [ ] **T7** — `OrdenRepository.cancelarViaApi({ numGuia, ownerId, devueltaOrigenEstatusId })`:
  tx que pre-lee estatus origen, valida owner+estado, hace `UPDATE orden.estatus_id =
  devuelta_origen` e invoca `appendCambioEstado` con `origenTipo:'cancelacion_api'` y
  `motivo:'cancelada por tienda'`. SIN escritura a `gestion_orden`. Devuelve union `ok |
  not_found | conflict`. **Hecho:** test unitario (tx fake / spies) verifica: transición
  desde cada estado cancelable a `devuelta_origen`, rechazo desde no-cancelable, not_found
  por ajena/inexistente, llamada a `appendCambioEstado` con origen/destino/actor/origenTipo y
  `motivo='cancelada por tienda'` en la misma tx, y que NO se llama a ningún insert de
  `gestion_orden`. [R19, R20, R21, R22, R23, R24, R25, R26]

## Bloque C — Services (depende de B)

- [ ] **T8 [P]** — `IApiOrdenLecturaService` + `ApiOrdenLecturaService` (`listar`,
  `detalle`) inyectando `IOrdenRepository` e `ISignedUrlProvider`. `detalle` firma las
  evidencias con `gestionConfig.SIGNED_URL_TTL_SECONDS` y mapea a DTO sin path/bucket/PII.
  **Hecho:** tests con repo y provider fake: scope por owner, 404-ish para ajena, evidencias
  firmadas presentes/vacías, DTO SIN `storagePath` ni datos del mensajero. [R6, R8, R15,
  R16, R17, R18]
- [ ] **T9 [P]** — `IApiOrdenCancelacionService` +
  `ApiOrdenCancelacionService.cancelar(actor, numGuia)` que resuelve
  `devueltaOrigenEstatusId` del catálogo y traduce la union del repo a resultado de dominio.
  **Hecho:** tests: ok desde `en_bodega` y `en_ruta_bodega_principal` (destino
  `devuelta_origen`), conflict desde otros (incl. ya `devuelta_origen`), not_found. [R19,
  R20, R23]

## Bloque D — Controllers / route handlers (depende de C)

- [ ] **T10** — `app/api/ordenes/api-key/route.ts` (GET listado). Reusa `extraerBearer`,
  `autenticar`, `deps` inyectables, `withErrorHandler`, `appErrorToResponse`. Valida query
  (`limit/offset/estado`, tope 100) con zod. **Hecho:** test de integración del handler
  (auth + service fake, sin DB): 401 sin/mal token, 403 usuario inactivo, 200 con
  items+pagination scoped, 422 query inválida, ignora `tiendaId` en query. [R1, R2, R3, R4,
  R8, R9, R10]
- [ ] **T11** — `app/api/ordenes/api-key/[numGuia]/route.ts` (GET detalle). Valida `numGuia`
  como entero positivo. **Hecho:** test de integración: 200 con evidencias firmadas, 404
  inexistente, 404 ajena (misma respuesta), 200 con `evidencias: []`, respuesta sin
  path/bucket/PII. [R1, R5, R12, R13, R14, R15, R16, R18]
- [ ] **T12** — `app/api/ordenes/api-key/[numGuia]/cancelar/route.ts` (**PUT** cancelar).
  **Hecho:** test de integración: 200 transiciona a `devuelta_origen`, 409 desde estado no
  cancelable, 404 ajena/inexistente, 401/403 auth. Confirma que el handler responde a PUT
  (no a POST). [R1, R3, R19, R20, R23]

## Bloque E — Verificación transversal

- [ ] **T13 [P]** — Test de seguridad de la key: forzar un error en cada endpoint y afirmar
  que ni la key ni su hash aparecen en el cuerpo de la respuesta ni en `console.*` (spy).
  **Hecho:** test verde en los tres endpoints. [R5]
- [ ] **T14** — Test de integración del choke point: cancelar (a) registra en la bitácora
  con `origen_tipo='cancelacion_api'`, destino `devuelta_origen` y
  `motivo='cancelada por tienda'`, y (b) encola el job de webhook (feature 104), TODO en la
  misma tx (spy sobre el emisor/outbox); y NO inserta filas en `gestion_orden`. **Hecho:**
  test verde. [R21, R22, R25, R26]
- [ ] **T15** — Correr `./init.sh` + suite completa (`pnpm test`, typecheck, lint) en verde.
  **Hecho:** todo verde; `progress/impl_106.md` documenta el mapa R→test final.

---

## Mapa de trazabilidad `R<n>→test`

| R | Descripción corta | Test (archivo / caso) |
|---|---|---|
| R1 | 401 sin/mal Bearer | T10/T11/T12 handler: "responde 401 cuando falta o es inválido el Bearer" |
| R2 | 401 key inexistente | T10 handler: "responde 401 cuando la key no existe" |
| R3 | 403 usuario inactivo | T10/T12 handler: "responde 403 cuando el usuario no está activo" |
| R4 | Owner = actor.usuarioId | T8 service: "usa actor.usuarioId como owner y no el input" |
| R5 | Key nunca logueada/serializada | T13 seguridad: "no filtra la key en errores ni logs" |
| R6 | Listado solo del owner | T5 repo + T8 service: "lista solo órdenes del owner" |
| R7 | Scope en el repositorio | T5 repo: "el where fuerza tienda_id = ownerId" |
| R8 | Query no amplía scope | T8 service + T10 handler: "ignora tiendaId de la query" |
| R9 | Validación de paginación (tope 100) | T10 handler: "422 cuando limit/offset son inválidos o limit>100" |
| R10 | Info de paginación | T10 handler: "devuelve pagination con total" |
| R11 | Excluye borradas del listado | T5 repo: "excluye órdenes con deleted_at" |
| R12 | Detalle de orden propia | T6 repo + T11 handler: "devuelve el detalle de una orden propia" |
| R13 | 404 inexistente | T6 repo + T11 handler: "404 cuando no existe la guía" |
| R14 | 404 ajena (no filtra) | T6 repo + T11 handler: "404 cuando la orden es de otro owner" |
| R15 | Evidencias entrega/rechazo | T6 repo + T8 service + T11 handler: "incluye evidencias firmadas" |
| R16 | Sin path/bucket/PII | T8 service + T11 handler: "no expone storagePath ni datos del mensajero" |
| R17 | Signed URL 5 min / servidor | T8 service: "firma con gestionConfig.SIGNED_URL_TTL_SECONDS vía provider" |
| R18 | Sin evidencias → [] | T6 repo + T8 service + T11 handler: "evidencias vacías sin error" |
| R19 | Cancela a devuelta_origen | T7 repo + T9 service + T12 handler: "cancela desde en_bodega y en_ruta_bodega_principal a devuelta_origen" |
| R20 | 409 desde estado no permitido | T7 repo + T9 service + T12 handler: "409 desde estado no cancelable (incl. ya devuelta_origen)" |
| R21 | Pasa por appendCambioEstado | T7 repo + T14: "registra vía appendCambioEstado en la misma tx" |
| R22 | Historial origen/destino/actor/origen_tipo | T7 repo + T14: "registra origen_tipo=cancelacion_api, destino=devuelta_origen, actor" |
| R23 | 404 ajena/inexistente en cancelar | T7 repo + T9 service + T12 handler: "404 al cancelar orden ajena/inexistente" |
| R24 | Excluye borradas en cancelar | T7 repo: "trata la borrada como inexistente" |
| R25 | Atomicidad de la cancelación | T7 repo + T14: "update + append en la misma transacción" |
| R26 | Marcador motivo="cancelada por tienda" en la bitácora (sin tocar gestion_orden) | T7 repo + T14: "appendCambioEstado persiste motivo='cancelada por tienda' en orden_historial_estado; no escribe gestion_orden" |
| R27 | Origen `cancelacion_api` sembrado | T3 seed: "siembra cancelacion_api idempotente" |
| R28 | Única migración (ADD VALUE) con down.sql | T4 migración: "db:migrate aplica ADD VALUE cancelacion_api y db:rollback corre; sin cambios en gestion_orden ni estatus" |
