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

## PARADO (histórico) — el filtro «A quién» (R59, parte de R54) necesitaba servidor → resuelto abajo

`listarMovimientosSchema`, `verResumenCajaAction` y `verDesgloseEgresosAction` no admiten `aQuien`
(`{tipo, id}` o `{nombre}`, design §6), y el `WHERE` que lo resuelva vive en el repositorio (cruce por
origen con `cierre_dia`, `liquidacion_pago`, `rechazo_tienda_cobro`, `wallet_anotacion.contraparte_nombre`…
—la misma tabla de design §3.4—) y tiene que aplicarse IGUAL a libro, tarjetas, composición, desglose y
descarga para que las tarjetas «reflejen el conjunto filtrado». Filtrar la página en el navegador
mentiría (paginación y tarjetas). Es servidor y es dinero (lo que dicen las tarjetas): **no se hizo**.
La pantalla no pinta un control que no filtra. Queda para backend_dev: schema + repositorio (con test
contra Postgres y mutación que quite la cuenta del `WHERE`) + un `SelectorBuscable` en `WalletFiltros`.

## ✅ R59 «A quién» — PARTE SERVIDOR (backend_dev) · `33e58c33`, `1c0786ae`, `34dbb6c7`

Lo PARADO de arriba, resuelto en el servidor. **Falta el control en la pantalla** (`SelectorBuscable`
en `WalletFiltros` + pasar `aQuien` en `inputDeFiltros`): es frontend_dev, con el contrato de abajo.

**Entorno.** Rama `feature/458-E` desde `32045882`. Base propia `ordenex_458eq` (`CREATE DATABASE …
TEMPLATE ordenex` con 0 conexiones a la plantilla; `migrate deploy`: «No pending migrations»; `migrate
status` → `ordenex_458eq` en `localhost:5432`). `.env` del checkout principal con la base cambiada y sin
`DATABASE_URL_PREVIEW`, copiado sin imprimirlo. `pnpm install --frozen-lockfile` propio, sin junction.
**Búsqueda:** el MCP `codebase-memory` se consultó primero; no conoce `autoriaDelLibroCajaAction`
(índice rancio para la 458-B/C), así que cada símbolo se leyó en el archivo real.

### Qué hace

- **El filtro.** `listarMovimientosSchema` gana `aQuien?` y pasa a `.strict()`. Como la descarga
  (`…CompletoSchema`) y el detalle de una fila de la composición (`…DeFilaSchema`) DERIVAN de él, y el
  resumen y el desglose lo usan tal cual, los seis bordes del libro lo aceptan a la vez:
  `listarMovimientosAction`, `listarMovimientosCompletoAction`, `listarMovimientosDeFilaAction`,
  `verResumenCajaAction` (tarjetas + composición), `verDesgloseEgresosAction`, y además
  `conceptosConMovimientosAction({ libro: "caja", aQuien })`.
- **El WHERE vive en el repositorio** (`lib/repositories/libro-caja-a-quien-sql.ts`): la tabla de
  design §3.4 —la MISMA de `LibroCajaAutoriaService.aQuien`, la columna «A quién»— como un `Record`
  TOTAL sobre `WalletOrigenTipo` (un origen nuevo no compila hasta decidir a quién se le paga) traducido
  a `EXISTS` correlacionados. Sin `IN` de ids: la consulta lleva siempre los mismos parámetros, tenga la
  cuenta 3 filas o 300.000 (el fallo que la revisión de la 458-A retiró de `cierresDeTienda`).
- **Tarjetas = Σ filas por construcción.** Con `aQuien`, `WalletMovimientoRepository` pagina, cuenta y
  agrega (`listar`, `agregarPorCategoriaYTipo`, `agregarPorCategoria`) con EL MISMO `whereLibroCajaSql`.
  Sin `aQuien`, el camino es el `where` de Prisma de siempre (sin cambios).
- **El selector:** `quienesDelLibroCajaAction` con el MISMO cruce (una sola definición para filtro y
  opciones: el selector no puede ofrecer una cuenta que el filtro no encuentre).
- **Rol antes de leer** en todo: `esAccesoTotal` (maestro/admin) en el servicio, antes del repositorio.

### Contrato para el frontend

```ts
// lib/types/libro-caja-a-quien.ts
type AQuienFiltro =
  | { tipo: "tienda" | "mensajero"; id: string /* uuid */ }   // .strict()
  | { nombre: string /* trim, 1..120 */ };                    // .strict()

// 1) Las opciones del selector — lib/actions/wallet-filtros.ts
quienesDelLibroCajaAction(input: {
  tipo?: "ingreso" | "egreso";   // la dirección vigente (Todo = ausente)
  desde?: "YYYY-MM-DD";          // el periodo vigente, días CR (mismos schemas que el libro)
  hasta?: "YYYY-MM-DD";
  busqueda?: string;             // trim, ≤ 80; sin mayúsculas ni tildes, sobre el nombre
}): Promise<
  | { status: "ok"; opciones: QuienDelLibroCajaOpcionDTO[]; hayMas: boolean }
  | { status: "forbidden" } | { status: "unauthenticated" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
>;

// lib/types/wallet-filtros.ts
type QuienDelLibroCajaOpcionDTO = {
  valor: AQuienFiltro;                        // se manda TAL CUAL como `aQuien`; viaja, no se pinta (H6)
  clase: "tienda" | "mensajero" | "nombre";   // para el rótulo («Tienda», «Mensajero», «Nombre anotado»)
  nombre: string;                             // cuenta: etiquetaDeCuenta (458-A R33); nombre libre: el anotado, recortado
  movimientos: number;                        // filas de la caja en el periodo: cardinal, nunca dinero
};

// 2) El filtro — la MISMA clave en los seis bordes del libro
{ ...inputDeFiltros(filtros), aQuien?: AQuienFiltro }
```

- **Orden:** alfabético por nombre (sin tildes) y, a igual nombre, tienda → mensajero → nombre libre.
- **Tope:** `MAX_QUIENES_FILTRO` (`lib/config/wallet-movimiento.ts`, env `WALLET_MAX_QUIENES_FILTRO`,
  200 por defecto); por encima, `hayMas: true` (la pantalla pide afinar la búsqueda, como el de cierres).
- **Nombre libre:** se agrupa y se compara sin mayúsculas ni espacios de los bordes
  («Cartonera del Valle» y «  cartonera DEL valle » son UNA opción y el mismo filtro).
- **«Ordenex» (aporte de capital) no es una opción**: no es una cuenta ni un nombre anotado.
- **Clave colada** (`.strict()`) o id sin forma de uuid → `validation_error`, sin leer. Un id válido que
  no tiene filas → libro vacío y todo en `0.00` (no es error).
- `periodoFiltrado` de las tarjetas pasa a `true` con `aQuien` (es un filtro: el rótulo de la cifra debe
  ser el de «periodo», R62/R101).

### Archivos

| Archivo | Cambio |
| --- | --- |
| `lib/types/libro-caja-a-quien.ts` | **nuevo** (hoja): `aQuienFiltroSchema`, `AQuienFiltro`, `A_QUIEN_NOMBRE_MAX` |
| `lib/types/wallet.ts` | `listarMovimientosSchema` + `aQuien`, `.strict()` |
| `lib/types/wallet-filtros.ts` | conceptos de la caja + `aQuien`; `quienesDelLibroCajaSchema`, DTO, resultado |
| `lib/repositories/libro-caja-a-quien-sql.ts` | **nuevo**: el cruce en SQL (filtro, comunes, opciones) |
| `lib/repositories/WalletMovimientoRepository.ts` | camino SQL con `aQuien` en `listar` y los dos agregados; `$queryRaw` en el `Pick` |
| `lib/repositories/FiltrosWalletRepository.ts` | `contarConceptosCaja` con `aQuien`; `quienesDelLibroCaja` |
| `lib/services/WalletService.ts`, `WalletEgresoService.ts` | pasan `aQuien` al repositorio |
| `lib/services/FiltrosWalletService.ts` | `quienesDelLibroCaja` (rol, búsqueda, orden, tope) + `opcionesDeQuienes` |
| `lib/actions/wallet-filtros.ts` | `quienesDelLibroCajaAction`, con `@sin-superficie` hasta que el frontend la cablee (guardia `superficie-de-uso`) |
| `lib/interfaces/**` (3) | los contratos de lo anterior |
| `lib/config/wallet-movimiento.ts` | `MAX_QUIENES_FILTRO` |
| `tests/unit/guards/caja-173-alcance.guardia.test.ts` | **modificado**: el cliente mínimo gana `$queryRaw` (compila) + caso nuevo «el filtro «A quién» solo SUMA la caja» (toda `SUM(` del repo es `SUM(w."monto")`; el módulo del cruce no nombra `monto`). R33 de la 173 no se relaja: otras tablas solo como criterio de pertenencia |
| `tests/integration/db/libro-caja-filtro-a-quien.test.ts` | **nuevo** (16) |
| `tests/unit/services/filtros-wallet-quienes-458e.test.ts` | **nuevo** (10) |

### Lo que el primer gate encontró (INIT_EXIT=1, 3 rojos nuevos, los tres míos) y cómo se cerró

| Guardia / test | Qué dijo | Arreglo |
| --- | --- | --- |
| `superficie-de-uso.guardia` | `quienesDelLibroCajaAction` no la importa ninguna ruta | `@sin-superficie` con el motivo real (el control es de frontend_dev); se borra al cablearlo |
| `wallet-movimiento-repository` (R47) | la clase ganó un método (`gruposConAQuien`) | pasa a función del módulo: la superficie sigue siendo de nueve métodos |
| `wallet-etiqueta-cuenta.guardia` (458-A R33) | `FiltrosWalletRepository` nombraba la cuenta con `nombreCompletoUsuario` | `etiquetaDeCuenta` (la función única de la wallet) |

### Verificación de esta tanda

- `pnpm run typecheck` y `eslint` de los archivos tocados: verdes (un warning ajeno previo en `IOrdenRepository.ts`).
- `pnpm run build`: `BUILD_EXIT=0` sobre el código final (`progress/build_458E_quien.log`).
- Gate completo `./init.sh` contra `ordenex_458eq`, log sin `tail` con `INIT_EXIT` dentro:
  1. `progress/gate_458E_quien_1.log` — `INIT_EXIT=1`: 3 rojos nuevos, los tres míos (tabla de arriba).
  2. `progress/gate_458E_quien_2.log` — `INIT_EXIT=1`: 1 rojo, `tests/integration/tablero-dia-conteo.test.ts`
     por **deadlock 40P01** (ajeno a la wallet); aislado 3/3 verde (`progress/rerun_458E_quien_tablero_aislado.log`).
  3. `progress/gate_458E_quien.log` — **`INIT_EXIT=0`**: 2312/2312 archivos, 32.235 tests verdes, 26
     skipped (todos en `AnaliticaPage`/`AnaliticaShell`, previos); **`integration/db`: 404 archivos, 0 skipped**.
- Base `ordenex_458eq` borrada al terminar; la base `ordenex` solo como plantilla; `feature_list.json` sin tocar.

### R59 → tests

| Qué | Test |
| --- | --- |
| por tienda / por mensajero / por nombre libre = la columna «A quién» | `libro-caja-filtro-a-quien` («por TIENDA», «por MENSAJERO», «por NOMBRE LIBRE») |
| tarjetas + composición = Σ filas; desglose y conceptos = Σ filas | ídem («las tarjetas … suman EXACTAMENTE», «el desglose … y los conceptos») |
| ajeno → 0 | ídem («una cuenta AJENA») |
| con dirección, concepto y periodo; orden total; DTO igual al de Prisma | ídem («con dirección, concepto y periodo»), borde 06:00Z |
| descarga y detalle de fila | ídem |
| selector: cuentas, nombres, periodo, búsqueda, tope + `hayMas` | ídem (4 casos) + `filtros-wallet-quienes-458e` |
| rol antes de leer; `.strict()` / uuid | ídem (R82, design §6) + unitario |

El oráculo del test NO es el código probado: el conjunto esperado sale de `LibroCajaAutoriaService`
(la columna «A quién» de la 458-B) fila a fila, y las sumas se hacen en el test con `Prisma.Decimal`.

### Mutaciones (11, una a una; autocomprobadas: patrón único, > 0 tests corridos, `git diff` limpio) — `progress/mutaciones_458E_quien.json`

| # | Mutación | Rojos |
| --- | --- | --- |
| M1 | la cuenta sale del `EXISTS` (sin `= id`) | 4/25 |
| M2 | el nombre libre no se compara | 2/25 |
| M3 | el repositorio ignora `aQuien` (vuelve al `where` de Prisma) | 8/25 |
| M4 | tarjetas y desglose agregan sin el WHERE | 3/25; re-medida tras el arreglo del gate: 3/26 |
| M5 | el desglose no pasa `aQuien` | 2/25 |
| M6 | `construirFiltros` no pasa `aQuien` | 9/25 |
| M7 | el selector de nombres ignora el periodo | 1/25 |
| M8 | el cobro por rechazo se atribuye al mensajero | 4/25 |
| M9 | los conceptos ignoran `aQuien` | 2/25 |
| M10 | se pierde la dirección en el camino SQL | 1/25 |
| M11 | `hasta` inclusivo en el camino SQL | 0/25 → caso del instante 06:00Z añadido → 1/26 |

Sin red en la base: los orígenes que el escenario de la 459 no escribe —`orden_incidente`,
`pago_mensajero`, `cobro_tienda_completado`, `cobro_manual_reclasificado`— (el `abono_tienda` sí: se
añadió un pago de la tienda B). Los tres últimos comparten rama (mismo documento) con `pago_tienda` y
`cobro_tienda`, que sí se prueban; `orden_incidente` solo lo sostiene el `Record` total.

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
| R59 | servidor: `tests/integration/db/libro-caja-filtro-a-quien.test.ts` (16) + `tests/unit/services/filtros-wallet-quienes-458e.test.ts` (10); pantalla: `tests/components/WalletFiltroAQuien458E.test.tsx` (13) + `DetalleFilaComposicion.test.tsx` («458-E R59»); recorrido `progress/recorrido_458-E/recorrido.md` § «Cierre de la pantalla» |
| R102, R103 | `docs/ayuda/oficina/wallet-caja.md` + `tests/unit/asistente/contexto-458.test.ts` (bloque E, 9) + cuatro preguntas reales (recorrido) |
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

1. ~~R59 / filtro «A quién» en pantalla~~ → cerrado (sección «Cierre de la pantalla», abajo).
2. Los enlaces de «A quién» apuntan a `/wallet/tiendas/<id>` y `/wallet/mensajeros/<id>`, que crea la
   458-D: hasta que se mergee dan 404.
3. ~~TE.6~~ → cerrado abajo. TE.7 (recorrido COMPLETO de los doce pasos y revisión final de la 458)
   sigue sin pedirse.
4. ~~`VerMovimientoCaja` relee la autoría~~ → cerrado abajo.

## Cierre de la pantalla (frontend_dev) · rama `wt/458-E-cierre` → `feature/458-E`

**Entorno.** `git checkout -B wt/458-E-cierre origin/feature/458-E` (HEAD `089c18a5` comprobado) y
`git merge origin/dev` (contiene `e0234bf9`): **sin conflictos** (`22384df0`) — la rama ya traía la
revisión de la 458-C (`c36b2efc`, `a38ea386`); lo de la C se conserva tal cual: la fila anulada dice
«Anulado» (celda de «Ver», `inline-flex`) y el panel dice quién anuló, cuándo, el motivo y el método.
Base propia `ordenex_458ec` (`CREATE DATABASE … TEMPLATE ordenex`, 0 conexiones a la plantilla;
`migrate deploy`: «No pending migrations»). `.env` del checkout principal con la base cambiada y sin
`DATABASE_URL_PREVIEW`. `pnpm install --frozen-lockfile` propio, sin junction. UN dev server (3487),
apagado al terminar. `ordenex` y `feature_list.json` sin tocar. **Búsqueda:** se consultó primero el MCP
`codebase-memory` (sin resultados para los símbolos de la 458-E: índice rancio); cada símbolo se leyó en
el archivo real.

| Qué | Archivos |
| --- | --- |
| R59: `SelectorBuscable` «A quién» en `WalletFiltros` (lee `quienesDelLibroCajaAction` al abrirse, con dirección y periodo del borrador y búsqueda en el servidor; se aplica al elegir; «Todos» y «Limpiar» lo quitan). `aQuien` entra en `WalletFiltrosValue` (opcional) y viaja por `inputDeFiltros` a libro, tarjetas + composición, desglose, detalle de fila y descarga, y a los conceptos | `WalletFiltros.tsx`, **nuevos** `a-quien-selector.ts` (rótulos y opción ↔ filtro, validada con `aQuienFiltroSchema`) y `use-quienes-del-libro-caja.ts` (SWR perezoso) |
| Fuera el `@sin-superficie` de `quienesDelLibroCajaAction` (la guardia `superficie-de-uso` ya la encuentra en `app/`) | `lib/actions/wallet-filtros.ts` (solo el comentario) |
| El panel «Ver» usa la autoría que el libro ya leyó (`autoriaDelLibro`); solo la lee él si el libro no la tiene. Tras registrar/anular/adjuntar el módulo relee la autoría (versión en la clave SWR) para que el panel diga quién anuló | `VerMovimientoCaja.tsx`, `WalletLedger.tsx`, `WalletModule.tsx` |
| «Close» → «Cerrar» en la primitiva `Sheet` (la de la wallet; `Dialog` ya decía «Cerrar»; los `Modal` de la wallet no tienen botón de cierre con texto) | `components/ui/sheet.tsx` |
| Ayuda: columnas del libro, filtros (Todo/Entra/Sale, «A quién», concepto, periodo; las tarjetas cuentan lo filtrado), «Ver», anulado; «tipo Ingreso» → «Entra»; fuentes | `docs/ayuda/oficina/wallet-caja.md`, `contexto-458.test.ts` bloque E |

**Tests nuevos:** `tests/components/WalletFiltroAQuien458E.test.tsx` (13: selector perezoso y rótulos sin
uuid; contexto y búsqueda al servidor; `hayMas` y error; por TIENDA —la misma entrada al libro y a las
tarjetas, tarjetas y libro del conjunto filtrado, conceptos y descarga—; por MENSAJERO con dirección; por
NOMBRE LIBRE, «Todos» y «Limpiar»; se conserva al aplicar el periodo; opción ↔ filtro; el panel no relee;
tras anular relee el libro una vez; «Cerrar» en el panel y en `Sheet`/`Dialog`) + caso «458-E R59» en
`DetalleFilaComposicion.test.tsx` + bloque E (9) de `contexto-458.test.ts`. Ningún test retirado.

**Mutaciones** (11, una a una; patrón único, 65 tests corridos por mutación, restauradas byte a byte,
`arbolIgual: true`; base 65/65 verde) — `progress/mutaciones_458E_cierre.json`:

| # | Mutación | Rojos |
| --- | --- | --- |
| M1 | `inputDeFiltros` no pasa `aQuien` | 6/65 |
| M2 | elegir «A quién» no se aplica | 4/65 |
| M3 | «Todos» no quita el filtro | 1/65 |
| M4 | los conceptos no se cuentan para «A quién» | 1/65 |
| M5 | el selector ignora dirección y periodo | 1/65 |
| M6 | el selector no manda la búsqueda | 1/65 |
| M7 | el valor pierde el tipo de cuenta (tienda ↔ mensajero) | 2/65 |
| M8 | el rótulo no dice qué es | 5/65 |
| M9 | el panel relee la autoría aunque el libro la tenga | 2/65 |
| M10 | tras anular el libro no relee la autoría | 1/65 |
| M11 | el cierre vuelve a «Close» | 2/65 |

**Recorrido** (`progress/recorrido_458-E/recorrido.md` § «Cierre de la pantalla»): maestro y admin, por
tienda (buscando), por mensajero y por nombre libre (buscando): libro filtrado = oráculo (libro sin
filtro por su columna «A quién») en filas y sumas, y tarjetas (Movimientos, Entró, Salió) = Σ del libro
filtrado, 6/6; R7/R8 = 0,00 en las 8 medidas. Asistente: cuatro preguntas reales, las cuatro responden con
la ayuda nueva.

**Primer gate rápido de los tests:** la guardia `ancla-de-carga` rechazó tres esperas ancladas a un
conteo en el test nuevo → anclas de contenido (`6c773e73`).

**Verificación del cierre.** `pnpm run build`: `BUILD_EXIT=0` (`progress/build_458E_cierre.log`). Gate
completo `./init.sh` contra `ordenex_458ec`, log sin `tail` con `INIT_EXIT` dentro:
1. `progress/gate_458E_cierre_1.log` — `INIT_EXIT=1`: 1 rojo, `tests/integration/db/caja-backfill.test.ts`
   («R42: simular y comprobar no dejan NI UNA fila», 45 → 43: cuenta la tabla entera mientras otro
   archivo en paralelo escribe y revierte); ajeno a la pantalla. Aislado 3/3 verde
   (`progress/rerun_458E_cierre_backfill_aislado.log`).
2. `progress/gate_458E_cierre.log` — **`INIT_EXIT=0`**: 2313/2313 archivos, 32.257 tests verdes, 26
   skipped (los de `AnaliticaPage`/`AnaliticaShell`, previos); **`integration/db`: 404 archivos, 0 skipped**.
