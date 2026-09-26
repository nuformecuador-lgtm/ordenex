# Revisión adversarial — 458-D «Estados de cuenta y Mi wallet»

**Revisor:** reviewer · 2026-09-26 · HEAD revisado `efbfcf54` (detached de `origin/feature/458-D`),
merge-base = `origin/dev` `e0234bf9` (rama al día). Ningún archivo de código cambia después de `25ee4d6d`
(los commits posteriores solo traen logs), así que el gate de la bitácora corresponde a este árbol.

**Búsqueda — lo digo explícitamente:** no usé el MCP `codebase-memory`. La bitácora ya midió tres veces
que el índice no contiene las piezas de la 458, así que leí los archivos del árbol y usé `grep`.

## Veredicto: **RECHAZADA**

Hay un bloqueante: al retirar `DesglosePagosMensajero`, el filtro por cierre del mensajero dejó de
mostrar los pagos registrados contra ese cierre. La 172 R52 lo exige, y su test sigue en verde porque
mide un camino que ya no tiene pantalla. Todo lo demás que pidió el leader está bien o solo tiene
hallazgos menores: cuadre, alcance de la tienda, R19, descarga, rutas, satélite y ayuda.

## Checklist

| # | Punto | Estado |
| --- | --- | --- |
| 1 | Tasks TD.1–TD.10 marcadas `[x]` con evidencia | OK |
| 2 | Trazabilidad R17–R36, R6–R8, R10–R12, R19, R70, R72, R78, R81, R102–R104 → tests reales | OK para la 458. **FALLA la 172 R52** (B1) |
| 3 | Tests retirados, cada uno con un sustituto que mida lo mismo | FALLA el filtro por cierre del mensajero (B1). R53 queda débil (m2) |
| 4 | Las 9 citas R→test repuntadas en 171/172/381/457 | 171 R41, 172 R4/R33/R34/R50, 381 R31/R34 y 457 R59: OK. 172 R53: débil (m2) |
| 5 | Saldo corrido = tarjeta = `derivarSaldoTienda` = resumen, con y sin filtro, con anulados y con saldo inicial | OK en el servidor: R22 y el cuadre del resumen se afirman antes de responder (`EstadoCuentaService.ts:217-237`); lo prueban `estado-cuenta-servidor-458d` y `mi-wallet-resumen-458d` contra Postgres. En pantalla puede desfasarse (m1) |
| 6 | Filtro por cierre con la cuenta en el `WHERE`; un cierre ajeno da 0 | OK: `cierreSql` se aplica sobre el CTE `libro`, ya acotado por `tienda_id`/`mensajero_id` (`EstadoCuentaRepository.ts:100-103, 151-178, 226`). Probado con un cierre compartido por dos tiendas y uno ajeno |
| 7 | Alcance de la tienda en /mi-wallet (solo lo suyo; lo ajeno = inexistente; sin nombres del personal ni «Anular…») | OK: la cuenta sale de la sesión (`leerMiTienda`, `:138-142`), el schema es `.strict()` y no tiene clave de cuenta, `paraLaTienda` (`:559-566`) vacía el registro y `anulacion.por` y pone `anulable=false`, y el origen se resuelve con el actor (sin mensajero ni enlace al cierre) |
| 8 | R19: sin órdenes de otra tienda; texto de «ninguna aporta» | OK: `verDetalleDeFilaDeCuenta` lee el movimiento con la cuenta en el WHERE y pasa `tiendaId` a las órdenes y al conteo; `/mi-wallet` usa la 344 acotada al actor. El texto nuevo es correcto y se prueba como literal de contrato (M11/M12) |
| 9 | Descarga: tope en el servidor, `limite_excedido`, ningún id | OK: `comoCompleto` (`:162-167`) sobre una ventana de `tope+1`; `limite_excedido` sin filas; columnas sin id; `/mi-wallet` sin «Registró» |
| 10 | Rutas nuevas → `notFound` por rol y por cuenta | OK en las tres páginas (rol antes de leer; cualquier estado distinto de `ok` → `notFound`) + los tests `*-estado-page` + recorrido (404 para adminTienda, mensajero y adminSatelite) |
| 11 | Satélite: Declarado/Recibido y la conciliación de la 431 sin cambio de comportamiento | OK: `ConciliacionSatelite` es un renombre con los mismos textos y acciones. «Pendiente de llegar» ahora es `saldoActual` (la misma fórmula Σefectivo−Σrecibido sin rechazadas que `saldoSinConciliar`, y `desmarcar` anula las dos columnas a la vez). Los 34 de la 431 están verdes |
| 12 | Ayuda | OK con una frase que promete de más (m4) |
| 13 | typecheck | OK (`TC_EXIT=0`, corrido por mí) |
| 14 | lint | OK (0 errores, 218 avisos previos) |
| 15 | Tests sin base | OK: 2055 archivos verdes y 262 saltados (los de `integration/db`, no hay base), 29845 tests verdes, `VITEST_EXIT=0` |
| 16 | `pnpm run build` | OK (`BUILD_EXIT=0`; migraciones omitidas en local); las tres rutas nuevas están en el manifiesto |
| 17 | Gate completo con base | Me apoyo en `progress/gate_458D_final.log`: `INIT_EXIT=0`, 2317 archivos, 32233 verdes, 26 saltados (Analítica, ajenos) y 0 saltados en `integration/db` |
| 18 | RLS / migraciones / secretos / webhooks | No aplica: sin migraciones ni tablas nuevas, y no hay secretos en el diff |
| 19 | Capas | OK: el repositorio solo hace consultas, el servicio no conoce HTTP y el composition root inyecta las tres dependencias obligatorias |

## Hallazgos

### B1 — BLOQUEANTE · El filtro por cierre del mensajero ya no incluye los pagos de ese cierre (172 R52)

- **Dónde:** `lib/repositories/EstadoCuentaRepository.ts:100-103` (la condición
  `l.origen_tipo = cierre_dia AND l.origen_id = <cierre>`), aplicada a los dos libros en `paginar`
  (`:226`).
- **Requisito:** 172 R52: «MIENTRAS el desglose de un mensajero esté filtrado por un cierre, el sistema
  DEBE incluir en él los pagos registrados contra ese cierre y sus anulaciones». El desglose retirado lo
  cumplía con `PagoMensajeroMovimientoRepository.buildFiltrosWhere` (`:106-122`), que hace un `OR` entre
  `cierre_dia = X` y `pago_mensajero IN (liquidacion_pago WHERE cierre_id = X)`. Todo pago a un
  mensajero va atado a un cierre (`LiquidacionService.ts:342`, «R21: el pago al mensajero va SIEMPRE
  atado a un cierre»), y el reparto de la 205 crea un `liquidacion_pago` por cierre imputado.
- **Escenario:** Marco tiene un cierre con 4.500 devengados y 2.000 en efectivo, y un pago de 1.000
  registrado contra ese cierre. En `/wallet/mensajeros/<Marco>`, al elegir ese cierre en el selector,
  aparecen solo las dos filas del cierre. El pago y su anulación desaparecen, y la oficina ve el cierre
  «sin pagar». El recorrido lo confirma sin señalarlo: «filtra a 2 filas»
  (`progress/recorrido_458-D/recorrido.md:99`).
- **Por qué nada lo cazó:** la cita de R52 (`specs/172-liquidacion/tasks.md:766`) sigue apuntando a
  `tests/unit/repositories/pago-mensajero-filtro-cierre.test.ts`, que mide el repositorio del desglose.
  La superficie de ese repositorio (`listarPagosDeMensajero{,Completo}Action`) queda
  `@sin-superficie`. El sustituto declarado en la bitácora para «DesglosePagosMensajero — filtros
  server-side fecha/cierre» era «pendiente de servidor», y el servidor lo implementó con otra semántica.
  El escenario de Postgres (`tests/integration/db/_fixtures/wallet-458.ts:248-258`) siembra
  `pagoM1`/`pagoM2` **sin** su `liquidacion_pago` con `cierre_id`, así que el caso «R12 … en el
  mensajero, su cierre trae sus dos filas» (`estado-cuenta-servidor-458d.test.ts:291-296`) deja la
  regresión en verde.
- **Qué falta:**
  1. En el libro del mensajero, que el filtro de cierre añada la rama
     `OR (l.origen_tipo = pago_mensajero AND l.origen_id IN (SELECT id FROM liquidacion_pago WHERE cierre_id = <cierre>))`,
     siempre dentro del CTE ya acotado por `mensajero_id`. En la tienda no hace falta.
  2. Un test contra Postgres con un `liquidacion_pago` real (`mensajero_id`, `cierre_id`), su fila
     `liquidacion`, su anulación (`ajuste_devengo`) y un pago de OTRO cierre que no debe aparecer. Matar
     la mutación «sin la rama del pago».
  3. Repuntar la cita de R52 en `specs/172-liquidacion/tasks.md:766` a ese test.
  4. Decidir si el selector (`FiltrosWalletRepository.cierresDeMensajero`) cuenta también esas filas en
     «N movimientos» (R11), y alinear la frase de la ayuda (`docs/ayuda/oficina/wallet-mensajeros.md:53`).

### m1 — menor · El resumen de tres cifras de /mi-wallet no se refresca con la tarjeta

`app/(app)/mi-wallet/_components/MiEstadoCuenta.tsx:106` pinta `inicial.resumen`, la lectura del
servidor al cargar la página. En cambio, la tarjeta «Saldo actual» usa `vigente` (la última lectura de
SWR), y cada lectura de la tienda ya trae `resumen`.
**Escenario:** la tienda tiene la pantalla abierta, la oficina aprueba un cierre y la tienda cambia de
chip o de periodo. La tarjeta y el corrido pasan al saldo nuevo, pero «Saldo a favor» del resumen se
queda en el viejo. Las dos cifras que la ayuda dice que «son el mismo número» (`mi-wallet.md` §El
resumen) quedan distintas hasta recargar. El servidor cuadra siempre; esto es solo de pantalla.
**Arreglo:** pintar `vigente.resumen`, subiendo el resumen al módulo o exponiendo `vigente`.

### m2 — menor · 172 R53 repuntado a un test que no puede fallar por R53

`specs/172-liquidacion/tasks.md:767` pasa a apuntar a `WalletRefrescoDirigido.test.tsx`, que comprueba
que la tarjeta pinta el saldo que devuelve un doble. R53 pide que «pagado» refleje el pago y que el
saldo baje en ese mismo monto. Con dobles, una mutación que no bajara el saldo seguiría verde: el
sustituto mide contra su propia fuente. La parte de «pagado» sí la mide contra Postgres
`mi-wallet-resumen-458d` en la vista de la tienda. Conviene citar ese test y un test de servicio o de
Postgres de la bajada del saldo, o declarar R53 parcialmente obsoleto en la oficina (el estado de
cuenta es neto, D3).

### m3 — menor · Decisión técnica sobre R25 en /mi-wallet sin ratificar

`lib/services/EstadoCuentaService.ts:563` quita `anulacion.por` en la vista de la tienda. R25, que R34
aplica a /mi-wallet, dice «con el motivo, **quién lo anuló** y cuándo». La decisión se apoya en 335/D2 y
está anotada en la bitácora («si el humano quiere…»), pero no consta que el humano la aprobara. No
cambia dinero. Hay que registrarla como decisión en el spec o preguntarla.

### m4 — menor · La ayuda de la tienda promete de más

`docs/ayuda/tienda/mi-wallet.md:103`: «Cada línea dice de qué orden y de qué cierre viene». Las filas
de cierre no nombran ninguna orden (se ven al desplegarlas), y los pagos, cobros y correcciones no
vienen de una orden. Mejor: «de dónde viene (el cierre, el pago, la guía…); las órdenes de un cierre se
ven desplegando su fila».

### m5 — menor · El resumen de tres cifras no se vio en el navegador

El recorrido de la tienda (`cierre-tienda.json`) es anterior a `bb861eda`, el commit que devuelve el
resumen. Del resumen solo hay tests, sin captura ni lectura de la app, y ya ha pasado que la suite
verde no ve textos rotos en pantalla. Conviene hacer una pasada con adminTienda antes de la release.

### m6 — menor · Comentarios rancios

Siguen nombrando piezas retiradas como si vivieran: `lib/actions/novedades.ts:29`
(`listarMisMovimientosAction`), `lib/actions/wallet-filtros.ts:54` (`MiWalletFiltros`),
`app/(app)/novedades/_components/NovedadesModule.tsx:84` (`MiWalletModule`) y
`app/(app)/mi-wallet/_components/mi-wallet-cierres.ts:47` (`DesgloseTiendaLedger`). No afecta a nada.

### m7 — menor · El tipo `Ventana` del servicio no declara `cierreId`

`lib/services/EstadoCuentaService.ts:515-523`: el objeto que se pasa lleva `cierreId` y llega al
repositorio, pero el tipo local no lo nombra, así que el compilador no protege la propagación. Hoy lo
cubren las mutaciones M-D1/M-D2. Hay que añadir `cierreId?: string` a `Ventana`.

## Lo que comprobé y está bien (resumen)

- **Cuadre en el servidor.** R22 (corrido de la última fila = tarjeta = `derivarSaldoTienda` =
  listado) y el cuadre `resumen.saldo === saldoActual` se afirman antes de responder, dentro de una
  lectura REPEATABLE READ. El resumen es de la cuenta entera y el chip y el cierre filtran filas sin
  tocar el corrido (R21). Todo probado contra Postgres, con anulados (c5/c6) y saldo inicial.
- **Tienda en /mi-wallet.** Sin `cuenta`/`tiendaId` en la entrada (`.strict()` → `validation_error`), el
  rol se mira antes de leer, un cierre ajeno da 0 filas, el comprobante sale por `verComprobanteAction`
  acotado, y no hay «Ver», «Anular…» ni «Registró», ni en pantalla ni en la descarga.
- **Retiros.** `verMiSaldoAction` y `listarMisMovimientos*` solo tenían callers en tests, y sus redes se
  movieron a las actions nuevas en los mismos archivos. Los literales de R55/N1 y del texto vacío de R19
  se afirman como contrato, no contra su propia constante.
- **Mutaciones.** Las cuatro tandas registran 15, 12, 17 y 12 mutaciones, todas muertas, con total y
  rojos por mutación. No las volví a correr: no hay base.
