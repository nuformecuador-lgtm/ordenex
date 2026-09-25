# Auditoría del módulo de wallet — 2026-09-25

- **Base auditada:** `origin/dev` en `e33abeee` (worktree propio, `pnpm install` propio, `prisma generate`).
- **Base de datos:** clon `ordenex_audit` (`CREATE DATABASE … TEMPLATE ordenex`, 216 migraciones al día). Borrado al terminar.
- **Gate completo** (`./init.sh`) sobre el clon: **verde** — 2201 archivos, 31.135 tests, 26 skipped, `INIT_EXIT=0`.
- **Búsqueda:** MCP `codebase-memory` (`R-job-singularis-projects-ordenex`) para escritores y llamadores; el índice
  no ve los archivos nuevos de la 459 (`trace_path` de `crearMovimientos` devolvió llamadores vacíos), así que TODO
  se confirmó con `grep` sobre el árbol real. Cada `archivo:línea` de este informe es de esa lectura.
- **Recorrido en navegador:** Playwright (Chromium) contra un solo dev server del worktree, salida a archivo;
  matado al terminar y `.next/dev` borrado. Roles: maestro, admin, adminTienda, mensajero, adminSatelite.
  Credenciales rotadas SOLO en el clon (`seed-usuarios-qa`, `seed-maestro`); OTP desactivado en el `.env` del
  worktree (`AUTH_RISK_THRESHOLD=999`, la misma configuración que producción).
- **Hallazgo ya conocido (no re-descubierto, alcance medido):** «Cobrar un costo a una tienda» solo escribe en el
  libro de la tienda (`lib/services/CobroTiendaService.ts:120-133`); ni ganancia ni caja. Se corrige en la 461.

## Veredicto en una línea

**El dinero cuadra.** En los 14 caminos que escriben dinero, R7 (cifra principal = ganancia + «De las tiendas»
+ capital) y R8 («De las tiendas» = Σ saldos + cobros de un costo no reclasificados) dieron **0,00 al céntimo**
después de cada registro y de cada anulación, ejecutados por la interfaz real y por las Server Actions reales
contra Postgres. Los candados y la idempotencia por clave resistieron las carreras forzadas. Lo que falla es de
**datos y pantalla**: el filtro por periodo de los libros está desplazado seis horas y trunca el último día
(FALLO T1), los pagos a tienda/mensajero caen en la analítica un día antes del que enseña el libro (T2), y hay
tres caminos de dinero sin vía de corrección ni clave de idempotencia (D2, D3).

## 1. Inventario de caminos que escriben dinero

Libros: **C** = `wallet_movimiento` (caja), **T** = `wallet_tienda_movimiento`, **M** = `pago_mensajero_movimiento`.
«R7/R8» = medido en el clon con la consulta C1 de `specs/459…/design.md` §11 antes y después del paso (§2).
«Test real» = test de integración contra Postgres que ejercita la escritura (no un doble).

| # | Camino (escritor) | Libros que toca | R7/R8 | Anulación | Idempotencia / candado | Test real | Veredicto |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Aprobar cierre — `CierresAdminRepository.resolverCierre` (:1866-1928) y sus 5 feeds | C (6 cargos, COD, pago mensajero, indemnización) · T (COD + 6 débitos) · M (devengo, pago efectivo) | 0,00 / 0,00 | No hay anulación de cierre aprobado; rechazar no toca libros; corregir gestión solo con cierre abierto (:1660-1670) | Índices únicos parciales + `skipDuplicates`; una transacción | caracterizacion-459, caja-tesoreria-idempotencia, cierre-rechazo-tienda-aprobacion | OK |
| 2 | Pago a tienda — `LiquidacionService.registrarPagoTienda` (:613-705) | T `pago_tienda` · C `egreso_pago_tienda` · doc | 0,00 / 0,00 (UI ₡1.000) | `anularPago` (:740-787): T `ajuste_credito` + C `ingreso_reverso_pago_tienda`; medido exacto | Clave UNIQUE; `FOR UPDATE` en `usuario` (:627); tope al saldo | liquidacion-idempotencia, wallet-tienda-idempotencia | OK (T2) |
| 3 | Pago / reparto a mensajero — `registrarPagoMensajero` (:290), `registrarRepartoMensajero` (:484) | M `liquidacion` · doc; **la caja no cambia** (devengo al aprobar) | 0,00 / 0,00 (UI ₡100) | `anularPago` / `anularReparto`: M `ajuste_devengo` | Clave UNIQUE; `FOR UPDATE` en `cierre_dia`; candados ordenados | pago-mensajero-liquidacion, pago-mensajero-idempotencia | OK (P6) |
| 4 | Cobrar un costo — `CobroTiendaService.registrarCobro` (:90-161) | T `cobro_manual` **solo** | 0,00 / 0,00 (excepción declarada de R8) | **No existe** (`ICobroTiendaService.ts:48`) | **Sin clave** (`origen_id NULL`), **sin candado** (deliberado) | wallet-tienda-cobro | **FALLO** D1 (461), D2, D3 |
| 5 | Pago por cuenta — `PagoPorCuentaTiendaService.registrar` (:126-237) | T `pago_por_cuenta` · C `egreso_pago_por_cuenta_tienda` · doc + historial | 0,00 / 0,00 (UI ₡10.000) | `anular` (:244-301): T `pago_por_cuenta_anulado` + C reverso, mismo instante; medido exacto | Clave UNIQUE (doble envío → `ok` + `ya_registrado`); **mismo** `FOR UPDATE` que el pago a tienda; UNIQUE(pago_id) | pago-por-cuenta-tienda (+ concurrencia), caja-invariante-tiendas | OK |
| 6 | Saldo inicial / aporte — `AporteCapitalService.registrar` (:95-197) | C `ingreso_aporte_capital` (capital) · doc + historial | 0,00 / 0,00 (UI ₡1.000.000) | `anular` (:200-231): C `egreso_reverso_aporte_capital` hoy; medido exacto | Clave UNIQUE; advisory lock del saldo inicial | aporte-capital, caja-estado-459 | OK |
| 7 | Ajuste manual de caja — `WalletService.registrarMovimientoManual` (:323-373) | C `ingreso_ajuste` / `egreso_ajuste` + historial | 0,00 / 0,00 | **No existe** (la corrección es otro ajuste) | **Sin clave** (:351) | wallet-idempotencia, wallet-fecha-elegida | D2, D3 |
| 8 | Sueldo / gasto variable — `WalletEgresoService.registrarEgreso` (:41-86) | C `egreso_sueldo` / `egreso_gasto_variable` + historial | 0,00 / 0,00 (UI ₡1.234,56) | `reversarEgreso` (:88-130): C `ingreso_ajuste`; medido exacto; 2.º intento «ya tenía su reversa» | Registro **sin clave**; reverso idempotente por índice | wallet-egreso | OK (D2, P3) |
| 9 | Gasto fijo — cron `GeneracionGastosFijosService` (:81-161); `GastoFijoCobroService.aprobar` (:97-155, solo maestro) | C `egreso_gasto_fijo` (o cobro pendiente) | fotografía 459 (sin plantillas en el clon) | reverso por `reversarEgreso` | Clave `<plantilla>:<periodo>`; `UPDATE … WHERE estado='pendiente'` | generacion-gastos-fijos, gasto-fijo-cobro-aprobacion/idempotencia | OK |
| 10 | Cobro por rechazo — `RechazoTiendaCobroService.aprobar` (:174-210) | C flete devolución (+IVA) como cargo · T débitos espejo | 0,00 / 0,00 (1 en la base) | **No existe** | Índices únicos por gestión; decisión atómica | rechazo-tienda-cobro.int, cierre-rechazo-tienda-* | OK (D3) |
| 11 | Premio del ranking — `PremioRankingDevengoService` (:159-253) | M `premio_ranking` · C `egreso_pago_mensajero` (origen fila del podio) | fotografía 459 | `anularPremio` (:263-326): M `ajuste_pago` + C `ingreso_ajuste` | Índices únicos (mensajero, día) | premio-ranking-idempotencia | OK |
| 12 | Indemnización por incidente — `IncidenteAdminRepository.resolver` (:352-359) | C `egreso_indemnizacion` (origen `orden_incidente`) | no ejercido | **No existe** | Índice único parcial | **solo dobles** (`wallet-indemnizacion-incidente-feed`) | D3; m5 |
| 13 | Backfill 173 — `CajaBackfillTesoreriaService` (script manual) | C | n/a | n/a | claves libres + `skipDuplicates`; excluye pagos por cuenta y aportes (R97) | caja-backfill | OK |
| 14 | Reclasificación 459 — migración `20260925120300` | C `egreso_pago_por_cuenta_tienda` (origen `cobro_manual_reclasificado`) | contraste C1 del leader 0,00 | `down.sql` borra exactamente esas filas | `ON CONFLICT DO NOTHING`; aborta si la lista no cuadra | reclasificacion-459-migration + guardia | OK |

Los `Record` totales que impiden que un concepto nuevo compile sin clasificarse siguen completos y coherentes:
`NATURALEZA_POR_CATEGORIA` y `LIQUIDEZ_POR_CATEGORIA` (`lib/utils/caja-tesoreria.ts:62-134`), `CONTRAPARTIDA_EN_CAJA`
(`lib/utils/invariante-tiendas.ts:50-76`), `CUBETA_POR_CATEGORIA` (`lib/utils/desglose-tienda.ts:34-59`). Los CHECK
tipo↔categoría de los tres libros y el RLS de las 12 tablas de dinero están activos (consultados en el clon).

## 2. Pruebas de cuadre ejecutadas (clon, cifras al céntimo)

Línea base del clon (C1): entró 13.524.733,22 · salió 40.800,50 · **cifra 13.483.932,72** · ganancia
13.336.262,62 · «De las tiendas» 147.670,10 · capital 0 · Σ saldos 147.670,10 · cobros 0 · **dif R8 0,00 · dif R7 0,00**.
La tarjeta de `/wallet` mostró exactamente esas cifras («Flujo de dinero registrado ₡13.483.932,72 … desde el 11 de
agosto de 2026»; `MIN(fecha_movimiento)` del clon = 2026-08-11 CR), y `/wallet/tiendas` y `/mi-wallet` el saldo
147.670,10 = 191.400 − 43.729,90.

| Paso (por la interfaz, como admin) | Caja: cifra / «De las tiendas» / ganancia / capital | Tienda (Tania) saldo · desglose | dif R8 / R7 | Pantalla |
| --- | --- | --- | --- | --- |
| Pago por cuenta ₡10.000 (Facebook, SINPE, ref) | 13.473.932,72 / 137.670,10 / igual / 0 | 137.670,10 · pagado 10.000 | 0,00 / 0,00 | Aviso «Pago registrado. El saldo de Tania Tienda queda en ₡137.670,10 · A favor»; fila «Pago por cuenta de una tienda · Tienda · Pago por cuenta de tienda · Tania Tienda · A Facebook · …»; historial `pago_por_cuenta_tienda_registrado` con nombre y monto |
| Anular ese pago (motivo obligatorio) | 13.483.932,72 / 147.670,10 / igual / 0 | 147.670,10 · a favor 201.400, pagado 10.000 | 0,00 / 0,00 | Contra-asiento «Pago por cuenta anulado» fechado hoy; la original marcada «Anulado»; `/mi-wallet` los rotula «Pago por cuenta de la tienda» / «Pago por cuenta anulado» |
| Cobrar un costo ₡5.000 (dos veces) | **sin cambio** (13.483.932,72 / 147.670,10) | 137.670,10 · cargos +10.000 | 0,00 / 0,00 (cobros_costo 10.000 en la excepción) | Aviso con el saldo; `/mi-wallet` «Cobro de Ordenex · Manual · Costo auditoria» |
| Saldo inicial ₡1.000.000 fechado 2026-09-01 | rechazado: «El saldo inicial no puede ser posterior al 11 de agosto de 2026, el primer día con movimientos en la caja.» | — | — | El monto llega vacío (R27) |
| Saldo inicial ₡1.000.000 fechado 2026-08-01 | 14.483.932,72 / 147.670,10 / igual / **1.000.000** | igual | 0,00 / 0,00 | Tarjeta «Dinero en caja»; barra «Reparto del dinero en caja. De las tiendas: ₡147.670,10. De Ordenex: ₡14.336.262,62 (ganancia y aportes)»; fila con dueño «Ordenex (capital)» |
| Anular el saldo inicial | 13.483.932,72 / … / 0 | igual | 0,00 / 0,00 | Vuelve a «Flujo de dinero registrado»; contra-asiento «Saldo inicial o aporte anulado» fechado hoy; original «Anulado» |
| Gasto variable ₡1.234,56 | 13.482.698,16 / igual / 13.335.028,06 (gastos 42.035,06) | — | 0,00 / 0,00 | Fila con «Reversar» |
| Reversar el gasto | 13.483.932,72 / igual / 13.336.262,62 (ingresos y gastos +1.234,56 cada uno) | — | 0,00 / 0,00 | «Egreso reversado…»; 2.º intento → «Este egreso ya tenía su reversa.» (ver P3) |
| Pago a tienda ₡1.000 (desde el desglose) | 13.482.932,72 / 146.670,10 | 136.670,10 · pagado 11.000 | 0,00 / 0,00 | Fila del comprobante «Vigente · Anular»; **la tabla de saldos siguió en 137.670,10** (P1) |
| Anular el pago a tienda | 13.483.932,72 / 147.670,10 | 137.670,10 · a favor 202.400 | 0,00 / 0,00 | Comprobante «Anulado por Ana el 2026-09-25 · Motivo…»; la tabla de saldos siguió en 136.670,10 (P1) |
| Reparto ₡100 a Marco (desde `/wallet/mensajeros`) | **caja sin cambio**; CxP mensajeros 5.100 → 5.000 | — | 0,00 / 0,00 | Cabecera del desglose 15.700 / 5.000; **la tabla superior siguió en 15.600 / 5.100** (P1); ningún «Anular» en la wallet (P6) |
| Descargas | `libro-de-movimientos-2026-09-25.xlsx`: 44 filas = 44 movimientos, mismo orden, mismos importes y rótulos que la tabla; `saldos-de-tiendas-2026-09-25.xlsx`: 137.670,10 = tabla | | | Sin uuids en las descargas |

Carreras forzadas (servicios reales, dos conexiones, pausa dentro de la transacción; test temporal, borrado):

| Carrera | Resultado medido |
| --- | --- |
| Pago a tienda ₡8.000 PAUSADO ∥ cobrar un costo ₡5.000 (saldo 10.000) | El cobro **esperó** aunque `CobroTiendaService` no toma candado: su INSERT con FK a `usuario` toma `FOR KEY SHARE`, que choca con el `FOR UPDATE` del pago. Final: pago `ok`, cobro `ok`, saldo −3.000 (permitido por HF3). R7/R8 sin variación |
| Anular pago ₡6.000 PAUSADO ∥ segundo pago ₡6.000 | El segundo pago esperó (`FOR UPDATE` compartido); anulación `ok`, pago `ok`, saldo 4.000. R7/R8 sin variación |
| Dos envíos simultáneos del mismo pago por cuenta (misma clave) | `ok` + `ya_registrado`; 1 documento, 1 débito, 1 egreso |
| Dos anulaciones simultáneas / dos saldos iniciales a la vez | Cubiertas por `pago-por-cuenta-tienda-concurrencia.test.ts` (verde en el gate) |
| 14 filas del libro de una tienda con el MISMO instante, paginadas de 4 en 4 | 14 vistas, 0 duplicadas, 0 faltantes (Postgres devolvió un orden estable; sigue sin desempate declarado, ver menor m4) |

## 3. Roles y acceso cruzado

Páginas (Playwright, HTTP real): maestro y admin → `/wallet`, `/wallet/tiendas`, `/wallet/mensajeros`,
`/wallet/satelites` 200 y `/mi-wallet` 404; adminTienda → los cuatro `/wallet*` 404 y `/mi-wallet` 200;
mensajero → todo 404 (también `/mi-wallet` y `/analitica`); adminSatelite → `/wallet*` y `/mi-wallet` 404.

Server Actions reales con el actor inyectado (test temporal contra Postgres, borrado):

| Actor → acción | Respuesta | Filas escritas |
| --- | --- | --- |
| adminTienda → registrar pago por cuenta, cobro, pago a tienda, aporte | `forbidden` (las cuatro) | 0 |
| adminTienda → resumen de caja, libro de caja, saldos de todas las tiendas | `forbidden` | — |
| adminTienda (otra tienda) → desglose de una tienda ajena (`listarMovimientosDeTiendaAction`) | `forbidden` | — |
| adminTienda → comprobante de un pago por cuenta ajeno / propio sin comprobante | `no_encontrado` / `sin_comprobante` (no distingue ajeno de inexistente, R57) | — |
| adminTienda → anular pago por cuenta | `forbidden` | 0 |
| mensajero → resumen de caja, cuentas por pagar, anular pago, egreso administrativo | `forbidden` (las cuatro) | 0 |
| adminSatelite → resumen de caja, saldos, cuentas por pagar | `forbidden` | — |
| maestro → anular pago por cuenta con `monto` en la petición | `validation_error` (R37, `.strict()`) | 0 |
| adminTienda → `listarMisMovimientosAction` con `tiendaId` ajeno en la entrada | `ok` **acotado al actor** (`WalletTiendaService.ts:110,165`: `tiendaId: actor.usuarioId` al final); el schema paginado no es `.strict()` y no rechaza la clave (el completo sí, `wallet-tienda.ts:25-27`) | — |

## 4. FALLOS por gravedad (dinero > datos > pantalla)

### Dinero

**D1 — Cobrar un costo no toca la caja ni la ganancia (conocido; ficha 461).** Alcance medido: dos cobros de
₡5.000 dejaron la cifra principal, «Entró/Salió» y la ganancia idénticas; solo bajó el saldo de la tienda. R8 lo
absorbe como excepción (`cobros_costo`), así que la tarjeta y la Σ de saldos siguen cuadrando, pero la ganancia
de Ordenex queda **subestimada** en cada cobro genuino y «De las tiendas» ya no es la Σ de saldos. En producción
los 203 antiguos ya están reclasificados; el riesgo es cada cobro nuevo desde entonces (consulta Q1).
*Reproducir:* `/wallet` → Registrar movimiento → «Cobrar un costo a una tienda» → ₡5.000 → la tarjeta no cambia.
*Corrección:* la de la 461 (el cobro escribe su cargo en la caja como hacen los seis cargos del cierre, y la
excepción de R8 desaparece).

**D2 — Sin clave de idempotencia en tres caminos de dinero: cobro de un costo, ajuste manual de caja y
sueldo/gasto variable.** Los tres insertan con `origen_id NULL`, fuera del índice único parcial
(`CobroTiendaService.ts:127-128`, `WalletService.ts:351`, `WalletEgresoService.ts:66-67`), y sus diálogos no
generan clave. Medido: dos cobros idénticos («Costo auditoria», ₡5.000) en 10 s quedaron como dos filas. Un doble
envío o un reintento de red por un error 5xx tardío (los que la memoria del repo ya tiene medidos) cobra o gasta
dos veces sin que nada lo note. Los caminos nuevos (pago a tienda, pago por cuenta, aporte) sí llevan clave; es la
familia que la 458 R48 quiere cerrar. *Corrección:* clave de idempotencia generada al abrir el diálogo y columna
UNIQUE (molde `pago_por_cuenta_tienda.clave_idempotencia`), o al menos `origen_id` = clave del formulario para
caer en el índice único existente.

### Datos

**D3 — Tres caminos de dinero sin ninguna vía de corrección en la app:** cobro de un costo (`ICobroTiendaService.ts:48`
lo prohíbe por escrito), ajuste manual de caja y cobro por rechazo aprobado (más la indemnización por incidente).
Un cobro equivocado a una tienda deja su saldo mal hasta que alguien toque la base: no existe productor de
`ajuste_credito` salvo la anulación de un pago, y no hay «Anular…» para esas filas. Es decisión de la 381 (R22),
pero la 458 (R58/R63) ya la revierte. *Corrección:* «Anular…» con contra-asiento para cobro de un costo y ajustes
(molde exacto del pago por cuenta: documento + anulación + contra-asiento fechado hoy), y decidir el caso del cobro
por rechazo aprobado.

**T1 — El filtro por periodo de los libros está desplazado seis horas y trunca el último día.** Los cuatro
schemas (`lib/types/wallet.ts:520-521`, `wallet-tienda.ts:179-180`, `wallet-mensajero.ts:159-160`) hacen
`z.coerce.date()` sobre el `YYYY-MM-DD` del `<input type="date">` → medianoche **UTC**, y el repositorio filtra
`gte desde` / `lte hasta` (`WalletMovimientoRepository.ts:87-92`). Medido en `/wallet`: filtro **hoy** (25/09) →
«Movimientos 2», solo el pago a tienda y su anulación (fechados 00:00Z), mientras el día tenía 7 movimientos;
filtro **ayer** (24/09) → «No hay movimientos que coincidan» y «Movimiento neto del periodo ₡0», con 16
movimientos reales ese día. Un rango `desde–hasta` incluye las 18:00–24:00 CR del día anterior a `desde` y excluye
casi todo `hasta`. Afecta al libro de la caja, a «Movimiento neto del periodo», a los desgloses de tienda y
mensajero, a `/mi-wallet` y a las descargas filtradas. La analítica lo hace bien (`inicioDelDiaCREnUtc`).
*Corrección:* en el borde, `desde = inicioDelDiaCREnUtc(desde)` y `hasta` como cota **exclusiva**
`inicioDelDiaSiguienteCREnUtc(hasta)` (`lib/utils/fecha-cr.ts:118-131`), con `lt` en el repositorio; un test que
filtre un día con movimientos a las 08:00 CR y a las 22:00 CR.

**T2 — Los pagos a tienda y a mensajero (y sus anulaciones) se fechan a medianoche UTC también en la caja, y el
rollup diario los cuenta el día anterior.** `medianocheUtcDelDia(fechaPago)` va a `fecha_movimiento` de la caja
(`LiquidacionService.ts:672,687,756,838`); `FinanzasDiarioRepository` e `IngresosAnaliticaRepository` agrupan por
`fecha_movimiento − 6 h`. Medido: pago del 25/09 → `dia_cr_rollup = 2026-09-24`; el libro lo pinta 2026-09-25
(`fechaDiaMovimientoCR` trata la medianoche exacta como fecha). La propia
`lib/utils/fecha-movimiento-manual.ts:21-26` documenta por qué 00:00Z está descartado para la caja. Hoy la serie
diaria no tiene pantalla; `dinero_en_caja`, `egresos` y `ganancia_ordenex` por día en `/analitica` sí.
*Corrección:* fechar los asientos de **caja** del pago y su anulación con `inicioDelDiaCREnUtc(dia)` (06:00Z, la
convención de los manuales), dejando `fecha_pago` del documento como está; backfill de `+6 h` sobre las filas de
caja con origen `pago_tienda` a medianoche exacta (consulta Q3 mide cuántas).

### Pantalla

**P1 — Las tablas de saldos y de cuentas por pagar no se refrescan tras registrar o anular desde el desglose.**
`/wallet/tiendas`: tras pagar ₡1.000 la tabla siguió en ₡137.670,10 y la cabecera del desglose, debajo, en
₡136.670,10; tras anular, 136.670,10 vs 137.670,10. `/wallet/mensajeros`: tras el reparto de ₡100 la tabla siguió en
15.600 / 5.100 y la cabecera en 15.700 / 5.000. Dos cifras distintas del mismo dinero en la misma pantalla hasta
recargar. *Corrección:* el `onRegistrado`/`onAnulado` del desglose debe refrescar también la lista (SWR `mutate` de
la clave de saldos), como hace `/wallet` con su tarjeta (R65).

**P2 — Identificadores internos visibles en `/wallet/mensajeros`.** El desglose pinta el uuid del cierre entre
paréntesis junto a «Ver el cierre» («(942993c5-9c11-4153-a207-9af086b22fc3)») y el filtro «Cierre» pide pegar ese
identificador («El identificador del cierre sale del enlace…»). Contradice H6 de la 458 (R1/R2/R10, pendientes).
*Corrección:* la de la 458 (selector de cierres con movimientos; el uuid deja de pintarse).

**P3 — «Reversar» sigue ofreciéndose sobre un egreso ya reversado.** Tras reversar el gasto de ₡1.234,56 la fila
conserva el botón; el segundo clic responde «Este egreso ya tenía su reversa.» (sin doble asiento, el índice único lo
impide). Debería mostrarse «Reversado» como hacen «Anulado» en los pagos por cuenta y aportes (458 R66).

**P4 — La pista de «Cargos de Ordenex» en `/wallet/tiendas` dice «Fletes, comisión e IVA»** (`desglose-tienda-labels.ts:45`)
mientras el importe ya incluye los cobros de un costo; en `/mi-wallet` sí los nombra (`mi-wallet-labels.ts:52`).
Es la deuda declarada en la 458 R90.

**P5 — El nombre de la tienda cambia entre superficies:** «Tania Tienda» en avisos e historial del pago por cuenta
(`etiquetaDePersona`), «Tania» en las tablas y en el historial del cobro. *Corrección:* una sola función de etiqueta.

**P6 — Un pago a mensajero no se puede anular desde la wallet.** El desglose de `/wallet/mensajeros` no ofrece
«Anular…» (solo `/cierres-admin`). Es la 458 R65, pendiente.

**P7 — Observaciones menores de texto:** el subtítulo de `/wallet` sigue diciendo «dinero en caja» en estado «flujo»
(`app/(app)/wallet/page.tsx`, m3 de la revisión 459); el filtro de concepto ofrece conceptos sin movimientos
(«Ajuste (débito)», «Pago a la tienda»; 458 R13); al entrar en `/wallet` como admin aparece primero el modal
«Confirmá el SINPE de GAM» (ficha 429) y hay que descartarlo para operar.

## 5. Menores (no bloquean)

- **m1** — El schema paginado del libro de la tienda (`listarMovimientosTiendaSchema`) no es `.strict()`: acepta un
  `tiendaId` ajeno en la entrada (lo ignora; el acotado por actor manda). El completo sí lo rechaza.
- **m2** — Los KPIs financieros de `/analitica` no tienen superficie (sección comentada desde el 2026-08-18): la
  comparación «KPIs frente a la caja» no es verificable en pantalla; `AnaliticaFinancieraService.deTesoreria` usa la
  misma `derivarCaja` que la tarjeta.
- **m3** — Cobros de un costo: el diálogo dice que «no se puede editar ni deshacer» y el servicio no exige nada
  contra el saldo; con un cobro y un pago a tienda simultáneos la tienda puede quedar en negativo (medido −3.000,
  permitido por HF3).
- **m4** — `listarPorTienda` y `listarPorMensajero` ordenan solo por `fecha_movimiento desc` sin desempate (a
  diferencia de la caja, que añade `createdAt` e `id`): con más filas del mismo instante que el tamaño de página la
  paginación puede repetir u omitir filas. Medido con 14 filas / páginas de 4: estable en este Postgres; sigue sin
  garantía.
- **m5** — La indemnización por incidente (`IncidenteAdminRepository.resolver`) y el reverso del premio del ranking
  solo tienen tests con dobles del repositorio de caja; ningún test contra Postgres ejercita esas dos escrituras.
- **m6** — `AporteCapitalService` lee el primer día de la caja fuera de la transacción (m7 de la revisión 459).

## 6. Lo que se comprobó y está bien

- Identidad R7 e invariante R8 al céntimo tras cada uno de los 11 pasos por interfaz y en las 3 carreras (§2).
- Las anulaciones (pago a tienda, pago por cuenta, saldo inicial, reverso de egreso) devuelven caja, saldo,
  desglose, ganancia y capital a su valor exacto, sin borrar ni editar filas; contra-asientos fechados hoy.
- Idempotencia por clave en pago a tienda, pago por cuenta, reparto y aporte; candado `FOR UPDATE` compartido entre
  pago a tienda, pago por cuenta y sus anulaciones (medido con pausas dentro de la transacción).
- Roles: 20 combinaciones de acción×rol responden `forbidden`/`no_encontrado`/`validation_error` sin escribir; las
  páginas responden 404 a los roles sin acceso.
- Textos y rótulos de la 459 en pantalla (estado flujo/saldo, barra solo en «saldo», «Ordenex (capital)», conceptos
  nuevos en libro, desglose, `/mi-wallet` y filtros); fechas del libro en día de Costa Rica; descargas iguales a la
  pantalla y sin identificadores.
- RLS activo en las 12 tablas de dinero; CHECK tipo↔categoría vigentes; sin secretos en el árbol auditado.

## 7. SQL de SOLO LECTURA para producción (las corre el leader)

Todas son `SELECT`; ninguna toca filas. El día CR se calcula con la convención del repo (`fecha_movimiento − 6 h`).
Q0 y Q9 son las consultas C1 y C2 de `specs/459-la-caja-muestra-el-dinero-real/design.md` §11 (identidad R7,
invariante R8 y contrapartidas cierre a cierre): se esperan `dif_r7 = dif_r8 = 0,00` y 0 filas.

```sql
-- Q1 (D1) — alcance del cobro de un costo desde la reclasificación: cobros nuevos, suma y por tienda.
-- Es exactamente lo que la ganancia de Ordenex NO reconoce y lo que separa «De las tiendas» de la suma de saldos.
SELECT u.nombre AS tienda, COUNT(*) AS cobros, SUM(m.monto) AS total,
       MIN((m.fecha_movimiento - interval '6 hours')::date) AS desde,
       MAX((m.fecha_movimiento - interval '6 hours')::date) AS hasta
FROM wallet_tienda_movimiento m
JOIN usuario u ON u.id = m.tienda_id
WHERE m.categoria::text = 'cobro_manual'
  AND NOT EXISTS (SELECT 1 FROM wallet_movimiento w
                  WHERE w.origen_tipo::text = 'cobro_manual_reclasificado' AND w.origen_id = m.id)
GROUP BY u.nombre ORDER BY total DESC;

-- Q2 (D2) — posibles dobles envíos: dos filas manuales iguales (misma cuenta/categoría, monto y descripción)
-- con menos de 2 minutos de diferencia. Se espera 0 filas.
SELECT 'tienda' AS libro, a.tienda_id AS cuenta, a.categoria::text, a.monto, a.descripcion, a.created_at, b.created_at AS created_at_2
FROM wallet_tienda_movimiento a
JOIN wallet_tienda_movimiento b
  ON b.id <> a.id AND b.tienda_id = a.tienda_id AND b.categoria = a.categoria AND b.monto = a.monto
 AND COALESCE(b.descripcion, '') = COALESCE(a.descripcion, '')
 AND b.created_at > a.created_at AND b.created_at <= a.created_at + interval '2 minutes'
WHERE a.origen_id IS NULL
UNION ALL
SELECT 'caja', NULL, a.categoria::text, a.monto, a.descripcion, a.created_at, b.created_at
FROM wallet_movimiento a
JOIN wallet_movimiento b
  ON b.id <> a.id AND b.categoria = a.categoria AND b.monto = a.monto
 AND COALESCE(b.descripcion, '') = COALESCE(a.descripcion, '')
 AND b.created_at > a.created_at AND b.created_at <= a.created_at + interval '2 minutes'
WHERE a.origen_id IS NULL
ORDER BY 6;

-- Q3 (T2) — asientos de CAJA fechados a medianoche UTC exacta, por categoría, y cuántos caen para el rollup
-- diario en un día CR distinto al del documento (siempre el anterior). Es el tamaño del backfill de +6 h.
SELECT categoria::text, COUNT(*) AS filas, SUM(monto) AS total,
       COUNT(*) FILTER (WHERE (fecha_movimiento - interval '6 hours')::date <> fecha_movimiento::date) AS en_dia_anterior
FROM wallet_movimiento
WHERE fecha_movimiento = date_trunc('day', fecha_movimiento)
GROUP BY 1 ORDER BY 2 DESC;

-- Q3-bis — el mismo cruce contra el documento del pago a tienda: fecha_pago vs día CR del asiento de caja.
SELECT COUNT(*) AS pagos_tienda,
       COUNT(*) FILTER (WHERE (w.fecha_movimiento - interval '6 hours')::date <> l.fecha_pago) AS caen_otro_dia
FROM liquidacion_pago l
JOIN wallet_movimiento w ON w.origen_tipo::text = 'pago_tienda' AND w.origen_id = l.id
WHERE l.tienda_id IS NOT NULL;

-- Q4 (T1) — filas del libro en la franja 00:00–06:00 UTC (18:00–24:00 CR del día anterior): las que un filtro
-- por día pone en el día equivocado. Informativo.
SELECT COUNT(*) AS filas, SUM(CASE WHEN tipo::text = 'ingreso' THEN monto ELSE -monto END) AS neto
FROM wallet_movimiento
WHERE date_part('hour', fecha_movimiento) < 6 AND fecha_movimiento <> date_trunc('day', fecha_movimiento);
```

```sql
-- Q5 (D3) — filas de dinero sin vía de corrección en la app, por camino (para dimensionar la 458/461).
SELECT 'cobro_manual' AS camino, COUNT(*) AS filas, SUM(monto) AS total
FROM wallet_tienda_movimiento WHERE categoria::text = 'cobro_manual'
UNION ALL
SELECT 'ajuste_caja', COUNT(*), SUM(monto)
FROM wallet_movimiento WHERE categoria::text IN ('ingreso_ajuste', 'egreso_ajuste') AND origen_tipo::text = 'manual'
UNION ALL
SELECT 'cobro_rechazo_aprobado', COUNT(*), SUM(monto_flete + monto_iva)
FROM rechazo_tienda_cobro WHERE estado::text = 'aprobado'
UNION ALL
SELECT 'indemnizacion', COUNT(*), SUM(monto)
FROM wallet_movimiento WHERE categoria::text = 'egreso_indemnizacion';

-- Q6 (m4) — grupos del mismo instante en el libro de la tienda mayores que la página por defecto (20):
-- donde la paginación sin desempate puede repetir u omitir filas. Se espera 0 filas.
SELECT tienda_id, fecha_movimiento, COUNT(*)
FROM wallet_tienda_movimiento GROUP BY 1, 2 HAVING COUNT(*) > 20;

-- Q7 — documento ↔ asientos del pago por cuenta: 1 débito y 1 salida por documento; si está anulado, además
-- 1 crédito y 1 reverso. Se esperan 0 filas.
WITH d AS (
  SELECT p.id, (a.id IS NOT NULL)::int AS anulado,
         (SELECT COUNT(*) FROM wallet_tienda_movimiento t WHERE t.origen_id = p.id AND t.categoria::text = 'pago_por_cuenta') AS debitos,
         (SELECT COUNT(*) FROM wallet_movimiento w WHERE w.origen_id = p.id AND w.categoria::text = 'egreso_pago_por_cuenta_tienda') AS salidas,
         (SELECT COUNT(*) FROM wallet_tienda_movimiento t WHERE t.origen_id = p.id AND t.categoria::text = 'pago_por_cuenta_anulado') AS creditos,
         (SELECT COUNT(*) FROM wallet_movimiento w WHERE w.origen_id = p.id AND w.categoria::text = 'ingreso_reverso_pago_por_cuenta_tienda') AS reversos
  FROM pago_por_cuenta_tienda p LEFT JOIN pago_por_cuenta_tienda_anulacion a ON a.pago_id = p.id
)
SELECT * FROM d WHERE debitos <> 1 OR salidas <> 1 OR creditos <> anulado OR reversos <> anulado;

-- Q8 — documento ↔ asientos del pago a tienda (173): egreso de caja y débito por pago; si está anulado, reverso
-- y crédito. Se esperan 0 filas.
WITH d AS (
  SELECT l.id, (an.id IS NOT NULL)::int AS anulado,
         (SELECT COUNT(*) FROM wallet_movimiento w WHERE w.origen_tipo::text = 'pago_tienda' AND w.origen_id = l.id AND w.categoria::text = 'egreso_pago_tienda') AS egresos,
         (SELECT COUNT(*) FROM wallet_movimiento w WHERE w.origen_tipo::text = 'pago_tienda' AND w.origen_id = l.id AND w.categoria::text = 'ingreso_reverso_pago_tienda') AS reversos,
         (SELECT COUNT(*) FROM wallet_tienda_movimiento t WHERE t.origen_tipo::text = 'pago_tienda' AND t.origen_id = l.id AND t.categoria::text = 'pago_tienda') AS debitos,
         (SELECT COUNT(*) FROM wallet_tienda_movimiento t WHERE t.origen_tipo::text = 'pago_tienda' AND t.origen_id = l.id AND t.categoria::text = 'ajuste_credito') AS creditos
  FROM liquidacion_pago l LEFT JOIN liquidacion_anulacion an ON an.pago_id = l.id
  WHERE l.tienda_id IS NOT NULL
)
SELECT * FROM d WHERE egresos <> 1 OR debitos <> 1 OR reversos <> anulado OR creditos <> anulado;

-- Q10 — mensajeros: cuentas por pagar negativas (no debería haber ninguna).
SELECT mensajero_id, SUM(CASE WHEN tipo::text = 'devengo' THEN monto ELSE -monto END) AS cxp
FROM pago_mensajero_movimiento
GROUP BY 1 HAVING SUM(CASE WHEN tipo::text = 'devengo' THEN monto ELSE -monto END) < 0;
```

## 8. Alcance, límites y limpieza

- **No ejercido por interfaz** (sí por la fotografía `caja-caracterizacion-459` y sus tests reales, verdes en el
  gate): aprobación de un cierre, gasto fijo (el clon no tiene plantillas), cobro por rechazo, premio del ranking (sin
  podio congelado), indemnización por incidente, backfill 173 y la migración de reclasificación (0 filas presentes en
  el clon). Sus escritores se leyeron línea a línea y sus índices de idempotencia se comprobaron en la base.
- **Comprobantes**: no se subió ninguno (el bucket privado no existe en local; el servicio responde
  `comprobante_no_guardado`, falla ruidoso, R56). El test de lectura de comprobante ajeno se hizo sin archivo.
- **Producción**: no se consultó (sin MCP en esta sesión). Las consultas de §7 son las que confirman cada riesgo.
- **Evidencia**: salidas de Playwright y de las consultas en el scratchpad de la sesión (`recorrido/*.png`, `p2*.out`,
  `audit_out.txt`, `pase1.out`); los literales de este informe salen de ahí. El test temporal
  `tests/integration/db/zz-auditoria-wallet-temporal.test.ts` se borró del árbol y no se commitea; su limpieza deshizo
  todas sus filas (el clon volvió a `dif_r8 = 0,00` tras corregir un fallo de limpieza propio del fixture, que no
  borraba `liquidacion_anulacion`).
- **Limpieza**: dev server matado, `.next/dev` borrado, clon `ordenex_audit` eliminado al terminar. El `.env` del
  worktree es una copia local con `AUTH_RISK_THRESHOLD=999` y `AUTH_OTP_DEBUG_LOG=1`; no se versiona.
- Las credenciales QA y del maestro se rotaron **solo en el clon** (`DATABASE_URL` del worktree apuntaba a
  `ordenex_audit`); la base local compartida no se tocó.

## 9. Resumen para el leader

| Gravedad | Id | Qué | Dónde arreglarlo |
| --- | --- | --- | --- |
| Dinero | D1 | Cobrar un costo no toca caja ni ganancia (conocido) | Ficha 461 |
| Dinero | D2 | Sin clave de idempotencia en cobro, ajuste de caja y sueldo/gasto variable (doble envío = doble fila) | 458 R48 o clave UNIQUE en esos tres |
| Datos | D3 | Cobro de un costo, ajuste de caja y cobro por rechazo aprobado sin vía de corrección en la app | 458 R58/R63 (+ decidir cobro por rechazo) |
| Datos | T1 | Filtro por periodo de los libros en medianoche UTC y `hasta` inclusivo del instante: un día filtrado sale vacío | Borde de los 3 schemas: `inicioDelDiaCREnUtc` / cota exclusiva |
| Datos | T2 | Pagos a tienda/mensajero fechados 00:00Z en la caja: la analítica los cuenta el día anterior al que enseña el libro | `LiquidacionService` (fecha de los asientos de caja) + backfill +6 h |
| Pantalla | P1 | Tablas de saldos y CxP no se refrescan tras pagar/anular desde el desglose | `mutate` de la lista en `onRegistrado`/`onAnulado` |
| Pantalla | P2 | uuid del cierre visible y filtro que pide pegarlo (`/wallet/mensajeros`) | 458 (H6) |
| Pantalla | P3–P7 | «Reversar» sobre reversado; pista de cargos; nombre de tienda; sin anular pago a mensajero desde wallet; textos | 458 / ajustes de una línea |

