# 458-D «Estados de cuenta y Mi wallet» — bitácora del frontend_dev

**Rama:** `feature/458-D` con `git checkout -B feature/458-D origin/feature/458-C` sobre `03122992` (la 458-C
con el `fix/458-B-async` dentro; comprobado con `git merge-base --is-ancestor 00b95dc7 HEAD`). Antes del
build y del gate final se mergeó `origin/dev` (`e9494f21`, la 458-C ya en `dev` con los arreglos de su
revisión) como pidió el leader: `d5790177`, **sin conflictos** — el merge no tocó ningún archivo de esta
hija; los tests de sus pantallas, verdes tras él.
**Base:** clon propio `ordenex_458d` (`CREATE DATABASE … TEMPLATE ordenex` con **0** conexiones a la
plantilla medidas antes; `prisma migrate deploy`: «No pending migrations»; `migrate status` →
`ordenex_458d` en `localhost:5432`). `.env` del checkout principal copiado sin imprimirlo, con la base
cambiada y **sin** `DATABASE_URL_PREVIEW`. `pnpm install --frozen-lockfile` propio, sin junction. La base
`ordenex` solo como plantilla; `feature_list.json` sin tocar.
**Búsqueda — lo digo explícitamente:** en esta hija **no usé el MCP `codebase-memory`**; todo se localizó
con `grep`/lectura del archivo real (la 458-C ya había medido el índice rancio para las piezas de la 458-B,
y cada símbolo se confirmó en el árbol).

**Solo UI y consumo de actions existentes.** El diff de la 458-D en `lib/` y `db/` es **solo de
comentarios** (medido: `git diff 03122992 e19d1974 -- lib db` sin una línea de código distinta): 8
archivos de `lib/actions` con sus anotaciones de superficie al día. Ningún servicio, repositorio, tipo,
migración ni dinero tocado. Lo que haría falta en el servidor está en **§Pendientes**, sin hacer.

## Contratos de la 458-B/458-C confirmados al abrir (lo que difiere del design, anotado)

| Pieza | En el árbol | Difiere del design / de lo que pide la hija |
| --- | --- | --- |
| `verEstadoCuentaAction({ cuenta:{tipo,id}, desde?, hasta?, chip?, page, pageSize })` | `lib/actions/estado-cuenta.ts`, `lib/types/estado-cuenta.ts` | **sin filtro de cierre** (R10 en el estado de cuenta: pendiente de servidor); la fila trae `categoria`/`origenTipo` y **no** el origen con entidad ni enlace (R6/R7 en el estado de cuenta: pendiente); `referencia` y método no viajan; **solo acceso total** (R81): `/mi-wallet` no la puede usar (R34: pendiente) |
| `verComprobanteAction({ destino })` | `lib/actions/wallet-comprobante.ts` | alcance de la tienda sobre SUS filas (R77/R78): se usa en `/mi-wallet` |
| `comoQuedoAction`, `anularMovimientoAction`, `DetalleMovimientoPanel`, `AnularMovimientoDialog`, `RegistrarMovimientoDialog` (con `conceptoInicial` + `cuentaFija`) | 458-B / 458-C | se reutilizan tal cual; el panel recibe la anulación (motivo, quién, día) de la fila del estado de cuenta |
| Los tres `obtenerComprobante*` `@sin-superficie` (pendiente 4 de la 458-C) | `lib/actions/{abono-tienda,aporte-capital,pago-por-cuenta-tienda}.ts` | **decisión:** `/mi-wallet` NO los usa (la acción única ya lee también esos documentos): su anotación se actualiza y su retirada queda como pendiente de servidor |

## Fotografías 459 / 458

No las corrí **antes** del primer cambio (omisión mía). Lo compenso así: el diff de la hija en `lib/`/`db/`
es solo de comentarios (arriba), y las dos fotografías corren **después** dentro del gate completo
(`caja-caracterizacion-459`, `wallet-caracterizacion-458`) sin tocar un literal: ver §Gate.

## TD.1 — `components/shared/estado-cuenta/` (R18–R25, R71, R72)

`EstadoCuenta.tsx` (módulo: tarjetas, acciones, chips, periodo, extracto, paginación, descarga y panel «Ver»;
el extracto `TablaEstadoCuenta` vive en el MISMO archivo para que el censo de tablas vea UNA tabla compartida
con sus tres montajes), `TarjetasEstadoCuenta.tsx` (saldo actual con su signo y la frase de quién le debe a
quién; saldo inicial, abonos, cargos y saldo final del periodo, todo STRING del servidor), `ChipsEstadoCuenta.tsx`
(los chips por tipo de cuenta desde las MISMAS constantes con las que el servidor decide el chip de cada fila),
`estado-cuenta-labels.ts`, `estado-cuenta-lineas.ts` (de la fila del servidor a la línea que se ve y se descarga;
`RotulosEstadoCuenta` = los diccionarios de la superficie, que pone la página), `estado-cuenta-clave.ts`,
`estado-cuenta-descarga-columnas.ts`.

Extracto: primera línea «Saldo inicial» (o «del periodo» con el día), orden del servidor (ascendente),
saldo corrido de la cuenta entera (R21: el chip no lo cambia), «Registró: …» (persona o «Automático · … por
…»), «Con comprobante», anulado tachado con «Anulado el <día> por <quién> · <motivo>» o «motivo no registrado»
(R72), contra-asiento «Anulación». «Ver» abre el panel de la 458-C con el destino de la fila (la bodega no
tiene filas de libro: sin «Ver»). Ningún «anulado» se deduce en el cliente (R71). La primera página baja del
Server Component; periodo, chip y páginas se piden con SWR por clave de cuenta.

**Despliegue de órdenes en las filas de cierre (R19): NO hecho.** La única lectura de «órdenes de una fila»
de la oficina (`verDetalleDeMovimientoAction`) es del libro de la caja, no del de la tienda o del mensajero:
pendiente de servidor. El chip «Cierres» agrupa esas filas.

Tests: `tests/components/EstadoCuenta.test.tsx` (20), `tests/components/EstadoCuentaAnulados.test.tsx` (6),
fixture `tests/fixtures/estado-cuenta.ts` (uuid de verdad en los destinos).

## TD.2 — `/wallet/tiendas/[tiendaId]` (R17, R26–R28, R40, R81)

`app/(app)/wallet/tiendas/[tiendaId]/page.tsx` (rol en el servidor; inexistente, de otro papel o segmento sin
forma de id → `notFound`, sin distinguir), `EstadoCuentaTienda.tsx` (diccionarios desde Ordenex y la nota del
cobro por rechazo del panel), `EstadoCuentaAcciones.tsx` (las tres acciones abren el diálogo único con concepto
y tienda FIJOS: «La tienda le paga a Ordenex» solo en contra; «Ordenex le cobra a la tienda» siempre; «Ordenex
le paga a la tienda» deshabilitado con «Ordenex no le debe nada a <tienda>: sin saldo a favor no hay nada que
pagarle.» como descripción accesible; el tope lo decide el servidor), `PagosTiendaEstadoCuenta.tsx` (la lista
de pagos de la 172 con método, referencia y comprobante, y su anulación con `anularPagoAction`: es lo que el
extracto todavía no dice de un pago), `estado-cuenta-tienda-labels.ts`. `SaldosTiendasTable`: columna «Estado de
cuenta» con «Ver estado de cuenta» (id solo en el `href`), sin desplegar; fuera la prop `puedeRegistrarPago`.

Tests: `tests/components/EstadoCuentaAcciones.test.tsx` (12), `tests/integration/wallet-tiendas-estado-page.test.tsx` (11).

## TD.3 — `/wallet/mensajeros/[mensajeroId]` (R17, R29, R70)

Página + `EstadoCuentaMensajero.tsx`: «Ordenex le paga al mensajero» es `PagoMensajeroAcciones` (reparto de la
205 con su previsualización, sin cambios salvo el texto del botón que ABRE, de «Registrar pago» a «Ordenex le paga
al mensajero», R29, y que ahora solo necesita id y nombre); la anulación de un pago va por el panel «Ver» de su
fila: `anularMovimientoAction({ destino:{libro:"mensajero", movimientoId}, motivo })` → `anularPagoAction`, la
MISMA acción de `/cierres-admin` (que no se toca; su test sigue verde). `CuentasPorPagarTable` enlaza.
`PremiosRankingPanel`: refresca «estado-cuenta» en lugar de «wallet-mensajeros:desglose».

Tests: `tests/components/EstadoCuentaMensajeroAnular.test.tsx` (3), `tests/integration/wallet-mensajeros-estado-page.test.tsx` (7),
`PagoMensajeroAcciones.test.tsx` y `CierresAdminPagoMensajero.test.tsx` verdes.

## TD.4 — `/wallet/satelites/[zonaId]` (R17, R31)

Página + `EstadoCuentaSatelite.tsx`: extracto Declarado/Recibido (lo que tiene por entregar tras cada fila) y,
DEBAJO, la conciliación de hoy: `DesgloseConsolidacionesSatelite.tsx` → `ConciliacionSatelite.tsx` (misma tabla,
mismas `ConciliacionAcciones`/`MarcarRecibidoDialog`, mismos textos y efecto; su «Pendiente de llegar» es el saldo
actual del estado de cuenta; tras marcar relee el estado de cuenta de ESA bodega y el listado). `SaldosSatelitesTable`
enlaza y deja de desplegar.

Tests: `tests/components/EstadoCuentaSatelite.test.tsx` (8) + los 34 de la 431 (`tests/integration/wallet-satelites.test.tsx`)
verdes sobre `ConciliacionSatelite`.

## TD.5 — `/mi-wallet` (R35, R77, R78)

`VerComprobanteMiMovimiento.tsx`: «Ver comprobante» en las filas de SU libro que pueden llevarlo (pago de Ordenex a la
tienda, pago de un gasto por ella, cobro de Ordenex, su pago a Ordenex) por `verComprobanteAction({ destino })`; el
aviso va junto al botón (la tabla se monta en superficies sin proveedor de avisos). Nada de registrar, anular ni
adjuntar (R35; `mi-wallet-335.guardia` verde: solo acciones de lectura).

**R34 (estado de cuenta con saldo corrido en `/mi-wallet`): NO hecho.** `verEstadoCuentaAction` es solo de acceso
total y no existe una lectura equivalente acotada a la tienda de la sesión: pendiente de servidor. `/mi-wallet` sigue
con sus lecturas de la 461 §7.5 y la 457 y su selector de cierre.

Tests: `tests/components/MiWalletComprobante458.test.tsx` (5).

## TD.6 — Descarga (R3, R32)

El periodo filtrado ENTERO (todas las páginas al mismo borde, pedidas por la acción de la página con el tope de
página del servidor), con la fila del saldo inicial arriba, el saldo corrido y las mismas columnas que se ven, sin
ninguna columna de id; por encima del tope de filas no hay archivo. **Desviación anotada:** no existe una acción
«completa» del estado de cuenta con el tope en el servidor (el patrón de la 170); se leen las páginas desde el
cliente con el tope comprobado ANTES de leerlas. Pendiente de servidor si se quiere el patrón canónico.
Tests: `tests/unit/descarga/estado-cuenta-descarga-columnas.test.ts` (6); `columnas-sensibles.guardia` verde.

## TD.7 — Refresco dirigido (R30, R48)

Tras registrar o anular desde un estado de cuenta se releen SOLO las claves de ESA cuenta (`esClaveDeLaCuenta`); el
listado se lee al montarse (SSR + SWR). Test: `tests/components/WalletRefrescoDirigido.test.tsx` (3: registrar,
anular, volver al listado).

## TD.8 — Retiro (D14) y la red que NO se pierde

Se borran `DesgloseMovimientosTienda.tsx`, `DesglosePagosMensajero.tsx`, `PagoTiendaAcciones.tsx`,
`desglose-tienda-descarga-columnas.ts`, `desglose-mensajero-descarga-columnas.ts`; `DesgloseConsolidacionesSatelite`
deja de ser desplegable (su tabla pasa a `ConciliacionSatelite`). Labels muertos fuera
(`DESGLOSE_TIENDA_{COLUMNAS,FILTRO_LABEL,NOMBRE,VACIO,ERROR}`, `CONCEPTO_TIENDA_TODOS_OPTION`; del mensajero
`DESGLOSE_{LABEL,COLUMNAS,FILTRO_LABEL,VACIO,COLUMNA_CIERRE,SIN_CIERRE}`, `TIPO_PAGO_LABEL`;
`DESGLOSE_SATELITE_MAX_PAGE_SIZE`). Se conservan `CATEGORIA_TIENDA_LABEL` y `DESGLOSE_TIENDA_LABEL` (los lee
`/mi-wallet`). **Nota de commits:** los borrados viajaron en el commit de TD.1 (`1cddd25d`) porque ya estaban en el
índice por `git rm`; el contenido de la rama es el mismo.

Superficie: las acciones que se quedan sin pantalla llevan `@sin-superficie` con su motivo (solo comentario):
`listarMovimientosDeTienda{,Completo}Action`, `listarPagosDeMensajero{,Completo}Action`, `cierresDeLaCuentaAction`;
y los módulos del selector de cierre (`cierres-selector.ts`, `use-cierres-de-la-cuenta.ts`) hasta que el estado de
cuenta filtre por cierre. `listarPagosDeTiendaAction` recupera superficie (`PagosTiendaEstadoCuenta`).

### Tests retirados o reescritos (cada uno con su sustituto)

| Test retirado / reescrito | Sustituto | R |
| --- | --- | --- |
| `tests/unit/components/desglose-movimientos-tienda.test.tsx` (entero, 381/R34/R35: el cobro con su nombre, sin enum, saldo negativo con signo, filtrar por el cobro) | `EstadoCuenta.test.tsx` (fila «Ordenex le cobra a la tienda», tarjeta «-₡2.500», chip «Cobros» con el corrido de la cuenta entera; H6 sin uuid) | R19, R21, R24 |
| `tests/unit/components/pago-tienda-acciones.test.tsx` (entero, 381/R31: sin saldo positivo no se ofrece pagar; con saldo sí) | `EstadoCuentaAcciones.test.tsx` («R28 …deshabilitado con el motivo», «a favor: habilitado») | R28 |
| `tests/components/PagoTiendaAccionesAbono457.test.tsx` (entero, 457/R59: solo en contra; concepto y tienda fijos; refresco tras registrar) | `EstadoCuentaAcciones.test.tsx` (R26, R40 con los tres conceptos) + `WalletRefrescoDirigido.test.tsx` (aviso con el saldo del servidor, tarjeta y fila del listado nuevas) | R26, R40, R30, R48 |
| `tests/components/WalletSaldosTiendasRefrescoP1.test.tsx` (entero, 461 P1: la fila de la tabla al pagar y al anular desde el desglose) | `WalletRefrescoDirigido.test.tsx` (registrar, ANULAR, volver al listado) | R30 |
| `tests/integration/wallet-tiendas-desglose.test.tsx` (entero, 171: lectura al abrir, cabecera de 4 importes, lista, paginación y filtros, nombres accesibles, descarga, fallo dentro de la fila, hueco `acciones`, refresco de una tienda, tabla de saldos intacta) | `EstadoCuenta.test.tsx` (tarjetas del servidor sin recalcular, extracto en su orden, paginación que no repite el saldo inicial, chips y periodo, «R5 …el fallo se dice», H6), `estado-cuenta-descarga-columnas.test.ts` (periodo entero), `wallet-tiendas-estado-page.test.tsx` (lee SOLO esa cuenta; el listado enlaza sin desplegar), `WalletRefrescoDirigido.test.tsx`, `desglose-tienda-labels.test.ts` (nombres accesibles por cuenta) | R17–R24, R30, R32 |
| `tests/integration/wallet-tiendas-pago.test.tsx` (entero, 172: permisos por partida doble, refresco dirigido, lo que se ve tras pagar, comprobantes en el desglose, anular con motivo y sin monto, N1, 171 intacta, money-safe del cableado) | `wallet-tiendas-estado-page.test.tsx` (R81) + `EstadoCuenta.test.tsx` («sin permiso… no hay acciones») + `WalletRefrescoDirigido.test.tsx` (anula por destino+motivo, sin monto; refresca SOLO su cuenta) + `EstadoCuentaAnulados.test.tsx` (el pago anulado se queda, tachado, con su comprobante marcado) + `PagosTiendaEstadoCuenta` (los pagos de la 172 con su comprobante, en el estado de cuenta) + guardias `liquidacion-money-safe`/`liquidacion-alcance` sobre los archivos nuevos. N1 no aplica: el estado de cuenta enseña cifras NETAS (D3) | R17–R30, R81, N1/D3 |
| `tests/components/DesglosePagosMensajero.test.tsx` (entero, 205: se paga desde acá; enlace al cierre por fila) | `EstadoCuentaMensajeroAnular.test.tsx` («R29 …vive en las acciones de SU estado de cuenta»). **El enlace de la fila a SU cierre NO tiene sustituto** (la fila del estado de cuenta no trae origen con entidad: pendiente de servidor) | R29 (R7 pendiente) |
| `tests/unit/descarga/desglose-tienda-descarga-columnas.test.ts` y `wallet-mensajero-descarga-columnas.test.ts` (enteros) | `estado-cuenta-descarga-columnas.test.ts` (columnas literales en el orden de la pantalla, valores crudos, ninguna clave de id, saldo inicial arriba, periodo entero, tope) | R3, R32 |
| `tests/components/DesgloseTiendaAbono457.test.tsx` bloque `/wallet/tiendas` (tabla, descarga, filtro, pistas de la cabecera) | mismo archivo sobre `EstadoCuentaTienda` y `lineaDeFila` (los dos nombres desde Ordenex, su origen, sin ids ni enum); las pistas de la cabecera del desglose se retiran con ella (quedan las de `/mi-wallet`); bloque `/mi-wallet`: «sin desplegar» admite ahora «Ver comprobante» (R78) | 457-R46/R48/R51, R78 |
| `tests/unit/components/desglose-tienda-labels.test.ts` (columnas, filtros, vacío/error, nombres accesibles del desglose) | mismo archivo sobre `COLUMNAS_TEXTO`/`ESTADO_CUENTA_TEXTO` (orden de la pantalla, periodo, vacío y error, un nombre accesible por cuenta) | R19, R4/R38 |
| CuentasPorPagarTable.test.tsx «expand del desglose por fila (R18)» | mismo archivo «la fila enlaza al estado de cuenta» + wallet-mensajeros-estado-page.test.tsx | R17 |
| descarga/WalletDescarga.test.tsx: ledger «Desglose de Ana Mensajera» en LEDGERS (3 casos parametrizados) | unit/descarga/estado-cuenta-descarga-columnas.test.ts | R32, R3 |
| PagoMensajeroAcciones.test.tsx: botón «Registrar pago» → «Ordenex le paga al mensajero» (literal cambiado) | mismo archivo | R29 |
| integration/wallet-satelites.test.tsx: `desplegar()` → `montarConciliacion()`; «abrir UNA bodega…» reescrito; permiso leído en [zonaId]/page.tsx; money-safe sobre ConciliacionSatelite/EstadoCuentaSatelite | mismo archivo + EstadoCuentaSatelite.test.tsx | R31 |
| OrigenMovimiento.test.tsx «R3 — las cuatro descargas…» casos `tienda` y `mensajero` (desglose) | estado-cuenta-descarga-columnas.test.ts «R3: ni una celda con forma de uuid»; el ORIGEN CON ENTIDAD del estado de cuenta queda PENDIENTE de servidor (la fila no trae `origen`) | R3 (R6 pendiente) |
| PremioRankingRotulo.test.tsx «R34 — el desglose del MAESTRO…» (2) y «la descarga…» (2) | mismo archivo reescrito sobre EstadoCuentaMensajero y lineaDeFila (literal «Premio del ranking» ≠ ajuste; chip «Premios»). El enlace de la fila del premio a SU cierre NO tiene sustituto: pendiente de servidor | 293-R34 (R7 pendiente) |
| WalletFechaCostaRica459.test.tsx «/wallet/tiendas: el desglose de una tienda y su descarga» y «/wallet/mensajeros: la descarga del desglose» | mismo archivo: «/wallet/tiendas/[tiendaId]: el estado de cuenta y su descarga» y «/wallet/mensajeros/[mensajeroId]: la descarga del estado de cuenta» (la pantalla pinta el día CR del servidor); el borde CR lo prueba el servidor (wallet-caracterizacion-458 TB.6) | R16 |
| WalletFiltros458.test.tsx «TA.3 + TA.4 — /wallet/tiendas: el desglose» (3) y «TA.4 — /wallet/mensajeros: el desglose» (2) | mismo archivo: «TA.4 — el selector de cierre de una cuenta» (3, sobre la MISMA composición SelectorBuscable + useCierresDeLaCuenta, que queda @sin-superficie hasta que el estado de cuenta filtre por cierre) + «458-D — ningún control pide un id» (2). El filtro de CONCEPTO de la tienda en la oficina (R13, libro `tienda`) lo sustituyen los chips (R24); el conteo por concepto de la oficina queda sin superficie | R2, R10–R12 (montaje pendiente de servidor), R24 |
| WalletMensajerosAvisoBrutos.test.tsx «la CABECERA del desglose lleva la salvedad…», «con el desglose ABIERTO…», «la salvedad va junto a los importes agregados…» y la mitad del desglose en «lenguaje claro» | mismo archivo: «el ESTADO DE CUENTA del mensajero no repite la salvedad: sus cifras ya son netas (D3)» + «la tabla de cuentas ya no despliega: el párrafo UNA vez» + «lenguaje claro» sobre el texto que queda | N1 (172), R22/D3 |
| integration/wallet-mensajeros-page.test.tsx «DesglosePagosMensajero — desglose por cierre del maestro (R18)» y «— filtros server-side fecha/cierre (R22)» (3) | EstadoCuenta.test.tsx (extracto paginado, periodo, chips, tarjetas del servidor) + wallet-mensajeros-estado-page.test.tsx; filtro por CIERRE: pendiente de servidor | R19–R24 (R10 pendiente) |
| integration/mi-wallet-page.test.tsx «/wallet/tiendas: el mismo concepto y origen, sin ids» (descarga del desglose) | mismo archivo «/wallet/tiendas/[tiendaId]: el mismo concepto y el motivo, sin ids» sobre `lineaDeFila` del estado de cuenta | R3, 459-R44 |
| unit/guards/wallet-sin-uuid.guardia.test.tsx superficies «/wallet/tiendas · desglose con el selector ABIERTO» y «/wallet/mensajeros · desglose (Ver el cierre) con el selector ABIERTO»; no-vacuidad ≥7 | mismo archivo: 5 superficies nuevas (listados que enlazan, estado de cuenta de tienda con el panel abierto, de mensajero con el pago, de bodega con la conciliación, selector de cierre abierto); no-vacuidad ≥10 y ≥3 enlaces con uuid SOLO en href | R1, R96 |
| paginacion/CuentasPorPagarPaginacion.test.tsx «expandir el desglose funciona en cualquier página (R50)» y «expandir en la página 1 no arrastra el desglose…»; `nombresVisibles` por el botón de desglose | mismo archivo: «el enlace al estado de cuenta funciona en cualquier página» y «en otra página, cada enlace sigue siendo el de SU fila» (href con el id de SU mensajero, importe de SU fila); `nombresVisibles` por el enlace | 170-R50, R17 |
| unit/guards/rutas-336-retiradas.guardia: control positivo `DesglosePagosMensajero` → `EstadoCuentaMensajero`; `@sin-superficie` del módulo del mensajero 1 → 3 (las dos del desglose retirado, NOMBRADAS, caducan con su retirada de servidor); cobertura ajena `wallet-mensajero-descarga-columnas.test.ts` → `estado-cuenta-descarga-columnas.test.ts`; WalletDescarga ≥3 → ≥2 ledgers; premio `filaDescargaDesgloseMensajero` → `lineaDeFila` | mismo archivo | 336 R15/R20/R22 |
| unit/descarga/censo-tablas.ts + cobertura-tablas.guardia: fuera «Desglose de pagos por cierre de un mensajero» y «Desglose de movimientos de una tienda»; la de consolidaciones cambia de archivo (ConciliacionSatelite); entra «Estado de cuenta…» (compartida, 3 montajes); PagosRegistradosTabla sigue con 2 montajes (PagosTiendaEstadoCuenta sustituye a PagoTiendaAcciones); totales 38→37 archivos/instancias, 39→38 censo, 25→24 con descarga | mismos archivos | 170-R4, R32 |
| unit/guards/wallet-money-safe-458: censo ampliado a `components/shared/estado-cuenta/**` | mismo archivo | R90 |
| Citas R → test de otras fichas a los tests retirados (la guardia `test-citado-desaparecido` las cazó en el primer gate): 171 R41; 172 R4, R33, R34, R50, R53; 381 R31, R34; 457 R59 | repuntadas en sus `tasks.md`/`design.md` al test que hoy cubre cada requisito (opción 1 de la guardia) + `tests/components/PagosTiendaEstadoCuenta.test.tsx` nuevo (172 R4/R50/R70/R76 y 458 R30) | los de cada ficha |

Ninguna guardia pierde archivos sin que su control de no-vacuidad lo diga: `wallet-sin-uuid` (≥10 superficies,
≥3 enlaces con uuid solo en `href`), `wallet-sin-campo-id` (estado de cuenta en el censo), `wallet-conceptos-sin-seed`
(dos filtros + estado de cuenta en el censo), `wallet-textos-458` (T5-tienda sobre `EstadoCuenta.tsx`), `rutas-336`,
`liquidacion-money-safe`/`-alcance`, `DineroIdentidadesEnPantalla` (la 17.ª pantalla pasa a ser las tarjetas del estado
de cuenta), `cobertura-tablas`.

## TD.9 — Ayuda y asistente (R102, R103)

`docs/ayuda/oficina/wallet-tiendas.md`, `wallet-mensajeros.md`, `wallet-satelites.md`, `docs/ayuda/tienda/mi-wallet.md`
(actualizado 2026-09-26, fuentes al día, fuera los archivos retirados). `tests/unit/asistente/contexto-458.test.ts`:
bloque A de la oficina reescrito (los desgloses se retiraron) y **bloque D** nuevo (frases literales por rol; nada de la
oficina en tienda, mensajero ni bodega); `contexto-457.test.ts`: el pago de la tienda se registra desde el estado de
cuenta y la tienda ya ve el comprobante. Cuatro preguntas reales (una desde la tienda): `progress/recorrido_458-D/recorrido.md`.

## TD.10 — Recorrido

`progress/recorrido_458-D/recorrido.md`: pasos 4, 5, 6, 9, 10, 11 con maestro y admin; 8 solo en `/mi-wallet` (en la
oficina el estado de cuenta no filtra por cierre); adminTienda en `/mi-wallet` y 404 en las cinco rutas de la oficina;
mensajero y adminSatelite 404 en las seis; sondas de las actions → `forbidden`/`no_encontrado`. **R7 = R8 = 0,00** antes
y después con `c458c-1.sql`; saldo corrido de la última fila = saldo de Tania en la base = tarjeta = fila del listado
(117.670,10).

### Mutaciones (15, una a una; arnés con autocomprobación: el archivo cambia, se corren > 0 tests, se restaura byte a byte y `git diff` vacío) — `progress/mutaciones_458-D.json`

| # | Mutación | Tests | Rojos |
| --- | --- | --- | --- |
| M1 | refrescar TODAS las cuentas en vez de SOLO la de esta página (R30) | `WalletRefrescoDirigido.test.tsx` | 2/3 |
| M2 | «La tienda le paga a Ordenex» siempre, no solo en contra (R26) | `EstadoCuentaAcciones.test.tsx` | 2/12 |
| M3 | «Ordenex le paga a la tienda» habilitado sin saldo a favor (R28) | `EstadoCuentaAcciones.test.tsx` | 1/12 |
| M4 | el anulado no se tacha (R25) | `EstadoCuentaAnulados.test.tsx` | 1/6 |
| M5 | «anulado» deducido en el cliente: toda fila con un contra-asiento en la página (R71) | `EstadoCuentaAnulados.test.tsx` | 1/6 |
| M6 | el saldo inicial se repite en todas las páginas (R20) | `EstadoCuenta.test.tsx` | 1/20 |
| M7 | la descarga solo trae la primera página (R32) | `estado-cuenta-descarga-columnas.test.ts` | 1/6 |
| M8 | la descarga no lleva la fila del saldo inicial (R32) | `estado-cuenta-descarga-columnas.test.ts` | 1/6 |
| M9 | la frase de la tarjeta con el monto CON signo (R18) | `EstadoCuenta.test.tsx` | 1/20 |
| M10 | «Ver comprobante» en TODAS las filas de /mi-wallet (R78) | `MiWalletComprobante458.test.tsx` | 1/5 |
| M11 | el enlace del listado de tiendas no lleva el id de SU fila (R17) | `wallet-tiendas-estado-page.test.tsx` | 1/11 |
| M12 | la conciliación no relee el estado de cuenta de la bodega tras marcar (R30/R31) | `EstadoCuentaSatelite.test.tsx`, `wallet-satelites.test.tsx` | 2/42 |
| M13 | la página de la tienda no comprueba el rol (R81) | `wallet-tiendas-estado-page.test.tsx` | 4/11 |
| M14 | el tope de la descarga no se mira (R32: nunca un archivo al que le falten filas) | `estado-cuenta-descarga-columnas.test.ts` | 1/6 |
| M15 | conversión a número en una pieza del estado de cuenta (R90) | `wallet-money-safe-458.guardia.test.ts` | 1/3 |

## Mapa R → test (458-D)

| R | Test |
| --- | --- |
| R17 | `wallet-tiendas-estado-page.test.tsx` («R17 / D14 …»), `wallet-mensajeros-estado-page.test.tsx`, `EstadoCuentaSatelite.test.tsx` + `wallet-satelites.test.tsx` (enlace del listado), `CuentasPorPagarPaginacion.test.tsx` (R50) |
| R18 | `EstadoCuenta.test.tsx` («R18 — las tarjetas…», tienda/mensajero/bodega, cifras del servidor) |
| R19, R20, R21, R23 | `EstadoCuenta.test.tsx` («R19–R21/R23 …»: saldo inicial arriba, orden del servidor, corrido con chip, página 2) — R19 sin el despliegue de órdenes (pendiente) |
| R22 | servidor (458-B); en pantalla `EstadoCuenta.test.tsx` (cifras que no cuadran a propósito: la pantalla no suma) + recorrido (corrido = tarjeta = listado = base) |
| R24 | `EstadoCuenta.test.tsx` («R24 — los chips…»), `PremioRankingRotulo.test.tsx` (chip «Premios») |
| R25, R71, R72 | `EstadoCuentaAnulados.test.tsx` |
| R26, R27, R28, R40 | `EstadoCuentaAcciones.test.tsx` |
| R29, R70 | `EstadoCuentaMensajeroAnular.test.tsx`; recorrido paso 10 |
| R30, R48 | `WalletRefrescoDirigido.test.tsx`, `EstadoCuentaMensajeroAnular.test.tsx`, `EstadoCuentaSatelite.test.tsx`, `WalletCuentasPorPagarRefrescoP1.test.tsx` |
| R31 | `EstadoCuentaSatelite.test.tsx` + `tests/integration/wallet-satelites.test.tsx` (31 de la 431) |
| R32, R3 | `estado-cuenta-descarga-columnas.test.ts`, `columnas-sensibles.guardia`; recorrido paso 9 (0 uuid en el archivo) |
| R33 | los nombres llegan del servidor (`nombreCompletoUsuario`); la pantalla no compone nombres |
| R34 | **pendiente de servidor** (ver §Pendientes) |
| R35 | `MiWalletComprobante458.test.tsx` («R35 …solo lee»), `mi-wallet-335.guardia` |
| R36 | 458-A (sin cambio) |
| R78, R77 | `MiWalletComprobante458.test.tsx`; sonda del recorrido (`no_encontrado` ajeno = inexistente) |
| R81 | `wallet-tiendas-estado-page.test.tsx`, `wallet-mensajeros-estado-page.test.tsx`, `EstadoCuentaSatelite.test.tsx`; recorrido (404 por rol) |
| R90 | `wallet-money-safe-458.guardia` ampliada a `components/shared/estado-cuenta/**` |
| R1, R2, R96 | `wallet-sin-uuid.guardia` (superficies nuevas), `wallet-sin-campo-id.guardia`, `WalletFiltros458.test.tsx` («458-D — ningún control pide un id») |
| R102, R103 | `contexto-458.test.ts` bloque D + `contexto-457.test.ts`; cuatro preguntas en el recorrido |
| R104 | `progress/recorrido_458-D/` |

## Build y gate

- `pnpm run build` sobre d5790177 (tras `git merge origin/dev` con la 458-C): `BUILD_EXIT=0`
  (`progress/build_458D.log`).
- Gate completo `./init.sh` contra el clon `ordenex_458d`, sin tail, con `INIT_EXIT` escrito dentro:
  - `progress/gate_458D_1.log` — ROJO: `test-citado-desaparecido` (9 citas R->test de 171/172/381/457 a tests
    retirados; repuntadas en 0e273fae + `PagosTiendaEstadoCuenta.test.tsx` nuevo) y un FK en
    `caja-backfill` (flake de base compartida: 3/3 verde aislado).
  - `progress/gate_458D_2.log` — ROJO: typecheck, el doble del pago decía `metodo: "sinpe"` (arreglado en 4c1d10b2).
  - `progress/gate_458D.log` — **`INIT_EXIT=0`** sobre 4c1d10b2: 2311 archivos, 32173 tests verdes, 26 saltados,
    todos en `AnaliticaPage`/`AnaliticaShell` (ajenos); **0 saltados en `integration/db`**. Las fotografías de
    459 y 458 corren dentro del gate y pasan.

## Pendientes (todos de SERVIDOR; no se hizo ninguno, como se pidió)

1. **Filtro por cierre en el estado de cuenta (R10, recorrido paso 8 en la oficina):** `estadoCuentaSchema` no
   acepta un cierre. Cuando lo acepte, se monta el selector que queda `@sin-superficie`
   (`cierres-selector.ts`, `use-cierres-de-la-cuenta.ts`, `cierresDeLaCuentaAction`).
2. **Origen con entidad y enlace en la fila del estado de cuenta (R6/R7/R8):** `FilaEstadoCuentaDTO` trae
   `origenTipo` y no el `OrigenLegibleDTO`; hoy se pinta el rótulo del diccionario («Cierre del día») sin el día,
   el mensajero ni el enlace al cierre que tenía el desglose (también el enlace «Ver el cierre» de la fila del
   premio, 205/R43, 293/R34).
3. **Despliegue de las órdenes de una fila de cierre (R19, 344/345)** en el estado de cuenta de la oficina: no hay
   lectura de órdenes para una fila del libro de la tienda o del mensajero desde la oficina.
4. **`/mi-wallet` como estado de cuenta con saldo corrido (R34):** `verEstadoCuentaAction` es solo de acceso total;
   hace falta la misma lectura acotada a la tienda de la sesión.
5. **Método y referencia en la fila / el panel** del estado de cuenta: no viajan (el panel no pinta «Cómo»); por eso
   se conserva debajo la lista de pagos de la 172 en la tienda.
6. **Descarga con tope en el servidor:** una acción «completa» del estado de cuenta (hoy se leen las páginas desde el
   cliente, con el tope comprobado antes).
7. **Retirar las acciones sin superficie** (`listarMovimientosDeTienda{,Completo}Action`,
   `listarPagosDeMensajero{,Completo}Action`, `obtenerComprobante{Abono,AporteCapital,PagoPorCuenta}Action`) y, si el
   filtro por cierre no llega, `cierresDeLaCuentaAction`; `rutas-336` admite hoy, NOMBRADAS, las dos del mensajero.
8. `conceptosConMovimientosAction` con `libro: "tienda"` se queda sin superficie (el estado de cuenta filtra por chips).

## Veredicto

UI de la 458-D entregada (pantallas 1 y 4: estado de cuenta de tienda, mensajero y bodega satélite; comprobante en
/mi-wallet), sin tocar servidor ni dinero; build y gate completo en verde; quedan 8 pendientes de servidor (R10,
R6/R7, R19, R34 entre ellos) y TD.5 parcial por R34.

---

# §Servidor — los pendientes de servidor de la 458-D (backend_dev, 2026-09-26)

**Rama:** `wt/458-D-servidor` desde `origin/feature/458-D` en `ba304748` (incluye `dev` con la 458-C), empujada a
`feature/458-D` tras cada paso. **Base:** clon propio `ordenex_458ds` (`CREATE DATABASE … TEMPLATE ordenex` con 0
conexiones a la plantilla medidas antes; `prisma migrate deploy`: «No pending migrations»). `.env` del checkout
principal copiado sin imprimirlo, con la base cambiada al clon y **sin** `DATABASE_URL_PREVIEW`. `pnpm install
--frozen-lockfile` propio, sin junction. Ni la base `ordenex` ni `feature_list.json` se tocaron.
**Búsqueda — lo digo explícitamente:** probé el MCP `codebase-memory` (`search_graph` sobre
`R-job-singularis-projects-ordenex` por «EstadoCuentaService leer estado cuenta») y devolvió símbolos ajenos
(`plantilla-datos.leer`, `cuenta-por-pagar`…): el índice no tiene las piezas de la 458. Todo lo demás se localizó con
`grep` y lectura del archivo real.
**Sin migraciones:** ninguna tabla ni columna nueva; todo son lecturas sobre lo que ya existe (RLS sin cambios).

## Qué se hizo (pendientes 1–6 del frontend_dev)

| # | Pendiente | Pieza |
| --- | --- | --- |
| 1 | Filtro por cierre (R10–R12) | `estadoCuentaSchema.cierreId` (uuid); `VentanaDeLibro.cierreId` → `AND l.origen_tipo = 'cierre_dia' AND l.origen_id = $cierre` sobre el `libro` YA acotado a la cuenta (`EstadoCuentaRepository.paginar`) |
| 2 | Origen con entidad y enlace (R6–R8) | `EstadoCuentaService` recibe `OrigenLegibleService` (458-A) por constructor (obligatorio) y resuelve el origen EN LOTE, fuera de la transacción, con el actor (la tienda no ve mensajero ni enlace al cierre) |
| 3 | Órdenes de una fila de cierre (R19) | `DetalleMovimientoService.verDetalleDeFilaDeCuenta` (344, una sola derivación) + `EstadoCuentaRepository.movimientoDeMensajero` + `FUENTE_MENSAJERO` (Record total) |
| 4 | `/mi-wallet` con saldo corrido (R34–R36) | `EstadoCuentaService.leerMiTienda`: el MISMO `leerCuenta` que la oficina con `cuenta = { tienda, actor.usuarioId }` |
| 5 | Método y referencia en la fila | `EstadoCuentaRepository.pagosDe` (una consulta por tipo de documento de pago presente) → `fila.pago` |
| 6 | Descarga completa con tope en el servidor | `leerCompleto` / `leerMiTiendaCompleto`: ventana `tope + 1`; por encima de `descargaConfig.MAX_FILAS`, `limite_excedido` sin filas |
| 7 | Retirar actions sin pantalla y los conceptos del libro de la tienda | **Nada se borra** (ver §Retirada) |

### Decisiones tomadas (técnicas, anotadas para revisar)

- **El filtro por cierre se comporta como el chip:** filtra FILAS; el saldo corrido sigue siendo el de la cuenta
  entera (R21) y las tarjetas (inicial, abonos, cargos, final) siguen siendo las del periodo. Así R22 sigue cuadrando
  y la afirmación del servicio no cambia. `total` es el de las filas filtradas.
- **Un cierre de otra cuenta** no es error: devuelve 0 filas (R12: «no devolver movimientos de ninguna otra
  cuenta»), igual que un cierre inexistente. Sin forma de uuid → `validation_error` en el borde. En una bodega →
  `validation_error` (`fieldErrors.cierreId`): no hay cierres de mensajero que filtrar.
- **La vista de la tienda** (`/mi-wallet`) NO lleva los nombres de la gente de Ordenex: `registro = { nombre: null,
  automatico: null }` y `anulacion.por = null` (se conservan el motivo y el día, R25). `/mi-wallet` nunca los enseñó
  (su descarga excluía `registradoPor`) y 335/D2 no revela a la tienda quién movió su dinero. `anulable = false`
  siempre (R35). Si el humano quiere ver quién anuló, es una línea en `paraLaTienda`.
- **El mensajero no reparte por orden:** `pago_devengado` = `cierre_dia.total_pago_mensajero` y `pago_efectivo` =
  `min(P,E)` (`WalletMensajeroFeedService`); `cierre_detail` no congela ningún pago por orden. Abrir su fila responde
  `sin_reparto: snapshot_del_cierre` (medido, no supuesto); el enlace a SU cierre lo da `fila.origen.enlace`.

## Contratos para el frontend (todas Server Actions en `lib/actions/estado-cuenta.ts`)

Orden del borde en todas: sesión (`unauthenticated`) → zod `.strict()` (`validation_error` sin leer nada) → servicio
(rol ANTES de leer). Montos STRING escala 2; fechas `YYYY-MM-DD` de Costa Rica; ningún error viaja con filas.

**`FilaEstadoCuentaDTO` gana dos campos** (el resto, igual que en la 458-B):

```ts
origen: OrigenLegibleDTO | null   // { texto, enlace: { etiqueta, href } | null }; null SOLO en filas de bodega.
                                  // El id va SOLO en enlace.href. La tienda: sin mensajero y sin enlace al cierre.
pago: { metodo: "efectivo" | "SINPE" | "transferencia"; referencia: string | null } | null
                                  // pago de la 172 (tienda o mensajero), pago de un gasto (459), pago de la tienda (457)
```

1. **`verEstadoCuentaAction(input)`** (ampliada) — `input = { cuenta: { tipo: "tienda"|"mensajero"|"bodega", id: uuid },
   desde?, hasta?, chip?, cierreId?: uuid, page?, pageSize? }` → `{ status: "ok", estado: EstadoCuentaDTO } |
   no_encontrado | forbidden | validation_error | unauthenticated`. `cierreId` sale de `cierresDeLaCuentaAction`.
2. **`verEstadoCuentaCompletoAction(input)`** (nueva) — `{ cuenta, desde?, hasta?, chip?, cierreId? }` (sin `page`/
   `pageSize`: `validation_error`) → `{ status: "ok", estado }` con TODAS las filas del periodo/filtro (`page: 1`,
   `pageSize: total`) `| { status: "limite_excedido", total, limite }` (sin filas; `limite` = `DESCARGA_MAX_FILAS`,
   5000) `| no_encontrado | forbidden | validation_error | unauthenticated`. La fila del saldo inicial la compone la
   pantalla con `estado.saldoInicial`, como hoy.
3. **`verMiEstadoCuentaAction(input)`** (nueva, `/mi-wallet`) — `{ desde?, hasta?, chip?, cierreId?, page?, pageSize? }`;
   una `cuenta`, un `tiendaId` o cualquier otra clave → `validation_error`. Solo `adminTienda` (si no, `forbidden`).
   `estado.cuenta = { tipo: "tienda", id: <la de la sesión>, nombre }`. Filas: `registro` siempre `{ null, null }`,
   `anulacion.por` siempre `null`, `anulable` siempre `false`, `ref` presente (para `verComprobanteAction`, R78).
   Chips de la tienda (`todo`/`cierres`/`pagos`/`cobros`/`correcciones`); `cierreId` sale de `listarMisCierresAction`
   (335, su selector actual). Mismas filas, mismo corrido y mismas tarjetas que la oficina (medido).
4. **`verMiEstadoCuentaCompletoAction(input)`** (nueva) — lo de 3 sin paginar; mismas ramas que 2.
5. **`verOrdenesDeFilaAction(input)`** (nueva, R19) — `{ cuenta: { tipo: "tienda"|"mensajero", id }, movimientoId,
   page?, pageSize? }` (pageSize de la 344: 25 por defecto, tope 100) → `{ status: "ok", data: DetalleMovimientoPayload }`
   (el de la 344: `monto`, `cierre: { fecha, mensajeroNombre }`, `ordenesDelCierre`, `total`, `page`, `pageSize`,
   `ordenes[]`) `| { status: "sin_reparto", motivo } | not_found | forbidden | validation_error | unauthenticated`.
   Solo acceso total. Úsese en las filas con `naceDeUnCierre`; la cuenta es la de la página (`movimientoId` =
   `fila.ref.movimientoId`). En la tienda trae SOLO las órdenes de esa tienda y el mensajero en la cabecera; en el
   mensajero responde siempre `sin_reparto: "snapshot_del_cierre"`.
6. **`cierresDeLaCuentaAction`** (458-A, sin cambios) — `{ cuenta: "tienda", tiendaId, busqueda? } | { cuenta:
   "mensajero", mensajeroId, busqueda? }` → `{ ok, opciones: [{ cierreId, dia, hora, mensajero, movimientos }], hayMas }`.
   `opciones[i].cierreId` es el `cierreId` de 1/2.

Las cuatro nuevas llevan `@sin-superficie` con su motivo: **caducan** al montarlas (la guardia de superficie exige
quitarlas entonces). Los comentarios de `components/shared/wallet/cierres-selector.ts` y `use-cierres-de-la-cuenta.ts`
aún dicen «pendiente de servidor»: son UI y no los toqué; al montar el selector se actualizan.

## §Retirada (pendiente 7) — nada se borra, y por qué

Busqué TODOS los llamadores de cada candidata en `app/`, `lib/`, `components/`, `scripts/`, `e2e/`, `tests/`
(incluidas las rutas de `app/api/**`, los 7 crons y el asistente): **ninguna tiene llamadores en API pública,
asistente, scripts ni crons; todas tienen llamadores en tests**, varios de ellos redes de OTRAS fichas contra
Postgres. Por la regla del encargo, no se borra ninguna; cada una lleva anotados sus usuarios junto al export.

| Candidata | Usuarios que impiden borrarla |
| --- | --- |
| `listarMovimientosDeTienda{,Completo}Action` | `tests/integration/db/wallet-cierres-selector.test.ts` y `wallet-origen-legible.test.ts` (458-A, Postgres), `wallet-tiendas-page`, `BajoRiesgoPaginacion`, `saldos-tiendas-table.negativo`, `wallet-tienda-schemas`, `wallet-tienda-desglose-action` |
| `listarPagosDeMensajero{,Completo}Action` | `e2e/wallet-mensajeros.spec.ts`, `rutas-336-retiradas.guardia` (las nombra), `pago-mensajero-liquidacion` y `wallet-cierres-selector` (Postgres), `wallet-mensajeros-page`, `CuentasPorPagarTable`, `paginacion-transversal`, `WalletMensajerosTabs`, sus tests de borde |
| `obtenerComprobanteAbonoAction` | `tests/integration/db/abono-tienda-457.test.ts` (alcance del comprobante de la 457 contra Postgres), `abono-tienda-action`, doble en `WalletLedgerAcciones457` |
| `obtenerComprobante{AporteCapital,PagoPorCuenta}Action` | `pago-por-cuenta-y-capital-actions` (borde de la 459), dobles en `WalletLedgerAcciones457/459/461` y `WalletFechaCostaRica459` |
| `conceptosConMovimientosAction` rama `libro: "tienda"` | `wallet-conceptos-con-movimientos` (R13 de la 458-A contra Postgres, tienda ajena incluida), `filtros-wallet-service` |
| `cierresDeLaCuentaAction` | NO es candidata ya: es la lectura de las opciones del filtro por cierre que el servidor ahora acepta; su `@sin-superficie` caduca al montar el selector |

Retirarlas es mover primero esas redes (al estado de cuenta, a `verComprobanteAction` o a la rama `mi_tienda`),
otra tarea.

## Tests nuevos o tocados

- `tests/integration/db/estado-cuenta-servidor-458d.test.ts` (13, Postgres real, transacción revertida): siembra el
  escenario de la 458 + un cierre REAL del mensajero compartido por la tienda C y una tienda D nueva, y una fila de D
  en el cierre de C.
- `tests/integration/db/detalle-movimiento-cierre-postgres.test.ts`: +3 casos «458-D R19» (feeds reales de la 344).
- `tests/unit/actions/estado-cuenta-458d-action.test.ts` (7): orden del borde de las cuatro actions nuevas.
- Ajustes de construcción (dependencia nueva obligatoria): `_fixtures/wallet-458.ts`, `estado-cuenta-concurrencia-458`,
  `wallet-detalle-movimiento`, `wallet-tienda-detalle-movimiento`; y los dos campos nuevos en los dobles
  `tests/fixtures/estado-cuenta.ts` y `wallet-sin-uuid.guardia` (sin cambiar ninguna aserción).

## Mapa R → test (servidor)

| R | Test |
| --- | --- |
| R10, R12 | `estado-cuenta-servidor-458d` («R10/R12: el cierre compartido…», «R12: un cierre de otra cuenta…», «R10/R12: cierre en una bodega o sin forma de id…»); `estado-cuenta-458d-action` (cierre sin forma en el completo) |
| R21 (con cierre) | `estado-cuenta-servidor-458d` («R21: el corrido de las filas filtradas por cierre…») |
| R6, R7 | `estado-cuenta-servidor-458d` («R6/R7: en la oficina…») |
| R8 | `estado-cuenta-servidor-458d` («R8: la tienda ve el mismo origen SIN…») |
| Método y referencia | `estado-cuenta-servidor-458d` («metodo y referencia del documento de pago…») |
| R19 | `detalle-movimiento-cierre-postgres` («458-D R19: …», 3); `estado-cuenta-458d-action` («las ordenes de una fila») |
| R22 | `estado-cuenta-servidor-458d` («R22: corrido de la ultima fila = tarjeta = derivarSaldoTienda = verMiSaldo») |
| R34 | `estado-cuenta-servidor-458d` («R34: /mi-wallet lee el MISMO extracto…») |
| R35 | `estado-cuenta-servidor-458d` («R35/D2: …») |
| R36 | `estado-cuenta-servidor-458d` («R36: lo ajeno responde igual que lo inexistente…», «R36: ninguna clave de cuenta…»); `estado-cuenta-458d-action` (borde de /mi-wallet) |
| R32 (TD.6) | `estado-cuenta-servidor-458d` («TD.6/R32 …»); `estado-cuenta-458d-action` |

## Mutaciones (12, una a una; arnés con autocomprobación) — `progress/mutaciones_458-D_servidor.json`

Cada una: el archivo cambia, se corren > 0 tests, se restaura byte a byte y el `git diff` del archivo queda igual.
**12/12 muertas.**

| # | Mutación | Tests | Rojos |
| --- | --- | --- | --- |
| M-D1 | el filtro de cierre sin el id (solo `origen_tipo`) | `estado-cuenta-servidor-458d` | 4/13 |
| M-D2 | el filtro de cierre no se aplica | `estado-cuenta-servidor-458d` | 4/13 |
| M-D3 | `/mi-wallet` sin comprobar el rol | `estado-cuenta-servidor-458d` | 1/13 |
| M-D4 | la vista de la tienda no se aplica (nombres y «Anular…») | `estado-cuenta-servidor-458d` | 1/13 |
| M-D5 | la fila sin el origen resuelto | `estado-cuenta-servidor-458d` | 3/13 |
| M-D6 | la referencia no viaja | `estado-cuenta-servidor-458d` | 1/13 |
| M-D7 | el tope del completo no se mira | `estado-cuenta-servidor-458d` | 1/13 |
| M-D8 | cierre aceptado en una bodega | `estado-cuenta-servidor-458d` | 1/13 |
| M-D9 | el borde de `/mi-wallet` sin `.strict()` | `estado-cuenta-458d-action` + `-servidor-458d` | 2/20 |
| M-D10 | la fila del mensajero sin su cuenta en el `WHERE` | `detalle-movimiento-cierre-postgres` | 1/14 |
| M-D11 | las órdenes de la tienda sin acotar a esa tienda | `detalle-movimiento-cierre-postgres` | 1/14 |
| M-D12 | las órdenes de una fila sin comprobar el rol | `detalle-movimiento-cierre-postgres` | 1/14 |

## Build y gate (servidor)

- `pnpm run typecheck` y `pnpm exec eslint` sobre los archivos tocados: 0 errores (2 avisos previos ajenos).
- `pnpm run build` sobre `319d1ca7`: **`BUILD_EXIT=0`** (`progress/build_458D_servidor.log`).
- Gate completo `./init.sh` contra el clon `ordenex_458ds`, sin tail, con `INIT_EXIT` escrito dentro
  (`progress/gate_458D_servidor.log`) sobre `4b704454`: **`INIT_EXIT=0`** — «DATABASE_URL resuelta: los 316 archivos
  de tests contra Postgres SI se ejecutan»; **2313 archivos, 32196 tests verdes, 26 saltados**, todos en
  `AnaliticaPage`/`AnaliticaShell` (ajenos, los mismos de la corrida del frontend); **0 saltados en
  `integration/db`** (404 archivos, medido sobre `.vitest/rojos.json`); «sin rojos nuevos». Las fotografías de 459 y
  458 corren dentro y pasan.

## Veredicto (servidor)

Los pendientes de servidor 1–6 de la 458-D quedan hechos con sus contratos para el frontend, probados contra
Postgres y con 12/12 mutaciones muertas; el 7 (retirada) se evaluó y no se borra nada porque todas las candidatas
tienen llamadores en tests de otras fichas; build y gate completo en verde.
