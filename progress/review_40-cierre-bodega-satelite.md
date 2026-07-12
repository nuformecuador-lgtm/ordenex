# Review — feature 40 (cierre de bodega satélite → central) · APROBADO (0 bloqueantes)

Fecha: 2026-07-12 · Reviewer (subagente) · Rama `feature/40-cierre-bodega-satelite` @ `105689d` (sobre `origin/dev` e8a9df1)

## Veredicto: APROBADO — 0 bloqueantes

## Verificación ejecutable (corrida por el reviewer)
- `./init.sh` → VERDE (exit 0): **202 files / 1797 tests passing**; lint 0 (135 warnings preexistentes en `.claude/skills/**`); typecheck OK; "todas las migraciones tienen down.sql"; `== init OK ==`. Sin flaky.
- **Round-trip migración `20260712120000_cierre_bodega`:** `db:rollback` (down) limpio → `migrate deploy` (up) `All migrations successfully applied` (R25).
- **DB viva:** `relrowsecurity=true` y **0 policies** en `cierre_bodega` (R24); índice único parcial `cierre_bodega_zona_solicitado_uq` presente (R8); columna `cierre_dia.cierre_bodega_id` presente (R9/R21).

## Decisiones F1.4 — todas respetadas
(a) tabla `CierreBodega` + FK nullable espejo 37; (b) reusa `CierreEstado`; (c) solo `aprobado`+`cierre_bodega_id IS NULL`, rechazados excluidos; (d) precondición: bloquea con `cierre_dia` `solicitado` pendiente; (e) snapshot agregado `Prisma.Decimal`/string, sin `parseFloat`, cuadra al centavo; (f) DTO NO expone pago al mensajero (`Object.keys` == 5 claves, test); (g) índice único parcial + `P2002→conflict`; (h) maestro ve cola+histórico; (i) motivo obligatorio `.trim().min(1)`; (j) rechazo inmutable, no desvincula `cierre_dia`; (k) auditoría `resuelto_por`/`resuelto_at`/`motivo_rechazo`; (l) extiende `/cierres-admin` role-aware (adminSatélite solicita, maestro aprueba/rechaza).

## Trazabilidad (R1–R25 + E2E) — tests no tautológicos verificados
1. Precondición R6: `contarCierresDiaSolicitados>0` → `conflict`, sin crear (service test).
2. Solo `aprobado`+FK null: `findCierresDiaConsolidables` WHERE `estado='aprobado' AND destinoTipo='bodega_satelite' AND destinoZonaId AND cierreBodegaId:null`; el `updateMany` del link repite la guardia.
3. Snapshot al centavo: suma `Prisma.Decimal` (10.01/5.55/100.44/116.00), string, sin parseFloat.
4. Unicidad ≤1 `solicitado`/zona: `existeCierreBodegaSolicitado` + `P2002→conflict` + índice parcial live.
5. Rechazo sin motivo → `validation_error` (zod borde + re-valida service `.trim()`).
6. Rol/zona ajeno: `forbidden` en ambos services; `notFound()` en `page.tsx`; `unauthenticated` en el borde de las 6 actions.

## Seguridad / regresión 37/38
- Capas action→service→repository (DI); `withErrorHandler`; zod en el borde; sin `fetch` interno; sin hardcode (`gestionConfig.EVIDENCIA_BUCKET`, `cierreConfig.SIGNED_URL_TTL_SECONDS`); evidencias solo por URL firmada; transición guardada `updateMany WHERE estado='solicitado'` sin TOCTOU; un solo UPDATE que no toca `cierre_dia`/`gestion`.
- **Regresión 38 intacta:** `page.tsx` conserva `CierresAdminModule` (cierres de mensajero); las secciones 40 se añaden por rol con guardas `status==='ok'`. Detalle REUSADO (`WITH_DETALLE`/`toPendienteRow`/`toDetalleDTO` + `BODEGA_RESUMEN_SELECT` compartido), sin duplicar. Cambio en `CierresAdminPage.test.tsx` legítimo (mockea las nuevas actions con default `forbidden`, no debilita aserciones). Cambio en `zonas-migration.test.ts` = patrón estándar (excluye `_cierre_bodega` del guard de orden).

## Menores / deudas (NO bloquean)
1. R8/R9/R16/R18/R20/R21/R22 etiquetados "integración repo/DB" pero implementados como unit con Prisma mockeado (patrón 37); no tautológicos y con aserción concreta; las defensas a nivel DB (índice único parcial, atomicidad `$transaction`, RLS) verificadas LIVE por el reviewer. Deuda: test de integración real que ejercite un `P2002` genuino del índice parcial y la atomicidad del link.
2. R24 sin test automatizado que afirme `relrowsecurity=true` (solo SQL de migración + verificación manual). Menor.
3. E2E `e2e/cierre-bodega-satelite.spec.ts` escrito, ejecución diferida (consistente con F1.4-l y patrón 33/34/36/37/38).

## Archivos clave revisados
`lib/services/CierreBodegaService.ts`, `lib/services/CierresBodegaAdminService.ts`, `lib/repositories/CierreBodegaRepository.ts`, `lib/repositories/CierresBodegaAdminRepository.ts`, `lib/actions/cierre-bodega.ts`, `lib/types/cierre-bodega.ts`, `db/migrations/20260712120000_cierre_bodega/{migration,down}.sql`, `db/schema.prisma`, `app/(app)/cierres-admin/page.tsx`, y los 5 archivos de test.

Recomendación: apto para PR/merge a `dev`. Deudas 1–3 como seguimiento, no requieren volver al implementer.
