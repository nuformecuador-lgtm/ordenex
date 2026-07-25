# Impl 106 — API: lectura, detalle (evidencias) y cancelación de órdenes por API key

Backend puro. Rama `feature/106-api-lectura-ordenes` (worktree aislado, nace de `origin/dev`).
Gate F1.4 CERRADO. Sin desvíos del spec.

## Bloque 0 — Reconocimiento (T1/T2)

- **T1** (verificado en código):
  - Enum Prisma `OrdenHistorialOrigenTipo` (`@@map("orden_historial_origen_tipo")`),
    `db/schema.prisma:910`. Se le agrega el valor `cancelacion_api`.
  - `devuelta_origen` YA existe en `ORDER_STATUS_SEED` (`lib/types/order-status.ts:22`) →
    la cancelación NO migra el enum de estatus (se reutiliza).
  - `orden_historial_estado.motivo` existe (`String?`, columna `motivo`, `db/schema.prisma:941`)
    y `appendCambioEstado` la persiste (`lib/repositories/registrar-cambio-estado.ts:33`,
    `motivo: e.motivo ?? null`). No requiere extender la función.
- **T2**: `lib/errors` exporta `NotFoundError` (code `NOT_FOUND` → 404) y `ConflictError`
  (code `CONFLICT` → 409), más `UnauthenticatedError` (401), `ForbiddenError` (403),
  `ValidationError` (422). Códigos HTTP en `lib/errors/codes.ts` (`HTTP_STATUS_BY_CODE`).

## Archivos creados

**Modelo de datos (única migración):**
- `db/schema.prisma` — enum `OrdenHistorialOrigenTipo` gana `cancelacion_api` (modificado).
- `lib/types/orden-historial.ts` — `ORDEN_HISTORIAL_ORIGEN_TIPO_SEED` gana `cancelacion_api`
  (modificado; el guard `_EnsureExhaustive` compila tras `db:generate`).
- `db/migrations/20260722130000_cancelacion_api_por_key/migration.sql` — `ALTER TYPE ... ADD
  VALUE IF NOT EXISTS 'cancelacion_api'` (aditiva; no toca gestion_orden ni el enum de estatus).
- `db/migrations/20260722130000_cancelacion_api_por_key/down.sql` — recrea el enum sin
  `cancelacion_api` (17 valores previos) con USING; documenta la irreversibilidad parcial del
  `ADD VALUE` (patrón features 67/99/100).

**Tipos / interfaces:**
- `lib/types/api-orden.ts` — DTOs públicos (`ApiOrdenListItemDTO`, `ApiOrdenDetalleDTO`,
  `ApiOrdenEvidenciaDTO`, `ApiOrdenListadoDTO`, `ApiOrdenCancelacionDTO`).
- `lib/interfaces/services/IApiOrdenLecturaService.ts`
- `lib/interfaces/services/IApiOrdenCancelacionService.ts`
- `lib/interfaces/repositories/IOrdenRepository.ts` — filas `ApiOrdenRow`/`ApiOrdenDetalleRow`/
  `ApiOrdenEvidenciaRow`, union `CancelarViaApiResult`, y las 3 firmas nuevas (modificado).

**Repositorio:**
- `lib/repositories/OrdenRepository.ts` (modificado) — `listByOwner`,
  `findDetalleByNumGuiaForOwner`, `cancelarViaApi`. Scope `tienda_id = ownerId AND deleted_at
  IS NULL` FORZADO en el WHERE. `cancelarViaApi` = 1 transacción: pre-lee, valida, `UPDATE
  estatus_id = devuelta_origen` + `appendCambioEstado(origenTipo='cancelacion_api',
  motivo='cancelada por tienda')`. NO escribe en `gestion_orden`.

**Services:**
- `lib/services/ApiOrdenLecturaService.ts` — owner = `actor.usuarioId`; firma evidencias con
  `ISignedUrlProvider.createSignedUrls` y `gestionConfig.SIGNED_URL_TTL_SECONDS` (5 min); DTO
  sin storagePath/bucket/PII del mensajero.
- `lib/services/ApiOrdenCancelacionService.ts` — resuelve `devuelta_origen` → estatusId y
  traduce la union del repo (`ok|not_found|conflict`).

**Controllers (route handlers):**
- `app/api/ordenes/api-key/route.ts` — GET listado (offset/limit, tope 100, zod, `total`).
- `app/api/ordenes/api-key/[numGuia]/route.ts` — GET detalle (evidencias firmadas; 404 uniforme).
- `app/api/ordenes/api-key/[numGuia]/cancelar/route.ts` — **PUT** cancelar (200/409/404).
- `lib/api/api-key-request.ts` — helpers compartidos `extraerBearer` + `buildAutenticar`
  (mismo patrón que `carga/route.ts`, feature 88).

**Tests creados:**
- `tests/unit/repositories/orden-repository.api-lectura.test.ts` (T5/T6)
- `tests/unit/repositories/orden-repository.cancelar-api.test.ts` (T7/T14)
- `tests/unit/services/api-orden-lectura-service.test.ts` (T8)
- `tests/unit/services/api-orden-cancelacion-service.test.ts` (T9)
- `tests/integration/api/ordenes-api-key-listado.route.test.ts` (T10)
- `tests/integration/api/ordenes-api-key-detalle.route.test.ts` (T11)
- `tests/integration/api/ordenes-api-key-cancelar.route.test.ts` (T12)
- `tests/integration/api/ordenes-api-key-seguridad.route.test.ts` (T13)
- `tests/integration/db/orden-historial-origen-tipo-cancelacion-api-migration.test.ts` (T3/T4)

**Tests actualizados por el ripple del enum (18.º valor `cancelacion_api`):**
- `tests/unit/types/orden-historial-types.test.ts` (17→18 valores)
- `tests/unit/repositories/orden-historial-cobertura.test.ts` (18.º punto de escritura:
  `OrdenRepository.cancelarViaApi`)
- `tests/integration/db/gestion-orden-anulacion-migration.test.ts` (feature 67 down: excluye
  `cancelacion_api` del set posterior)
- `tests/integration/db/orden-historial-origen-tipo-sla-devuelta-migration.test.ts` (feature 99)
- `tests/integration/db/orden-historial-origen-tipo-resolver-novedad-migration.test.ts` (feature 100)
- `tests/integration/db/zonas-migration.test.ts` (whitelist de migraciones posteriores)
- 5 fakes de `IOrdenRepository` en tests de services (agregados los 3 métodos nuevos):
  `orden-service`, `asignacion-mensajero-service`, `bulk-orden-service`,
  `bulk-orden-service.carga-api`, `rol-admin-satelite-authz`.

## Mapa R→test (nombres reales de caso)

| R | Test (archivo :: caso) |
|---|---|
| R1 | listado/detalle/cancelar route :: "R1: sin Bearer/sin-mal Bearer -> 401" |
| R2 | ordenes-api-key-listado.route :: "R2: key inexistente (autenticar unauthenticated) -> 401" |
| R3 | listado/cancelar route :: "R3: usuario inactivo (forbidden) -> 403" |
| R4 | api-orden-lectura-service :: "R4/R6: usa actor.usuarioId como owner"; api-orden-cancelacion-service :: "R19: ... owner = actor.usuarioId" |
| R5 | ordenes-api-key-seguridad.route :: "listado/detalle/cancelar: forbidden y error interno -> body y console.* sin el secreto" |
| R6 | orden-repository.api-lectura :: "R6: mapea las filas del owner"; api-orden-lectura-service :: "R4/R6: usa actor.usuarioId como owner" |
| R7 | orden-repository.api-lectura :: "R7: el where fuerza tienda_id = ownerId y deleted_at IS NULL" |
| R8 | api-orden-lectura-service :: "R8: el filtro estado se resuelve a estatusId"; ordenes-api-key-listado.route :: "R8: ignora tiendaId de la query" |
| R9 | ordenes-api-key-listado.route :: "R9: limit > 100 -> 422" / "limit no numerico" / "offset negativo" |
| R10 | ordenes-api-key-listado.route :: "R10: 200 con items + pagination (total)"; api-orden-lectura-service :: "R10: ... pagination con total" |
| R11 | orden-repository.api-lectura :: "R11: excluye borradas — deleted_at: null va SIEMPRE en el where" |
| R12 | orden-repository.api-lectura :: "R12: devuelve el detalle de una orden propia"; ordenes-api-key-detalle.route :: "R12/R15: 200 con evidencias firmadas" |
| R13 | orden-repository.api-lectura :: "R13/R14/R24: ... -> null"; ordenes-api-key-detalle.route :: "R13: inexistente -> 404" |
| R14 | ordenes-api-key-detalle.route :: "R14: ajena -> 404 (misma respuesta que inexistente)" |
| R15 | orden-repository.api-lectura :: "R15: incluye evidencias..."; api-orden-lectura-service :: "R15/R16/R17: firma evidencias..." |
| R16 | api-orden-lectura-service :: "R16: ... DTO sin storagePath ni PII"; ordenes-api-key-detalle.route :: "R16: la respuesta no expone storagePath, bucket ni mensajero" |
| R17 | api-orden-lectura-service :: "R15/R16/R17: firma evidencias con gestionConfig.SIGNED_URL_TTL_SECONDS" |
| R18 | orden-repository.api-lectura :: "R18: sin evidencias -> evidencias vacias"; api-orden-lectura-service :: "R18: ... [] y NO se invoca el provider"; ordenes-api-key-detalle.route :: "R18: 200 con evidencias: []" |
| R19 | orden-repository.cancelar-api :: "R19/R25: transiciona desde %s a devuelta_origen"; api-orden-cancelacion-service :: "R19: ok desde en_bodega / en_ruta_bodega_principal"; ordenes-api-key-cancelar.route :: "R19: 200 transiciona a devuelta_origen" |
| R20 | orden-repository.cancelar-api :: "R20: %s no es cancelable -> conflict"; api-orden-cancelacion-service :: "R20: conflict"; ordenes-api-key-cancelar.route :: "R20: 409" |
| R21 | orden-repository.cancelar-api :: "R22/R26: appendCambioEstado registra..." + "R19/R25: ... en la MISMA tx" |
| R22 | orden-repository.cancelar-api :: "R22/R26: appendCambioEstado registra origen/destino/actor/origen_tipo" |
| R23 | orden-repository.cancelar-api :: "R23/R24: orden inexistente/ajena/borrada -> not_found"; api-orden-cancelacion-service :: "R23: not_found"; ordenes-api-key-cancelar.route :: "R23: 404 ajena/inexistente" |
| R24 | orden-repository.cancelar-api :: "R23/R24: ... borrada -> not_found"; orden-repository.api-lectura :: "R13/R14/R24: ... -> null" |
| R25 | orden-repository.cancelar-api :: "R19/R25: ... update + append en la MISMA tx" ($transaction llamada 1 vez) |
| R26 | orden-repository.cancelar-api :: "R22/R26: motivo='cancelada por tienda'" + "R26/T14: NO escribe ninguna fila en gestion_orden" |
| R27 | orden-historial-origen-tipo-cancelacion-api-migration :: "siembra cancelacion_api idempotente" |
| R28 | orden-historial-origen-tipo-cancelacion-api-migration :: UP/DOWN/schema (ADD VALUE + down reversible; sin gestion_orden ni estatus) |

**Nota T14 (webhook feature 104):** la feature 104 NO está en la base de esta rama
(`origin/dev`). El webhook de la 104 se dispara por el choke point `appendCambioEstado`; T14 queda
cubierto ESTRUCTURALMENTE por `orden-repository.cancelar-api` que verifica el routing por
`appendCambioEstado` en la MISMA `$transaction` (atómico) con el payload correcto y SIN escritura a
`gestion_orden`. No hay emisor de webhook que espiar con un mock en esta rama (se activará cuando
la 104 se integre, sin código extra: la cancelación ya pasa por el choke point que ésta engancha).

## Verificación

- **`pnpm db:migrate` NO se ejecutó** contra la base (el `.env` apunta a una DB compartida;
  aplicar ahí generaría drift pre-merge). En su lugar: enum editado en `schema.prisma` + `pnpm
  db:generate` (codegen local, sin DB) → el cliente conoce `cancelacion_api` y el guard
  `_EnsureExhaustive` compila; `migration.sql`/`down.sql` validados por inspección y por el test
  estático `orden-historial-origen-tipo-cancelacion-api-migration.test.ts`. **`db:migrate` queda
  como paso de despliegue humano.**
- **Baseline (T1):** `tsc --noEmit` EXIT 0 antes de empezar (worktree en verde).
- **Reparación de entorno (no relacionada con el código):** el `node_modules` compartido
  (junction) tenía ~18 paquetes del store pnpm vacíos (árbol incompleto: picocolors, @babel/*,
  css-tree, jsdom deps, @csstools/*). Issue conocido; reparado rellenando los dirs canónicos del
  store con los tarballs exactos del registro (versiones del lockfile). No es un cambio del repo.

### `pnpm typecheck`
EXIT 0 (verde).

### `pnpm lint`
0 errors, 143 warnings (todas preexistentes; ninguna en archivos de la feature 106).

### `pnpm test`
- **Tests de la feature 106 + ripple del enum:** 55 (feature) + 68 (ripple) todos en VERDE
  aislados.
- **Suite completa:** el conteo de fallos VARÍA entre corridas (8 → 26) — firma de flakiness por
  timeout bajo carga (jsdom). NINGÚN fallo es de la feature 106 ni de los tests de enum. Corridos
  en aislado/baja-carga pasan todos salvo `HomePage.test.tsx`, que hace timeout (5s) en un
  `import('@/app/(app)/dashboard/page')` que esta feature NO toca (flaky de perf documentado en
  memoria). Guards deterministas (`no-embalaje`, `cierre-detail-inmutable`) verificados en verde
  aislados. Última corrida de 8 archivos UII: 128 passed / 1 failed (solo HomePage timeout).

## Veredicto
Feature 106 completa (T1–T15), backend puro, sin desvíos del spec; typecheck y lint verdes,
suite de la feature verde; los fallos de la suite completa son flakiness de UI por timeout ajena
a esta feature.
