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

## Arreglo heredado de la 457 (§12.4): el saldo del pago a una tienda por el `tx` del candado

`LiquidacionService.registrarPagoTienda` leía el saldo que decide (`agregarSaldoPorTienda`) por el
cliente global mientras tenía el candado de la tienda. Ahora le pasa el `tx` (tercer parámetro, molde
`AbonoTiendaService`). Tests: `tests/integration/db/liquidacion-pago-tienda-458-concurrencia.test.ts`
(pool de UNA conexión: el pago se registra, restante 6 000,00; `excede` con 2 500,00 sin escribir) y
`tests/unit/services/liquidacion-service.test.ts` R29 (`toHaveBeenCalledWith("t1", {}, d.tx)`).
Mutación (quitar el `tx`): **3 rojos de 91** (los dos de Postgres, por la transacción que caduca a los
10 s, y el unitario), `aplicado=true`, `restaurado=true`.

## TB.5 — Orden estable (R23)

`listarPorTienda` y `listarPorMensajero`: `orderBy [fechaMovimiento desc, createdAt desc, id desc]`
(el de la caja desde la 334). Test: `tests/integration/db/wallet-orden-estable-458.test.ts` (14 filas
del mismo instante en dos tandas de `created_at`, páginas de 4: 0 duplicadas, 0 faltantes, orden
esperado calculado a mano, dos lecturas iguales; tienda y mensajero). Tests reescritos (contrato
nuevo, R23): `wallet-tienda-movimiento-repository.test.ts` R19 y `pago-mensajero-movimiento-repository
.test.ts` R20 (`orderBy` = la lista de tres). Mutaciones: tienda solo por fecha → rojo (1/2);
mensajero sin `createdAt` → rojo (1/2).

## TB.8 / TB.9 — Estado de anulación derivado y anulación uniforme

**Piezas nuevas (backend):**

| Pieza | Qué hace |
| --- | --- |
| `lib/types/wallet-anulacion.ts` | Contratos de borde: `destinoMovimientoSchema` (`{libro, movimientoId}` \| `{documento, id}`), `anularMovimientoSchema`, `AnularMovimientoResult`, `CaminoAnulacion`, `MotivoNoAnulable`; `anularEgresoCajaSchema`, `anularCobroRechazoTiendaSchema` y sus resultados. Todos `.strict()`, sin monto. |
| `EgresoCajaAnulacionService` (+ interfaz) | Anula con motivo sueldo / gasto de Ordenex / gasto fijo cobrado (origen `gasto`) e indemnización (origen `orden_incidente`, D8). Rol antes de leer; constancia (`AjusteCajaAnulacionRepository.anularEgreso`, `createMany skipDuplicates`) + contra-asiento `ingreso_ajuste` por el monto del original con `ahora()` inyectado; si el contra-asiento ya existía (vía vieja sin motivo) revierte y responde `ya_anulado`. Servicio propio (no un método de `WalletEgresoService`, construido en 32 sitios): **desviación anotada** respecto de «`reversarEgreso` gana motivo»; `reversarEgreso` conserva su comportamiento y solo gana el arreglo R4 (sin uuid). |
| `AjusteCajaAnulacionRepository.anularEgreso` / `.constanciasDe` | D13: misma tabla que la corrección, método y tipo de historial propios (`egreso_caja_anulado`). |
| `RechazoTiendaCobroService.anular` + `RechazoTiendaCobroAnulacionRepository` + `CajaRechazoTiendaCobroFeedService` | D7: rol → cobro `aprobado` (si no, `no_anulable/no_aprobado`) → en la tx: líneas originales (sin la del flete en la caja: `no_anulable/sin_linea_de_caja`, sin escribir) → constancia (`skipDuplicates`) → reversos de cargo por el monto de SU línea → créditos espejo SOLO por los débitos existentes. `estado` sigue `aprobado` (R73). Historial `cobro_rechazo_tienda_anulado` (etiqueta: la del envío, como la aprobación; monto: el flete, como la aprobación — **desviación anotada**: el design decía «etiqueta = tienda», pero el constructor tipado de `rechazo_tienda_cobro` es el del envío). El constructor del servicio gana `anulacion: {repo, caja}` SIN valor por defecto (4 sitios actualizados). |
| `anularCobroRechazoTiendaAction` | Borde del camino nuevo (`lib/actions/rechazo-tienda-cobro.ts`). |
| `WalletAnulacionService.enrutar` + `WalletAnulacionDestinoRepository` | La tabla de design §4.2: cada destino a su camino (egreso_caja, ajuste_caja, cobro_tienda, pago_por_cuenta_tienda, aporte_capital, abono_tienda, liquidacion_pago, rechazo_tienda_cobro, premio_del_ranking); `no_anulable` con motivo para lo del cierre, lo reclasificado y los contra-asientos (R65). Rol antes de leer (R82). |
| `anularMovimientoAction` / `anularEgresoCajaAction` (`lib/actions/wallet-anulacion.ts`) | La acción única: sesión → forma → `enrutar` → la action existente del camino con el MISMO actor → respuesta normalizada; un estado desconocido lanza (500), nunca se traduce a «ok». |
| `EgresoCajaDocumentosRepository` / `IndemnizacionDocumentosRepository` | Lectores nuevos de `LectoresDocumentosCaja` (`egresos`, `indemnizaciones`); `rechazos` = `RechazoTiendaCobroAnulacionRepository.estadoDeDocumentos` (id = la gestión). «Anulado» del egreso lo decide el contra-asiento en la base; sin constancia → `motivoNoRegistrado` (R72). |
| `WalletService.tipoDeDocumentoOriginal` | + `egreso_caja`, `indemnizacion` (solo origen `orden_incidente`), `rechazo_tienda_cobro` (las dos líneas, mismo documento). `DocumentoCajaDTO` gana esos tipos y `motivoNoRegistrado?`. |

**Toque mínimo de UI (lo exige el `Record` total de `DocumentoCajaAcciones` y `DOCUMENTO_CAJA_NOMBRE`):**
los tres tipos nuevos se anulan desde el libro actual por `anularMovimientoAction` con el id de la
propia fila. Efecto visible hoy: la indemnización por incidente y las dos líneas del cobro por rechazo
ofrecen «Anular…» en `/wallet`; el egreso administrativo sigue con «Reversar» (la columna lo resuelve
antes, `WalletLedger`), hasta que la 458-C lo sustituya por el panel. Nada más de UI.

**Desviación de alcance anotada (TB.8):** el `documento` de las filas del libro de la TIENDA y del
MENSAJERO no se añade a `WalletTiendaMovimientoDTO`/`PagoMensajeroMovimientoDTO` (los desgloses que
los pintan se retiran en 458-D): el estado de anulación de esas filas viaja en `FilaEstadoCuentaDTO`
(TB.6), que es lo que 458-D consume.

**Tests:** `tests/unit/services/wallet-anulacion-service.test.ts` (19: servicio de egresos, tabla de
enrutado, borde y normalización), `tests/unit/services/rechazo-tienda-cobro-anulacion.test.ts` (11),
`tests/integration/db/wallet-anulacion-458.test.ts` (10, por las actions sobre el escenario 459),
`tests/integration/db/wallet-anulacion-concurrencia.test.ts` (2, composition roots reales y filas
commiteadas), `caja-invariante-tiendas.test.ts` (+3 pasos: anulación del cobro por rechazo,
indemnización, indemnización anulada; R7/R8 a 0,00), bloque «lo que la 458 añade a propósito» en
`caja-caracterizacion-459.test.ts` (6 casos nuevos; ningún literal anterior tocado).

**Mutaciones TB.8/TB.9** (arnés con autocomprobación; todas `aplicado=true`, `restaurado=true`):

| # | Mutación | Tests | Rojos |
| --- | --- | --- | --- |
| 4 | `egreso_reverso_flete_devolucion` como `efectivo` | 48 | 7 |
| 5 | `flete_devolucion_anulado` en «cargos» | 47 | 1 (medida antes de añadir el caso de desglose al bloque a propósito; se repite en TB.15) |
| 6 | anular el rechazo sin el crédito de la tienda | 41 | 7 |
| 7 | reverso del flete con el monto del IVA | 41 | 7 |
| 7b | contra-asiento del egreso con monto `1.00` | 19 | 3 |
| 8 | constancia del egreso sin `skipDuplicates` (dos a la vez) | 2 | 1 |
| 8b | constancia del rechazo sin `skipDuplicates` | 2 | 1 |
| 10 | `tipoDeDocumentoOriginal` sin `rechazo_tienda_cobro` | 10 | 1 |
| 11 | el lector de egresos no mira la base | 10 | 2 |

## TB.6 — Estado de cuenta (tienda, mensajero, bodega)

| Pieza | Qué hace |
| --- | --- |
| `lib/types/estado-cuenta.ts` | `estadoCuentaSchema` (`.strict()`; `cuenta {tipo, id uuid}`, `desde`/`hasta` `YYYY-MM-DD` CR con `diaCalendarioSchema` de la 461, `chip?`, `page`, `pageSize` con tope en `lib/config/estado-cuenta.ts`), `EstadoCuentaDTO`, `FilaEstadoCuentaDTO`, `RegistroDTO`, `SentidoDelSaldo`. |
| `lib/utils/estado-cuenta-chips.ts` | `CHIP_POR_CATEGORIA_TIENDA` / `_MENSAJERO`: `Record` TOTAL por libro sobre (categoría, origen[, premio]). Un contra-asiento va al chip de su original. |
| `lib/utils/estado-cuenta.ts` | Puro: el filtro de cada chip como lista cerrada de pares (derivada del mismo diccionario), la clave que une original y contra-asiento (D3), `totalesNetos` (excluye el par solo si está ENTERO en el periodo) y `saldoAlFinal`. |
| `EstadoCuentaRepository` | Ventana `SUM(± monto) OVER (ORDER BY fecha, created_at, id)` sobre la cuenta ENTERA hasta `hasta`; periodo y chip FUERA; paginación y conteo en SQL; `numeric → text`. Bodega: UNION «Declarado»/«Recibido» sobre `cierre_bodega` sin rechazadas. Totales por tipo (la resta la hace el servicio), anulaciones y comprobantes en lote, aprobador de los cierres. |
| `EstadoCuentaService.leer` | Rol antes de leer (R81); cuenta con su papel o `no_encontrado`; chip de otro tipo de cuenta → `validation_error`; saldo actual e inicial con `derivarSaldoTienda` / `derivarCuentaPorPagar` / `saldoDe`; totales netos; **afirma R22 y lanza si no cuadra**; filas con saldo corrido, chip, anulación (motivo, quién, día CR), contra-asiento, comprobante, anulable, nace de un cierre, registro (persona o «aprobación del cierre por …»). |
| `verEstadoCuentaAction` (`lib/actions/estado-cuenta.ts`) | Borde, `@sin-superficie` hasta 458-D. |

**Contrato para 458-D (y desviaciones anotadas):** la fila lleva `categoria` y `origenTipo` —NO un
`concepto` ni un `origen` ya rotulados— porque los textos viven en los diccionarios de la 461 (`app/`)
y `lib/` no los importa; la frase «quién le debe a quién» la compone la pantalla con `sentido` y
`cuenta.nombre`. `referencia` no viaja (queda para 458-C/D si la necesitan: está en el documento).
En la bodega el saldo es lo que TIENE POR ENTREGAR: cargo = «Declarado», abono = «Recibido», y
`saldoFinal = inicial + cargos − abonos` (la misma cuenta leída desde la bodega).

**Tests:** bloque TB.6 de `wallet-caracterizacion-458.test.ts` (7 casos: la tienda C entera fila a
fila con su corrido, la constancia del pago anulado, desde el 12 sep —saldo inicial 6 200,00 y el par
fuera de los totales—, hasta el 11 sep —bordes 23:30/00:30 CR—, el chip «Cobros» con el corrido de la
cuenta entera, el mensajero M y la bodega Z; R22 contra `listarSaldosTiendas`, la cuenta por pagar y
el pendiente de `/wallet/satelites`), `tests/integration/db/estado-cuenta-saldo-corrido.test.ts` (par
a caballo de dos periodos, páginas de 3, R81 por la action, H6), `tests/unit/utils/saldos-corridos
.test.ts` (10, puros), `tests/unit/guards/estado-cuenta-chips-total.guardia.test.ts` (totalidad +
contraprueba + no-vacuidad).

## TB.7 — «A quién» y «Registró» (R56/R57)

`LibroCajaAutoriaService.resolver({ movimientoIds })` + `LibroCajaAutoriaRepository` (una consulta por
tipo de origen presente) + `autoriaDelLibroCajaAction` (`lib/actions/libro-caja-autoria.ts`,
`@sin-superficie` hasta 458-E). Devuelve por fila `aQuien {nombre, beneficiario, cuenta, esOrdenex}` y
`registro {nombre, automatico {accion, por}}` — datos, no frases: la 458-E compone «Automático ·
Aprobación del cierre por Ana» con sus rótulos. Tabla de design §3.4 completa. **Desviación anotada:**
es una acción aparte que la 458-E llama con los ids de la página, no un campo más de
`WalletMovimientoDTO` (evita tocar el `WalletService`, construido en decenas de sitios y compartido con
la 458-A). Test: `tests/integration/db/libro-caja-a-quien.test.ts` (7: una fila por origen con el
nombre leído de `usuario`, enlaces, «—» sin anotación, automático con quien decidió, H6, R82).

**Mutaciones TB.6** (todas `aplicado=true`, `restaurado=true`, sobre `wallet-caracterizacion-458`):
M1 signo del corrido al revés → 4/13 rojos; M2 sin `created_at` en la ventana (tienda) → 3/13; M2b
(mensajero) → 1/13; M12 totales sin excluir el par → 4/13; bodega con rechazadas → 1/13; borde de
periodo en UTC en vez de día CR → 1/13.

## TB.10 — Comprobante lateral (R74–R80)

`PREFIJO_COMPROBANTE` +3 (`movimientos-caja`, `cobros-tienda`, `pagos`). `WalletComprobanteRepository`
(`crear` con `createMany({ skipDuplicates })` → `ya_tiene` sin interpretar un P2002; `lateralDe`,
`duenoDeLateral`, `documento` para los tres de la 459/457, `tiendaDeFila`) + `WalletComprobanteService`
(`subir` / `registrarEnTx` / `retirar` para los registros de TB.11; `adjuntar` y `ver`) +
`lib/actions/wallet-comprobante.ts` (`adjuntarComprobanteAction(FormData: destino JSON + archivo)`,
`verComprobanteAction({ destino })`, las dos `@sin-superficie` hasta 458-C/D). Tipos en
`lib/types/wallet-comprobante-lateral.ts`.

El destino se clasifica con la MISMA tabla que la anulación: `WalletAnulacionService` gana
`clasificar(destino)` (la clasificación sin el rol; `enrutar` = rol + `clasificar`), y
`FUENTE_POR_CAMINO` (`Record<CaminoAnulacion, …>` total) dice dónde vive el comprobante: egreso y
corrección → caja; cobro de Ordenex → fila de la tienda; pago de la 172 → `liquidacion_pago`; pago de un
gasto, aporte y pago de la tienda → en SU documento (`no_admite: en_su_documento` al adjuntar; `ver`
los lee de su `comprobante_path`); cobro por rechazo y premio → sin comprobante. Alcance de la tienda:
solo filas de SU libro y los documentos que la nombran (`liquidacion_pago`, `pago_por_cuenta_tienda`,
`abono_tienda`); todo lo demás —caja, mensajeros, ajeno, inexistente— `no_encontrado` idéntico, y ANTES
de clasificar (así una fila de cierre de la caja no delata que existe con `sin_comprobante`). Rótulo
(R80): `{ fuente, categoria, fecha }` sin la ruta; el texto lo pone la pantalla.

**Desviación anotada:** `ver` cubre también los comprobantes de los documentos de la 459/457 por el
mismo destino (R77 dice «todo comprobante»); sus actions propias (`obtenerComprobante…`) siguen igual.
La indemnización (egreso de caja anulable) también admite adjuntar después (R79: «movimiento anulable»).

**Tests:** `tests/unit/services/wallet-comprobante-service.test.ts` (21: tipo, tamaño, fallo de subida
no registra, fallo de registro retira, `ya_tiene` retira, pre-chequeo sin subir, `no_admite` por
camino, carpeta y columna por camino, rol antes de leer, alcance de la tienda, actions `.strict()`) y
`tests/integration/db/wallet-comprobante-alcance.test.ts` (8, Postgres: las tres columnas, UNIQUE por
el repo saltándose el servicio, sin huérfanos, D6, URL + rótulo, R78, R77 ajeno = inexistente, borde
sin reemplazar/borrar).

**Mutaciones TB.10** (`aplicado=true`, `restaurado=true`): sin comprobar el dueño → 1/8 rojo; sin el
filtro de libro de la tienda → 1/8; `crear` sin `skipDuplicates` → 7/8; sin retirar el objeto → 2/20;
cobro a la columna de la caja → 4/28; la tienda pide cualquier documento → 1/21. Dos supervivientes
iniciales, anotados: quitar SOLO `libro !== "tienda"` (lo cubre `tiendaDeFila`, capa redundante:
equivalente) y la lista de documentos de la tienda (sobrevivía hasta añadir el caso del cobro por
rechazo, que habría respondido `sin_comprobante`).

## TB.11 — Bordes: «a quién», referencia y comprobante (R42, R43, R50, R51, R74–R76)

Cinco caminos, y en los cinco sin los campos nuevos la llamada es la de antes:

| Camino | Action (acepta además `FormData`) | Campos nuevos | Dónde queda |
| --- | --- | --- | --- |
| Sueldo / gasto de Ordenex | `registrarEgresoAdministrativoAction` | `contraparteNombre?`, `referencia?`, `comprobante?` | `wallet_anotacion` + `wallet_comprobante.caja_movimiento_id` en la tx de `crearMovimientoRegistrado` |
| Corrección de caja | `registrarMovimientoManualAction` | ídem | ídem |
| Pago a una tienda (172) | `registrarPagoTiendaAction` | `comprobante?` | `wallet_comprobante.liquidacion_pago_id`, en la tx del pago |
| Reparto a un mensajero (205) | `registrarRepartoMensajeroAction` | `comprobante?` | una fila por pago del reparto, el MISMO objeto (una transferencia) |
| Cobro a una tienda (461) | `registrarCobroTiendaAction` | `comprobante?` | `wallet_comprobante.tienda_movimiento_id` (el débito `cobro_manual`) |

Piezas: `lib/types/wallet-laterales.ts` (campos laterales como intersección con los schemas de hoy; topes
reusados: 120 del beneficiario 459 y 60 de la referencia 172; campo en blanco = ausente;
`separarComprobante`), `lib/services/registro-con-comprobante.ts` (`registrarConComprobante`: sube antes,
escribe en la tx, retira si no quedó; `lateralesDeCaja`), `lib/actions/_shared/comprobante-lateral.ts`
(el puerto real y la lectura del archivo validado), `IWalletMovimientoRepository.crearMovimientoRegistrado`
gana `laterales?` (escritos en SU transacción solo si el asiento se escribió). Los servicios reciben el
puerto `IWalletComprobanteService` como último parámetro OPCIONAL del constructor; con comprobante y sin
puerto, LANZA (un composition root que no inyecta no descarta el archivo en silencio). Los cinco
composition roots lo inyectan.

**Decisiones anotadas:**
- **D5 en el servidor:** «a quién» es opcional también en sueldo y gasto. R42 es del diálogo («el
  diálogo DEBE pedir»); exigirlo en el servidor rompería el diálogo de hoy hasta que llegue la 458-C y
  violaría «sin los campos nuevos, byte a byte el de hoy». **Contrato para la 458-C:** el diálogo lo
  exige en sueldo y gasto.
- **Sobrecargas de tipo, no contrato nuevo:** con un OBJETO cada action conserva su tipo de resultado
  de hoy (sin `comprobante_no_guardado`, que no puede ocurrir sin archivo); con `FormData` el tipo suma
  esa rama. Así los tres consumidores de hoy (`RegistrarMovimientoCajaDialog`, `PagoTiendaAcciones`,
  `PagoMensajeroAcciones`, y el `switch` exhaustivo de `RegistrarPagoDialog`) no se tocan. Las firmas de
  sobrecarga van como `export function` (sin `async`): la guardia de la 205 cuenta las acciones del
  reparto con `export async function` y seguiría viendo tres.
- **Superficie del prototipo:** las escrituras nuevas van como closures dentro del método público, no
  como métodos privados: `CobroTiendaService` («dos métodos y ni uno más», R19 de la 461) y
  `LiquidacionService` (lista cerrada de métodos) no cambian de superficie.
- **El `.strict()` se conserva:** el archivo se separa del `FormData` ANTES del `parse`; cualquier otra
  clave no prevista sigue muriendo en el borde.
- **172 [P7]** decía que el pago a un mensajero no admite adjunto; el spec aprobado de la 458 (R74) lo
  supera para el reparto (205). `registrarPagoMensajeroAction` (pago simple contra un cierre) no se tocó.

**Tests:** `tests/integration/db/wallet-registro-comprobante-458.test.ts` (9, Postgres, por las actions
con `FormData`: anotación recortada y comprobante en su fila; reenvío de la clave sin duplicar; sin
campos nuevos ninguna fila lateral; corrección con solo «a quién»; archivo inválido y almacenamiento
caído no registran; registro fallido con el objeto subido revierte y retira; pago, reparto y cobro con
su comprobante; sin huérfanos) y `tests/unit/services/registro-con-comprobante.test.ts` (6).
Mutaciones TB.11 (`aplicado=true`, `restaurado=true`): anotación no escrita → 3/9; sin retirar → 2/9;
pago a tienda sin su fila → 3/9; blanco no ausente → 9/9; reparto sin fila por pago → 2/9; cobro sin
fila → 2/9; sin puerto descarta en silencio → 1/6; laterales siempre presentes → 0/9 en integración
(equivalente en la base: `{}` no escribe nada) y 1/70 en unit (la llamada deja de ser la de antes).

**Tests ajenos adaptados (no son literales de dinero):**
- `tests/integration/db/liquidacion-idempotencia.test.ts`: su `tx` en memoria no tenía `groupBy` del libro
  de tiendas; el arreglo heredado (saldo por el `tx` del candado, commit `db616cf9`) lo necesita. Se
  delega en la MISMA lectura comprometida (mismo `log`, misma foto): el experimento R83/R46 no cambia.
  **Esto debió verse en el commit del arreglo heredado; se vio al correr integration/db entera.**
- Catálogos de enums de las migraciones anteriores (el mecanismo establecido: «lo que features
  posteriores añadieron»): `liquidacion-migration`, `wallet-tienda-cobro-migration` (+2 de la tienda),
  seis de `historial_accion` (+`cobro_rechazo_tienda_anulado`, `egreso_caja_anulado`) y
  `orden-traspaso-migration` (+2 migraciones). **También de TB.2/TB.3: se vieron aquí.**

**Rojos ajenos aislados:** en la corrida entera de integration/db, 4 archivos cayeron por `40P01`
(deadlock, 3) y una FK de siembra (`cierre-rechazado-aviso-dedupe`); aislados y en serie, 3 de 3 verdes
(47/47 cada vez). Es el modo de flake conocido (memoria «cuatro modos de flake»).

## TB.12 — «Así queda» (R44–R47, R50, R82)

`lib/types/efecto-movimiento.ts` (`CONCEPTO_REGISTRO_SEED`: los diez conceptos de §4.1;
`previsualizarMovimientoSchema` `.strict()`; `EfectoMovimientoDTO`), `lib/utils/efecto-movimiento.ts`
(`EFECTO_POR_TIPO`, `Record` total por concepto: líneas de caja + asiento en la cuenta; y
`efectoDeMovimiento`, PURA: filas hipotéticas + `derivarCaja` dos veces + `derivarSaldoTienda` /
`derivarCuentaPorPagar`; ninguna resta propia), `PrevisualizarMovimientoService` (+ interfaz; rol antes
de leer; lee la caja sin filtros, el saldo inicial vigente, el primer día y la cuenta) y
`previsualizarMovimientoAction` (`lib/actions/efecto-movimiento.ts`, `@sin-superficie` hasta 458-C).

**Contrato para la 458-C:** el diálogo enruta por `ConceptoRegistro` (la MISMA clave que
`EFECTO_POR_TIPO`); `cifraPrincipal.rotulo` es el ESTADO de la caja (`saldo`/`flujo`), el texto lo pone
la pantalla con el diccionario de la 459; `superaDisponible` solo viene en el pago a una tienda y en el
pago de una tienda a Ordenex; `saldoEnContra` en cualquier concepto de tienda que la deje en negativo.
**Anotado:** la cuenta del mensajero se valida por existencia del usuario (`obtenerNombreMensajero`), no
por rol; un id de otro rol daría la cuenta por pagar de ese usuario (cero): lectura, sin efecto.

**Tests:** `tests/unit/utils/efecto-movimiento.test.ts` (14: un caso por concepto con cifras escritas a
mano, «no cambia», la línea de capital del aporte, identidad R7 tras cada concepto, `saldoEnContra`,
`superaDisponible` en el borde exacto), `tests/unit/actions/previsualizar-movimiento-action.test.ts` (5:
por rol con el servicio real, `forbidden` sin leer nada, `.strict()`, `cuentaId`, `no_encontrado`) y
`tests/integration/db/efecto-movimiento-predice.test.ts` (5, Postgres: para los diez conceptos se
previsualiza y luego se registra por su camino REAL; la caja y la cuenta quedan EXACTAMENTE como se
previó — R50 medido, no supuesto; tabla de «cambia» de §4.1). `caja-derivaciones.guardia` verde.
Mutaciones TB.12 (todas rojas, `restaurado=true`): **M9** aporte sin la línea de capital → 3/19; cobro
con categoría de corrección → 2/5; pagar el saldo exacto como excedido → 1/14; sin aviso de saldo en
contra → 2/19; rol después de leer → 1/5; pago a tienda como crédito → 1/5.

## TB.13 — «Cómo quedó» (R58, parte servidor)

`ComoQuedoRepository` (+ interfaz), `ComoQuedoService` (+ interfaz), `lib/types/como-quedo.ts` y
`comoQuedoAction` (`lib/actions/como-quedo.ts`, `@sin-superficie` hasta 458-C). Entrada: la fila de un
libro (`{ libro, movimientoId }`). Salida: `caja` (`derivarCaja` sobre las líneas con
`(fecha_movimiento, created_at, id) ≤` la de referencia, comparadas EN SQL contra la fila, sin pasar
instantes como parámetro) y `cuenta` (saldo de la tienda / cuenta por pagar del mensajero hasta su fila).

**Contrapartida entre libros** (lo que el design no detalla): la fila del otro libro con el MISMO origen
(`origen_tipo`, `origen_id`; el débito de un cobro, por las líneas `cobro_tienda*` que lo nombran)
escrita MÁS CERCA en `created_at`. Los dos asientos de un registro van en la misma transacción; su
contra-asiento, en otra: así un pago y su anulación, que comparten origen, no se confunden (medido: la
mutación «la más lejana» cae). Una línea de caja cuya contrapartida toca VARIAS cuentas (un cierre) da
`cuenta: null`; una fila de cuenta sin línea de caja (pago a un mensajero, [P2] de la 173) da `caja:
null`. **Desviación anotada:** servicio propio en vez de `EstadoCuentaService`/`WalletService` (no
ensanchar dos constructores compartidos con la 458-A y decenas de tests).

**Test:** `tests/integration/db/como-quedo.test.ts` (7, Postgres; lo esperado se deriva APARTE cortando
el prefijo de los libros leídos en orden): tras la última línea == resumen sin filtros; una línea del
medio == su prefijo; el pago a una tienda que tiene anulación → la tienda tras SU débito; el débito de un
cobro → la caja tras SU cargo; el pago al mensajero sin caja; R82. Mutaciones TB.13 (todas rojas):
contrapartida más lejana → 1/7; caja sin incluir la fila → 4/7; cobro sin su cargo → 1/7; saldo sin
acotar a la tienda → 2/7; orden sin `created_at` → 1/7.
