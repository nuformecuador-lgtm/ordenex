# Review — feature 39 (pago al mensajero por zona en el cierre) · APROBADO (0 bloqueantes)

Fecha: 2026-07-12 · Reviewer (subagente) · Rama `feature/39-pago-mensajero-zona` @ `941ea7c` (sobre `origin/dev` ec8f8d7)

## Veredicto: APROBADO — 0 bloqueantes

## Verificación ejecutable (números obtenidos por el reviewer)
- `./init.sh` → VERDE (`== init OK ==`); typecheck 0; lint 0 (135 warnings preexistentes en `.claude/skills/**`).
- `pnpm test` → **205 files / 1829 passed / 0 failed** (sin regresión 37/38/40).
- Round-trip migración `20260712130000_pago_mensajero_cierre`: `db:rollback` (down) → `migrate deploy` re-aplicó los 3 `ADD COLUMN` → `migrate status` "up to date". Reversibilidad concluyente (si el down no soltara las columnas, el re-`ADD COLUMN` fallaría).

## F1.4 — decisiones respetadas (verificadas en código)
1. **Snapshot inmutable:** `solicitarCierre` congela con la tarifa vigente en la `$transaction`; el histórico lee del snapshot. Test R15 real: tarifa vigente daría 5.00, el cierre congeló 99.99, el read devuelve 99.99.
2. **Solo `entregada` paga:** `pagoPorResultado` devuelve `cobroEntregado` solo para `entregada`, `"0.00"` para el resto. Test R6: `not 9.99` con `cobroRechazado="9.99"`.
3. **`cobroRechazado` fuera de alcance (feature 56):** el util nunca lo lee; solo se transporta en `PagoTarifa`.
4. **Resolución de tarifa:** `findUnique(zona,vehiculo)` + fallback `findFirst(vehiculoId:null)`, zona del MENSAJERO (`findUsuarioZonaId`).
5. **Tarifa faltante = 0.00 no bloqueante:** resolver → null → `"0.00"`, cierre procede.
6. **Snapshot 3 niveles + UI existente** (sin pantallas nuevas).

## Money-critical
- `Prisma.Decimal` en cálculos; salida `toFixed(2)` STRING; **cero `parseFloat`/`Number(`** sobre montos del flujo de pago (back y front). Agregado de bodega = suma Decimal de snapshots `cierre_dia` (test R18: 10.50+0.25=10.75). Dinero recibido intacto (R21: `computeTotales` sin tocar).

## Desviaciones evaluadas
1. `crearCierre` puebla `pago_mensajero` agrupado por valor (`pagoByGestionId`, ≤2 `updateMany`) dentro de la `$transaction`, guardia `cierreId=nuevo` — equivalente, atómico, sin TOCTOU. OK.
2. `totalPagoMensajeroAgregado` en `ListarConsolidacionServiceResult.ok` — requerido por R18. OK.
3. Test obsoleto de la 40 ("DTO no expone pago") reemplazado por R20 (exposición del snapshot en 3 niveles) — legítimo, no debilitamiento. OK.
4. **Heurística de tarifa faltante — MENOR (no bloqueante):** `renderPagoMensajero` infiere el badge por `entregada && pago === "0.00"` (STRING). Money-neutral (el valor snapshot es correcto; el badge no altera números). F1.4-5 ("aviso en vista admin") satisfecho a nivel informativo. Falso positivo posible en una entrega legítima de ₡0.00. Deuda: flag `tarifaFaltante` server-side (el resolver ya distingue `null`).

## Menores / deudas (NO bloquean)
- **m1:** heurística de tarifa faltante con falsos positivos en entregas legítimas de ₡0.00 → recomendación: flag `tarifaFaltante` resuelto server-side (candidato feature 56 o follow-up).
- **m2:** comentario de cabecera obsoleto en `tests/unit/services/cierres-bodega-admin-service.test.ts:15` (cita el R14 viejo de la 40).
- **m3:** test R22 de migración es estático (regex sobre SQL); round-trip real contra Postgres corrido por el reviewer.
- **m4 (deuda de otra feature):** `ZonaRepository.ts:35-36` usa `.toNumber()` para la config de `ZonaForm` (feature 55), fuera del flujo de pago → señalar para 55/56.

## Archivos clave revisados
`lib/utils/pago-mensajero.ts`, `lib/repositories/TarifaZonaMensajeroRepository.ts`, `lib/services/CierreDiaService.ts`, `lib/repositories/CierreDiaRepository.ts`, `lib/services/CierreBodegaService.ts`, `db/migrations/20260712130000_pago_mensajero_cierre/{migration,down}.sql`, `app/(app)/cierres-admin/_components/cierre-detalle-shared.tsx`.
