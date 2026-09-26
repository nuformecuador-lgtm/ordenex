# 458-E «Libro de caja» — bitácora del frontend_dev

**Rama:** `feature/458-E` desde `origin/feature/458-C` en `03122992` (HEAD comprobado). Tras la revisión
de la 458-C se mergeó `origin/feature/458-C` (`fce368a3`) en `c36b2efc`. **Base:** clon `ordenex_458e`
(`CREATE DATABASE … TEMPLATE ordenex`, 0 conexiones a la plantilla; `migrate deploy`: «No pending
migrations»). `.env` del checkout principal con la base cambiada y sin `DATABASE_URL_PREVIEW`, copiado
sin imprimirlo. `pnpm install --frozen-lockfile` propio, sin junction. La base `ordenex` solo como
plantilla; `feature_list.json` sin tocar. **Búsqueda:** el MCP `codebase-memory` no se usó: el índice
está rancio para la 458-B/C (lo dice la bitácora de la 458-C); cada símbolo se leyó en el archivo real.

**Fotografías antes** (`progress/fotografias_458E_antes.log`): `caja-caracterizacion-459` +
`wallet-caracterizacion-458` → 36/36, `EXIT=0`. Después: dentro del gate (abajo).

## Confirmado al abrir (lo que esta hija da por hecho)

| Pieza | Estado | Difiere |
| --- | --- | --- |
| `autoriaDelLibroCajaAction({movimientoIds ≤ 100})` → `aQuien {nombre, beneficiario, cuenta, esOrdenex}` + `registro` (458-B TB.7) | existe; desde la revisión de la 458-C trae además `como` y `anulacion` | no |
| `textoRegistro`, `PANEL_TEXTO` (458-C) | existen | `textoAQuien` del panel es privado: se escribe la misma composición en `libro-caja-labels.ts` para no tocar `components/shared/wallet/**` (lo usa la 458-D) |
| Filtros del libro: `tipo`, `categoria`, `desde`, `hasta` en `listarMovimientosSchema` | existen | **no hay filtro «A quién»** en el borde (ver PARADO) |
| `SegmentedToggle`, `useConceptosConMovimientos` (458-A) | existen | `SegmentedToggle` no tiene `disabled` |
| Subtítulo de `/wallet` sin «dinero en caja» (TE.5) | ya lo cerró la 458-A (TA.6, T9) | nada que hacer; guardia `wallet-textos-458` verde |

## ⛔ PARADO — el filtro «A quién» (R59, parte de R54) necesita servidor

`listarMovimientosSchema`, `verResumenCajaAction` y `verDesgloseEgresosAction` no admiten `aQuien`
(`{tipo, id}` o `{nombre}`, design §6), y el `WHERE` que lo resuelva vive en el repositorio (cruce por
origen con `cierre_dia`, `liquidacion_pago`, `rechazo_tienda_cobro`, `wallet_anotacion.contraparte_nombre`…
—la misma tabla de design §3.4—) y tiene que aplicarse IGUAL a libro, tarjetas, composición, desglose y
descarga para que las tarjetas «reflejen el conjunto filtrado». Filtrar la página en el navegador
mentiría (paginación y tarjetas). Es servidor y es dinero (lo que dicen las tarjetas): **no se hizo**.
La pantalla no pinta un control que no filtra. Queda para backend_dev: schema + repositorio (con test
contra Postgres y mutación que quite la cuenta del `WHERE`) + un `SelectorBuscable` en `WalletFiltros`.

## TE.1 — Columnas (R55–R57) y descarga sin ids (R3) · `d160b2a0`

- `WalletLedger`: `Fecha · Movimiento y motivo · A quién · Monto · Registró · Ver` (+ «Desglose», que
  antepone la primitiva). «Movimiento y motivo» = concepto desde Ordenex + origen con entidad y motivo
  (`OrigenMovimiento`). «Monto» = insignia Entra/Sale + importe del servidor + dueño (`data-dueno`).
  «A quién» con enlace a `/wallet/tiendas/<id>` o `/wallet/mensajeros/<id>` (rutas de la 458-D; uuid solo
  en el `href`, nombre accesible «<nombre> · estado de cuenta de la tienda»). «Registró»: persona o
  «Automático · <acción> por <quién>». Estados «Cargando…» / «No se pudo leer» (nunca «—» por error).
- `WalletModule`: la autoría de la página por SWR (clave = ids de la página; una lectura). La descarga
  lee el libro completo y la autoría en tramos de 100 y pasa por `filasDesdeResultado` (el tope y los
  errores los sigue poniendo el adaptador común); si la autoría falla no hay archivo.
- `wallet-ledger-descarga-columnas.ts`: `Fecha · Movimiento · Motivo y origen · A quién · Entra o sale ·
  Monto · Dueño · Registró`; claves anteriores conservadas; monto STRING tal cual.
- `TIPO_LABEL`: «Ingreso»/«Egreso» → «Entra»/«Sale» (R55, mismas palabras que el filtro y el panel).

## TE.2 — Todo / Entra / Sale, concepto, periodo, tarjetas (R53, R54) · `a9db4884`

`WalletFiltros`: fuera el `Select` de tipo (`TIPO_OPTIONS` retirado); `SegmentedToggle` «Filtrar por
dirección del dinero» que se aplica al pulsarlo con el resto del borrador y viaja como el mismo `tipo`
a libro, tarjetas + composición y desglose; los conceptos con cuenta se piden con esa dirección.

## TE.3 — «Ver», anular, «Cómo quedó», refresco (R58, R60) · `cf817183`

Lo pone la 458-C (panel); aquí se prueba desde el libro nuevo dentro del módulo: anular relee libro,
tarjetas + composición y desglose con los filtros VIGENTES. **Pendiente de la 458-C «quién anuló,
cuándo y cómo»:** lo cerró la revisión de la 458-C en el servidor (`AutoriaDeFilaDTO.anulacion/como`,
`fce368a3`); medido en el recorrido: «Anulado el 2026-09-26 por Maestro QA · <motivo>».

## TE.4 — Colas y composición sin cambios (R61, R73, R83, R87) · `cf817183`

Ningún test de las colas, la composición ni las plantillas se tocó (`git diff 03122992 --name-only --
tests`: solo los 7 de la tabla de abajo). Verdes: `wallet-cobros-rechazo-tienda-panel`,
`wallet-page-cobros-pendientes`, `wallet-gastos-fijos-panel`, `wallet-gasto-fijo-plantilla-dialog`,
`ComposicionGananciaCard`, `DetalleFilaComposicion`, `CajaComposicionBarra`, `gasto-fijo-cobro-actions`,
`gasto-fijo-plantilla-actions` (205/205) y contra Postgres `wallet-anulacion-458`,
`rechazo-tienda-cobro.int`, `gasto-fijo-cobro-aprobacion`, `gasto-fijo-cobro-idempotencia`,
`composicion-detalle-postgres` (47/47). Caso nuevo del cobro anulado: bloque «T E.4» de
`WalletLibroCaja458E.test.tsx`.

## TE.5 — Subtítulo (R101)

Ya cumplido por la 458-A; guardia `wallet-textos-458` verde. Sin commit propio.

## Revisión de la 458-C mergeada · `c36b2efc`, `e35d3c01`

Conflicto en `WalletLedger.tsx` resuelto quedándose la insignia «Anulado» de la 458-C (celda de «Ver») y
quitando la que la 458-E ponía junto al concepto. El recorrido encontró que esa insignia salía TACHADA
(celda `flex` hereda el tachado): `inline-flex`, medido `text-decoration-line: none`.

## Tests retirados o reescritos (cada uno con su sustituto)

| Test | Qué cambia | Sustituto / R |
| --- | --- | --- |
| `WalletDescarga.test.tsx` «R35: los encabezados anteriores conservan su orden y «Dueño» se añade» | retirado en el MISMO commit que cambia las columnas | «458-E R55: los encabezados del libro son los de la maqueta, en su orden» (literal = contrato) |
| `WalletDescarga.test.tsx` «R34: la descarga trae «Dueño» con el mismo texto que la tabla» | el dueño se lee dentro de «Monto» | «R34 (231) / 458-E R56/R57: el archivo dice lo mismo que la tabla en «Dueño», «A quién» y «Registró»» (+ R3 sin ids) y «si la autoría no se puede leer, la descarga NO produce archivo» |
| `wallet-caja-descarga-columnas.test.ts` literal de claves/encabezados; `fila.tipo` «Egreso» | contrato nuevo a mano; «Sale» | mismo archivo + caso «458-E R56/R57/R3» |
| `wallet-ledger-dueno.test.tsx` (R31/R33) | la columna «Dueño» ya no existe | mismo archivo: el dueño se busca en `[data-dueno]` de la celda «Monto»; mismas aserciones |
| `WalletLedgerAcciones457/461.test.tsx` `tipo: "Ingreso"/"Egreso"` | «Entra»/«Sale» | mismos casos (R55) |
| `wallet-page.test.tsx` | ampliado (mocks de autoría y conceptos, caso R53–R57) | — |

## Mapa R → test (458-E)

| R | Test |
| --- | --- |
| R3 | `wallet-caja-descarga-columnas.test.ts` («458-E R56/R57/R3», «no expone identificadores»), `WalletDescarga.test.tsx` (R34/R56/R57 sin ids), `WalletLibroCaja458E` («H6/R3»); recorrido: xlsx sin uuid |
| R53 | `WalletLibroCaja458E` («R53»), `wallet-page.test.tsx` («R53/R54/R56/R57») |
| R54 | `WalletLibroCaja458E` («R54: «Entra»…», «R54: el periodo…»), `wallet-page.test.tsx` |
| R55 | `WalletLibroCaja458E` (T E.1), `WalletDescarga.test.tsx` («458-E R55»), `wallet-ledger-dueno` |
| R56, R57 | `WalletLibroCaja458E` (T E.1 y «el módulo lee la autoría»), `WalletDescarga.test.tsx`, `tests/integration/db/libro-caja-a-quien.test.ts` (458-B, servidor) |
| R58, R60 | `WalletLibroCaja458E` (T E.3), `WalletLedgerVer458C` y `DetalleMovimientoPanel` (458-C) |
| R59 | **sin test: PARADO (servidor)** |
| R61, R73 | `WalletLibroCaja458E` (T E.4) + los tests de colas sin modificar + `wallet-anulacion-458` |
| R71/R72 (fila) | `WalletLibroCaja458E` («R71/R72…»), `WalletLedgerVer458C` (B2) |
| R101 | `wallet-textos-458.guardia` |
| R104 | `progress/recorrido_458-E/` |

## Mutaciones (10, una a una; aplicada → corre > 0 tests → restaura byte a byte; `git diff` final vacío) — `progress/mutaciones_458-E.json`

| # | Mutación | Rojos |
| --- | --- | --- |
| M1 | «A quién»/«Registró» ignoran la autoría leída | 5/28 |
| M2 | el enlace de la tienda apunta a mensajeros | 1/16 |
| M3 | la descarga pone el id de la cuenta en «A quién» | 1/8 |
| M4 | Todo/Entra/Sale no se aplica al pulsarlo | 3/16 |
| M5 | el módulo no pide la autoría | 5/41 |
| M6 | la descarga no lee la autoría del libro entero | 2/12 |
| M7 | anular desde el panel no relee el libro | 1/16 |
| M8 | el filtro manda la dirección al revés | 3/16 |
| M9 | la dirección vuelve a «Ingreso»/«Egreso» | 2/24 |
| M10 | la fila anulada deja de decir «Anulado» | 2/16 |

Sin red: la insignia tachada (`flex` vs `inline-flex`) no la ve jsdom; queda medida en el recorrido.

## Verificación

- `pnpm run build`: `BUILD_EXIT=0` (`progress/build_458E.log`).
- Recorrido: `progress/recorrido_458-E/recorrido.md` (maestro, admin, adminTienda; R7/R8 = 0,00 en 6 medidas).
- Gate completo: `progress/gate_458E.log` (ver el cierre abajo).

## Pendiente

1. **R59 / filtro «A quién»**: servidor (PARADO, arriba).
2. Los enlaces de «A quién» apuntan a `/wallet/tiendas/<id>` y `/wallet/mensajeros/<id>`, que crea la
   458-D: hasta que se mergee dan 404.
3. TE.6 (ayuda de la caja + bloque E del asistente + cuatro preguntas) y TE.7 (recorrido COMPLETO de los
   doce pasos y revisión final) no se pidieron en esta tanda.
4. `VerMovimientoCaja` relee la autoría de su fila al abrir aunque el módulo ya la tiene (una lectura de
   más, sin efecto en el dinero): se puede pasar por props cuando la 458-C se asiente.
