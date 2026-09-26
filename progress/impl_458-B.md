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

## TB.1 — Fase 0

Ver `progress/fase0_458-B.md` (fotografías 459 e invariante verdes: 27/27; fotografía nueva
`wallet-caracterizacion-458.test.ts`: 6/6; tres mutaciones medibles hoy en rojo con autocomprobación).

## TB.2 / TB.3 — Migraciones (orden y ciclo medido en el clon)

1. `20260928120000_wallet_458_enums` — seis `ADD VALUE IF NOT EXISTS` (2 caja, 2 tienda, 2 historial).
   `down.sql` = función dinámica de la 459/461 renombrada `_458` (lee `pg_enum`, RAISE si una fila usa
   un valor, recrea CHECK/índices que nombran el tipo).
2. `20260928120100_wallet_458_tablas` — `wallet_anotacion`, `rechazo_tienda_cobro_anulacion`,
   `wallet_comprobante` (CHECK `num_nonnulls = 1`, UNIQUE por destino, CHECK de `content_type`), los dos
   CHECK tipo↔categoría ampliados, RLS en las tres. `down.sql`: `DO` con RAISE si hay filas en las tres
   tablas o movimientos con las categorías nuevas; CHECK a las listas EXACTAS de la 457; `DROP TABLE`.
   D13: **no** se crea `wallet_movimiento_anulacion`.

Catálogos (caja / tienda / origen / historial tipos / historial entidades), medidos en `ordenex_458b`:

| Momento | Catálogos | Tablas nuevas | CHECK (md5, 8) |
| --- | --- | --- | --- |
| Antes (457) | 25 / 16 / 14 / 63 / 24 | 0 | `2182276a`, `d1a65d24` |
| Después de `migrate deploy` | 27 / 18 / 14 / 65 / 24 | 3 | `cd688cd4`, `c779ba9d` |
| `db:rollback` con 1 fila en `wallet_anotacion` | falla: «rollback 458: hay 1 filas … se aborta sin borrar nada»; la fila sigue | 3 | sin cambio |
| `db:rollback` (migración 2) sin filas | 27 / 18 / 14 / 65 / 24 | 0 | `2182276a`, `d1a65d24` (= 457) |
| `down.sql` de la 1 con 1 fila de historial `egreso_caja_anulado` | falla: «rollback 458: 1 filas de historial_accion.accion usan …»; los 6 valores siguen | — | — |
| `down.sql` de la 1 sin filas | 25 / 16 / 14 / 63 / 24 | 0 | `2182276a`, `d1a65d24` |
| `migrate deploy` otra vez | 27 / 18 / 14 / 65 / 24 | 3 | `cd688cd4`, `c779ba9d` |

`prisma migrate diff --from-config-datasource --to-schema db/schema.prisma --script` tras aplicar:
«This is an empty migration» (sin drift; el índice de expresión `lower(contraparte_nombre)` no aparece).
`prisma format` realineó columnas del schema (diff `-w`: solo inserciones).

Test: `tests/integration/db/wallet-458-migration.test.ts` (8 casos: catálogos valor a valor, CHECK
admiten/rechazan, RLS y restricciones de las tres tablas, `rechazo_tienda_cobro_anulacion` sobre un
cobro real de la 459, `down` de la 2 aborta con filas y devuelve los CHECK de la 457, función del
`down` de la 1 igual a la de la 461 salvo el sufijo, `TIPO_POR_CATEGORIA_TIENDA` = CHECK del motor,
R89 sin sentencias sobre filas).

## TB.4 — `Record` totales y literales de guardias (reescritos a mano)

Código: `WALLET_MOVIMIENTO_CATEGORIA_SEED` (+2), `WALLET_TIENDA_MOVIMIENTO_CATEGORIA_SEED` (+2),
`WALLET_EGRESO_NOMBRADO_SEED` (3→5), `NATURALEZA_POR_CATEGORIA` (propio ×2), `LIQUIDEZ_POR_CATEGORIA`
(`cargo_a_tienda` ×2), `FUENTE_CAJA`/`FUENTE_TIENDA` (`sin_reparto/no_nace_de_un_cierre` ×4),
`CUBETA_POR_CATEGORIA` (`aFavor` ×2), `TIPO_POR_CATEGORIA_TIENDA` (`credito` ×2),
`CONTRAPARTIDA_EN_CAJA` (+2), `metrics.ts` (`dinero_en_caja` y `ganancia_ordenex` +2; `egresos` no;
`cuenta_por_pagar_tienda` +2), `CATEGORIA_LABEL`, `CATEGORIA_TIENDA_LABEL`, `CATEGORIA_MI_WALLET_LABEL`
(textos de design §2.3), `EGRESO_NOMBRADO_LABEL` y su icono (dos filas nombradas nuevas: «Fletes por
rechazo cobrados a una tienda anulados», «IVA de fletes por rechazo cobrados a una tienda anulados»),
`HISTORIAL_ACCION_TIPOS` + categoría + etiqueta («Anuló un cobro por rechazo a una tienda», «Anuló un
gasto de la caja»). `ESCRIBEN_EN_LA_TIENDA` no cambia (los créditos nuevos llevan origen
`gestion_orden`, que ya estaba). `finanzas-diarias.ts` no cambia (lee `LIQUIDEZ_POR_CATEGORIA`).

Literales de tests cambiados (ninguno es un importe de dinero; son conteos, listas de catálogo o
filas nuevas con ₡0):

| Test | Antes → después |
| --- | --- |
| `metrics-caja-naturaleza.guardia` | 25→27 (dinero_en_caja), 16→18 (ganancia) |
| `caja-clasificacion-459.guardia` (4) | 8→10 cargos (+ los dos reversos); detector y dos casos nuevos (R68/R91 y contraprueba de la mutación 4) |
| `caja-composicion-exhaustiva.guardia` | nombrados 3→5 |
| `catalogo-y-choke-point` | 63→65 tipos; `mueve_dinero` 41→43 |
| `financiera-ingresos-repo` | 16→18 categorías del WHERE de la ganancia |
| `wallet-labels.test` | 25→27 textos + 2 literales nuevos; nombrados +2 |
| `mi-wallet-labels.test` / `desglose-tienda-labels.test` | 16→18 textos + 2 literales nuevos; actores 15→17 |
| `desglose-tienda.test` | `CREDITO_SEED` +2 |
| `caja-derivacion-457.test` | POOL +2 filas (1 000,00 y 130,00); título 25→27 |
| `ComposicionGananciaCard.test` / `DetalleFilaComposicion.test` | dos filas nuevas con ₡0 en las listas-contrato; controles 16→18 |
| fixtures de composición (6 tests) | `egresos` +2 claves en `"0.00"` (lo exige el `Record`) |
| `api-key-dependencias-usuario` (censo) | +2 relaciones a `usuario` (`SOLO_OPERADOR`) |
| migraciones previas (`caja-459`, `cobro-tienda-461`, `wallet-461`, `abono-tienda-457`, `caja-tesoreria`) | los tramos `slice` corren 2 posiciones; conteos 25→27, 16→18, 63→65; rama crédito 5→7 |

**Reescritura de una aserción (no literal):** `caja-composicion.test.ts` R26 afirmaba «el pago a la
tienda no entra en la columna» con `salidas > totalEgresos`, que dependía de los importes del conjunto;
con los dos reversos (propios, fuera de «Salió», importes mayores del catálogo) dejó de valer. Se afirma
ahora directamente: quitar el pago a la tienda no mueve `totalEgresos` y sí baja `salidas`.

**Queda rojo hasta TB.9:** `historial-accion-escrituras-cubiertas.guardia` (los dos tipos nuevos aún no
tienen productor; sus métodos nacen en TB.9).
