# Review 106 — API: lectura, detalle (evidencias) y cancelación por API key

**Veredicto: APROBADO** — 0 bloqueantes.

Reviewer (verifica, no edita). Rama `feature/106-api-lectura-ordenes` (worktree aislado).

## Checklist

- [x] Spec completa: `requirements.md` (R1–R28 EARS), `design.md` (con alternativas descartadas + gate F1.4 cerrado), `tasks.md` (T1–T15 todas `[x]`).
- [x] Trazabilidad R→test COMPLETA: cada R1–R28 tiene al menos un test REAL que lo verifica (abiertos y leídos, no solo por nombre). Tabla abajo.
- [x] `progress/impl_106.md` contiene el mapa R→test.
- [x] Conformidad con decisiones del gate (todas cumplidas). Detalle abajo.
- [x] Seguridad de la key (R5): test dedicado + inspección del código (sin `console.*` en los handlers; el secreto solo viaja en el header y ningún canal lo re-emite).
- [x] Convenciones / capas: Controller sin queries ni lógica; Service sin HTTP; Repository solo Prisma; interfaces en `lib/interfaces/`.
- [x] `pnpm typecheck`: EXIT 0 (verde).
- [x] Suite feature 106 + ripple del enum: verde (ver números).
- [x] RLS: no crea tablas; documentado (§5.2). Migración única reversible con `down.sql`.
- [x] Sin secretos hardcodeados; sin hardcode de owner/contexto (owner = `actor.usuarioId` forzado).

## Conformidad con el gate (verificada en código)

- Owner forzado en el REPOSITORIO: `listByOwner` y `findDetalleByNumGuiaForOwner` ponen `tiendaId: ownerId` no-opcional + `deletedAt: null` en el `where`; `cancelarViaApi` pre-lee con el mismo scope dentro de la tx. El service reafirma `ownerId = actor.usuarioId` (defensa en profundidad).
- Listado scopeado: `tiendaId`/`owner` en la query no está en el zod schema → jamás se lee (test "R8: ignora tiendaId").
- Detalle 404 uniforme para ajena/inexistente/borrada (repo → `null` → `NotFoundError`), no filtra existencia.
- Evidencias: URL firmada, DTO sin `storagePath`/bucket/PII del mensajero; serialización testeada contra `/storagePath|storage_path|mensajero|gestion-evidencias/`.
- Cancelación SOLO desde `en_bodega`/`en_ruta_bodega_principal` → `devuelta_origen`; cualquier otro (incl. ya `devuelta_origen`) → 409.
- `appendCambioEstado` en la MISMA tx, `origen_tipo='cancelacion_api'`, `motivo='cancelada por tienda'`, actor = owner; NO escribe en `gestion_orden` (spies sobre `gestionOrden.*` verifican 0 llamadas).
- Verbo PUT (módulo exporta PUT, NO POST — testeado). `num_guia` como id. Paginación offset/limit tope 100 (zod `.max(100)`). TTL 5 min (`SIGNED_URL_TTL_SECONDS` default 300). Única migración = `ADD VALUE IF NOT EXISTS 'cancelacion_api'` + `down.sql`.

## Tabla R→test

| R | Estado | Test verificado |
|---|--------|-----------------|
| R1 | OK | listado/detalle/cancelar route :: 401 sin/mal Bearer |
| R2 | OK | listado route :: key inexistente → 401 |
| R3 | OK | listado/cancelar route :: forbidden → 403 |
| R4 | OK | lectura-service (owner=actor), cancelacion-service (ownerId=actor.usuarioId) |
| R5 | OK | seguridad.route :: body + console.* sin el secreto (3 endpoints) |
| R6 | OK | repo api-lectura (mapea filas del owner) + service |
| R7 | OK | repo api-lectura :: where fuerza tiendaId=ownerId + deletedAt:null |
| R8 | OK | service (estado→estatusId) + listado route (ignora tiendaId) |
| R9 | OK | listado route :: limit>100 / no numérico / offset<0 → 422 |
| R10 | OK | listado route + service :: pagination con total |
| R11 | OK | repo api-lectura :: deletedAt:null siempre en el where |
| R12 | OK | repo + detalle route :: orden propia |
| R13 | OK | repo (null) + detalle route :: 404 inexistente |
| R14 | OK | detalle route :: ajena → 404 (misma respuesta) |
| R15 | OK | repo (where gestiones entregada/rechazada + evidencia not null) + service + detalle route |
| R16 | OK | service + detalle route :: sin storagePath/bucket/mensajero |
| R17 | OK | service :: createSignedUrls con gestionConfig.SIGNED_URL_TTL_SECONDS |
| R18 | OK | repo + service (no invoca provider) + detalle route :: evidencias [] |
| R19 | OK | repo (each en_bodega/en_ruta_bodega_principal) + service + cancelar route |
| R20 | OK | repo (each estado no cancelable incl. devuelta_origen) + service + route → 409 |
| R21 | OK | repo cancelar-api :: appendCambioEstado en la MISMA $transaction |
| R22 | OK | repo :: createMany con origen/destino/actor/origen_tipo=cancelacion_api |
| R23 | OK | repo (null) + service + route :: 404 ajena/inexistente |
| R24 | OK | repo :: borrada→not_found; detalle repo :: borrada→null |
| R25 | OK | repo :: $transaction llamada 1 vez (update+append atómicos) |
| R26 | OK | repo :: motivo='cancelada por tienda' + 0 escrituras a gestion_orden |
| R27 | OK | migration test :: cancelacion_api en ORDEN_HISTORIAL_ORIGEN_TIPO_SEED |
| R28 | OK | migration test :: UP ADD VALUE + DOWN recrea enum sin el valor (17 previos) + irreversibilidad documentada; sin gestion_orden/estatus |

## Verificación ejecutable

### pnpm typecheck
EXIT 0 (verde).

### Suite feature 106 + ripple del enum
- Feature 106 (9 archivos) + `orden-historial-types` + `orden-historial-cobertura`: **11 test files, 76 tests, todos PASSED** (5.31s).
- Ripple de migraciones (`gestion-orden-anulacion`, `sla-devuelta`, `resolver-novedad`, `zonas`): **4 files, 56 tests PASSED** (1.22s).

Nota sobre la suite completa: no se corrió íntegra en esta revisión; los fallos flaky de UI (`HomePage`, etc. por timeout jsdom) están documentados en `impl_106.md` y son ajenos a esta feature (backend puro; ningún archivo de UI tocado). Typecheck global verde descarta regresión de tipos.

## Hallazgos

- **menor** — `pnpm db:migrate`/`db:rollback` NO se ejecutaron contra una DB real (el `.env` apunta a una base compartida; aplicar generaría drift pre-merge). La migración se validó por: (a) test estático que lee `migration.sql`/`down.sql` por regex, (b) `db:generate` (el cliente conoce `cancelacion_api` y el guard `_EnsureExhaustive` compila). Justificado y documentado; queda como paso de despliegue humano. No bloqueante, pero debe ejecutarse `db:migrate` en el deploy y verificar `db:rollback` en un entorno no compartido.
- **menor** — El test de seguridad (R5) inyecta un `autenticar` fake, así que el `ApiKeyAuthService` real no corre en ese caso; cubre que los handlers/services no re-emiten el secreto (que es el vector realista), pero no ejercita el logging del autenticador real. Aceptable: el patrón de auth es reuso verificado de la feature 88 y `extraerBearer` no loguea.

## Veredicto final

**APROBADO** — 0 bloqueantes. Los 2 hallazgos son menores (operacionales/cobertura), no requieren cambio de código para aprobar. `db:migrate` pendiente como paso de despliegue humano.
