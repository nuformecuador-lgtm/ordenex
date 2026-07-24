# impl_138 — Recepción en bodega central (BACKEND, Fase 1 de 2)

> Rama: `feature/138-recepcion-bodega-central` (desde `origin/dev`, con 137 mergeado).
> Fase 1 = backend (Bloques 0/1/2 + tests backend). Fase 2 = frontend (escáner UI) la hace
> `frontend_dev`. El acoplamiento es flojo: el componente nuevo aún no existe, no rompe typecheck.

## T0 — Precondición (dep 137) VERIFICADA

`grep` confirma en el código post-137:
- `lib/services/BulkOrdenService.ts:32` → `const ESTATUS_INICIAL_API = "en_ruta_bodega_central";`
- `en_ruta_bodega_central` (origen, dead-end de carga API) y `en_bodega_central` (destino)
  presentes en el catálogo/consumidores (BulkOrdenService, CierresAdminService, etc.).

Dep 137 intacta → se procede.

## Archivos creados

- `db/migrations/20260724130000_orden_historial_origen_recepcion_bodega_central/migration.sql`
  (UP: `ADD VALUE IF NOT EXISTS 'recepcion_bodega_central'`, va sola)
- `db/migrations/20260724130000_orden_historial_origen_recepcion_bodega_central/down.sql`
  (DOWN: recrea el enum sin el valor, patrón `carga_api`; lista de 20 valores previos)
- `lib/interfaces/services/IRecepcionBodegaCentralService.ts` (contrato + union de resultado, SIN
  `zona_ajena`/`tienda_ajena`/`sin_zona`)
- `lib/services/RecepcionBodegaCentralService.ts` (service, `esAccesoTotal`, sin guardia zona/tienda)
- `lib/types/recepcion-bodega-central.ts` (`recibirEnBodegaCentralSchema` + `RecibirEnBodegaCentralResult`)
- `lib/actions/recepcion-bodega-central.ts` (Server Action `recibirEnBodegaCentralPorQr`)
- `tests/unit/services/recepcion-bodega-central-service.test.ts` (15 tests)
- `tests/unit/repositories/orden-repository.recepcion-bodega-central.test.ts` (5 tests)
- `tests/unit/actions/recepcion-bodega-central-action.test.ts` (9 tests)
- `tests/integration/db/orden-historial-origen-recepcion-bodega-central-migration.test.ts` (10 tests, estático)

## Archivos modificados

- `db/schema.prisma` — nuevo valor `recepcion_bodega_central` en `enum OrdenHistorialOrigenTipo`
- `lib/types/orden-historial.ts` — nuevo valor en `ORDEN_HISTORIAL_ORIGEN_TIPO_SEED` (fuente única
  de verdad del tipo; el `satisfies` + `_EnsureExhaustive` obliga a añadirlo aquí)
- `lib/interfaces/repositories/IOrdenRepository.ts` — firma `recibirEnBodegaCentral(ordenId, destinoEstatusId, historial)`
- `lib/repositories/OrdenRepository.ts` — impl `recibirEnBodegaCentral` (espejo de `recibirEnOrigen`
  SIN guardia zona/tienda) + constante `ORIGEN_RECEPCION_BODEGA_CENTRAL`
- Tests de terceros ajustados por el cambio de interfaz/enum (no rompen su intención):
  - 5 fakes de `IOrdenRepository` (añaden `recibirEnBodegaCentral`): `asignacion-mensajero-service`,
    `bulk-orden-service`, `bulk-orden-service.carga-api`, `orden-service`, `rol-admin-satelite-authz`
  - `tests/unit/repositories/orden-historial-cobertura.test.ts` — punto **#21** del choke point
    (conjunto cerrado 20→21) + títulos
  - `tests/unit/types/orden-historial-types.test.ts` — valor esperado + conteo 20→21
  - 4 tests estáticos de migración del enum (`AÑADIDOS_EN_O_DESPUES_DEL_{67,99,100,106}` suman
    `recepcion_bodega_central`, apéndice posterior)
  - `tests/integration/db/zonas-migration.test.ts` — allowlist de migraciones apéndice (excluye la nueva)

## Mapa R → test (parte backend: R1–R11, R17, R18 + R5/R10 del action)

| Req | Test |
| --- | --- |
| R1 (ofrece recepción central) | service `R2: ok — transiciona en_ruta_bodega_central -> en_bodega_central (maestro)` |
| R2 (transición efectiva) | service `R2: ok ...` (+ admin) · repo `R2/R11/R18: UPDATE guardado ...; true si afecto 1 fila` |
| R3 (historial en misma tx) | repo `R3/R17: recepcion deja 1 historial ...` · repo `R3: envuelve el updateMany + append en UNA transaccion` |
| R4 (no autorizado → forbidden) | service `R4: forbidden si el actor es adminTienda/adminSatelite/mensajero, sin efectos` |
| R5 (sin sesión → unauthenticated) | action `R5: sin actor -> unauthenticated, sin tocar el service` |
| R6 (inexistente/borrada → no_encontrada) | service `R6: no_encontrada si no hay orden ...` · `R6: ... si la orden esta borrada ...` |
| R7 (idempotente → ya_recibida) | service `R7: ya_recibida si ya esta en en_bodega_central: idempotente, sin escritura` |
| R8 (estado no origen → estado_invalido) | service `R8: estado_invalido lleva el estado actual ...` · `R8: ... si esta en en_bodega_satelite` |
| R9 (concurrencia: a lo sumo una) | service `R9: si pierde la carrera ... -> ya_recibida` · `R9: ... -> conflict` · repo `R9/R3: false si el UPDATE no afecto filas (race); NO deja rastro` |
| R10 (num_guia inválido → validation_error) | action `R10: {no numérico,cero,negativo,decimal,ausente} -> validation_error, sin tocar el service` |
| R11 (global, sin zona/tienda) | service `R11: recibe una orden de CUALQUIER zona/tienda ...` · repo `R2/R11/R18: ... where SIN zonaId/tiendaId` · `R11: la pre-lectura del origen tampoco acota por zona/tienda` |
| R17 (origen_tipo propio) | repo `R3/R17: ... tipo recepcion_bodega_central` · migración `SEED ... (R17)` / `UP ADD VALUE (R17)` · cobertura punto #21 |
| R18 (no toca num_guia/mensajero) | repo `R2/R11/R18: ... arg.data NO tiene mensajeroAsignadoId ni numGuia` |

Requisitos de UI **R12–R16** (incluye R14) → **Fase 2 (frontend_dev)**, sin test aquí.

## Verificación ejecutable (Fase 1)

- `pnpm run typecheck` → **0 errores**.
- `pnpm run lint` (archivos backend nuevos/modificados) → **limpio** (sin salida).
- Mis suites backend (`pnpm vitest run <mis 4 archivos>`) → **39 passed (4 files)**.
- Suite completa `pnpm test` → **502 files / 4964 tests, todos verdes**. (Una corrida previa mostró 3
  timeouts flaky de tests de componente bajo contención de CPU —documentados en `vitest.config.ts`—
  que pasan en aislado; se re-corrió la suite completa y quedó 100% verde.)
- `./init.sh` completo NO aplica a esta fase: lo cierra el `frontend_dev` cuando exista el componente.

## Deuda: aplicación real de la migración (post-merge)

No hay DB real en el entorno (solo `.env.example`, sin `DATABASE_URL`): NO se pudo `db:migrate`/
`db:rollback` de verdad. Queda hecho: migración creada (`migration.sql` + `down.sql`), `db/schema.prisma`
actualizado y `pnpm prisma generate` OK (el cliente reconoce `recepcion_bodega_central`). El
round-trip up→down→up contra Postgres es **DEUDA post-merge** (mismo criterio que la 137/106/100/99).
La cobertura estática del par migration/down (regex, sin DB) sí corre en CI: test
`orden-historial-origen-recepcion-bodega-central-migration.test.ts`.

## Nota para frontend_dev (Fase 2, NO tocado aquí)

Pendiente (R12–R16, incl. R14):
- Crear `app/(app)/ordenes/_components/EscanerRecepcionBodegaCentral.tsx` (`"use client"`): QR cámara
  (`QrScanner` + `extractNumGuiaFromScan`) + input manual de guía; ambos a
  `recibirEnBodegaCentralPorQr({ numGuia })`; toasts por `RecibirEnBodegaCentralResult` (tabla §4.1
  del design); guard `procesando`; `onRecibida` en `ok`/`ya_recibida` (R14).
- `app/(app)/ordenes/_components/OrdenesTabs.tsx`: prop `puedeRecibirBodegaCentral?: boolean`; montar
  el receptor en el encabezado con `onRecibida={handleSuccess}`.
- `app/(app)/ordenes/page.tsx`: gate `puedeRecibirBodegaCentral = rol ? esAccesoTotal(rol) : false` (R16).
- Test de componente (R12–R16) + cierre de `./init.sh`.

La acción `recibirEnBodegaCentralPorQr` y el tipo `RecibirEnBodegaCentralResult` ya están listos y
tipados para el consumo del componente.

## Veredicto

Backend de la feature 138 completo y verde (typecheck 0, 39 tests backend propios, suite 4964 verde);
migración creada + `prisma generate` OK, con su aplicación real como deuda post-merge documentada.
