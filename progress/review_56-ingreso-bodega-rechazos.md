# Review 56 — Ingreso de bodega por rechazos (`cobroRechazado`) — money-critical

Rama: `feature/56-ingreso-bodega-rechazos` @ HEAD `40d99e2` (backend `6a0153d` + UI `40d99e2`).
Reviewer verificó, NO editó código. Números obtenidos por el reviewer, no de la bitácora.

## Verificación ejecutable (corrida por el reviewer)
- `pnpm typecheck`: **0 errores**.
- `pnpm lint`: **0 errores** (135 warnings pre-existentes, todos en `.claude/skills/*`).
- `./init.sh` / `pnpm vitest run`: **1866/1867 pass, 1 fail**. El único fallo es
  `tests/components/LoginForm.test.tsx:320` (findByText timeout bajo carga paralela);
  re-corrido aislado pasa **26/26**. Flaky de login, SIN relación con la feature 56
  (no toca dinero/cierre). Análogo al flaky conocido de HomePage.
- Migración `20260712140000_ingreso_bodega_rechazos`: round-trip **up→down→up limpio**
  contra Postgres local (db:rollback aplica down + marca pendiente; `migrate deploy`
  re-aplica; `migrate status` = up to date).

## Trazabilidad R→test (no tautológica) — leída directamente
- R1/R3/R4/R5/R6/R7: `tests/unit/utils/ingreso-bodega.test.ts` — usa `cobroRechazado`
  (no `cobroEntregado`), solo `rechazada`, `==0`→0.00, `null`→0.00 sin lanzar, Decimal
  escala 2 (incl. redondeo 3.005→3.01). OK.
- R2/R7b/R8/R9/R10/R11/R12/R14/R20/R23: `tests/unit/services/cierre-dia-service.test.ts`
  — resuelve por zona+vehículo del MENSAJERO; total separado de `totales` y de
  `totalPagoMensajero`; snapshot al solicitar; **R14 inmutabilidad** (histórico lee 7.50
  congelado aunque la tarifa vigente sea 3.00, no re-deriva); **R23** con ambos casos
  (null→true; tarifa 0.00 real→false, sin falso positivo). OK.
- R13: `tests/unit/repositories/cierre-dia-repository.test.ts` — INSERT + vincular +
  poblar `ingreso_bodega_rechazo` agrupado por valor con guardia `cierreId=nuevo`, TODO
  en la misma `$transaction`, como `Prisma.Decimal`. OK.
- R15/R16: `cierres-admin-service.test.ts` (snapshot leído, sin recomputar). Verde en suite.
- R17/R18: `cierre-bodega-service.test.ts` (agregado = suma Decimal; congela en la tx). Verde.
- R19: `cierres-bodega-admin-service.test.ts` (por cierre_dia + agregado, snapshot). Verde.
- R21: `tests/integration/db/ingreso-bodega-migration.test.ts` — aditiva (3 ADD COLUMN,
  gestion NULL, totales NOT NULL DEFAULT 0), sin RLS/enums/tablas, down en orden inverso,
  timestamp posterior a 39/40. OK.
- R22: asserts `typeof === "string"` transversales. OK.

## Decisiones F1.4 (todas respetadas)
- Q1/Q2: `lib/utils/ingreso-bodega.ts` — solo `rechazada` + `cobroRechazado>0`; reusa
  `resolvePagoTarifa` (no duplica resolver, no toca `pago-mensajero.ts`).
- Q3: congela en `solicitarCierre` (misma tarifa ya resuelta), deriva en `listarCierreDia`.
- Q4: migración 3 niveles + down; wiring en `crearCierre` (37/39) y `crearCierreBodega` (40).
- Q5: atribuido al `destinoTipo`/`destinoZonaId` ya resuelto por `solicitarCierre` (R8).
- Q6: `tarifaFaltante` derivado SERVER-SIDE (`tarifa === null`) en `CierreDiaService`;
  `cierre-detalle-shared.tsx` usa `g.tarifaFaltante` y **eliminó** la heurística
  `entregada && pago === "0.00"` (grep: la vieja cadena solo sobrevive en comentarios/tests).
  Aplica a entregas Y rechazos. **Deuda m1 de la 39 RESUELTA.**
- Q7: expuesto en las 3 pantallas existentes (mensajero `CierreDiaModule`, admin
  `CierresAdminModule`/`cierre-detalle-shared`, bodega `Consolidacion`/`CierresBodegaAdmin`),
  sin pantallas nuevas.

## Money-safety
- Cero `parseFloat`/`Number(`/`parseInt` en rutas de dinero (back y front); solo comentarios.
  Frontend renderiza vía `money()` (prefija ₡ a un STRING, nunca parsea).
- Carriles separados: `total_ingreso_bodega_rechazos` NO altera `total_efectivo/simpe/
  transferencia/general` (37/40) ni `total_pago_mensajero` (39). Verificado por R7b/R20.
- Agregado de bodega = `sumIngresoBodega` con `Prisma.Decimal`, salida STRING escala 2.

## Regresión 37/38/39/40
- Sus tests siguen verdes dentro de la suite; snapshots de dinero recibido y pago al
  mensajero intactos (solo se AÑADIERON columnas/campos). El cambio del aviso en
  `cierre-detalle-shared.tsx` (ahora por flag) está cubierto por `CierresAdminModule.test.tsx`
  (badge por flag en entregas Y rechazos; NO se muestra sin flag aun con pago 0.00).

## Seguridad / capas
- RLS intacta: migración es puro `ADD COLUMN` (no puede deshabilitar RLS; sin CREATE POLICY/
  ROW LEVEL SECURITY). Sin tablas nuevas. Sin secretos ni hardcode de país/moneda/cuenta.
- Capas: util puro → service (`derivarIngresoBodega`, `sumIngresoBodega`) → repo (queries/tx).
  Sin `fetch` interno. Reuso del resolver y del destino existentes.

## Coherencia tras el corte en dos commits
Backend (6a0153d) + UI (40d99e2) quedaron INTEGRADOS y COMPLETOS: el DTO expone
`ingresoBodegaRechazo`/`totalIngresoBodegaRechazos`/`tarifaFaltante` y las 3 vistas los
consumen. No hay cabos sueltos. La feature NO quedó a medias.

## Hallazgos
- **menor** — `specs/56-ingreso-bodega-rechazos/tasks.md`: T1..T9 no están marcadas `[x]`
  (solo T0). La 39 (aprobada) marcó las 15/15. Desvía de CHECKPOINTS ("todas las tasks
  marcadas [x]"). Trabajo real completo y verde; ticar antes de pasar a `done`.
- **menor** — `progress/impl_56-*.md` (escrita por el backend antes de morir): el mapa
  R→test no lista los tests de componente añadidos por el frontend_dev
  (`CierresAdminModule.test.tsx`/`CierreDiaModule.test.tsx`). El código UI sí existe y pasa;
  solo es un vacío de documentación en la bitácora.
- **menor (pre-existente, ajeno a la 56)** — `tests/components/LoginForm.test.tsx` flaky
  bajo carga paralela (pasa aislado 26/26).

## Veredicto: **APROBADO** (0 bloqueantes)
