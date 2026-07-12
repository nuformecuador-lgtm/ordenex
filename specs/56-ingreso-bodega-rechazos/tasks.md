# Feature 56 — Ingreso de bodega por rechazos (`cobroRechazado`) — tasks.md

> Espejo de la implementación de la 39. Reusa el resolver de tarifa y la resolución de
> destino existentes. NO empezar hasta cerrar la puerta F1.4 (regla condicional Q1,
> resultados Q2, flag Q6): esas decisiones fijan R3/R4/R5 y el alcance de R23.
> `[P]` = paralelizable con las tasks del mismo bloque. Cada task cita R y su "hecho".

## T0 — Pre-flight (bloqueante)
- Confirmar baseline verde en `feature/56-ingreso-bodega-rechazos`: `./init.sh`, typecheck,
  lint y `pnpm test` en verde (1829/1829 de la 39 como piso).
- Releer la sección F1.4 aprobada de `requirements.md` y ajustar R3/R4/R5/R23 al texto
  aprobado por el humano ANTES de tocar código.
- **Hecho:** init.sh verde + decisiones F1.4 transcritas en el encabezado del spec.

## T1 — Migración aditiva (R21) [depende de T0]
- Crear `db/migrations/<timestamp>_ingreso_bodega_rechazos/migration.sql`: 3 `ADD COLUMN`
  (`gestion_orden.ingreso_bodega_rechazo` DECIMAL(12,2) NULL;
  `cierre_dia.total_ingreso_bodega_rechazos` y `cierre_bodega.total_ingreso_bodega_rechazos`
  DECIMAL(12,2) NOT NULL DEFAULT 0). Sin tocar RLS/enums.
- Escribir `down.sql` (3 `DROP COLUMN IF EXISTS`, orden inverso).
- Actualizar `db/schema.prisma` (3 campos, ver design §2). `prisma validate` OK.
- **Hecho:** `prisma validate` OK; `pnpm db:migrate` aplica; `pnpm db:rollback` round-trip
  limpio; test `tests/integration/db/ingreso-bodega-migration.test.ts` (R21) pasa.

## T2 — Util puro `ingreso-bodega.ts` (R1,R3-R7,R7b) [P, depende de T0]
- Crear `lib/utils/ingreso-bodega.ts` con `ingresoBodegaPorResultado(resultado, tarifa)`
  según design §1 y la regla F1.4-Q1/Q2 aprobada.
- **Hecho:** `tests/unit/utils/ingreso-bodega.test.ts` cubre R3 (rechazada+aplica ->
  cobroRechazado), R4 (otros -> 0.00), R5 (no aplica -> 0.00), R6 (tarifa null -> 0.00 sin
  lanzar), R7 (Decimal/STRING 2 dec). Sin DB/red.

## T3 — DTOs / interfaces (R7b,R20,R22) [P, depende de T0]
- Extender los contratos del design §3 con los campos STRING nuevos
  (`ingresoBodegaRechazo`, `totalIngresoBodegaRechazos`, `...Agregado`, `ingresoByGestionId`).
  Si F1.4-Q6 aprobado: añadir `tarifaFaltante: boolean` a `CierreDetalleGestion`.
- **Hecho:** typecheck 0; los tipos compilan en los 4 services y 2 repos consumidores.

## T4 — `CierreDiaService` + repo: derivar y snapshotear (R2,R8-R14) [depende de T1,T2,T3]
- `CierreDiaService`: `derivarIngresoBodega` (espejo `derivarPagos`); exponer
  `totalIngresoBodegaRechazos` en `listarCierreDia` (R9/R10) y snapshotear en
  `solicitarCierre` (R11/R12) reusando la tarifa ya resuelta y el destino ya calculado (R8).
- `CierreDiaRepository.crearCierre`: persistir total + por-gestión en la MISMA `$transaction`
  (patrón `idsByPago`, R13); leer columnas en `findGestionesPendientes`/`findCierresByMensajero`.
- **Hecho:** `tests/unit/services/cierre-dia-service.test.ts` cubre R2,R8,R9,R10,R11,R12,
  R14,R20; `tests/unit/repositories/cierre-dia-repository.test.ts` cubre R13 (persistencia
  en una tx). Regresión 39: pago_mensajero/totales intactos.

## T5 — `CierresAdminService` + `toDetalleDTO` + repo 38 (R15,R16) [P, depende de T3,T4]
- `toDetalleDTO`: mapear `ingresoBodegaRechazo` snapshot; `toResumen`:
  `totalIngresoBodegaRechazos`; `CierresAdminRepository` selecciona la nueva columna
  (reuso `WITH_DETALLE`/`toPendienteRow`).
- **Hecho:** `tests/unit/services/cierres-admin-service.test.ts` cubre R15/R16 (snapshot, no
  recomputa).

## T6 — `CierreBodegaService` + `CierresBodegaAdminService` + repo 40 (R17,R18,R19) [depende de T3,T4]
- `CierreBodegaService`: `sumIngresoBodega`; exponer agregado en `listarConsolidacion` (R17)
  y congelar en `solicitarCierreBodega`/`crearCierreBodega` en la misma tx (R18).
- `CierresBodegaAdminService`: detalle expone por `cierre_dia` + agregado (R19).
- **Hecho:** `tests/unit/services/cierre-bodega-service.test.ts` (R17/R18) y
  `tests/unit/services/cierres-bodega-admin-service.test.ts` (R19) pasan.

## T7 — Flag `tarifaFaltante` server-side (R23) [P, depende de T3,T4] — SOLO si F1.4-Q6 aprobado
- Derivar `tarifaFaltante` (true cuando el resolver -> null) en el service donde ya se
  resuelve la tarifa; reemplazar la heurística de `cierre-detalle-shared.tsx`
  (`renderPagoMensajero`/`PAGO_SIN_TARIFA`) para entregas Y rechazos.
- **Hecho:** test R23 verde; badge de "sin tarifa" ya no da falso positivo en entregas
  legítimas de ₡0.00.

## T8 — UI en pantallas existentes (R9,R10,R16,R19; F1.4-Q7) [depende de T4,T5,T6]
- Añadir columna/label "Ingreso de bodega por rechazos" (sección rechazadas) + línea de
  total en `/cierre-dia`, `/cierres-admin` (detalle compartido) y detalle de bodega. Reuso
  del render del pago mensajero. Sin pantallas nuevas.
- **Hecho:** el dato aparece en las 3 vistas; tests de componente (si aplica) verdes; lint 0.

## T9 — Verificación final (bloqueante) [depende de T1..T8]
- `pnpm prisma validate` OK · typecheck 0 · lint 0 · `pnpm test` verde (sin regresión 37/38/
  39/40) · `./init.sh` verde · `pnpm db:migrate` + `pnpm db:rollback` round-trip limpio.
- Verificar money-safety: asserts de tipo STRING en todos los campos nuevos; búsqueda de
  `parseFloat`/`Number(` en los archivos tocados = 0 en rutas de dinero.
- Actualizar `progress/impl_56-*.md` con el mapa R -> test completo.
- **Hecho:** todo verde + mapa de trazabilidad R1-R23 (o R1-R22 si Q6 se difiere) completo;
  listo para reviewer.

## Orden y paralelismo
- Secuencia base: T0 -> T1 -> (T2,T3 `[P]`) -> T4 -> (T5,T6,T7 `[P]`) -> T8 -> T9.
- T2 y T3 pueden ir en paralelo tras T0. T5, T6 y T7 en paralelo tras T4. T8 al final.
