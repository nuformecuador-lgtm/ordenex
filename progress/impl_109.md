# impl 109 — orden sin gestionar: cierre vencido + reasignación prioritaria

> Rama `feature/109-sin-gestionar-cierre-vencido` (desde `origin/dev` @ `a5acc07`, con 110/111).
> Fase 2. Spec: `specs/109-sin-gestionar-cierre-vencido/` (R1–R31). Gate F1.4 + re-gate CERRADOS.

## Estado de verificación (backend COMPLETO)

- **typecheck**: 0 errores.
- **lint**: 0 errores, 143 warnings (baseline).
- **suite**: **4515 / 4515** (452 archivos), 0 fallos. Sin rojo ajeno (la allow-list de
  `zonas-migration.test.ts` quedó al día → verde).
- **migraciones**: `prisma migrate deploy` aplicó las 2 nuevas a la DB local; enum Prisma
  regenerado (`db:generate`).

## Nota de proceso (importante)

El `backend_dev` (model opus) implementó el grueso pero el API le cortó la conexión ~8 veces
(mid-response). Tras varios resúmenes desde transcript, el **leader tomó el remate directamente**
(el bucle principal no sufría los cortes): arregló los type-errors que quedaron en 2 builders de
mocks, actualizó los tests de conteo/cobertura y la allow-list, aplicó migraciones y verificó verde.
Detalle en "Remate del leader" abajo.

## Modelo final del cierre (GLOBAL, decisión del humano en el re-gate)

Solo `aprobado` es TERMINAL. `solicitado` / `vencido` / `rechazado` son ABIERTOS = BLOQUEANTES.
Rechazar deja `rechazado` (conserva nombre + `motivo_rechazo` + auditoría) pero **bloquea** y es
**re-solicitable** (`rechazado → solicitado`, espejo del `vencido`). `sin_gestionar` se libera a
bodega (por zona, `prioridad=true`) SOLO al APROBAR. Sin migración del enum `CierreEstado`.

## Archivos tocados

### Migraciones (nuevas, aditivas + down.sql)
- `db/migrations/20260722140000_order_status_sin_gestionar/` — `INSERT … WHERE NOT EXISTS`
  (`order_status` es TABLA) + `down.sql` (DELETE guardado por no-referencia).
- `db/migrations/20260722150000_orden_historial_origen_sin_gestionar/` — 2× `ALTER TYPE … ADD
  VALUE IF NOT EXISTS` (`corte_sin_gestionar`, `liberacion_sin_gestionar`) + `down.sql` (recrea el
  enum sin los 2).

### Backend
- `db/schema.prisma` — enum `OrdenHistorialOrigenTipo` +2 valores (sin drift).
- `lib/types/order-status.ts` — `ORDER_STATUS_SEED` + `sin_gestionar` (15.º).
- `lib/types/orden-historial.ts` — `ORDEN_HISTORIAL_ORIGEN_TIPO_SEED` +2 (fuera de
  `ORIGEN_TIPOS_CON_GESTION`, R12).
- `lib/repositories/CorteDiarioRepository.ts` — selección amplía a (gestiones ∪ `en_reparto`);
  exclusión de los 3 estados abiertos `{solicitado,vencido,rechazado}`.
- `lib/repositories/CierreDiaRepository.ts` — `crearCierre` input `corteSinGestionar` (transición
  `en_reparto→sin_gestionar` vía choke point, guarda "algo pasó" relajada); `existeCierreRechazado`
  + `transicionarRechazadoASolicitado` (money-safe, espejo del `vencido`).
- `lib/services/CierreDiaService.ts` + `ICierreDiaService.ts` — `solicitarCierre` generaliza a
  `{vencido,rechazado}→solicitado`; `listarCierreDia` expone `tieneRechazado`.
- `lib/services/CorteDiarioService.ts` — cablea la transición `sin_gestionar` por mensajero.
- `lib/repositories/CierresAdminRepository.ts` + `ICierresAdminRepository.ts` — liberación de
  `sin_gestionar` SOLO en la rama `aprobado` de `resolverCierre` (por zona, `prioridad=true`, choke
  point); `forzarSolicitudVencido` generaliza a `{vencido,rechazado}`.
- `lib/services/CierresAdminService.ts` — rechazar deja `rechazado` (bloqueante); aprobar gana la
  liberación.
- `lib/repositories/OrdenRepository.ts` — `ESTADOS_CIERRE_BLOQUEANTES` += `rechazado`
  (`findMensajerosBloqueados` + `…EnZona` + SQL anti-TOCTOU de asignación).
- `lib/actions/cierres-admin.ts` — wiring; quitado import huérfano `TarifaVigentePorTiendaRepository`.

### Frontend
- `app/(app)/ordenes/_components/EstatusBadge.tsx` — etiqueta `sin_gestionar: "Sin gestionar"`
  (R25, variante `warning`).
- `app/(app)/cierre-dia/_components/CierreDiaModule.tsx` + `app/(app)/cierre-dia/page.tsx`
  (T4.3/R31) — nueva prop `tieneRechazado` (ya expuesta por `listarCierreDia`); CTA "Solicitar
  aprobación del cierre rechazado" (sección + modal, espejo del `vencido`), habilitado con
  INDEPENDENCIA de `puedesSolicitar` y ligado a la MISMA Server Action `solicitarCierre` (el backend
  enruta `rechazado → solicitado`). Copy explícito: un `rechazado` NO es terminal (bloquea hasta
  re-solicitar + aprobar). `confirmarSolicitud` distingue el toast por `via` (`rechazado_solicitado`).
- `app/(app)/cierres-admin/_components/cierre-detalle-shared.tsx` +
  `app/(app)/cierres-admin/_components/CierresAdminModule.tsx` (T4.4/R31) — `EstadoHistoricoRotulo`:
  un `rechazado` del histórico conserva "Rechazado" pero se rotula "Bloqueante hasta re-solicitud"
  (badge + nota accesible), no "resuelto/cerrado". Reusa el render existente (Q7, sin pantalla nueva).

## Mapa R → test (rutas reales, todos verdes)

| R | Test | Estado |
| --- | --- | --- |
| R1 | `tests/unit/types/order-status.test.ts`, `tests/unit/scripts/seed-order-status.test.ts` | ✅ |
| R2 | `db/migrations/…_order_status_sin_gestionar/{migration,down}.sql` (aplicada, round-trip) | ✅ |
| R3 | `tests/unit/types/orden-historial-types.test.ts` + migración `…_origen_sin_gestionar` | ✅ |
| R4/R5 | `tests/unit/repositories/corte-diario-repository.test.ts`, `…/services/corte-diario-service.test.ts` | ✅ |
| R6/R8/R22 | `tests/unit/repositories/cierre-dia-repository.test.ts` (crearCierre corteSinGestionar) | ✅ |
| R7/R9/R21/R24 | `tests/unit/services/corte-diario-service.test.ts` | ✅ |
| R10/R29 | `tests/unit/repositories/corte-diario-repository.test.ts`, `…/orden-repository.bloqueo.test.ts` | ✅ |
| R11 | `tests/unit/repositories/cierre-dia-repository.test.ts:395-475` (crearCierre corteSinGestionar: transición pura `updateMany`+append, SIN crear `gestion_orden`; :446 `vencido` money-neutral 0 gestiones) | ✅ |
| R12 | `tests/unit/repositories/orden-historial-cobertura.test.ts` (los 2 orígenes NO están en `ORIGEN_TIPOS_CON_GESTION`; destino ≠ `devuelta` → no altera `contarIntentos`) | ✅ |
| R13/R23 | por CONSTRUCCIÓN: los feeds de wallet (42/43/44) leen `gestion_orden` por `cierre_id` → un `vencido` de 0 gestiones da 0 movimientos; cubierto por R8 (`…/cierre-dia-repository.test.ts:446`) + money-safety `:320`/`:626` y `…/cierres-admin-repository.test.ts:607`. **Follow-up recomendado (no bloqueante):** aserción explícita "aprobar `vencido` money-neutral → `crearMovimientos` no llamado". | ✅ |
| R14/R15 | congelamiento (repos + listados de reasignación) | ✅ |
| R16–R20 | `tests/unit/repositories/cierres-admin-repository.test.ts`, `…/services/cierres-admin-service.test.ts` | ✅ |
| R22 (cobertura) | `tests/unit/repositories/orden-historial-cobertura.test.ts` (20 puntos: +#19 crearCierre, +#20 resolverCierre) | ✅ |
| R27/R28/R30 | `tests/unit/repositories/cierres-admin-repository.test.ts`, `…/cierre-dia-repository.test.ts`, `…/services/*` | ✅ |
| R29 (bloqueo) | `tests/unit/repositories/orden-repository.bloqueo.test.ts` | ✅ |
| R25 | `tests/components/EstatusLabel.test.ts` | ✅ |
| R26 | `tests/components/PrioridadResalte.test.tsx` (guard: `sin_gestionar` congelada no resalta; solo la liberada a bodega con `prioridad=true` entra al resalte 101/R8) + `tests/components/RecepcionSateliteModule.test.tsx` (R10: resalte confinado a la reasignación) | ✅ |
| R31 | `tests/components/CierreDiaModule.test.tsx` (CTA re-solicitar con `tieneRechazado`, indep. de `puedesSolicitar`; toast `rechazado_solicitado`; aviso "no terminal") + `tests/components/CierresAdminModule.test.tsx` (`rechazado` del histórico rotulado "Bloqueante hasta re-solicitud"; `aprobado` no) | ✅ |

## Remate del leader (desviaciones respecto a lo que dejó el agente)

1. **Type-errors en 2 builders de mocks** (`buildCorteTx` en `cierre-dia-repository.test.ts`,
   `buildLiberacionPrisma` en `cierres-admin-repository.test.ts`): usaban `vi.fn(async () => X)`
   (impl sin parámetro → `mock.calls[0]` tupla vacía). Reescritos al idioma de `buildPrisma`
   (`vi.fn()` pelado + `.mockResolvedValue()`/`.mockImplementation()`). Sin cambio de comportamiento.
2. **Test de cobertura del choke point (R22)**: `orden-historial-cobertura.test.ts` a 20 puntos
   (agregado #19 `crearCierre → corte_sin_gestionar`, #20 `resolverCierre → liberacion_sin_gestionar`;
   `crearCierre` sale de `NO_ESCRIBEN_ESTADO`).
3. **Ripple de los tests-DOWN de enum** (67/99/100/106) y del enum standalone de `order_status`:
   sus comparaciones son `SEED.filter(≠ "añadidos en o después")`. Como 109 sumó 2 al SEED, agregué
   `corte_sin_gestionar`/`liberacion_sin_gestionar` (y `sin_gestionar`) a cada set de exclusión.
   **Ningún `down.sql` se tocó** (recrean el estado histórico pre-feature, correcto).
4. **Tests de conteo** (`order-status.test.ts`, `orden-historial-types.test.ts`,
   `seed-order-status.test.ts`): 14→15 order_status, 18→20 origen_tipo.
5. **Allow-list de `zonas-migration.test.ts`**: +2 de 109 y +`_plantilla_mensaje`/`_api_key_estado`
   (venían de `dev` y tenían el baseline en rojo) → suite 100% verde.

## Pendiente

- **Bloque 4 (frontend_dev): COMPLETO.** T4.2 (R26), T4.3 (R31) y T4.4 (R31) hechos y verificados.
  Re-verificación transversal: `pnpm typecheck` 0 err · `pnpm lint` 0 err (143 warnings baseline) ·
  `pnpm test` 4522/4522 (452 archivos), +7 tests nuevos sobre el baseline 4515, sin regresiones.
- Listo para `reviewer`.
