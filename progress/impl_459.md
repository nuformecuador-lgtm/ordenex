# Ficha 459 — bitacora del BACKEND (feature/459-backend)

- Rama: `feature/459-backend` desde `6280fdbb`. Base: CLON local `ordenex_459` (TEMPLATE de
  `ordenex`), `.env` del worktree apuntando a ella (`prisma migrate status`: `localhost:5432`,
  `ordenex_459`, 212 migraciones al dia). `node_modules` por junction al repo principal.
- Busqueda: MCP `codebase-memory` (`R-job-singularis-projects-ordenex`) primero; el indice esta
  rancio (no devolvio `CobroTiendaService`, `RechazoTiendaCobroService`, `GastoFijoCobroService`):
  todo simbolo confirmado en el archivo real.
- Sin `feature_list.json`. Sin UI.

## Estado por tarea

| Tarea | Estado | Donde |
| --- | --- | --- |
| T0.1 escenario | HECHA | `tests/integration/db/_fixtures/caja-459.ts` |
| T0.2 fotografia | HECHA (14 verdes, 0 skipped) | `tests/integration/db/caja-caracterizacion-459.test.ts` |
| T0.3 mutaciones | HECHA (15: 14 rojas + 1 equivalente explicada) | `progress/impl_459_fase0.md` |
| T0.4 contraste prod | LEADER (linea base ya en `design.md`) | — |
| T A.5 invariante + guardia | HECHA | `lib/utils/invariante-tiendas.ts`, `LIQUIDEZ_POR_CATEGORIA` en `lib/utils/caja-tesoreria.ts`, guardia + integracion |
| T B.7 comprobante (piezas puras) | HECHA | `lib/config/wallet-comprobante.ts`, `lib/utils/comprobante.ts`, `BUCKETS` |
| T B.8 descripciones | HECHA | `lib/utils/descripcion-pago-por-cuenta.ts` |
| T C.2 (lista aprobada) | TRAIDA de `origin/dev` (6973d3ca) y copiada a la ruta del spec; verificada: 203 filas, 203 ids, suma 25769034.50, sin filas malformadas, LF | `progress/reclasificacion_459/lista_aprobada.csv` (= `progress/459_reclasificacion_aprobada.csv`) |
| T A.1, A.2, A.3, A.4, A.6, A.9 | **BLOQUEADAS POR UI** (ver abajo) | — |
| T B.2–B.6, B.9–B.14 | **BLOQUEADAS POR UI** (cadena de B.2) | — |
| T C.4–C.6 | **BLOQUEADAS** (la migracion inserta `egreso_pago_por_cuenta_tienda` / `cobro_manual_reclasificado`, que crea B.2; y su timestamp tiene que ir DESPUES de las de B) | — |

## La lista aprobada frente al spec (para decidir antes de C.4)

1. **Sin `tienda_id`.** R80/R82 y la plantilla de design §10.2 comprueban `(id, tienda, monto)` fila a
   fila; la lista trae `(id, fecha_movimiento, monto)`. Propuesta: comprobar por fila `id` + `monto` +
   `debito/cobro_manual`, y ademas que TODOS los ids son de UNA sola tienda (`count(DISTINCT
   tienda_id) = 1`): si el «si no estoy mal todos para Nuform» del humano fallara, la migracion
   aborta sin escribir. Necesita el visto bueno del leader porque rebaja R82 de «la tienda aprobada»
   a «una sola tienda».
2. **La fecha de la lista es un DIA, no un instante**, y los dias van del 2026-08-28 al 2026-09-22,
   no del 2026-09-08 al 2026-09-23 que dice `requirements.md` (F1). No se sabe si es dia UTC o dia
   CR. La migracion NO la usaria para casar filas: el egreso copia el `fecha_movimiento` real de la
   fila del cobro (R81, «el mismo instante»), que es lo que pidio el leader. Si se quiere comprobar
   tambien la fecha, hay que fijar antes su convencion.
3. Sumas de control para la migracion: `n_esperados = 203`, `suma_esperada = 25769034.50`; en local
   y preview ningun id existe → `RETURN` sin escribir (R83).

## BLOQUEO — el backend no compila sin tocar UI

Medido, no supuesto: se aplico T A.1 (`NaturalezaMovimiento` + `capital`; los 7 campos nuevos de
`CajaResumenDTO` de design §2.6) y `pnpm exec tsc --noEmit` rompio en estos archivos; despues se
revirtio (`git diff --stat` vacio).

**T A.1 / A.2 (tipo `capital` + contrato del resumen):**
- `app/(app)/wallet/_components/wallet-labels.ts` — `DUENO_LABEL: Record<NaturalezaMovimiento, string>`.
- `app/(app)/wallet/_components/WalletLedger.tsx` — `DUENO_PUNTO: Record<NaturalezaMovimiento, string>`.
- Fixtures de `CajaResumenDTO` en tests de pantalla: `tests/components/CajaComposicionBarra.test.tsx`,
  `tests/components/CajaResumenCard.test.tsx`, `tests/components/ComposicionGananciaCard.test.tsx`,
  `tests/components/DetalleFilaComposicion.test.tsx`, `tests/components/DineroIdentidadesEnPantalla.test.tsx`,
  `tests/components/descarga/WalletDescarga.test.tsx`, `tests/integration/wallet-page.test.tsx`,
  `tests/unit/components/wallet-page-cobros-pendientes.test.tsx`
  (y `tests/unit/actions/wallet-actions.test.ts`, que es de backend y se arregla con A.2).

**T B.2 → B.4/B.6 (valores de enum de la caja, de la tienda y de origen):** en cuanto
`db/schema.prisma` gana los valores, `_Ensure*Exhaustive` obliga a meterlos en los seeds de
`lib/types/wallet*.ts`, y eso rompe estos `Record` TOTALES de pantalla:
- `app/(app)/wallet/_components/wallet-labels.ts` — `CATEGORIA_LABEL`, `ORIGEN_LABEL`.
- `app/(app)/mi-wallet/_components/mi-wallet-labels.ts` — `CATEGORIA_TIENDA_LABEL`.
- (`ORIGEN_TIENDA_LABEL` no rompe el build —es `Record<string,string>`— pero design §5 lo exige.)
El resto de `Record` que obligan (`NATURALEZA`/`LIQUIDEZ_POR_CATEGORIA`, `CUBETA_POR_CATEGORIA`,
`FUENTE_CAJA`/`FUENTE_TIENDA`, `invariante-tiendas`) son de backend y los haria yo.

**Segundo motivo para no generar el cliente de B aqui:** `node_modules` es un junction al repo
principal; `prisma generate` con los enums nuevos reescribe el cliente COMPARTIDO y pone rojo el
`_Ensure*Exhaustive` de las demas sesiones (memoria «base local compartida rompe gates ajenos»). Para
el bloque B hace falta un `node_modules` propio del worktree (`pnpm install`) antes de generar.

**Propuesta para desbloquear (decision del leader):** o el frontend_dev anade antes las entradas de
esos `Record` y los campos de los fixtures (textos exactos en design §3.3–§3.4 y §5), o se autoriza
al backend a anadir SOLO esas entradas con los textos de design §5, sin tocar componentes.

## R → test (lo entregado)

| R | Test |
| --- | --- |
| R92 | `tests/integration/db/caja-caracterizacion-459.test.ts` («R92: saldo y desglose de la tienda A/B») |
| R93 | idem («R93: ganancia…», «composicion…», «desglose de egresos…», «Salio…») |
| R94 | idem («R94: cuenta por pagar del mensajero…», «filas del LIBRO DEL MENSAJERO») |
| R95, R96 | idem («R95/R96: filas de la CAJA / TIENDA A / TIENDA B») + mutaciones M01–M14 |
| R9, R90 | `tests/unit/guards/caja-clasificacion-459.guardia.test.ts` + `tests/integration/db/caja-clasificacion-459.test.ts` (afirmacion 5, contra el CHECK real) |
| R1 (parcial: la clasificacion) | `caja-clasificacion-459.guardia` «(4) literal del contrato: los seis cargos a una tienda» |
| R43 | `tests/unit/utils/descripcion-pago-por-cuenta.test.ts` |
| R54, R55 (piezas puras) | `tests/unit/services/wallet-comprobante.test.ts` |
| Resto (R2–R8, R10–R42, R44–R91, R97–R100) | PENDIENTE: bloqueadas (ver arriba) |

R8 y R7: la invariante NO tiene aun test de integracion ni guardia de derivacion, porque con el
codigo de hoy R8 NO se cumple (es F2). En el escenario de la fase 0, con la formula nueva a mano:
«De las tiendas» = 28517.00 − 12970.68 (cargos) = 15546.32 = Σ saldos 13045.82 + cobro sin
reclasificar 2500.50 → diferencia 0.00. Es la cifra que `caja-invariante-tiendas.test.ts` (T B.14)
afirmara tras A.2.

## Mutaciones de T A.5 (arnes con autocomprobacion, mismo de la fase 0)

Comando: `node node_modules/vitest/vitest.mjs run tests/unit/guards/caja-clasificacion-459.guardia.test.ts tests/integration/db/caja-clasificacion-459.test.ts --reporter=json`

| # | Mutacion | Archivo | Diff (una linea) | Tests ejecutados | Rojos | Veredicto |
| --- | --- | --- | --- | --- | --- | --- |
| A5-1 | par invertido: el contra-entrega de la tienda emparejado con el pago a tienda | `lib/utils/invariante-tiendas.ts` | `- cod_recaudado: "ingreso_cod_recaudado", ⟶ + cod_recaudado: "egreso_pago_tienda",` | 9 | 1 | ROJO (muerta) |
| A5-2 | concepto de terceros sin pareja: la anulacion del pago a tienda sin contrapartida | `lib/utils/invariante-tiendas.ts` | `- ajuste_credito: "ingreso_reverso_pago_tienda", ⟶ + ajuste_credito: SIN_CONTRAPARTIDA,` | 9 | 2 | ROJO (muerta) |
| A5-3 | un cargo clasificado como efectivo | `lib/utils/caja-tesoreria.ts` | `- ingreso_flete: "cargo_a_tienda", ⟶ + ingreso_flete: "efectivo",` | 9 | 2 | ROJO (muerta) |
| A5-4 | tipo del pago a tienda cambiado en la tabla | `lib/utils/invariante-tiendas.ts` | `- pago_tienda: "debito", ⟶ + pago_tienda: "credito",` | 9 | 2 | ROJO (muerta) |


## Verificacion (salida real)

Gate COMPLETO `./init.sh` contra `ordenex_459`, sobre `a2d89ad4` (todo el codigo y los tests de esta
rama; despues solo entro la lista aprobada, que es un CSV de `progress/`). Log:
`progress/gate_459_backend.log` (sin `tail`, con `INIT_EXIT` escrito dentro).

- `pnpm run typecheck`: `✓ typecheck paso`
- `pnpm run lint`: `✖ 217 problems (0 errors, 217 warnings)` (avisos preexistentes; ninguno en archivos de esta rama)
- `pnpm test`: `Test Files  2182 passed (2182)` · `Tests  30871 passed | 26 skipped (30897)`
- `✓ DATABASE_URL resuelta: los 269 archivos de tests contra Postgres SI se ejecutan`; los 26 skipped son
  `tests/components/AnaliticaPage.test.tsx` (17) y `AnaliticaShell.test.tsx` (9), preexistentes: **0 skipped en
  `tests/integration/db`**.
- `== init OK ==` · `INIT_EXIT=0`

**Veredicto:** fase 0 completa y verde con 14 mutaciones muertas; A.5, B.7 y B.8 hechos; el resto del backend BLOQUEADO por los `Record` de UI listados arriba.
