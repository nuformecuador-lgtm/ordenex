# Feature 109 — Orden sin gestionar: cierre vencido + reasignación prioritaria · tasks.md

> Checklist discreta y verificable. `[B]` = backend_dev, `[F]` = frontend_dev. `[P]` =
> paralelizable (sin conflicto de archivos con las tareas del mismo bloque). Cada task trae su
> criterio de "hecho". La tabla de trazabilidad `R<n> → test` cierra el archivo (regla del arnés:
> todo `R<n>` mapea a un test).
>
> **Gate F1.4 + re-gate CERRADOS (2026-07-22). NO quedan decisiones abiertas.** Modelo FINAL del
> cierre (GLOBAL): solo `aprobado` es TERMINAL; `solicitado`/`vencido`/`rechazado` son ABIERTOS =
> BLOQUEANTES. Rechazar deja `rechazado` (conserva nombre + `motivo_rechazo` + auditoría) pero
> BLOQUEA y es RE-SOLICITABLE (`rechazado → solicitado`, espejo del `vencido`). `sin_gestionar`
> libera SOLO al APROBAR. SIN migración del enum `CierreEstado`.

---

## Bloque 0 — Migraciones y fuentes únicas de verdad (fundación)

- [ ] **T0.1 [B]** Añadir `"sin_gestionar"` a `ORDER_STATUS_SEED` (`lib/types/order-status.ts`).
  _Hecho:_ el seed lista el valor; `pnpm typecheck` (romperá `ORDER_STATUS_LABELS` hasta T4.1). (R1)
- [ ] **T0.2 [B]** Migración `db/migrations/<ts>_order_status_sin_gestionar/` con `migration.sql`
  (`INSERT … WHERE NOT EXISTS`) y `down.sql` (`DELETE` guardado por no-referencia en `orden` /
  `orden_historial_estado`). _Hecho:_ round-trip up→down→up verde; RLS/columnas intactas. (R1/R2)
- [ ] **T0.3 [B] [P]** Añadir `"corte_sin_gestionar"` y `"liberacion_sin_gestionar"` a
  `ORDEN_HISTORIAL_ORIGEN_TIPO_SEED` (`lib/types/orden-historial.ts`); NO a `ORIGEN_TIPOS_CON_GESTION`.
  _Hecho:_ `_EnsureExhaustive` compila; typecheck verde. (R3)
- [ ] **T0.4 [B]** Migración `db/migrations/<ts>_orden_historial_origen_sin_gestionar/` con
  `migration.sql` (2× `ALTER TYPE … ADD VALUE IF NOT EXISTS`) y `down.sql` (recrea el enum con los
  18 valores previos; precondición sin filas nuevas). _Hecho:_ round-trip verde. (R3)

> Nota: NO hay migración del enum `CierreEstado` (el modelo reusa `solicitado/aprobado/rechazado/
> vencido`); `cierre-estado-*-migration` queda intacta.

## Bloque 1 — Corte diario extendido (depende de Bloque 0)

- [ ] **T1.1 [B]** Ampliar `CorteDiarioRepository.findMensajerosConActividadSinCierre`: unión de
  (a) gestiones `cierre_id IS NULL AND anulada_at IS NULL` y (b) órdenes `en_reparto` no borradas;
  EXCLUIR mensajeros con `cierre_dia estado IN ('solicitado','vencido','rechazado')` (los 3
  abiertos). _Hecho:_ tests de selección (gestiones sola, en_reparto sola, ambas, excluidos por cada
  estado abierto) verdes. (R4/R7/R10/R29)
- [ ] **T1.2 [B]** Extender `CierreDiaRepository.crearCierre` (input opcional del corte): en la
  misma tx, `updateMany` guardado `en_reparto → sin_gestionar` (conserva `mensajero_asignado_id`) +
  `appendCambioEstado` (actor null, `corte_sin_gestionar`) solo de las afectadas; relajar la guarda
  "algo pasó" a `sinGestionar>0 || gestiones>0` (0/0 → `rollback → null`). `solicitarCierre` (37) no
  se afecta (no pasa el input). _Hecho:_ tests de transición, append, y creación con 0 gestiones
  verdes. (R6/R8/R22)
- [ ] **T1.3 [B]** Cablear en `CorteDiarioService.ejecutarCorte` la transición `sin_gestionar` por
  mensajero (pasar estatus ids de `en_reparto`/`sin_gestionar`); mantener idempotencia y manejo de
  errores/no-PII. _Hecho:_ tests de servicio (idempotencia 2.ª corrida, invariante, sin secreto en
  log) verdes. (R5/R9/R21/R24)

## Bloque 2 — Money-neutralidad y congelamiento (depende de Bloque 1)

- [ ] **T2.1 [B] [P]** Test: orden `sin_gestionar` no tiene `gestion_orden`, no genera pago/cobro;
  `contarIntentos` no la cuenta (destino ≠ `devuelta`). _Hecho:_ tests verdes. (R11/R12)
- [ ] **T2.2 [B] [P]** Test integración: aprobar un `vencido` money-neutral (0 gestiones) → 0
  movimientos en wallet 42/43/44; snapshots inmutables. _Hecho:_ verde. (R13/R23)
- [ ] **T2.3 [B/F] [P]** Test: `sin_gestionar` ausente de los listados de reasignación
  (`en_bodega` de `/ordenes`, "Recibidas" de `/recepcion-satelite`); no reasignable mientras el
  cierre no se apruebe. _Hecho:_ verde. (R14/R15)

## Bloque 3 — Liberación a bodega SOLO al APROBAR (depende de Bloque 0/1)

- [ ] **T3.1 [B]** En `CierresAdminRepository.resolverCierre`, DENTRO de la rama
  `if (res.count === 1 && nuevoEstado === 'aprobado')` (junto a los wallets): cargar `sin_gestionar`
  del `mensajeroId` del cierre, derivar destino por `resolverDestinoCierre(orden.zonaId,
  centralZonaId)`, `updateMany` guardado por `estatus_id = sin_gestionar` con destino +
  `mensajero_asignado_id = null` + `asignado_at = null` + `prioridad = true`, y `appendCambioEstado`
  (actor = `resueltoPor`, `liberacion_sin_gestionar`), en la MISMA tx. Inyectar `findCentralZonaId` /
  estatus ids. _Hecho:_ tests de liberación (central + satélite, prioridad, actor/origen; SOLO al
  aprobar; rechazo NO libera) verdes. (R14/R16/R17/R18/R19/R22)
- [ ] **T3.2 [B]** Test: cierre NORMAL (sin `sin_gestionar`) aprobado → liberación no-op; flujo de
  wallets sin cambios (regresión 38/42/43/44 verde). _Hecho:_ verde. (R20)

## Bloque 3.bis — `rechazado` bloqueante + re-solicitable (modelo GLOBAL) (depende de Bloque 0/1)

- [ ] **T3b.1 [B]** Conjunto bloqueante → `{solicitado,vencido,rechazado}`: en
  `lib/repositories/OrdenRepository.ts` añadir `"rechazado"` a `ESTADOS_CIERRE_BLOQUEANTES` (:113,
  cubre `findMensajerosBloqueados` :1740 y `…EnZona` :1762) y `'rechazado'` al SQL crudo
  anti-TOCTOU de asignación (:1717). _Hecho:_ tests de bloqueo por `rechazado` (por-mensajero y por
  zona) verdes; el SQL de asignación bloquea un `rechazado`. (R29)
- [ ] **T3b.2 [B]** `CierreDiaRepository`: añadir `existeCierreRechazado` +
  `transicionarRechazadoASolicitado` (gemelos EXACTOS del `vencido`, :230/:242; o generalizados a
  `{vencido,rechazado}` → `existeCierreReabrible`/`transicionarAbiertoASolicitado`, `updateMany
  WHERE estado IN ('vencido','rechazado') SET estado='solicitado'`, count 0 → false). Solo cambia
  `estado` (money-safe). _Hecho:_ tests repo (guardado, count 0 → false, sin tocar snapshot) verdes.
  (R28)
- [ ] **T3b.3 [B]** `CierreDiaService.solicitarCierre`: generalizar la rama del `vencido` a "existe
  cierre reabrible (`vencido`|`rechazado`) → transiciónalo a `solicitado`" (misma Server Action
  `lib/actions/cierre-dia.ts`, sin ruta nueva; sin precondición de pendientes, anti-deadlock);
  `listarCierreDia` expone `tieneRechazado` (gemelo de `tieneVencido`). _Hecho:_ tests de servicio
  (solicitar desde `rechazado`, `via` opcional, `tieneRechazado`) verdes. (R28/R31-datos)
- [ ] **T3b.4 [B]** `CierresAdminRepository.forzarSolicitudVencido` (:439): generalizar la guarda a
  `estado IN ('vencido','rechazado')` (válvula del admin para el `rechazado` abandonado). _Hecho:_
  tests (destrabar un `rechazado` de su alcance → `solicitado`; fuera de alcance/carrera → sin
  efecto) verdes. (R28)
- [ ] **T3b.5 [B]** AJUSTAR tests existentes de 38/111/41 al modelo global (no aflojar): reject sigue
  devolviendo `rechazado` (escritura SIN cambio) pero ahora BLOQUEA; ver Bloque de "tests que
  cambian" abajo. Invariante generalizado: ninguna secuencia (corte/solicitar/válvula/aprobar/
  rechazar/re-solicitar) deja 2 cierres abiertos coexistir. _Hecho:_ suite 38/111/41 verde.
  (R21/R27/R30)

## Bloque 4 — Frontend (etiqueta, no-fuga, cierre re-solicitable) (depende de T0.1 / Bloque 3.bis)

- [ ] **T4.1 [F]** Añadir `sin_gestionar: "Sin gestionar"` (+ variante de color) a
  `ORDER_STATUS_LABELS` (`EstatusBadge`); `estatusLabel` y la timeline (49) la muestran legible.
  _Hecho:_ typecheck verde (Record completo); test de componente. (R25)
- [ ] **T4.2 [F] [P]** Test: `sin_gestionar` no resalta/reordena fuera de la reasignación de bodega
  (110/R10). _Hecho:_ verde. (R26)
- [ ] **T4.3 [F]** `CierreDiaModule` (mensajero): generalizar el CTA "Solicitar aprobación" del
  `vencido` (111/R13) para que aparezca también con la prop `tieneRechazado` (mismo botón → misma
  Server Action `solicitarCierre`); el aviso comunica que `rechazado` NO es terminal (bloquea hasta
  re-solicitar+aprobar). _Hecho:_ test de componente (CTA con `tieneRechazado`) verde. (R31)
- [ ] **T4.4 [F] [P]** `/cierres-admin` (`CierresAdminModule`): rotular un `rechazado` del histórico
  como "bloqueante hasta re-solicitud" (no "resuelto/cerrado"); reusa el render existente (Q7).
  _Hecho:_ test de componente verde. (R31)

## Bloque 5 — Verificación transversal

- [ ] **T5.1 [B]** `pnpm typecheck` 0 errores, `pnpm lint` 0 errores (warnings baseline),
  `pnpm test` verde salvo el rojo AJENO conocido (`zonas-migration.test.ts` allow-list). Añadir las 2
  migraciones nuevas a esa allow-list si aplica. _Hecho:_ evidencia en `progress/impl_109.md`.
- [ ] **T5.2 [B]** Round-trip real de AMBAS migraciones (`db:rollback` → `migrate deploy`), evidencia
  en la bitácora. _Hecho:_ `migrate status` up-to-date.
- [ ] **T5.3 [B]** Bitácora `progress/impl_109.md` con el mapa `R<n> → test` reproducido con rutas
  reales y desviaciones. _Hecho:_ reviewer puede trazar cada `R<n>`.

---

## Tests EXISTENTES que cambian (38/111/41) — AJUSTAR, no aflojar

- `tests/unit/repositories/orden-repository.bloqueo.test.ts` (41) — **de "desbloqueo al rechazar" a
  "bloqueo"**: un `rechazado` ahora SÍ bloquea (por-mensajero + por zona + SQL anti-TOCTOU incluye
  `'rechazado'`). (R29)
- `tests/unit/repositories/corte-diario-repository.test.ts` — la exclusión pasa a los 3 estados
  abiertos; un mensajero con `rechazado` no recibe un 2.º cierre. (R10/R29)
- `tests/unit/repositories/cierre-dia-repository.test.ts` / `tests/unit/services/cierre-dia-service.test.ts`
  (111) — **NUEVO** camino `rechazado → solicitado` (gemelo del `vencido`); regresión del `vencido`
  verde. (R28)
- `tests/unit/repositories/cierres-admin-repository.test.ts` / `tests/unit/services/cierres-admin-service.test.ts` —
  reject conserva `estado:'rechazado'` (escritura SIN cambio); aprobar gana la liberación de
  `sin_gestionar`; `forzarSolicitudVencido` acepta `rechazado`. (R16/R28/R30)
- `tests/integration/actions/cierres-admin-action.test.ts` — el `rechazar` sigue `rechazado`; se
  añade que el cierre queda bloqueante/re-solicitable. (R27)
- `tests/components/CierresAdminModule.test.tsx` / `tests/components/CierresAdminPage.test.tsx` —
  `rechazado` rotulado "bloqueante hasta re-solicitud". (R31)
- `tests/components/CierreDiaModule.test.tsx` (111/R13) — el CTA re-solicitar aparece con
  `tieneRechazado`. (R31)
- `e2e/cierres-admin.spec.ts` / `e2e/cierres-admin-rechazos-sla.spec.ts` (diferidos) — rechazar ya
  NO cierra el ciclo: mensajero re-solicita → admin aprueba. (R27/R28)
- **NO cambian:** `tests/integration/db/cierre-estado-vencido-migration.test.ts` (enum `CierreEstado`
  intacto).

---

## Trazabilidad `R<n> → test` (archivo de test esperado)

| R | Test esperado |
| --- | --- |
| R1 | `tests/unit/types/order-status.test.ts` (SEED incluye `sin_gestionar`) |
| R2 | `tests/integration/db/order-status-sin-gestionar-migration.test.ts` (up/down round-trip, RLS/columnas intactas) |
| R3 | `tests/integration/db/orden-historial-origen-sin-gestionar-migration.test.ts` (2 ADD VALUE + down recrea enum) + `tests/unit/types/orden-historial-types.test.ts` |
| R4 | `tests/unit/repositories/corte-diario-repository.test.ts` (selección incluye `en_reparto`) |
| R5 | `tests/unit/services/corte-diario-service.test.ts` (`en_espera_aceptacion` NO se transiciona) |
| R6 | `tests/unit/repositories/cierre-dia-repository.test.ts` (transición vía append; actor null; `corte_sin_gestionar`) |
| R7 | `tests/unit/services/corte-diario-service.test.ts` (mensajero con `sin_gestionar` queda con `vencido`) |
| R8 | `tests/unit/repositories/cierre-dia-repository.test.ts` (0 gestiones + `en_reparto` → crea `vencido`, no `null`) |
| R9 | `tests/integration/actions/corte-diario-route.test.ts` (2.ª corrida idempotente, sin duplicar) |
| R10 | `tests/unit/repositories/corte-diario-repository.test.ts` (excluye `estado IN ('solicitado','vencido','rechazado')`) |
| R11 | `tests/integration/db/sin-gestionar-money-neutral.test.ts` (sin `gestion_orden`/pago/cobro) |
| R12 | `tests/unit/services/orden-historial-service.test.ts` (`contarIntentos` ignora `sin_gestionar`) |
| R13 | `tests/integration/db/sin-gestionar-money-neutral.test.ts` (aprobar money-neutral → 0 movimientos wallet) |
| R14 | `tests/unit/repositories/cierres-admin-repository.test.ts` (frozen hasta APROBAR; rechazo no libera) |
| R15 | `tests/unit/repositories/orden-repository.test.ts` + `tests/components/RecepcionSateliteModule.test.tsx` (ausente de reasignación) |
| R16 | `tests/unit/repositories/cierres-admin-repository.test.ts` (APROBAR → libera a `en_bodega`/`en_bodega_satelite` por zona, sin mensajero, misma tx) |
| R17 | `tests/unit/repositories/cierres-admin-repository.test.ts` (`prioridad: true` en el mismo `data`) |
| R18 | `tests/unit/repositories/cierres-admin-repository.test.ts` (append actor=admin, `liberacion_sin_gestionar`) |
| R19 | `tests/unit/repositories/cierres-admin-repository.test.ts` (liberación SOLO en rama `aprobado`; guarda `estatus_id = sin_gestionar`; count 0 → no-op) |
| R20 | `tests/unit/services/cierres-admin-service.test.ts` (cierre normal aprobado → liberación no-op; wallets sin cambio) |
| R21 | `tests/integration/db/sin-gestionar-invariante.test.ts` (nunca 2 cierres abiertos coexistir) |
| R22 | `tests/unit/repositories/orden-historial-cobertura.test.ts` (las 2 transiciones pasan por el choke point) |
| R23 | `tests/integration/db/sin-gestionar-money-neutral.test.ts` (snapshots inmutables) |
| R24 | `tests/integration/actions/corte-diario-route.test.ts` (error sin secreto/PII) |
| R25 | `tests/components/EstatusBadge.test.tsx` (`estatusLabel('sin_gestionar')` legible) |
| R26 | `tests/components/RecepcionSateliteModule.test.tsx` / `tests/components/PrioridadResalte.test.ts` (no resalta fuera de reasignación) |
| R27 | `tests/unit/repositories/cierres-admin-repository.test.ts` + `tests/unit/services/cierres-admin-service.test.ts` (rechazar → `rechazado`, mensajero SIGUE bloqueado, `sin_gestionar` no liberadas) + `tests/unit/repositories/orden-repository.bloqueo.test.ts` (rechazado bloquea) |
| R28 | `tests/unit/repositories/cierre-dia-repository.test.ts` + `tests/unit/services/cierre-dia-service.test.ts` (`rechazado → solicitado` money-safe, guardado, count 0 → conflict) + `tests/unit/repositories/cierres-admin-repository.test.ts` (`forzarSolicitud` acepta `rechazado`) |
| R29 | `tests/unit/repositories/orden-repository.bloqueo.test.ts` (`ESTADOS_CIERRE_BLOQUEANTES` + SQL anti-TOCTOU = `{solicitado,vencido,rechazado}`) + `tests/unit/repositories/corte-diario-repository.test.ts` (exclusión incluye `rechazado`) |
| R30 | `tests/integration/db/sin-gestionar-invariante.test.ts` (ninguna secuencia deja 2 cierres abiertos; transiciones 1→1) |
| R31 | `tests/components/CierreDiaModule.test.tsx` (CTA re-solicitar con `tieneRechazado`) + `tests/components/CierresAdminModule.test.tsx` (`rechazado` rotulado bloqueante) |

> Nota: varios tests AMPLÍAN archivos existentes (`corte-diario-*`, `cierre-dia-*`, `cierres-admin-*`,
> `orden-repository.bloqueo`, `CierreDiaModule`, `CierresAdminModule`); los nuevos
> (`sin-gestionar-money-neutral`, `sin-gestionar-invariante`, `*-migration`) se crean. El implementer
> confirma rutas reales en `progress/impl_109.md`.
