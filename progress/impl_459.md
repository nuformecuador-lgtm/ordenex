# Ficha 459 — bitacora del BACKEND (feature/459-backend)

- Rama: `feature/459-backend` desde `6280fdbb`. Base: CLON local `ordenex_459` (`prisma migrate status`:
  `localhost:5432`, `ordenex_459`, al dia con las 4 migraciones nuevas).
- `node_modules` PROPIO del worktree desde el bloque B (junction quitado, `pnpm install --frozen-lockfile`,
  `prisma generate`; el cliente del repo principal no cambio: md5 igual antes y despues).
- Busqueda: MCP `codebase-memory` (`R-job-singularis-projects-ordenex`) primero; indice rancio, todo simbolo
  confirmado en el archivo real.
- Sin `feature_list.json`.

## Estado por tarea

| Tarea | Estado | Donde |
| --- | --- | --- |
| T0.1–T0.3 fase 0 | HECHA (14 mutaciones rojas + 1 equivalente) | `tests/integration/db/_fixtures/caja-459.ts`, `caja-caracterizacion-459.test.ts`, `progress/impl_459_fase0.md` |
| T A.1 tipos | HECHA | `lib/types/wallet.ts` (`capital`, `CajaResumenDTO` + 7 campos, `EstadoCaja`) |
| T A.2 derivacion | HECHA | `lib/utils/caja-tesoreria.ts` (4 `derivarBalance`), `caja-derivaciones.guardia` 3→4 |
| T A.3 fotografia | HECHA (solo el bloque «a proposito» reescrito) | `caja-caracterizacion-459.test.ts` |
| T A.4 estado | HECHA; el lector de B.12 es el REAL (`AporteCapitalRepository`), sin `TODO(459-B)` | `WalletService`, `WalletMovimientoRepository.primerDiaDeLaCaja` |
| T A.5 invariante + guardia | HECHA | `lib/utils/invariante-tiendas.ts`, `caja-clasificacion-459` |
| T A.6 finanzas/metricas | HECHA | `lib/analytics/finanzas-diarias.ts`, `metrics.ts` |
| T A.7, A.8 textos y tarjeta | FRONTEND | — |
| T A.9 `cargar-kpis.ts` | FRONTEND (vive en `app/`, no autorizado) | — |
| T B.1 | LEADER | — |
| T B.2–B.5 migraciones | HECHAS; up→down→up identico (`foto-esquema`), rollback con filas falla sin borrar | `db/migrations/20260925120000_…`, `…120100_…`, `…120200_…`, `caja-459-migration.test.ts` |
| T B.6 clasificacion | HECHA en backend; `ORIGEN_TIENDA_LABEL` y su test → FRONTEND (no autorizado) | Records de `lib/`, `metrics.ts` |
| T B.7, B.8 | HECHAS | comprobante y descripciones |
| T B.9 puertos + repos + historial | HECHA | `lib/services/Caja*FeedService.ts`, `lib/repositories/{PagoPorCuentaTienda,AporteCapital}Repository.ts` |
| T B.10, B.11 servicios | HECHOS | `lib/services/{PagoPorCuentaTienda,AporteCapital}Service.ts` |
| T B.12 actions | HECHA (integracion POR LA ACTION, buildService real) | `lib/actions/{pago-por-cuenta-tienda,aporte-capital}.ts` |
| T B.13 concurrencia | HECHA (entrelazado FORZADO, no carrera) | `pago-por-cuenta-tienda-concurrencia.test.ts` |
| T B.14 invariante con todo | HECHA | `caja-invariante-tiendas.test.ts` + columnas 3 y 4 en `caja-derivacion-459.test.ts` |
| T B.15, B.17 | FRONTEND | — |
| T B.16 `documento` en `WalletMovimientoDTO` | PENDIENTE: cambia un DTO que consumen fixtures de pantalla no autorizados; lo hace quien toque el libro (los repos ya tienen `estadoDeDocumentos`) | — |
| T C.4 migracion + guardia | HECHA | `db/migrations/20260925120300_reclasificar_cobros_459/`, `reclasificacion-459-lista.guardia.test.ts` |
| T C.5 test de la migracion | HECHA | `reclasificacion-459-migration.test.ts` |
| T C.6 rotulo | HECHO el de `ORIGEN_LABEL`; «sin acciones en esas filas» va con B.16 (FRONTEND) | `wallet-labels.ts` |

## Cambios de UI AUTORIZADOS por el coordinador (solo lo que exige la compilacion)

Solo entradas nuevas de `Record` con los textos de design §5, y los campos nuevos de los fixtures de
`CajaResumenDTO`. Ni componentes, ni textos visibles nuevos, ni tarjeta ni dialogo.

- `app/(app)/wallet/_components/wallet-labels.ts` — `DUENO_LABEL.capital` «Ordenex (capital)»;
  `CATEGORIA_LABEL` de los 4 conceptos de caja; `ORIGEN_LABEL` «Pago por cuenta de tienda», «Saldo inicial o
  aporte», «Cobro reclasificado como pago por cuenta».
- `app/(app)/wallet/_components/WalletLedger.tsx` — `DUENO_PUNTO.capital` `bg-info`.
- `app/(app)/mi-wallet/_components/mi-wallet-labels.ts` — `CATEGORIA_TIENDA_LABEL` «Pago por cuenta de la
  tienda», «Pago por cuenta anulado».
- Fixtures de `CajaResumenDTO` (+8 lineas cada uno, sin tocar una afirmacion): `tests/components/{CajaComposicionBarra,
  CajaResumenCard,ComposicionGananciaCard,DetalleFilaComposicion,DineroIdentidadesEnPantalla}.test.tsx`,
  `tests/components/descarga/WalletDescarga.test.tsx`, `tests/integration/wallet-page.test.tsx`,
  `tests/unit/components/wallet-page-cobros-pendientes.test.tsx`.
- NO tocado (queda al frontend): `ORIGEN_TIENDA_LABEL` (no rompe el build pero design §5 lo pide), `cargar-kpis.ts`.

## Tests existentes REESCRITOS (con el requisito que lo exige)

| Test | Por que |
| --- | --- |
| `caja-caracterizacion-459` (bloque «a proposito») | T A.3: literales nuevos a mano (R2, R3, R5, R6, R11) |
| `caja-tesoreria`, `caja-composicion`, `wallet-service`, `caja-cadena-pago-anulacion` | R1–R7, R11, R14: la entrada es solo efectivo y los cargos restan de «De las tiendas» |
| `analitica-financiera-service`, `analitica-financiera-serie`, `finanzas-diario`, `financiera-ingresos-repo`, `financiera-produccion.guardia` | R12/R13: ingresos diarios = efectivo; egresos con `egreso_pago_por_cuenta_tienda` (10) |
| `metrics-caja-naturaleza.guardia`, `caja-composicion-exhaustiva.guardia`, `caja-derivaciones.guardia` | R9: conceptos nuevos clasificados; 4 llamadas a `derivarBalance` |
| `historial-accion-escrituras-cubiertas.guardia`, `catalogo-y-choke-point` | R53/R78: 4 tipos y 2 entidades nuevas en el censo (59 tipos / 23 entidades / 37 de dinero) |
| `desglose-tienda`, `wallet-movimiento-repository`, `wallet-caja-descarga`, `composicion-detalle-postgres`, `wallet-fecha-elegida`, `caja-tesoreria-migration` | cubeta y dueño de los conceptos nuevos; `primerDiaDeLaCaja` en los dobles |
| `pago-por-cuenta-tienda-service` («R29 … mismo instante») | ver «Decisiones medidas» 1 |
| Resto de `M` en `tests/unit/repositories|services` | solo dobles: el metodo nuevo `primerDiaDeLaCaja` / 3er parametro de `WalletService` |

## Decisiones medidas (el spec suponia otra cosa)

1. **El mismo instante con «hoy» (R29).** design §6.1 dejaba el `DEFAULT now()` para las dos filas; medido contra
   Postgres, el cargo y la salida quedaban a **4 ms** (Prisma rellena `@default(now())` en el cliente, fila a
   fila). Ahora el servicio pasa UN instante (`ahora()`) a las dos. Mutacion B12-1 → rojo.
2. **Doble envio del saldo inicial (R73 vs R70).** Con la misma clave respondia `ya_hay_saldo_inicial`; ahora
   devuelve el original (`ya_registrado`). Mutacion B12-2 → rojo.
3. **R42, lado del pago por cuenta: mutante EQUIVALENTE.** Quitar su candado deja verde el test: sus INSERT con
   FK a `usuario` toman `FOR KEY SHARE` sobre la fila de la tienda, que choca con el `FOR UPDATE` del pago a
   tienda. Quitar el candado del OTRO lado → rojo (B13-1b). El candado queda como defensa en profundidad.
4. **Lista de la reclasificacion (autorizado por el coordinador):** casada SOLO por id; por fila: existe, es
   `debito`/`cobro_manual`, monto exacto y tienda = constante `ecf6c289-9799-4558-be6d-ce5f8a12f5cd`; control
   203 / 25.769.034,50 sobre la propia lista y sobre lo escrito. La fecha del CSV es informativa (UTC); la salida
   copia `fecha_movimiento` de la propia fila. En local y preview: `RETURN` sin escribir (medido: 0 filas).

## Nota de operaciones (antes de desplegar B)

Crear el bucket PRIVADO `wallet-comprobantes` en local, preview y prod (T B.7). Migraciones de B y C en orden.

## R → test

| R | Test |
| --- | --- |
| R1–R6, R10, R11 | `tests/unit/utils/caja-derivacion-459.test.ts` (M6 columnas 2, 3 y 4), `caja-tesoreria.test.ts` |
| R7 | `caja-derivacion-459` (500 conjuntos, semilla 459) + `caja-invariante-tiendas.test.ts` (libro entero y diferencia, tras cada paso) |
| R8, R89 | `tests/integration/db/caja-invariante-tiendas.test.ts` |
| R9, R90 | `caja-clasificacion-459.guardia` + `tests/integration/db/caja-clasificacion-459.test.ts` |
| R12, R13 | `finanzas-diario.test.ts`, `metrics-caja-naturaleza.guardia` |
| R14, R21 | `wallet-service.test.ts`, `caja-estado-459.test.ts` (MIN real), `aporte-capital.test.ts`, `caja-invariante-tiendas` (estados) |
| R15–R20, R22–R26, R28 | FRONTEND (el DTO ya los sirve: `estado`, `flujoDesde`, `deTercerosAbsoluto`, `signo*`) |
| R27 | `aporte-capital-service.test.ts` (sin metodo que sugiera), `pago-por-cuenta-y-capital-actions.test.ts` (clave «sugerido» rechazada) |
| R29, R30, R43, R53 | `tests/integration/db/pago-por-cuenta-tienda.test.ts`, `pago-por-cuenta-tienda-service.test.ts` |
| R31–R37 | `pago-por-cuenta-tienda-schema.test.ts`, `pago-por-cuenta-tienda.test.ts` (nada escrito) |
| R38 | `pago-por-cuenta-y-capital-actions.test.ts`, `pago-por-cuenta-tienda.test.ts` |
| R39, R48 | `caja-invariante-tiendas` (Δ exactos), `pago-por-cuenta-tienda.test.ts` (saldo y ningun otro libro) |
| R40, R41 | `pago-por-cuenta-tienda.test.ts` |
| R42, R50, R70 | `pago-por-cuenta-tienda-concurrencia.test.ts` |
| R44, R45 | FRONTEND (rotulos y desglose); el concepto y su cubeta: `desglose-tienda.test.ts` |
| R46, R47, R49, R51, R52 | `pago-por-cuenta-tienda.test.ts`, `pago-por-cuenta-y-capital-actions.test.ts` (R52: lista exacta de exportaciones) |
| R54, R55 | `wallet-comprobante.test.ts`, `pago-por-cuenta-tienda-schema.test.ts` |
| R56, R57 | `pago-por-cuenta-tienda-service.test.ts` |
| R58 | `pago-por-cuenta-tienda-service.test.ts` (DTO sin ids ni ruta) |
| R59–R67 | FRONTEND (dialogo y libro, T B.15/B.16) |
| R68, R69, R71–R76, R78 | `tests/integration/db/aporte-capital.test.ts`, `aporte-capital-service.test.ts`, `pago-por-cuenta-tienda-schema.test.ts` |
| R77, R87 (rotulo) | FRONTEND (rotulo en pantalla); el `ORIGEN_LABEL` y el dueño ya estan |
| R79, R91 | LEADER (consultas de produccion, `progress/`) |
| R80, R88 | `tests/unit/guards/reclasificacion-459-lista.guardia.test.ts` |
| R81–R86, R87 (libro de la tienda intacto) | `tests/integration/db/reclasificacion-459-migration.test.ts` |
| R92–R96 | `caja-caracterizacion-459.test.ts` (fotografia intacta salvo el bloque de A.3) |
| R97 | `pago-por-cuenta-tienda.test.ts` («no aparece en la lista de pagos a la tienda») |
| R98, R99 | `tests/integration/db/caja-459-migration.test.ts` |
| R100 | `pago-por-cuenta-tienda.test.ts` (descripciones sin uuid), `reclasificacion-459-migration` (descripcion sin id); pantallas → FRONTEND |

## Mutaciones (arnes con autocomprobacion: texto unico, diff no vacio, tests ejecutados > 0, arbol limpio al revertir)

| # | Mutacion | Veredicto |
| --- | --- | --- |
| A2-1 | un cargo como `efectivo` | ROJO |
| A2-2 | los cargos no restan de «De las tiendas» | ROJO |
| A2-3 | «De Ordenex» sin el capital (repetida tras B) | ROJO (3 tests; antes de B era equivalente) |
| A4-1 | `primerDiaDeLaCaja` con MAX | ROJO |
| A5-1…A5-4 | pares y tipos de `invariante-tiendas` | ROJO (4/4) |
| A6-1 | finanzas diarias suman los cargos | ROJO |
| B9-1 / B9-2 | `haySaldoInicialVigente` sin clase / sin excluir anulados | ROJO / ROJO |
| B12-1 | «hoy» con el DEFAULT de la columna | ROJO |
| B12-2 | doble envio del saldo inicial → «ya hay uno» | ROJO |
| B13-1 | sin candado en el pago por cuenta | VERDE — equivalente (decision 3) |
| B13-1b | sin candado en el pago a tienda | ROJO |
| B13-2 | sin candado del saldo inicial | ROJO |
| B14-1 | reverso del pago por cuenta como propio | ROJO |
| B14-2 | pago por cuenta como gasto propio | ROJO |
| C4-1 / C4-2 | una fila de la lista con otro monto / el down sin una fila | ROJO / ROJO |
| C5-1…C5-6 | sin monto, sin ON CONFLICT, fecha de hoy, sin tienda, parciales escriben, down borra de mas | ROJO (6/6) |

## Verificacion (salida real)

Gate COMPLETO `./init.sh` contra `ordenex_459`, sobre `599e3bcb`. Log: `progress/gate_459_backend.log`
(sin `tail`, `INIT_EXIT` dentro).

- Primera corrida (sobre `117016b8`): `INIT_EXIT=1`, 13 archivos / 21 tests rojos, TODOS propios de esta rama:
  censos historicos de enum y de carpetas de migracion que no declaraban los valores de la 459 (historial x6,
  `caja-tesoreria-migration`, `liquidacion-migration`, `orden-incidente`, `orden-traspaso`, `premio-ranking`,
  `wallet-tienda-cobro`) y `wallet-egreso` (usaba `ingreso_flete` como entrada: desde R1 es un cargo). Arreglados
  en `599e3bcb` restando/declarando los posteriores (los `.sql` viejos no se tocan); ningun literal de contrato
  cambiado.
- `pnpm run typecheck`: `✓ typecheck paso`
- `pnpm run lint`: `✖ 217 problems (0 errors, 217 warnings)` (preexistentes)
- `pnpm test`: `Test Files  2195 passed (2195)` · `Tests  31011 passed | 26 skipped (31037)`
- `✓ DATABASE_URL resuelta: los 276 archivos de tests contra Postgres SI se ejecutan`; los 26 skipped son
  `AnaliticaPage.test.tsx` (17) y `AnaliticaShell.test.tsx` (9), preexistentes: **0 skipped en `tests/integration/db`**.
- `== init OK ==` · `INIT_EXIT=0`

**Veredicto:** backend de A, B y C hecho y verde (gate completo), con sus mutaciones muertas salvo un equivalente explicado; lo que queda es UI (A.7–A.9, B.6 `ORIGEN_TIENDA_LABEL`, B.15–B.17, C.6 acciones) y lo del leader.

## T B.1 (LEADER, 2026-09-24) — catálogos de producción y migraciones pendientes
- C6 en producción = M3/M4 de `progress/medicion_457.md` (sin cambios desde entonces): `wallet_movimiento_categoria`
  17 valores, `wallet_tienda_movimiento_categoria` 11, `wallet_origen_tipo` 8, `historial_accion_tipo` 52,
  `historial_accion_entidad` 21; los dos CHECK tipo↔categoría tal como se citan ahí; bucket `wallet-comprobantes`
  NO existe (se crea antes de desplegar B).
- Migraciones de `dev` que faltan en `prod` y tocan esos catálogos, además de las propias de la 459:
  `20260918120000_historial_accion_zona_sinpe` y `20260919120000_historial_accion_conciliacion_bodega` (SF-001,
  añaden valores a `historial_accion_tipo`/`_entidad`). Ninguna toca los tres enums de la wallet ni los CHECK.
- Conclusión: compatible. El down de la 459 lee `pg_enum` (P12), así que no depende de si SF-001 salió antes o después.
  Si la 459 sale SOLA por la vía de ramificar de prod, sus migraciones de historial deben aplicarse sobre un catálogo
  sin los valores de SF-001: los `ADD VALUE` son aditivos y no dependen de posición, así que también vale.
