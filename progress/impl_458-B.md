# 458-B «Cimientos» — bitácora del backend_dev

**Rama:** `feature/458-B` creada con `git checkout -B feature/458-B origin/dev` sobre `752e40df`
(«chore(458): en curso (hijas A y B)»; la 461 y la 457 ya en `dev`). **Base:** clon `ordenex_458b`
(`CREATE DATABASE … TEMPLATE ordenex`, 0 conexiones a la plantilla medidas antes; `prisma migrate
deploy`: «No pending migrations»). `.env` = el del checkout principal con la base cambiada y SIN
`DATABASE_URL_PREVIEW`, copiado sin imprimirlo. `pnpm install --frozen-lockfile` propio, sin junction.
La base `ordenex` solo se usó como plantilla. **Búsqueda:** MCP `codebase-memory` disponible y usado
para orientar; su índice está rancio (no conoce la 457/461), así que cada símbolo se confirmó con
`grep`/lectura del archivo real.

## TB.0 — Lo que la ficha da por hecho, confirmado en `dev` (`752e40df`)

| Pieza | En `dev` | Qué cambia para 458-B |
| --- | --- | --- |
| Anulación de la corrección de caja (461) | Tabla **`ajuste_caja_anulacion`** (`movimiento_id` TEXT NOT NULL **UNIQUE** FK `wallet_movimiento(id)` RESTRICT, `motivo` con CHECK `btrim<>''`, `anulado_por` FK `usuario` RESTRICT, `created_at`, RLS sin policies) — migración `20260926120400_wallet_461_idempotencia_y_anulacion_correccion`. Servicio `AjusteCajaService.anular`, repositorio `AjusteCajaAnulacionRepository` (`anular(tx, …)` + `estadoDeDocumentos(ids)`), action `anularAjusteCajaAction` (`lib/actions/wallet.ts:366`), historial `wallet_movimiento_manual_anulado` («Anuló una corrección de caja»). | **D13 → se REUTILIZA `ajuste_caja_anulacion`** (ver abajo). |
| Anulación del cobro de Ordenex a una tienda (461) | Tabla `cobro_tienda_anulacion`, `CobroTiendaAnulacionRepository`, `anularCobroTiendaAction` (`lib/actions/wallet-tienda.ts:511`), categorías `ingreso_cobro_tienda` / `egreso_reverso_cobro_tienda` / `cobro_tienda_anulado`, orígenes `cobro_tienda` y `cobro_tienda_completado`. | Nada; se enruta a ella. |
| `DocumentoCajaDTO.tipo` | `"pago_por_cuenta_tienda" \| "aporte_capital" \| "cobro_tienda" \| "ajuste_caja" \| "abono_tienda"` (`lib/types/wallet.ts:298-307`). | + `egreso_caja`, `indemnizacion`, `rechazo_tienda_cobro` (TB.8). |
| `LectoresDocumentosCaja` | `pagosPorCuenta`, `aportes`, `cobros`, `ajustes`, `abonos` (`IWalletService.ts`), sin valores por defecto. | + `egresos`, `indemnizaciones`, `rechazos` (TB.8). |
| Pago de la tienda a Ordenex (457) | `abono_tienda(_anulacion)`, `AbonoTiendaService`, `registrarAbonoTiendaAction`, `anularAbonoTiendaAction`, `obtenerComprobanteAbonoAction` (`lib/actions/abono-tienda.ts`); `PREFIJO_COMPROBANTE.abono_tienda = "abonos-tienda"`. | Nada; se reutiliza. |
| Borde de periodo (T1 de la 461) | `desdeDiaCRSchema` / `hastaDiaCRSchema` en `lib/types/filtro-dias-cr.ts:40-43` (`diaCalendarioSchema` → `inicioDelDiaCREnUtc` / `inicioDelDiaSiguienteCREnUtc`, cota exclusiva). Ya en `wallet.ts:610`, `wallet-tienda.ts:189`, `wallet-mensajero.ts:161`. | Los schemas nuevos (estado de cuenta) usan ESAS dos piezas. |
| «Ya reversado» (P3 de la 461) | Lo decide el CLIENTE (`WalletLedger.tsx:197-203, 332`: `reversadosEnSesion` + `reversadosEnPagina`). | R71 lo sustituye (servidor, TB.8); la pantalla la cambia 458-C/E. |
| Historial del reverso de un egreso | Ya existe `egreso_administrativo_reversado` («Reversó un egreso administrativo»), escrito por `reversarEgreso`. | Se conserva para la vía vieja sin motivo. |
| Timestamps de migración en `origin/dev` | Últimos: `20260927120000_abono_tienda_457_enums`, `20260927120100_abono_tienda_457_tablas_y_checks`. Ninguna rama remota trae migraciones posteriores. | **458-B:** `20260928120000_wallet_458_enums` y `20260928120100_wallet_458_tablas`. |

### D13 — decisión

La 461 dejó para la corrección de caja **una tabla con FK a `wallet_movimiento(id)` y UNIQUE sobre
`movimiento_id`** (`ajuste_caja_anulacion`). Es exactamente la condición de D13, así que **se
reutiliza** para la constancia de la anulación de sueldo, gasto de Ordenex, gasto fijo cobrado e
indemnización: `movimiento_id` = la fila ORIGINAL del egreso. **No se crea
`wallet_movimiento_anulacion`.** Consecuencias:

- La constancia no guarda el id del contra-asiento (la 461 tampoco): el contra-asiento se encuentra
  por el índice único parcial `(origen_tipo, origen_id, categoria)` —`gasto`/id del egreso o
  `orden_incidente`/id del incidente, `ingreso_ajuste`—, que es además su candado de idempotencia.
- El historial NO puede ser `wallet_movimiento_manual_anulado` («Anuló una corrección de caja»): no
  es generalizable. Se añade **`egreso_caja_anulado`** (§2.1 del design, rama «si la 461 no dejó un
  tipo generalizable»), escrito por un método PROPIO del repositorio (la guardia del censo mide por
  método).
- `AjusteCajaService` (la corrección) no cambia: sigue exigiendo `ingreso_ajuste`/`egreso_ajuste`
  con origen `manual`, así que no puede anular un sueldo por esa vía ni al revés.
