# Ficha 461 — bitácora del backend (bloques 0, A, B y hallazgos de la auditoría)

- Fecha: 2026-09-25. Rama `feature/461-backend` (nace de `origin/dev` @ `f415f4bb`, el spec). Worktree
  propio, `pnpm install` propio, `prisma generate` propio.
- Base: clon `ordenex_461` (`CREATE DATABASE … TEMPLATE ordenex`); `prisma migrate status` al cerrar:
  «222 migrations found · Database schema is up to date!» (216 previas + 6 de esta ficha).
- Búsqueda: MCP `codebase-memory` (`R-job-singularis-projects-ordenex`) primero; el índice está rancio
  para la 459 (no ve `CobroTiendaService` ni los feeds nuevos). Todo se confirmó en el archivo real.
- Alcance: bloques **0, A, B** de `tasks.md` + los hallazgos de la auditoría que el coordinador añadió
  (`progress/auditoria_wallet.md`, `e0707f3a`): **D2, D3 (solo la corrección de caja), T1 y T2**,
  registrados como **R66–R75** al final de `requirements.md` (sección J) con su tabla R → test. Los
  bloques C y D y los fallos de pantalla P1/P3 son del `frontend_dev`.
- Fase 0: `progress/fase0_461.md` (commit `b461f29d`). Su anexo de mutaciones está al final de este archivo.

## 1. Lo que hace el backend (resumen por decisión)

1. **HD1 — el cobro escribe su cargo en la caja.** `CobroTiendaService` recibe `ICajaCobroTiendaFeedService`
   por constructor (obligatorio, R9) y escribe debito + historial + `ingreso_cobro_tienda` (propio, liquidez
   `cargo_a_tienda`, origen `cobro_tienda`/id del debito) en UNA transacción. Anulación: constancia
   `cobro_tienda_anulacion` (UNIQUE cobro_id), crédito `cobro_tienda_anulado`, reverso
   `egreso_reverso_cobro_tienda`, mismo instante, historial `cobro_tienda_anulado`. Reclasificados y sin línea
   de caja → `no_anulable`.
2. **HD2 — R8 sin excepción.** `derivarCaja` gana la cubeta `reversosDeCargos`; la liquidez «cargo» vale para
   egresos; `terceros = (ingT + reversos, egT + cargos)`. `invariante-tiendas`: solo `ajuste_debito` sin
   contrapartida. Migración de datos `20260926120200` completa la línea de caja de los cobros previos (0 filas en
   el clon; en producción Q1 = 0 desde la 459).
3. **D2 — clave de idempotencia.** `claveIdempotencia` (uuid) obligatoria en `registrarCobroTiendaSchema`,
   `registrarMovimientoManualSchema` y `registrarEgresoAdministrativoSchema`; columna UNIQUE
   `clave_idempotencia` en `wallet_movimiento` y `wallet_tienda_movimiento`; `skipDuplicates` deja `count 0` y
   el servicio relee por clave (`obtenerPorClave` / `obtenerCobroPorClave`) → `ya_registrado` sin escribir nada.
4. **D3 — anular una corrección de caja.** Tabla `ajuste_caja_anulacion`, `AjusteCajaService.anular`
   (rol → solo la corrección ORIGINAL: `ingreso_ajuste`/`egreso_ajuste`, origen `manual`, sin `origen_id` →
   constancia + contra-asiento opuesto por el monto de la corrección, origen `manual`/id, fechado con el reloj →
   historial `wallet_movimiento_manual_anulado`). `anularAjusteCajaAction` (`.strict()`). El libro marca la
   original con `documento: { tipo: "ajuste_caja", … }` (lector `LectoresDocumentosCaja.ajustes`).
5. **T1 — filtros por día CR.** `lib/types/filtro-dias-cr.ts`: `desde` = `inicioDelDiaCREnUtc`, `hasta` =
   `inicioDelDiaSiguienteCREnUtc` (cota EXCLUSIVA); los seis schemas (caja, tienda, mensajero × paginado/
   descarga) lo usan; los tres repositorios pasan de `lte` a `lt`.
6. **T2 — asientos de pago al inicio del día CR.** `LiquidacionService` fecha los asientos de los pagos a tienda
   y a mensajero (y sus anulaciones) con `inicioDelDiaCREnUtc`; el documento (`fecha_pago`) sigue a 00:00Z. El
   respaldo de la 173 (`CajaBackfillTesoreriaService`) escribe lo mismo. Migración `20260926120500` mueve +6 h
   las filas de origen `pago_tienda`/`pago_mensajero` a medianoche exacta (**6 filas en el clon**, todas del
   libro del mensajero; en producción el coordinador midió 0).
   *Decisión:* la auditoría acotaba T2 a la caja, pero con T1 (filtros por día CR) un asiento del libro de la
   tienda o del mensajero a las 00:00Z quedaría en el día anterior: se aplicó a los tres libros para que el
   filtro, el libro y el rollup digan el mismo día.

## 2. Archivos

### Esquema y migraciones (todas con `down.sql`, up→down→up probado en el clon: `scratchpad/rollback_all6.log`)

- `db/schema.prisma`: enums (+6 valores en 4 tipos, +`wallet_movimiento_manual_anulado`), modelos
  `CobroTiendaAnulacion`, `AjusteCajaAnulacion`, columnas `claveIdempotencia` (UNIQUE, nullable) en los dos libros,
  relaciones en `Usuario`, `WalletMovimiento`, `WalletTiendaMovimiento`.
- `20260926120000_cobro_tienda_461_enums` · `20260926120100_cobro_tienda_461_anulacion_y_checks` ·
  `20260926120200_cobro_tienda_461_completar_caja` (datos) · `20260926120300_wallet_461_enum_anulacion_correccion` ·
  `20260926120400_wallet_461_idempotencia_y_anulacion_correccion` · `20260926120500_wallet_461_fechas_cr_pagos` (datos).
  Los `down` de enum leen `pg_enum` (función de la 459 copiada byte a byte con sufijo `_461`); los de tablas/datos
  abortan con RAISE si hay filas que usen lo suyo.

### Nuevos (lib)

`lib/interfaces/services/ICajaCobroTiendaFeedService.ts`, `lib/services/CajaCobroTiendaFeedService.ts`,
`lib/interfaces/repositories/ICobroTiendaAnulacionRepository.ts`, `lib/repositories/CobroTiendaAnulacionRepository.ts`,
`lib/utils/descripcion-cobro-tienda.ts`, `lib/interfaces/repositories/IAjusteCajaAnulacionRepository.ts`,
`lib/repositories/AjusteCajaAnulacionRepository.ts`, `lib/interfaces/services/IAjusteCajaService.ts`,
`lib/services/AjusteCajaService.ts`, `lib/types/filtro-dias-cr.ts`.

### Modificados (lib)

`lib/actions/wallet.ts` (+`anularAjusteCajaAction`, lector `ajustes`), `lib/actions/wallet-tienda.ts`
(+`anularCobroTiendaAction`, caja en el composition root), `lib/analytics/metrics.ts`,
`lib/interfaces/repositories/{IWalletMovimientoRepository,IWalletTiendaMovimientoRepository,IPagoMensajeroMovimientoRepository}.ts`,
`lib/interfaces/services/{ICobroTiendaService,IWalletEgresoService,IWalletService}.ts`,
`lib/repositories/{WalletMovimientoRepository,WalletTiendaMovimientoRepository,PagoMensajeroMovimientoRepository}.ts`,
`lib/services/{CobroTiendaService,WalletService,WalletEgresoService,LiquidacionService,CajaBackfillTesoreriaService}.ts`,
`lib/types/{wallet,wallet-tienda,wallet-mensajero,historial-accion}.ts`,
`lib/utils/{caja-tesoreria,invariante-tiendas,desglose-tienda,aporte-por-orden,finanzas-diarias}.ts`.

### UI tocada (fuera de mi zona; registrado para el `frontend_dev`, precedente de la 459)

- Entradas de `Record` exigidas por la compilación, con los textos de design §7: `wallet-labels.ts`
  (`CATEGORIA_LABEL` ×2, `ORIGEN_LABEL` ×2, `DOCUMENTO_CAJA_NOMBRE` ×2 — `cobro_tienda`, `ajuste_caja`),
  `ComposicionGananciaCard.tsx` (icono), `DesgloseEgresosLista.tsx` (icono), `composicion-detalle-labels.ts`
  (`egreso_reverso_cobro_tienda: "Cobros a una tienda anulados"` — PROVISIONAL, lo confirma C.5),
  `mi-wallet-labels.ts` (`cobro_tienda_anulado`, `ORIGEN_TIENDA_LABEL.cobro_tienda`), `DocumentoCajaAcciones.tsx`
  (ramas `cobro_tienda` y `ajuste_caja` del `Record` de acciones).
- `RegistrarMovimientoCajaDialog.tsx`: la unión de resultados ganó `ya_registrado` y el archivo dejó de compilar;
  se trata como éxito (igual que hace ya con el aporte y el pago de un gasto) y `comun` envía
  `claveIdempotencia: clave` (la misma clave por apertura que ya generaba el diálogo). Sin esa línea los tres
  registros responderían `validation_error` (R66). Su test `wallet-registrar-movimiento-dialog.test.tsx` se
  alineó (la clave viaja: `expect.stringMatching(UUID)` y las listas de claves).
- El frontend es dueño de todo lo anterior: puede renombrar, mover o rehacer sin pedir permiso al backend.

### Docs API (encargo aparte)

- `docs/api/CHANGELOG.md`: entrada **2026-09-04** (serie de analítica con el día en curso `parcial`/`corteAt` y
  `cobertura`), leída de `lib/api/openapi-spec.ts` y del commit `6c35439a`.
- `docs/api/api-key-openapi.yaml`: descripciones de `CotizacionEscenarioDevuelto` (schema, `flete`, `iva`)
  alineadas con el TS; `comision`, `fulfillment` y `total` ya coincidían.

## 3. Mapa R → test (backend)

| R | Test (todos verdes; los `integration/db` contra `ordenex_461`) |
| --- | --- |
| R1, R2, R3, R4, R7, R9 | `tests/integration/db/cobro-tienda-461.test.ts`, `tests/integration/db/wallet-tienda-cobro.test.ts` (caso g), `tests/unit/services/cobro-tienda-service.test.ts`, `tests/unit/actions/wallet-tienda-cobro-action.test.ts` |
| R5, R6, R8 | `tests/unit/services/cobro-tienda-service.test.ts`, `tests/integration/db/wallet-tienda-cobro.test.ts` |
| R10, R11, R12, R13, R15, R16, R17, R18, R19 | `tests/integration/db/cobro-tienda-461.test.ts`, `tests/integration/db/cobro-tienda-461-concurrencia.test.ts`, `tests/unit/services/cobro-tienda-service.test.ts`, `tests/unit/types/cobro-tienda-anulacion-schema.test.ts` |
| R14 | `tests/integration/db/cobro-tienda-461-migration.test.ts` (CHECK del motivo) |
| R20, R37 | `tests/integration/db/cobro-tienda-461.test.ts` (documento del libro), `tests/unit/services/wallet-service.test.ts` |
| R21, R22, R23, R24, R27, R28 | `tests/unit/utils/caja-derivacion-461.test.ts`, `tests/unit/guards/caja-clasificacion-459.guardia.test.ts`, `tests/unit/guards/caja-composicion-exhaustiva.guardia.test.ts` |
| R25, R26 | `tests/integration/db/caja-invariante-tiendas.test.ts` (pasos «escenario», «cobro completado», «anulación del cobro») |
| R29 | `tests/unit/analytics/metrics-caja-naturaleza.guardia.test.ts`, `tests/unit/analytics/finanzas-diario.test.ts` |
| R30 | `tests/unit/analytics/finanzas-diario.test.ts`, `tests/integration/db/caja-caracterizacion-459.test.ts` |
| R31, R32, R33, R34, R35, R36 | `tests/integration/db/cobro-tienda-461-completar-migration.test.ts`, `tests/integration/db/caja-invariante-tiendas.test.ts` |
| R51, R55 | `tests/unit/historial-accion/catalogo-y-choke-point.test.ts`, `tests/unit/guards/historial-accion-escrituras-cubiertas.guardia.test.ts` |
| R59, R60 | `tests/integration/db/caja-caracterizacion-459.test.ts` (bloque «lo que la 461 cambia a propósito»), `progress/fase0_461.md` |
| R61 | `tests/integration/db/reclasificacion-459-migration.test.ts` (solo cableado), `caja-invariante-tiendas` paso 7 |
| R62, R63, R64 | `tests/integration/db/cobro-tienda-461-migration.test.ts`, `tests/integration/db/wallet-461-migration.test.ts`, `tests/integration/db/caja-459-migration.test.ts` (a) |
| R66, R68 | `tests/integration/db/wallet-461-idempotencia-clave.test.ts`, `tests/unit/types/wallet-461-clave-schema.test.ts`, `ya_registrado` en `wallet-service`, `wallet-egreso-service`, `cobro-tienda-service` (unit), `cobro-tienda-461` y `cobro-tienda-461-concurrencia` |
| R67 | `tests/integration/db/wallet-461-migration.test.ts` (b), `wallet-461-idempotencia-clave` (23505, NULL no chocan) |
| R69, R70, R71 | `tests/integration/db/ajuste-caja-anulacion-461.test.ts`, `tests/unit/services/ajuste-caja-service.test.ts`, `tests/unit/types/wallet-461-clave-schema.test.ts` (`.strict()`), `wallet-461-migration` (c) |
| R72 | `tests/unit/types/filtro-dias-cr.test.ts`, `tests/integration/db/wallet-filtro-dia-cr-461.test.ts` |
| R73 | `tests/integration/db/liquidacion-fechas-cr-461.test.ts`, `tests/unit/services/liquidacion-service.test.ts`, `liquidacion-anulacion`, `liquidacion-reparto-service`, `caja-backfill-tesoreria` |
| R74 | `tests/integration/db/wallet-461-fechas-cr-migration.test.ts` |
| R75 | anexo de mutaciones (abajo) |

R38–R50, R52–R54, R56–R58, R65 son del frontend (bloques C y D).

### Tests reescritos o ajustados (con su R)

- **A conciencia (contrato):** `caja-clasificacion-459.guardia` (sin contrapartida = `["ajuste_debito"]`, 8 cargos,
  signo por prefijo, contrapruebas nuevas; R21–R24), `caja-composicion-exhaustiva.guardia` (8 propios, 3 nombrados;
  R28), `metrics-caja-naturaleza.guardia` (23/16; R29), `catalogo-y-choke-point` (61 tipos, 39 «mueve dinero», textos
  §7.7; R51/R55/R69), `historial-accion-escrituras-cubiertas.guardia` (+2 productores `recibe_tx`; R55/R69),
  `caja-caracterizacion-459` (R59/R60: ingresosPropios 66 471,43, ganancia −87 374,34, 23 filas),
  `caja-invariante-tiendas` (B.12: R8 sin excepción, dos legados, 11 pasos), `wallet-tienda-cobro` (g: +1 fila
  de cargo), `wallet-service` (lectores, k1/k2/k2r, `ya_registrado`), `desglose-tienda.test` (R38 cubeta).
- **Alineados con R72 (`hasta` exclusivo):** `wallet-movimiento-repository`, `wallet-tienda-movimiento-repository`,
  `pago-mensajero-movimiento-repository`, `pago-mensajero-filtro-cierre` (+`lt`), `wallet-detalle-fila-action`,
  `wallet-caja-descarga` (`hasta: "2026-07-31"`), `wallet-fecha-elegida` (+1 ms), `composicion-detalle-postgres` (+1 ms).
- **Alineados con R73 (06:00Z):** `liquidacion-service`, `liquidacion-anulacion`, `liquidacion-reparto-service`,
  `caja-backfill-tesoreria`, `liquidacion-idempotencia`, `caja-backfill`.
- **Alineados con R66 (la clave en las entradas):** `wallet-actions`, `wallet-egresos-actions`, `wallet-tienda-cobro-action`,
  `wallet-egreso-service`, `wallet-service`, `cobro-tienda-service`, `wallet-fecha-elegida`, `wallet-tienda-cobro`,
  `_fixtures/caja-459`, `wallet-registrar-movimiento-dialog` (UI).
- **Mecánicos (dobles completos, conteos):** 11 dobles de `IWalletMovimientoRepository` (+`obtenerPorClave`), 12 de
  `IWalletTiendaMovimientoRepository` (+`obtenerCobroPorId`, `nombreDeTienda`, `obtenerCobroPorClave`), 8 de
  `LectoresDocumentosCaja` (+`cobros`, `ajustes`), fixtures de composición (ComposicionGananciaCard,
  DetalleFilaComposicion, WalletDescarga, wallet-page, wallet-actions, wallet-page-cobros-pendientes,
  financiera-ingresos-repo), `api-key-dependencias-usuario` (+2 FK), migraciones POSTERIORES
  (`caja-459-migration`, `wallet-tienda-cobro-migration`, `liquidacion-migration`, `orden-incidente-migration`,
  `premio-ranking-devengo-migration`, `caja-tesoreria-migration` 21→23), `mi-wallet-labels`.

## 4. Decisiones que no están en el spec (anotadas, no reabren nada)

- `DocumentoCajaDTO` se amplió en B.9 (y con `ajuste_caja` en D3) y no en A.1: así el árbol compila en cada commit.
- Etiqueta del historial de la anulación del cobro = `tienda.nombre` (como la 381); descripción de la caja =
  nombre + primer apellido (como la migración de la 459).
- La anulación de una corrección responde `no_encontrado` (no `no_anulable`) para el contra-asiento, el reverso
  de un egreso o un asiento automático: no hay un estado que explicar, esa fila no es una corrección original.
- El contra-asiento de la corrección lleva origen `manual` + `origen_id` = la corrección (precedente: el reverso
  de un egreso lleva origen `gasto` + id). Una corrección original se reconoce por `origen_id IS NULL`.
- T2 en los tres libros (ver §1.6). El `down` de esa migración devuelve −6 h a todo el conjunto a las 06:00Z:
  antes de esta ficha ningún asiento de esos orígenes se escribió a esa hora.
- `fechaDiaMovimientoCR` conserva su caso de medianoche exacta: lo usan las fechas `@db.Date` (cierres, documentos).
- Mensajes del `down` de la migración 4 y de los CHECK: `rollback 461`.

## 5. Salidas reales

- `pnpm run typecheck`: **TSC_EXIT=0** (`scratchpad/tsc_461h.log`).
- `pnpm run lint`: **0 errors, 217 warnings** (todas previas; `scratchpad/lint_461h.log`).
- Unitarios/componentes/guardias tocados: 153 archivos · 2 781 tests → todos verdes tras alinear
  (`scratchpad/unit_461c.log`, `unit_461d.log`, 162/162 en la última tanda).
- Integración tocada/nueva (24 + 5 + 6 archivos): todos verdes (`scratchpad/int_461b.log`… `int_461f.log`).
- up→down→up de las 6 migraciones en el clon: `scratchpad/rollback_all6.log` (tras los 6 `down`: sin tablas,
  columnas ni valores de la 461, CHECK de la 459 con 21 valores, 6 asientos de mensajero a 00:00Z; tras el
  `deploy`: todo de vuelta, 23 valores, 6 asientos a 06:00Z).
- `pnpm test` completo: dentro del gate (§7): 2 217 archivos · 31 291 tests · 26 skipped (componentes de analítica), 0 en `integration/db`.

## 6. Anexo — mutaciones (R59/R75; design §14.2 backend 1–10 y 14 + R66–R74)

Ejecutor: `scratchpad/mutar.sh` (aplica UNA línea con `sed`, exige `git diff` no vacío, corre SOLO los tests
nombrados, revierte con `git checkout` y exige árbol limpio). Informe completo: `scratchpad/mutaciones_461.log`.

Cada fila: diff de UNA línea, `git diff` ≠ 0 antes de correr, árbol limpio después. Todas en ROJO (VITEST_EXIT=1) con
el nombre del caso; el número de tests ejecutados nunca fue 0.

| # | Mutación (archivo · línea cambiada) | Tests corridos | Resultado |
| --- | --- | --- | --- |
| 1 | `CobroTiendaService`: no llama a `emitirCargoDeCobro` | invariante, cobro-tienda-461, cobro-tienda-service | **20 rojos** (R8 en «escenario» por 2 500,50; R1/R4/R25) |
| 2 | `LIQUIDEZ.ingreso_cobro_tienda = "efectivo"` | caja-derivacion-461, guardia clasificación, invariante | **12 rojos** / 32 (R22, R24: sube «Entró») |
| 3 | `LIQUIDEZ.egreso_reverso_cobro_tienda = "efectivo"` | idem | **8 rojos** / 32 (R22: sube «Salió») |
| 4 | `NATURALEZA.egreso_reverso_cobro_tienda = "terceros"` | guardia clasificación, invariante | **5 rojos** / 20 (guardia (4), R12) |
| 5 | `CUBETA.cobro_tienda_anulado = "cargos"` | desglose-tienda, mi-wallet-desglose | **2 rojos** / 32 (desglose ≠ saldo) |
| 6 | `anular` sin el crédito a la tienda | invariante, cobro-tienda-461, cobro-tienda-service | **9 rojos** / 64 (R10, R25) |
| 7 | contra-asientos con el monto de la PETICIÓN (`input.monto ?? cobro.monto`) | cobro-tienda-service | **1.ª corrida: 52 verdes — mutante EQUIVALENTE** (la petición del test no traía `monto`). Test endurecido (la petición trae `monto: "1.00"`): **1 rojo** / 52 |
| 7b | contra-asientos con una constante (`"1.00"`) | cobro-tienda-service, cobro-tienda-461 | **2 rojos** / 56 (R13) |
| 8 | la migración de datos escribe también para el reclasificado (`'cobro_manual_reclasificado'` → otro texto) | completar-migration, invariante | **6 rojos** / 14 (R32, R25) |
| 9 | la migración de datos sin `ON CONFLICT` | completar-migration | **1 rojo** / 6 (R33: dos pasadas) |
| 10 | el `down` de la migración de datos borra aunque haya reverso (`RAISE EXCEPTION` → `NOTICE`) | completar-migration | **1 rojo** / 6 (R36) |
| 14 | `tipoDeDocumentoOriginal` sin el origen `cobro_tienda_completado` | wallet-service | **2 rojos** / 39 (R37) |
| 66 | `claveIdempotencia` opcional en el schema del cobro | wallet-461-clave-schema | **1 rojo** / 10 (R66) |
| 67 | el repositorio no guarda la clave (`crearMovimientos` sin `claveIdempotencia`) | wallet-461-idempotencia-clave | **2 rojos** / 5 (R67/R68) |
| 68a | la corrección ignora `count 0` (`escritas === -1`) | idempotencia-clave, wallet-service | **3 rojos** / 44 (R68) |
| 68b | el cobro ignora `count 0` | idempotencia-clave, concurrencia, cobro-tienda-service | **4 rojos** / 59 (R68) |
| 69 | el contra-asiento de `ingreso_ajuste` con el MISMO signo | ajuste-caja-service, ajuste-caja-anulacion-461 | **2 rojos** / 21 (R69: la ganancia no vuelve) |
| 70 | se anula también el contra-asiento (`origenId === null` → `true`) | idem | **2 rojos** / 21 (R70) |
| 71 | la corrección original sin `documento` (`return null`) | ajuste-caja-anulacion-461 | **2 rojos** / 5 (R71) |
| 72a | `hasta` inclusivo en el borde (`inicioDelDiaCREnUtc` en vez del día siguiente) | filtro-dias-cr, wallet-filtro-dia-cr-461 | **6 rojos** / 15 (R72) |
| 72b | `lte` en el repositorio de la caja | wallet-filtro-dia-cr-461, wallet-movimiento-repository | **3 rojos** / 24 (R72) |
| 73 | el egreso del pago a tienda a medianoche UTC (`medianocheUtcDelDia`) | liquidacion-fechas-cr-461, liquidacion-service | **3 rojos** / 91 (R73: el rollup lo cuenta el día anterior) |
| 74 | el backfill mueve +5 h | wallet-461-fechas-cr-migration | **2 rojos** / 2 (R74) |

Las 11–13 de design §14.2 son del `frontend_dev`. Detalle (diff exacto y salida de vitest de cada una):
`scratchpad/mutaciones_461.log`, `scratchpad/m07.log`, `scratchpad/mut/*.vitest.log`; las de la fase 0 (M0-1…M0-5),
en `progress/fase0_461.md`.

## 7. Gate

Comando: `./init.sh > progress/gate_461_backend.log 2>&1; echo "INIT_EXIT=$?" >> progress/gate_461_backend.log`
(gate COMPLETO, sin `tail`, contra `ordenex_461` con las 222 migraciones aplicadas).

- **1.ª corrida** (`5ff78c6c^`, guardada en `scratchpad/gate_461_backend_1.log`): `INIT_EXIT=1` — 20 rojos en 11
  archivos, TODOS consecuencia de esta ficha y ninguno del dinero: seis censos `POSTERIORES` del historial sin
  los dos tipos nuevos, `caja-459-migration` (a) con la cola del enum, `orden-traspaso-migration` sin las seis
  migraciones declaradas, el schema del cobro de la 381 sin la clave (R66) y los dos tests del desglose de la
  tienda con instantes ISO en vez de días (R72). Corregidos en `5ff78c6c`.
- **2.ª corrida** (`5ff78c6c`), la que vale:

```
 Test Files  2217 passed (2217)
      Tests  31291 passed | 26 skipped (31317)
   Duration  808.73s
== init OK ==
INIT_EXIT=0
```

Los 26 `skipped` son los de siempre en `tests/components/AnaliticaPage.test.tsx` (17) y
`AnaliticaShell.test.tsx` (9); **0 skipped en `tests/integration/db`** (389 líneas de esa carpeta en el log,
todas `✓`).

## 8. Veredicto

Backend de la 461 (bloques 0, A y B) + D2/D3/T1/T2 de la auditoría **terminado y verde**: typecheck 0, lint 0
errores, gate completo `INIT_EXIT=0` (31 291 tests, 0 skipped en integración), 23 mutaciones en rojo, seis
migraciones con up→down→up probado en el clon. Rama `feature/461-backend` pusheada. Queda para el frontend
(C y D): renombrar/rehacer las entradas de Record y el diálogo que este backend tocó por compilación y por el
contrato de R66, y los fallos de pantalla P1/P3.

## 9. Cierre Z (2026-09-25, rama `feature/461-cierre`, `backend_dev`)

- **Entorno:** worktree propio nacido de `dev` → `git switch -c feature/461-cierre origin/feature/461-final`
  (`72f1fd7b`: frontend `3319dceb` + `progress/review_461.md`). `pnpm install --frozen-lockfile` propio (sin
  junction, 24,5 s), `prisma generate` propio. Base: clon **`ordenex_461z`** (`CREATE DATABASE ordenex_461z
  TEMPLATE ordenex`, la base compartida que ya lleva `dev` hasta la 462) + `prisma migrate deploy` de las seis de
  la 461; `.env` propio apuntando al clon (copiado sin imprimirlo; borrado al terminar). Sin `psql` en el PATH:
  el clon se creó con `prisma db execute --file` contra la base `postgres` (datasource comprobado con
  `migrate status` antes de ejecutar), y las lecturas de control con dos scripts de un solo uso en `.vitest/`
  (gitignorado) sobre `PrismaPg`.
- **Merge de `origin/dev` (`b37553db`, la 462) → `cbf32718`.** Un conflicto,
  `tests/integration/db/orden-traspaso-migration.test.ts`: se conservan las dos listas en orden de timestamp
  (primero `20260925130000_notificacion_evento_reprogramadas_esperan_cierre`, después las seis `20260926…`).
  `db/schema.prisma` (la 462 añade dos valores a `NotificacionEvento`/`NotificacionEntidadTipo`; la 461 sus
  enums, modelos y relaciones) y `tests/integration/db/_fixtures/caja-459.ts` (la 462 pasa `sinRetenidas()`
  como 7.º argumento; la 461 cablea `CajaCobroTiendaFeedService` y los dos repositorios de anulación) se
  auto-mergearon con los dos lados. Verificación del merge antes de commitear: `pnpm run typecheck`
  **TSC_EXIT=0** (0 errores) y 9 archivos de integración contra el clon (`orden-traspaso-migration`, los tres de
  `462/`, `caja-caracterizacion-459`, `caja-invariante-tiendas`, `cobro-tienda-461`, `caja-459-migration`,
  `454/gestion-pendiente-sql-real`): **103/103 verdes, 0 skipped**.
- **Orden real de aplicación en el clon** (`_prisma_migrations` por `finished_at`): `20260925120300_reclasificar_cobros_459`
  (índice 215) → `20260925130000_…462` (216, ya en la plantilla) → `20260926120000_cobro_tienda_461_enums` …
  `20260926120500_wallet_461_fechas_cr_pagos` (217–222, aplicadas aquí). `prisma migrate status`: «223
  migrations found · Database schema is up to date!».
- **T B.1, la mitad medible desde aquí.** Migraciones que `dev` añadió entre el spec (`f415f4bb`) y el merge:
  **una**, la de la 462: dos `ALTER TYPE … ADD VALUE IF NOT EXISTS` sobre `notificacion_evento` y
  `notificacion_entidad_tipo`. No toca los cuatro enums de la wallet y el historial, ni los dos CHECK
  tipo↔categoría, ni las tablas de la wallet. C461-3 (design §13) en el clon tras el merge:
  `historial_accion_tipo` **61** (con `cobro_tienda_anulado`, `wallet_movimiento_manual_anulado`),
  `wallet_movimiento_categoria` **23** (`ingreso_cobro_tienda`, `egreso_reverso_cobro_tienda`),
  `wallet_origen_tipo` **13** (`cobro_tienda`, `cobro_tienda_completado`), `wallet_tienda_movimiento_categoria`
  **14** (`cobro_tienda_anulado`); `relrowsecurity = t` en `cobro_tienda_anulacion` y `ajuste_caja_anulacion`;
  `clave_idempotencia` en `wallet_movimiento` y `wallet_tienda_movimiento`. Coincide con lo que midió el
  reviewer (`review_461.md` §4.2: 61/23/13/14). La re-medición de C461-3 **en producción** es del leader y no
  consta en `progress/contraste_461.md` (que sí tiene C461-0 = 203 / 25.769.034,50 y T2 = 0 filas): T B.1
  sigue `[ ]` en `tasks.md` por eso.
- **Hallazgos de la revisión cerrados aquí:** H1 (`specs/461-*/tasks.md`: 34 tareas `[x]` con su evidencia;
  abiertas T B.1, T Z.3, T Z.4 y T Z.5), H7 (`progress/gate_461_frontend.log` commiteado, `INIT_EXIT=0`),
  H4 (nota en `docs/release.md`, «Pendiente para la PRÓXIMA release»: `db:rollback` revierte siempre el
  último directorio; deshacer varias es a mano). H8 es este merge.
- **Gate final:** ver el apartado siguiente.
