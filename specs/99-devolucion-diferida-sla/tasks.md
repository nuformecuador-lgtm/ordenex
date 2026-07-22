# Feature 99 — Tasks

> Checklist verificable. `[P]` = paralelizable con las tareas de su mismo bloque.
> Cada task fija su criterio de "hecho" y los `R<n>` que cubre. No se marca "hecho" sin que
> pasen `./init.sh` y la suite (docs/verification.md). Orden general: migración/enum →
> relocalización 47 → cron (repo→service→controller) → novedades → dinero (integración) →
> inversión de tests hermanos.

---

## Bloque 0 — Migración del enum `origen_tipo` (base de todo el cron)

- [ ] **T0** — Crear migración `db/migrations/<ts>_orden_historial_origen_tipo_sla_devuelta/`.
  - `migration.sql`: `ALTER TYPE "orden_historial_origen_tipo" ADD VALUE IF NOT EXISTS
    'liberacion_devuelta_sla';` y `... 'escalado_devuelta_sla';` (en su PROPIA migración, no en la
    que los usa).
  - `down.sql`: recrear el enum con los 13 valores previos (RENAME `_old` → `CREATE TYPE` →
    `ALTER TABLE orden_historial_estado ... USING (...::text::...)` → `DROP TYPE ..._old`), patrón
    `20260714160000_gestion_orden_anulacion/down.sql`.
  - _Depende de:_ —. _Cubre:_ R19 (base). _Done:_ `pnpm run db:migrate` aplica y
    `pnpm run db:rollback` revierte limpio; test de integración `tests/integration/db` verifica que
    el enum tiene los 2 valores nuevos.

- [ ] **T1 [P]** — Agregar `liberacion_devuelta_sla` y `escalado_devuelta_sla` a
  `ORDEN_HISTORIAL_ORIGEN_TIPO_SEED` (`lib/types/orden-historial.ts`). NO agregarlos a
  `ORIGEN_TIPOS_CON_GESTION` (documentar por qué: no cuentan como intento). _Depende de:_ T0.
  _Cubre:_ R19. _Done:_ el `satisfies` + `_EnsureExhaustive` compilan; `tsc` verde.

---

## Bloque 1 — Relocalizar la lógica de la feature 47 (R29)

- [ ] **T2** — En `MisAsignacionesService.gestionar`, eliminar el bloque `devuelta` que llama a
  `resolverSeguimientoDevuelta` y pasa `seguimiento`. La rama `devuelta` transiciona la orden a
  `devuelta` sin seguimiento. _Depende de:_ —. _Cubre:_ R1/R29.
  _Done:_ test (invertido) `mis-asignaciones-service`: devolver deja `orden.estatus = devuelta`.

- [ ] **T3** — Retirar `resolverSeguimientoDevuelta` y las deps del constructor que quedan sin uso
  en `MisAsignacionesService`; retirar el parámetro `seguimiento` y su bloque de
  `GestionOrdenRepository.crearGestionYTransicionar`. _Depende de:_ T2. _Cubre:_ R29.
  _Done:_ `tsc` verde sin dead code; `gestion-orden-repository` sin la rama de seguimiento.

- [ ] **T4** — Invertir la suite de la feature 47 (`mis-asignaciones-service.test.ts`,
  `mis-asignaciones-causa-devolucion.test.ts` y afines): las aserciones de transición inmediata
  pasan a "queda en `devuelta`"; las de reintento/escalado MIGRAN al test del cron (T10). No
  aflojar. _Depende de:_ T2. _Cubre:_ R30. _Done:_ suite verde con el sentido nuevo.

---

## Bloque 2 — Cron SLA (Repository → Service → Controller)

- [ ] **T5** — Interfaces `IDevolucionSlaService` / `IDevolucionSlaRepository`
  (`lib/interfaces/...`) con las firmas de design §4. _Depende de:_ —. _Cubre:_ R14-R25 (contrato).
  _Done:_ `tsc` verde.

- [ ] **T6** — `DevolucionSlaRepository.findDevueltasSla()` (`lib/repositories/`): órdenes en
  `devuelta` no borradas + su última gestión `devuelta` vigente (`take 1`, `orderBy createdAt
  desc`, select `id, mensajeroId, causaDevolucion, createdAt`), filtrando en memoria las sin
  gestión vigente. _Depende de:_ T5. _Cubre:_ R5. _Done:_ `devolucion-sla-repository` test:
  devuelve causa + `ancladaAt` de la gestión vigente; ignora órdenes sin gestión vigente.

- [ ] **T7** — `DevolucionSlaRepository.liberarDevueltaSla()` — `$transaction`: `updateMany`
  guardado por `estatusId = devuelta` + `deletedAt null`, `data` = destino + `mensajeroAsignadoId
  null` + `asignadoAt null`; `appendCambioEstado` (`origen_tipo = liberacion_devuelta_sla`, actor
  NULL) DENTRO de `if (count > 0)`; devuelve `count > 0`. _Depende de:_ T5, T1. _Cubre:_
  R15/R18/R19/R24/R25. _Done:_ test: libera y appendea; 2.ª corrida → count 0 → false, sin
  segundo append.

- [ ] **T8 [💰]** — `DevolucionSlaRepository.escalarDevueltaSla()` — `$transaction` (Option A):
  `updateMany` guardado por `estatusId = devuelta`; si count 0 → `false` (sin efectos); si count 1
  → `gestionOrden.create` sintética (`resultado: rechazada`, `mensajeroId` de la gestión devuelta,
  `cierreId: null`, motivo, sin evidencia/causa) + `appendCambioEstado` (`origen_tipo =
  escalado_devuelta_sla`, actor NULL, `gestionOrdenId` = sintética). _Depende de:_ T5, T1.
  _Cubre:_ R16/R17/R18/R19/R20/R21/R22/R23/R24/R25.
  _Done:_ test: escala + crea 1 gestión sintética `rechazada` del mensajero correcto; 2.ª corrida
  no crea 2.ª gestión (count 0); no toca `mensajeroAsignadoId`; aritmética sin `number`.

- [ ] **T9** — `DevolucionSlaService.ejecutar(now)` (`lib/services/`): resolver estatus una vez
  (catálogo incompleto → conteos 0 + warn); `findCentralZonaId`; iterar candidatas resiliente
  (try/catch → omitida); `venceVentana(causa, ancladaAt, now)` (24h / 5d rolling); ruteo not_found
  `contarIntentos >= umbral` → escalar / `<` → liberar; wrong_* → escalar directo; causa null →
  omitida; devolver `{ evaluadas, liberadas, escaladas, omitidas }`; warn agregado sin PII.
  _Depende de:_ T6, T7, T8. _Cubre:_ R6/R13/R14/R15/R16/R17/R26/R27/R28.
  _Done:_ ver T10.

- [ ] **T10** — Tests unit de `DevolucionSlaService` (dobles, sin DB, reloj fijo). Casos:
  not_found viva (<24h) no actúa (R14); not_found vencida `intentos<3` libera (R15); not_found
  vencida `intentos>=3` escala (R16); wrong_* vencida escala directo (R17); wrong_* viva (<5d) no
  actúa (R13); causa null omitida (R28); catálogo incompleto conteos 0 (R27); una orden que lanza
  no aborta la corrida (R26). Aquí aterrizan las aserciones migradas de la 47 (T4).
  _Depende de:_ T9. _Cubre:_ R13/R14/R15/R16/R17/R26/R27/R28.
  _Done:_ suite verde con nombres por comportamiento.

- [ ] **T11** — Controller `app/api/cron/procesar-devueltas-sla/route.ts` + deps inyectables
  (`getSecret`/`service`/`now`), clon de `liberar-reprogramadas`. 401 antes de efectos; 200
  conteos; `GET` exportado. _Depende de:_ T9. _Cubre:_ R10/R11/R12/R13.
  _Done:_ test `procesar-devueltas-sla-action`: sin secreto → 401 sin construir service; con
  secreto → 200 con conteos; reloj inyectado se pasa al service; nunca loguea secreto/PII.

- [ ] **T12 [P]** — Registrar el cron en `vercel.json`:
  `{ "path": "/api/cron/procesar-devueltas-sla", "schedule": "0 * * * *" }` (horario, Q3).
  _Depende de:_ T11. _Cubre:_ R6 (cadencia). _Done:_ JSON válido; schedule horario.

---

## Bloque 3 — /novedades reconciliado (R7-R9)

- [ ] **T13** — `OrdenRepository.novedadWhere` → anclar a `{ tiendaId, deletedAt: null, estatus: {
  value: "devuelta" } }`; retirar el `gestiones.some` del filtro y el uso de `ESTATUS_CERRADOS` en
  el predicado (mantener `findCausasDevueltaVigentes` para causa/recencia). _Depende de:_ —.
  _Cubre:_ R7/R8/R9. _Done:_ `orden-repository.novedades` (invertido): solo cuentan órdenes en
  `devuelta`; una liberada a `en_bodega` NO aparece.

- [ ] **T14** — Ajustar `NovedadesService` si `ESTATUS_CERRADOS` queda sin uso; conservar la causa
  (R9). Invertir `NovedadesService.test.ts` al nuevo predicado (no aflojar). _Depende de:_ T13.
  _Cubre:_ R7/R8/R9. _Done:_ suite 89 verde con el sentido nuevo.

---

## Bloque 4 — Dinero: verificación de consistencia (integración) **[💰]**

- [ ] **T15 [💰]** — Test de integración/servicio que cierra el círculo del dinero: una orden
  escalada por el cron (gestión sintética `rechazada`, `cierre_id null`) es tomada por
  `CierreDiaService.solicitarCierre`/`crearCierre` del mensajero atribuido y snapshotea
  `ingreso_bodega_rechazo = cobroRechazado` (y suma en `total_ingreso_bodega_rechazos`), IDÉNTICO a
  un rechazo directo; una gestión `devuelta` no escalada sigue en 0.00. _Depende de:_ T8.
  _Cubre:_ R20/R22/R23.
  _Done:_ el snapshot cobra el rechazo del cron exactamente una vez, sin descuadre; verificado con
  `derivarIngresoBodega`/`ingresoBodegaPorResultado` reales (sin código monetario nuevo).

---

## Bloque 5 — Cierre de la feature

- [ ] **T16** — Actualizar `progress/impl_99.md` con el mapa R→test completo (trazabilidad,
  CLAUDE.md #4). _Depende de:_ T0-T15. _Done:_ todo `R<n>` tiene test citado; el reviewer puede
  cruzarlo.

- [ ] **T17** — `./init.sh` verde + suite completa verde; `feature_list.json` a `done` (tras
  aprobación humana). _Depende de:_ T16. _Done:_ CI/Vercel build verde.

---

## Dependencias (resumen)
- T0 → T1 → (T7, T8)
- T2 → (T3, T4)
- T5 → (T6, T7, T8) → T9 → (T10, T11) ; T11 → T12
- T13 → T14
- T8 → T15
- todo → T16 → T17

## Notas de gate
Antes de implementar, resolver Q1-Q8 (requirements.md). En especial **Q1 [💰]** (Option A) y **Q7**
(predicado de /novedades) cambian el alcance de T8/T13-T14 si el humano decide distinto.
