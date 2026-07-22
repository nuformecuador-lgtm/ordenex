# Bitácora de implementación — Feature 99: Devolución diferida + cron SLA (liberar/rechazar) + ingreso de bodega del rechazo

Zona: backend. Rama: `feature/99-devolucion-diferida-sla`. Money-critical, sdd:true.
Gate F1.4 APROBADO (8 recomendadas + confirmación Q1). Implementa T0–T17.

## Decisiones de implementación no obvias
- **Option A del dinero (Q1):** `DevolucionSlaRepository.escalarDevueltaSla` crea, en la MISMA tx del escalado, una gestión sintética `resultado=rechazada` (actor sistema, `cierre_id=null`, atribuida al mensajero de la última gestión `devuelta` vigente). Reusa BYTE A BYTE el snapshot de la 56 (`derivarIngresoBodega`/`ingresoBodegaPorResultado`) y el feed de wallet 42/69, sin código monetario nuevo. La gestión sintética NO lleva `montoRecibido` ni `ingresoBodegaRechazo` pre-computados: el ingreso lo deriva el cierre desde `resultado`.
- **Relocalización de la 47 (Q6/R29):** se retiró el parámetro `seguimiento` de `crearGestionYTransicionar` y su bloque; se eliminó `resolverSeguimientoDevuelta`/`catalogoIncompleto` de `MisAsignacionesService` y **sus deps de constructor** `historial` (contarIntentos) + `zonaRepo` (findCentralZonaId) — ahora el constructor tiene 5 params (repo, ordenRepo, storage, signedUrls, rutaRepo). Actualizados los 6 call-sites (1 factory + 5 test constructions).
- **Anclaje derivado (Q2):** sin columna `devuelta_at`; la ventana se deriva de `gestion_orden.created_at` + `causa_devolucion` de la última gestión `devuelta` vigente (`findDevueltasSla`). La migración es SOLO el `ALTER TYPE` del enum.
- **Conteos disjuntos:** `evaluadas` = ventana aún viva (no actúa, R14); `liberadas`/`escaladas`/`omitidas` disjuntos. `omitidas` cubre causa null (R28), fallo por orden (R26) y guarda de estado ya no vigente (R24/R25).
- **/novedades (Q7):** predicado re-anclado al estado real `estatus = devuelta`; se retiró el parámetro `cerrados` de `count/findDevueltasByTienda` y `ESTATUS_CERRADOS` de `NovedadesService` (código muerto tras el re-anclaje). `findCausasDevueltaVigentes` se conserva (causa/recencia, R9).
- **Cron reloj CRUDO:** a diferencia de `liberar-reprogramadas` (que pasa por `startOfDayCR`), el cron SLA pasa `now()` sin truncar (ventana rolling en ms, R13).
- **Choke point completo:** los 2 `origen_tipo` nuevos son los puntos #14/#15 del test de cobertura del choke point (49); NO entran en `ORIGEN_TIPOS_CON_GESTION` (su destino no es `devuelta`, no cuentan como intento).

## Archivos creados
- `db/migrations/20260721120000_orden_historial_origen_tipo_sla_devuelta/migration.sql` (T0, `ADD VALUE IF NOT EXISTS` x2)
- `db/migrations/20260721120000_orden_historial_origen_tipo_sla_devuelta/down.sql` (T0, recrea enum con los 13 previos + USING)
- `lib/interfaces/repositories/IDevolucionSlaRepository.ts` (T5)
- `lib/interfaces/services/IDevolucionSlaService.ts` (T5)
- `lib/repositories/DevolucionSlaRepository.ts` (T6/T7/T8)
- `lib/services/DevolucionSlaService.ts` (T9)
- `app/api/cron/procesar-devueltas-sla/route.ts` (T11)
- `tests/integration/db/orden-historial-origen-tipo-sla-devuelta-migration.test.ts` (T0)
- `tests/unit/repositories/devolucion-sla-repository.test.ts` (T6/T7/T8)
- `tests/unit/services/devolucion-sla-service.test.ts` (T9/T10)
- `tests/unit/services/devolucion-sla-dinero.test.ts` (T15 [💰])
- `tests/integration/actions/procesar-devueltas-sla-route.test.ts` (T11)

## Archivos modificados (producción)
- `db/schema.prisma` (T1, enum `OrdenHistorialOrigenTipo` +2 valores)
- `lib/types/orden-historial.ts` (T1, SEED +2 valores; doc de por qué NO en `ORIGEN_TIPOS_CON_GESTION`)
- `lib/services/MisAsignacionesService.ts` (T2/T3, elimina seguimiento + 2 deps)
- `lib/repositories/GestionOrdenRepository.ts` (T3, retira param `seguimiento` + bloque)
- `lib/interfaces/repositories/IGestionOrdenRepository.ts` (T3, firma sin `seguimiento`)
- `lib/actions/mis-asignaciones.ts` (T3, factory sin las 2 deps + imports)
- `lib/services/OrdenHistorialService.ts` (doc: contarIntentos alimenta ahora al cron SLA)
- `lib/repositories/OrdenRepository.ts` (T13, `novedadWhere` anclado a `devuelta`, sin `cerrados`)
- `lib/interfaces/repositories/IOrdenRepository.ts` (T13, firmas sin `cerrados`)
- `lib/services/NovedadesService.ts` (T14, sin `ESTATUS_CERRADOS`)
- `vercel.json` (T12, cron `0 * * * *`)

## Archivos modificados (tests invertidos, R30 — invertidos, NO aflojados)
- `tests/unit/services/mis-asignaciones-service.test.ts` (47 invertida: devolver → queda en `devuelta`, sin seguimiento; constructor 5 args)
- `tests/unit/services/mis-asignaciones-causa-devolucion.test.ts` (constructor 5 args; `seguimiento` ya no definido)
- `tests/unit/services/mis-asignaciones-orden-ruta.test.ts` (constructor 5 args)
- `tests/unit/repositories/gestion-orden-repository.test.ts` (seguimiento block invertido: UNA transición/append)
- `tests/unit/services/NovedadesService.test.ts` (89 invertida: sin `cerrados`)
- `tests/unit/repositories/orden-repository.novedades.test.ts` (89 invertida: predicado `estatus = devuelta`)
- `tests/unit/types/orden-historial-types.test.ts` (conjunto cerrado 13 → 15)
- `tests/unit/repositories/orden-historial-cobertura.test.ts` (choke point 13 → 15 puntos: #14/#15 del cron)
- `tests/integration/db/gestion-orden-anulacion-migration.test.ts` (set "añadidos después del 67" +2)
- `tests/integration/db/zonas-migration.test.ts` (exclusión de la migración apéndice de la 99)

## Mapa R → test
| R | Test |
| --- | --- |
| R1 | mis-asignaciones-service.test.ts «R1: devolver transiciona a devuelta… no seguimiento»; gestion-orden-repository.test.ts «R1/R29: devuelta → UN solo update/append» |
| R2 | gestion-orden-repository.test.ts «R1/R29» (append en_reparto→devuelta, origen_tipo gestion); orden-historial-service.test.ts (contarIntentos cuenta destino devuelta) |
| R3 | orden-historial-service.test.ts (contarIntentos derivado); devolucion-sla-service.test.ts (usa contarIntentos en not_found) |
| R4 | mis-asignaciones-causa-devolucion.test.ts (causa en GestionOrdenData); gestion-orden-repository.test.ts «R11: devuelta con causa» |
| R5 | devolucion-sla-repository.test.ts «R5: findDevueltasSla deriva causa/ancladaAt/mensajero» |
| R6 | devolucion-sla-service.test.ts (not_found 24h / wrong_* 5d rolling); procesar-devueltas-sla-route.test.ts (schedule `0 * * * *`) |
| R7 | orden-repository.novedades.test.ts «R7/R8 predicado estatus=devuelta»; NovedadesService.test.ts |
| R8 | orden-repository.novedades.test.ts «R8 (no doble conteo): sin gestiones.some ni notIn»; NovedadesService.test.ts «R8 mismo universo» |
| R9 | NovedadesService.test.ts «R10 causa al DTO» (findCausasDevueltaVigentes) |
| R10 | procesar-devueltas-sla-route.test.ts «R10: 401 sin/ mal secreto, sin construir service» |
| R11 | procesar-devueltas-sla-route.test.ts «R12/R11 sin PII» + «R11 error sin secreto» |
| R12 | procesar-devueltas-sla-route.test.ts «R12/R11: 200 con {evaluadas,liberadas,escaladas,omitidas}» |
| R13 | devolucion-sla-service.test.ts «R13 misma orden viva/vencida»; procesar-devueltas-sla-route.test.ts «R13 reloj crudo» |
| R14 | devolucion-sla-service.test.ts «R14 not_found viva → evaluada» |
| R15 | devolucion-sla-service.test.ts «R15 <umbral → reintento» (+ zona central/satélite); devolucion-sla-repository.test.ts «liberar» |
| R16 | devolucion-sla-service.test.ts «R16 >=umbral → escala» |
| R17 | devolucion-sla-service.test.ts «R17 wrong_number/wrong_address → rechazo directo, sin conteo» |
| R18 | devolucion-sla-repository.test.ts (append por choke point en liberar/escalar); orden-historial-cobertura.test.ts (#14/#15) |
| R19 | devolucion-sla-repository.test.ts (origen_tipo liberacion/escalado_devuelta_sla, actor null); migration + types test |
| R20 [💰] | devolucion-sla-repository.test.ts «R20/R22 gestión sintética rechazada»; devolucion-sla-dinero.test.ts (snapshot 56 cobra) |
| R21 [💰] | devolucion-sla-repository.test.ts «R21/R24/R25 2.ª corrida no crea 2.ª gestión»; devolucion-sla-dinero.test.ts (idempotencia = del repo) |
| R22 [💰] | devolucion-sla-repository.test.ts (mensajeroId de la gestión devuelta); devolucion-sla-service.test.ts «R22 atribución + motivo» |
| R23 [💰] | devolucion-sla-dinero.test.ts (STRING escala 2, Decimal, sin tarifa → 0.00); devolucion-sla-repository.test.ts (sin montoRecibido/ingreso coercionado) |
| R24 | devolucion-sla-repository.test.ts (liberar/escalar count 0 → false); devolucion-sla-service.test.ts «R24/R25» |
| R25 | devolucion-sla-repository.test.ts (updateMany guardado por estado); devolucion-sla-service.test.ts «R24/R25» |
| R26 | devolucion-sla-service.test.ts «R26 una orden que lanza no aborta» |
| R27 | devolucion-sla-service.test.ts «R27 catálogo incompleto → 0 + warn» |
| R28 | devolucion-sla-service.test.ts «R28 causa null → omitida»; devolucion-sla-repository.test.ts (row causa null sale) |
| R29 | mis-asignaciones-service.test.ts «R29 no deriva bodega»; devolucion-sla-service.test.ts (capacidad en el cron); orden-historial-cobertura.test.ts |
| R30 | suite 47 invertida (mis-asignaciones-service / gestion-orden-repository) + 89 invertida (NovedadesService / orden-repository.novedades) |
| migración | orden-historial-origen-tipo-sla-devuelta-migration.test.ts + ROUND-TRIP real (abajo) |

## Verificación medida
- **`pnpm typecheck`:** 0 errores (baseline previo también 0 → 0 nuevos).
- **`pnpm lint`:** 0 errores, 143 warnings — TODOS preexistentes en archivos NO tocados por la 99 (ninguno en archivos de la feature).
- **`pnpm test`:** 397 archivos / 3950 tests PASSED (baseline 392/3917 → +5 archivos, +33 tests de la 99). 0 fallos.
- **Round-trip real de la migración (localhost:5432, DB `ordenex`, no compartida):**
  - UP (`prisma migrate deploy`): enum con los 2 valores → assert-present OK.
  - DOWN (`pnpm db:rollback` = down.sql): enum recreado SIN los 2 valores → assert-absent OK.
  - UP de nuevo (`prisma migrate deploy`): enum con los 2 valores → assert-present OK; `migrate status` = "Database schema is up to date".
  - Sin tocar datos (ADD VALUE + recreación de enum con los mismos valores; ninguna fila cambia).

## Veredicto
Feature 99 implementada (T0–T15) con typecheck/lint limpios, suite completa verde (incl. tests invertidos de 47 y 89) y round-trip real de la migración up→down→up verificado; pendiente T17 (aprobación humana + `feature_list.json` → done, que NO toco).
