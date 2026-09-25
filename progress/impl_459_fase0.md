# Ficha 459 — Fase 0: caracterizacion de lo que NO puede cambiar (T0.1–T0.3)

- Base: rama `feature/459-backend` desde `6280fdbb` (dev). Base de datos: CLON local `ordenex_459`
  (`CREATE DATABASE ordenex_459 TEMPLATE ordenex`); `prisma migrate status`: host `localhost:5432`,
  base `ordenex_459`, 212 migraciones, al dia.
- Busqueda: MCP `codebase-memory` (`R-job-singularis-projects-ordenex`) para localizar servicios; el
  indice esta RANCIO por defecto (no devolvio `CobroTiendaService`, `RechazoTiendaCobroService` ni
  `GastoFijoCobroService`, que si existen): todo simbolo se confirmo en el archivo real.
- Nombre del informe: el encargo del leader lo pide en `progress/impl_459_fase0.md`; `tasks.md` T0.3
  dice `progress/fase0_459.md`. Es este archivo.

## T0.1 — el escenario (`tests/integration/db/_fixtures/caja-459.ts`)

Sembrado por los SERVICIOS REALES, cableados como su `buildService()`, sobre la transaccion del test
con savepoints reales (`clienteConSavepoint`). A mano solo lo que ningun servicio de dinero escribe
(personas, tarifas, ordenes, gestiones sueltas, plantilla + cobro pendiente de gasto fijo, podio
congelado). Caminos: cierre (solicitar + aprobar, dos tiendas, comision con centimos, prepagada,
rechazada de calle con su confirmacion fisica, incidente con indemnizacion), cobro por rechazo 337,
pago a tienda + anulacion, pago a otra tienda, reparto a mensajero + anulacion de su pago + pago
contra el cierre, cobro de un costo, sueldo + reverso, gasto variable, ajuste +/−, gasto fijo
aprobado, premio del ranking + anulacion. 18 pasos, todos `ok`.

Aislamiento: transaccion SIEMPRE revertida, en REPEATABLE READ (la base local es compartida y hay
tests que commitean filas de caja; con READ COMMITTED el «antes» y el «despues» del libro entero
podrian ver conjuntos distintos). La caja se afirma por DIFERENCIA (despues − antes): todas las
cifras afirmadas son sumas por cubeta.

*Hecho:* «dos siembras en la misma transaccion escriben dos conjuntos IGUALES e independientes»
(22 filas de caja, 9 + 9 de tiendas, 7 del mensajero, identicas en las dos) — verde.

## T0.2 — la fotografia (`tests/integration/db/caja-caracterizacion-459.test.ts`)

14 casos, todos LITERALES con la cuenta hecha a mano en comentario (ninguno se calcula con la
funcion probada): saldo y desglose de las dos tiendas (R92); ganancia, ingresos/egresos propios,
composicion concepto por concepto, desglose de egresos y «Salio» (R93); cuenta por pagar del
mensajero en listado y libro (R94); filas de cada libro camino por camino (R95/R96); bloque con
nombre propio «lo que esta ficha cambia a proposito (cifras de HOY)»: `entradas` 100487.93,
`enCaja` −61357.84, `deTerceros` 28517.00.

Verde contra `6280fdbb`: `pnpm exec vitest run tests/integration/db/caja-caracterizacion-459.test.ts`
→ `Tests 14 passed (14)`, 0 skipped.

Diseño anti-«skipped»: si la siembra lanza, el `beforeAll` NO lanza (vitest marcaria los 13 casos
como SKIPPED); guarda el error y cada caso lo relanza, asi que una mutacion que rompe un camino pone
los 14 casos en ROJO con su nombre (se ve en M05, M07, M08, M12). La primera corrida del arnes, sin
esto, dio «1/14» con 13 SKIPPED en esas cuatro: se corrigio y se repitieron las 15.

Comprobacion cruzada con la formula NUEVA (para T A.3; calculada a mano, NO afirmada aun): cargos a
tiendas del escenario = 8000 + 1040 + 978.47 + 127.21 + 2500 + 325 = 12970.68; «De las tiendas» nueva
= 28517.00 − 12970.68 = 15546.32 = Σ saldos (7530.70 + 5515.12) + cobros sin reclasificar (2500.50).
R8 se cumpliria al centimo en este escenario.

## T0.3 — mutaciones, con autocomprobacion

Arnes (script de un solo uso, fuera del repo): (1) el texto a mutar aparece EXACTAMENTE una vez o
aborta; (2) tras escribir, `git diff --numstat` debe mostrar el archivo o aborta; (3) corre SOLO la
fotografia con reporter json y exige `numTotalTests > 0`; (4) `git checkout -- <archivo>` y exige
`git diff --stat` VACIO o aborta. Arranca exigiendo el arbol versionado limpio. Una mutacion cada
vez; ningun gate en paralelo.

Comando por mutacion (el mismo para las 15):
`node node_modules/vitest/vitest.mjs run tests/integration/db/caja-caracterizacion-459.test.ts --reporter=json --outputFile=mut-<id>.json`

| # | Mutacion | Archivo | Diff (una linea) | Tests ejecutados | Rojos | Veredicto |
| --- | --- | --- | --- | --- | --- | --- |
| M01 | cubeta de `cobro_manual` a `aFavor` | `lib/utils/desglose-tienda.ts` | `- cobro_manual: "cargos", ⟶ + cobro_manual: "aFavor",` | 14 | 1 | ROJO (muerta) |
| M02 | signo del debito en `derivarSaldoTienda` | `lib/utils/saldo-tienda.ts` | `- const saldo = cred.sub(deb); ⟶ + const saldo = cred.add(deb);` | 14 | 2 | ROJO (muerta) |
| M03 | `egreso_sueldo` a `terceros` | `lib/utils/caja-tesoreria.ts` | `- egreso_sueldo: "propio", ⟶ + egreso_sueldo: "terceros",` | 14 | 3 | ROJO (muerta) |
| M04 | `ingreso_flete` a `terceros` | `lib/utils/caja-tesoreria.ts` | `- ingreso_flete: "propio", ⟶ + ingreso_flete: "terceros",` | 14 | 3 | ROJO (muerta) |
| M05 | el `min(P,E)` del pago al mensajero pasa a `P` | `lib/utils/cuenta-por-pagar.ts` | `- const pagado = P.lte(E) ? P : E; ⟶ + const pagado = P;` | 14 | 14 | ROJO (muerta) |
| M06 | quitar `emitirEgresoDePago` del pago a tienda | `lib/services/LiquidacionService.ts` | `- await this.caja.emitirEgresoDePago(tx, { ⟶ + if (tx === null) await this.caja.emitirEgresoDePago(tx, {` | 14 | 4 | ROJO (muerta) |
| M07 | `ajuste_credito` -> `ajuste_debito` en `escribirContraasiento` | `lib/services/LiquidacionService.ts` | `- categoria: "ajuste_credito", ⟶ + categoria: "ajuste_debito",` | 14 | 14 | ROJO (muerta) |
| M08 | omitir el egreso del gasto fijo aprobado | `lib/services/GastoFijoCobroService.ts` | `- const insertadas = await this.movimientoRepo.crearMovimientos(tx, [ ⟶ + const insertadas = await ((..._x: unknown[]) => Promise.resolve(1))(tx, [` | 14 | 14 | ROJO (muerta) |
| M09 | `movimientosDeTienda` del cobro por rechazo devuelve `[]` | `lib/services/RechazoTiendaCobroService.ts` | `- if (!this.config.TIENDA_DEBITA_FLETE_DEVOLUCION) return []; ⟶ + if (this.config.TIENDA_DEBITA_FLETE_DEVOLUCION) return [];` | 14 | 2 | ROJO (muerta) |
| M10 | omitir el reverso del premio en la caja | `lib/services/PremioRankingDevengoService.ts` | `- const enCaja = await this.caja.reversarEgresoPremio(tx, { ⟶ + const enCaja = 1 \|\| await this.caja.reversarEgresoPremio(tx, {` | 14 | 5 | ROJO (muerta) |
| M11 | quitar `tipo: "credito"` en `CajaCodFeedService` | `lib/services/CajaCodFeedService.ts` | `- tipo: "credito",` | 14 | 0 | VERDE (SUPERVIVIENTE) |
| M11b | quitar `origenId: cierreId` del WHERE de `CajaCodFeedService` (variante de la 11) | `lib/services/CajaCodFeedService.ts` | `- origenId: cierreId,` | 14 | 3 | ROJO (muerta) |
| M12 | quitar `cod_recaudado` del feed de la tienda | `lib/services/WalletTiendaFeedService.ts` | `- bump(tiendaId, "credito", "cod_recaudado", codRecaudado); ⟶ + void codRecaudado;` | 14 | 14 | ROJO (muerta) |
| M13 | saltar `ingreso_ajuste` en `derivarComposicionGanancia` | `lib/utils/caja-tesoreria.ts` | `- if (!esIngresoPropio(fila.categoria)) continue; ⟶ + if (!esIngresoPropio(fila.categoria) \|\| fila.categoria === "ingreso_ajuste") continue;` | 14 | 1 | ROJO (muerta) |
| M14 | categoria del cobro de un costo a `ajuste_debito` | `lib/services/CobroTiendaService.ts` | `- categoria: "cobro_manual", ⟶ + categoria: "ajuste_debito",` | 14 | 1 | ROJO (muerta) |

Casos rojos y causa (primer mensaje de fallo), por mutacion:

- **M01** (1/14):
  - causa: `AssertionError: expected { saldo: '5515.12', …(2) } to deeply equal { saldo: '5515.12', …(2) }`
  - «R92: saldo y desglose de la tienda B (el cobro de un costo es un cargo)»
- **M02** (2/14):
  - causa: `AssertionError: expected { saldo: '32269.30', …(2) } to deeply equal { saldo: '7530.70', …(2) }`
  - «R92: saldo y desglose de la tienda A»
  - «R92: saldo y desglose de la tienda B (el cobro de un costo es un cargo)»
- **M03** (3/14):
  - causa: `AssertionError: expected { ingresosPropios: '63970.93', …(2) } to deeply equal { ingresosPropios: '63970.93', …(2) }`
  - «R93: ganancia de Ordenex, ingresos y egresos propios»
  - «R93: composicion de la ganancia, concepto por concepto»
  - ««Entro», «Dinero en caja» y «De terceros» de hoy»
- **M04** (3/14):
  - causa: `AssertionError: expected { ingresosPropios: '55970.93', …(2) } to deeply equal { ingresosPropios: '63970.93', …(2) }`
  - «R93: ganancia de Ordenex, ingresos y egresos propios»
  - «R93: composicion de la ganancia, concepto por concepto»
  - ««Entro», «Dinero en caja» y «De terceros» de hoy»
- **M05** (14/14):
  - causa: `Error: escenario 459: el paso «repartoMensajero» respondio {"status":"sin_saldo"}`
  - «anti-vacuidad: los dieciocho pasos del escenario respondieron `ok`»
  - «R92: saldo y desglose de la tienda A»
  - «R92: saldo y desglose de la tienda B (el cobro de un costo es un cargo)»
  - «R93: ganancia de Ordenex, ingresos y egresos propios»
  - «R93: composicion de la ganancia, concepto por concepto»
  - «R93: desglose de egresos (gasto fijo, variable, sueldo, indemnizacion)»
  - «R93: «Salio» (todos los egresos de la caja) — no cambia con esta ficha»
  - «R94: cuenta por pagar del mensajero (listado y libro coinciden)»
  - «R95/R96: filas de la CAJA, camino por camino»
  - «R95/R96: filas del LIBRO DE LA TIENDA A»
  - «R95/R96: filas del LIBRO DE LA TIENDA B (con el cobro de un costo)»
  - «R94/R95/R96: filas del LIBRO DEL MENSAJERO»
  - ««Entro», «Dinero en caja» y «De terceros» de hoy»
  - «dos siembras en la misma transaccion escriben dos conjuntos IGUALES e independientes»
- **M06** (4/14):
  - causa: `AssertionError: expected '153845.77' to be '161845.77' // Object.is equality`
  - «R93: «Salio» (todos los egresos de la caja) — no cambia con esta ficha»
  - «R95/R96: filas de la CAJA, camino por camino»
  - ««Entro», «Dinero en caja» y «De terceros» de hoy»
  - «dos siembras en la misma transaccion escriben dos conjuntos IGUALES e independientes»
- **M07** (14/14):
  - causa: `DriverAdapterError: el nuevo registro para la relación «wallet_tienda_movimiento» viola la restricción «check» «wallet_tienda_movimiento_tipo_categoria_check»`
  - «anti-vacuidad: los dieciocho pasos del escenario respondieron `ok`»
  - «R92: saldo y desglose de la tienda A»
  - «R92: saldo y desglose de la tienda B (el cobro de un costo es un cargo)»
  - «R93: ganancia de Ordenex, ingresos y egresos propios»
  - «R93: composicion de la ganancia, concepto por concepto»
  - «R93: desglose de egresos (gasto fijo, variable, sueldo, indemnizacion)»
  - «R93: «Salio» (todos los egresos de la caja) — no cambia con esta ficha»
  - «R94: cuenta por pagar del mensajero (listado y libro coinciden)»
  - «R95/R96: filas de la CAJA, camino por camino»
  - «R95/R96: filas del LIBRO DE LA TIENDA A»
  - «R95/R96: filas del LIBRO DE LA TIENDA B (con el cobro de un costo)»
  - «R94/R95/R96: filas del LIBRO DEL MENSAJERO»
  - ««Entro», «Dinero en caja» y «De terceros» de hoy»
  - «dos siembras en la misma transaccion escriben dos conjuntos IGUALES e independientes»
- **M08** (14/14):
  - causa: `Error: gasto-fijo-cobro: el movimiento de la clave "b65e744d-2baa-4bff-afb4-d8afdd6d854d:2026-09" no se pudo releer tras aprobar`
  - «anti-vacuidad: los dieciocho pasos del escenario respondieron `ok`»
  - «R92: saldo y desglose de la tienda A»
  - «R92: saldo y desglose de la tienda B (el cobro de un costo es un cargo)»
  - «R93: ganancia de Ordenex, ingresos y egresos propios»
  - «R93: composicion de la ganancia, concepto por concepto»
  - «R93: desglose de egresos (gasto fijo, variable, sueldo, indemnizacion)»
  - «R93: «Salio» (todos los egresos de la caja) — no cambia con esta ficha»
  - «R94: cuenta por pagar del mensajero (listado y libro coinciden)»
  - «R95/R96: filas de la CAJA, camino por camino»
  - «R95/R96: filas del LIBRO DE LA TIENDA A»
  - «R95/R96: filas del LIBRO DE LA TIENDA B (con el cobro de un costo)»
  - «R94/R95/R96: filas del LIBRO DEL MENSAJERO»
  - ««Entro», «Dinero en caja» y «De terceros» de hoy»
  - «dos siembras en la misma transaccion escriben dos conjuntos IGUALES e independientes»
- **M09** (2/14):
  - causa: `AssertionError: expected { saldo: '8660.70', …(2) } to deeply equal { saldo: '7530.70', …(2) }`
  - «R92: saldo y desglose de la tienda A»
  - «R95/R96: filas del LIBRO DE LA TIENDA A»
- **M10** (5/14):
  - causa: `AssertionError: expected { ingresosPropios: '58970.93', …(2) } to deeply equal { ingresosPropios: '63970.93', …(2) }`
  - «R93: ganancia de Ordenex, ingresos y egresos propios»
  - «R93: composicion de la ganancia, concepto por concepto»
  - «R95/R96: filas de la CAJA, camino por camino»
  - ««Entro», «Dinero en caja» y «De terceros» de hoy»
  - «dos siembras en la misma transaccion escriben dos conjuntos IGUALES e independientes»
- **M11** (0/14):
  - ninguno
- **M11b** (3/14):
  - causa: `AssertionError: expected [ …(22) ] to deeply equal [ …(22) ]`
  - «R95/R96: filas de la CAJA, camino por camino»
  - ««Entro», «Dinero en caja» y «De terceros» de hoy»
  - «dos siembras en la misma transaccion escriben dos conjuntos IGUALES e independientes»
- **M12** (14/14):
  - causa: `Error: escenario 459: el paso «pagoTiendaA» respondio {"status":"sin_saldo"}`
  - «anti-vacuidad: los dieciocho pasos del escenario respondieron `ok`»
  - «R92: saldo y desglose de la tienda A»
  - «R92: saldo y desglose de la tienda B (el cobro de un costo es un cargo)»
  - «R93: ganancia de Ordenex, ingresos y egresos propios»
  - «R93: composicion de la ganancia, concepto por concepto»
  - «R93: desglose de egresos (gasto fijo, variable, sueldo, indemnizacion)»
  - «R93: «Salio» (todos los egresos de la caja) — no cambia con esta ficha»
  - «R94: cuenta por pagar del mensajero (listado y libro coinciden)»
  - «R95/R96: filas de la CAJA, camino por camino»
  - «R95/R96: filas del LIBRO DE LA TIENDA A»
  - «R95/R96: filas del LIBRO DE LA TIENDA B (con el cobro de un costo)»
  - «R94/R95/R96: filas del LIBRO DEL MENSAJERO»
  - ««Entro», «Dinero en caja» y «De terceros» de hoy»
  - «dos siembras en la misma transaccion escriben dos conjuntos IGUALES e independientes»
- **M13** (1/14):
  - causa: `AssertionError: expected { ingreso_flete: '8000.00', …(11) } to deeply equal { ingreso_flete: '8000.00', …(11) }`
  - «R93: composicion de la ganancia, concepto por concepto»
- **M14** (1/14):
  - causa: `AssertionError: expected [ …(9) ] to deeply equal [ …(9) ]`
  - «R95/R96: filas del LIBRO DE LA TIENDA B (con el cobro de un costo)»

**Superviviente explicada — M11 (mutante EQUIVALENTE).** El `WHERE` de `CajaCodFeedService` filtra
por `categoria = 'cod_recaudado'` Y por `tipo = 'credito'`; el CHECK
`wallet_tienda_movimiento_tipo_categoria_check` solo admite `cod_recaudado` con `tipo = 'credito'`
(M4 de `progress/medicion_457.md`), asi que quitar `tipo` no puede cambiar el conjunto leido: no hay
escenario que lo distinga. Se sustituye por la variante **M11b** (quitar `origenId: cierreId` del
mismo `WHERE`), que SI muere: la caja pasa a sumar el contra-entrega de TODOS los cierres.

`git diff --stat` al terminar las 15: vacio (el arnes imprime `git diff --stat final: «»`).

## Anexo T Z.1 — la fase 0 repetida con el ÁRBOL FINAL (2026-09-24, `feature/459-fix` @ `c6e6fa3d`)

Árbol final = backend + frontend + revisión + recorrido + las correcciones de la revisión (B1, F1, F2,
m1, m3). Base: el clon `ordenex_459` (`prisma migrate status`: `localhost:5432`, 216 migraciones, al
día). Mismo arnés (texto único, `git diff --numstat` no vacío, `numTotalTests > 0`, `git checkout` y
`git diff --stat` vacío tras cada una; arranca con el árbol limpio), las MISMAS 15 mutaciones y el
mismo comando (solo `tests/integration/db/caja-caracterizacion-459.test.ts`). Un solo cambio en el
arnés: el texto de M11b ahora incluye la línea siguiente (`origenId: cierreId,` + `categoria:
"cod_recaudado",`), porque desde el bloque B `origenId: cierreId,` aparece dos veces en
`CajaCodFeedService.ts` (el `WHERE` y la fila que se escribe) y el arnés abortaba por ambigüedad. Se
muta la MISMA línea del `WHERE` que en la fase 0.

**Fotografía sin mutar: verde** — `caja-caracterizacion-459` + `caja-invariante-tiendas`: `Tests 20
passed (20)`, 0 skipped. Sus literales no se tocaron (el único bloque cambiado sigue siendo el de T A.3).

| # | Tests ejecutados | Rojos | Veredicto | Igual que en la fase 0 |
| --- | --- | --- | --- | --- |
| M01 | 14 | 1 | ROJO | sí (1) |
| M02 | 14 | 2 | ROJO | sí (2) |
| M03 | 14 | 3 | ROJO | sí (3) |
| M04 | 14 | 3 | ROJO | sí (3) |
| M05 | 14 | 14 | ROJO | sí (14) |
| M06 | 14 | 4 | ROJO | sí (4) |
| M07 | 14 | 14 | ROJO | sí (14) |
| M08 | 14 | 14 | ROJO | sí (14) |
| M09 | 14 | 2 | ROJO | sí (2) |
| M10 | 14 | 5 | ROJO | sí (5) |
| M11 | 14 | 0 | VERDE — equivalente | sí (misma explicación: el CHECK solo admite `cod_recaudado` con `credito`) |
| M11b | 14 | 3 | ROJO | sí (3) |
| M12 | 14 | 14 | ROJO | sí (14) |
| M13 | 14 | 1 | ROJO | sí (1) |
| M14 | 14 | 1 | ROJO | sí (1) |

Los casos rojos son los mismos que en la tabla de arriba, con UN nombre que cambió por T A.3: el caso
«Entro», «Dinero en caja» y «De terceros» de hoy» se llama ahora «Entro», la cifra principal, «De las
tiendas», capital y «De Ordenex»» (es el bloque «a propósito»). Causas idénticas (M05 «repartoMensajero
respondio sin_saldo», M07 el CHECK de `wallet_tienda_movimiento`, M08 «no se pudo releer tras
aprobar», M12 «pagoTiendaA respondio sin_saldo», y las `AssertionError` de los literales).

`git diff --stat` al terminar: vacío (el arnés imprime `git diff --stat final: «»`).
