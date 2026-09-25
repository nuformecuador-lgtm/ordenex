# Ficha 459 — bitácora del FRONTEND (feature/459-frontend)

- Rama: `feature/459-frontend` desde `fa2624fb`. Base: el clon `ordenex_459` (`prisma migrate status`:
  `localhost:5432`, `ordenex_459`, «Database schema is up to date!»). `.env` copiado del worktree del
  backend sin imprimirlo.
- `node_modules` PROPIO del worktree (`pnpm install`, sin junction) y `pnpm exec prisma generate`.
- Búsqueda: MCP `codebase-memory` (`R-job-singularis-projects-ordenex`) primero; cada símbolo confirmado
  en el archivo real. Sin `feature_list.json`.

## Estado por tarea

| Tarea | Estado | Dónde |
| --- | --- | --- |
| T A.7 textos | HECHA | `app/(app)/wallet/_components/wallet-labels.ts` (§3.3/§3.4 literales; `rotuloCifraPrincipal`, `pistaCifraPrincipal`, `avisoCifraNegativa`, `CAJA_RESUMEN_TIENDAS_DEBEN`, `CAJA_RESUMEN_NOTA_DIFERENCIA(rótulo)`); guardia `tests/unit/guards/caja-textos-459.guardia.test.ts` con 3 contrapruebas |
| T A.8 tarjeta | HECHA | `CajaResumenCard.tsx` (rótulo por estado, pistas, líneas de negativo, región «Saldo inicial y aportes», «Las tiendas le deben…», barra y mensajes solo en «saldo»); `BarraComposicionCaja.tsx` (nombre accesible con «De Ordenex») |
| T A.9 KPIs | HECHA | `app/(app)/analitica/_components/finanzas/cargar-kpis.ts`: rótulo y pista de la cifra de caja desde la MISMA función que la tarjeta; comentario del bruto retirado; `@sin-superficie` intacto |
| T B.6 `ORIGEN_TIENDA_LABEL` | HECHA | `mi-wallet-labels.ts`: `pago_por_cuenta_tienda` y `gestion_orden` (ya escribía en ese libro y se leía crudo); test que recorre `WALLET_ORIGEN_TIPO_SEED` |
| T B.15 diálogo | HECHA | `wallet-conceptos-manuales.ts` (7 conceptos en 3 grupos, `FRASE_DEL_EFECTO`, clases `pago_por_cuenta_tienda`/`aporte_capital`, libro `caja_y_tienda`); `RegistrarMovimientoCajaDialog.tsx` (campos por concepto, `FormData` solo con sus claves, R62, R63, monto vacío sin ejemplo en el aporte, clase explicada con `RadioGroup`, comprobante opcional) |
| T B.16 `documento` | HECHA | `WalletMovimientoDTO.documento` (`lib/types/wallet.ts`); repositorio lo proyecta `null`; `WalletService.listarMovimientos` lo resuelve en lote (una consulta por tipo presente, solo originales: categoría Y origen); 4.º parámetro del constructor `LectoresDocumentosCaja` SIN valor por defecto, inyectado en `lib/actions/wallet.ts`; `DocumentoCajaAcciones.tsx` («Anular…», «Anulado», «Ver comprobante») montado desde `WalletLedger.tsx` |
| T B.17 tienda | HECHA | pistas de «A tu favor»/«Ya pagado» en `/mi-wallet` y `/wallet/tiendas`; origen legible en tabla y descargas |
| T C.6 reclasificadas | HECHA | rótulo en el libro y en la descarga; sin acciones (el servidor les da `documento: null`) |

Anotaciones `@sin-superficie` de las SEIS actions de `lib/actions/pago-por-cuenta-tienda.ts` y
`lib/actions/aporte-capital.ts` retiradas: ya son alcanzables desde `/wallet` y la guardia
`superficie-de-uso` exige quitarlas cuando caducan.

## Decisiones (el spec no lo fijaba)

1. **Con filtros, sin pista bajo la cifra.** design §3.1 dice «la de hoy» para la pista con filtros, pero la
   pista de hoy es justo la que §3.3 retira. Con filtros la cifra la explica `CAJA_RESUMEN_AVISO_PERIODO`
   (la nota que ya salía con filtros); ni la pista del flujo («desde el primer día») ni la del saldo
   describen un periodo recortado. Tampoco hay línea de negativo con filtros (R17/R19 dicen «sin filtros»).
2. **KPIs sin resumen (denegado/error):** rótulo «Flujo de dinero registrado». Sin resumen el estado no se
   conoce, y afirmar «Dinero en caja» sería lo que R16 prohíbe.
3. **Bolsillo de Ordenex en «flujo»: siempre neutro.** El color de peligro era del modo de la barra; sin
   barra (R22) no se tiñe por un modo que no se enseña.
4. **Acciones fuera de `WalletLedger.tsx`.** El libro es presentación y una guardia (WalletDescarga) exige
   que no importe Server Actions salvo la reversa de la 45. `DocumentoCajaAcciones.tsx` es un hermano
   (precedente: `PagoTiendaAcciones.tsx`) con dos mutaciones y la lectura del enlace firmado al pulsar.
5. **«Ver comprobante»** abre la pestaña ANTES del `await` (un `window.open` tras una promesa lo bloquea el
   navegador) y le pone la URL al volver; si no hay enlace la cierra y lo dice.
6. **Textos no fijados por el diseño** (van en `wallet-labels.ts` y en el diálogo, sin identificadores):
   descripción de la cabecera `caja_y_tienda`, títulos y respuestas del diálogo de anulación, textos de
   error del diálogo (tienda/beneficiario/método/referencia/clase, «ya hay un saldo inicial»,
   comprobante no guardado), rótulos «Tienda por la que se paga», «Método de pago», «Qué es»,
   «Motivo del pago», «Motivo», y las pistas nuevas de `/mi-wallet` y `/wallet/tiendas`.
7. **`gestion_orden` en `ORIGEN_TIENDA_LABEL`** con el MISMO texto que la caja («Gestión de orden»): el
   test que exige rótulo para todo origen que escribe en el libro de la tienda lo pedía, y se leía crudo.

## Tests existentes REESCRITOS (con el requisito que lo exige)

| Test | Por qué |
| --- | --- |
| `CajaResumenCard.test.tsx`: conjunto base a `estado: "saldo"`; los 3 casos de R34 de la 173 y el R61 (parte tarjeta) → R23/R24 | «Dinero en caja» solo existe con saldo inicial (R18); «De las tiendas» YA es la deuda y el aviso «es más» es falso (R24) |
| `CajaResumenCard.test.tsx` R60 («contra-entrega» → «también el que es de las tiendas») y R64 (capital `5.00`) | texto nuevo de la nota (§3.3); el capital se pinta y en ese caso no puede leerse «₡0» |
| `CajaComposicionBarra.test.tsx`: conjunto a `estado: "saldo"`; dos regex del aviso | la barra solo existe en «saldo» (R22); aviso nuevo (R23/R24) |
| `DineroIdentidadesEnPantalla.test.tsx` B1: «terceros + ganancia = en caja» → «terceros + ganancia + capital = cifra principal» con capital `1000.33` | design §3.2 / R7 en pantalla |
| `wallet-page.test.tsx`: barrido STRING con `estado` y `flujoDesde` (día o `null`) afirmados por su forma | design §2.6 |
| `kpis-financieros.test.ts`: fixture con los campos de §2.6 | T A.9 |
| `wallet-conceptos-manuales.test.ts` «exactamente CINCO» → SIETE, «los cuatro primeros» → orden relativo de los de la 334, `porLibro` con `caja_y_tienda`, `CONCEPTOS_MANUALES[2]` → por id | R59 (reordenado en grupos) |
| `wallet-registrar-movimiento-dialog.test.tsx`: lista de opciones (5 → 7, con grupos) y el conteo del caso 85/R25 | R59 |
| `mi-wallet-labels.test.ts`: `aFavorHint` y `pagadoHint` literales nuevos | T B.17 (las pistas nombran el pago por cuenta y su anulación) |
| `wallet-movimiento-repository.test.ts` y 17 fixtures de `WalletMovimientoDTO` en tests de pantalla/servicio: `documento: null` | T B.16 (campo nuevo del DTO; autorizado) |
| construcción de `WalletService` en 44 sitios (4.º argumento) — incluido `_fixtures/caja-459.ts` (solo la línea del constructor, ninguna aserción) | T B.16 |

## R → test (lo de este bloque)

| R | Test |
| --- | --- |
| R15–R20, R22, R23, R25, R26 | `tests/components/CajaResumenCard.test.tsx`, `tests/components/CajaComposicionBarra.test.tsx` |
| R7 en pantalla | `tests/components/DineroIdentidadesEnPantalla.test.tsx` (tres sumandos, capital con céntimos) |
| R16, R24, R27 | `tests/unit/guards/caja-textos-459.guardia.test.ts` (+ contrapruebas) |
| R28 | `tests/integration/wallet-page.test.tsx` (barrido STRING) + money-safe de la tarjeta |
| T A.9 | `tests/unit/analytics/kpis-financieros.test.ts` |
| R44 | `tests/integration/mi-wallet-page.test.tsx`, `tests/unit/components/mi-wallet-labels.test.ts` |
| R45, R77, R87 | `tests/components/WalletLedgerAcciones459.test.tsx` (tabla y descarga), `wallet-labels` |
| R59–R64, R27 | `tests/unit/components/wallet-conceptos-manuales.test.ts`, `tests/unit/components/wallet-registrar-movimiento-dialog.test.tsx` |
| R65–R67 | `tests/components/WalletLedgerAcciones459.test.tsx`, `tests/unit/services/wallet-service.test.ts` (qué filas y cuántas consultas), `tests/integration/db/libro-caja-documentos-459.test.ts` (por las actions, Postgres) |
| R100 | `WalletLedgerAcciones459.test.tsx` y `mi-wallet-page.test.tsx` (sin ids en pantalla ni descargas) |

## Mutaciones (arnés con autocomprobación: texto único, `git diff` no vacío, tests ejecutados > 0, árbol limpio al revertir)

Arnés: `mutar.py` (fuera del repo). La primera pasada anotó «0 ejecutados» porque leía la línea «Failed
Tests N ⎯⎯⎯»; se corrigió la expresión, se añadió `assert total > 0` y se repitió entera. Esta es la salida
de la segunda pasada, sin editar:

## M1 — tarjeta flujo/saldo: sin filtros el rotulo es siempre «Dinero en caja»
- archivo: `app/(app)/wallet/_components/wallet-labels.ts`; diff:  1 file changed, 1 insertion(+), 1 deletion(-)
- tests: tests/components/CajaResumenCard.test.tsx tests/unit/guards/caja-textos-459.guardia.test.ts tests/unit/analytics/kpis-financieros.test.ts
- ejecutados: 59; linea: 8 failed | 51 passed (59)
- veredicto: **ROJO**
  - tests/components/CajaResumenCard.test.tsx > Ficha 459 — estado «flujo»: sin saldo inicial (R15/R16/R17/R22) > R15: la cifra se llama «Flujo de dinero registrado», dice desde cuándo y que no es el banco
  - tests/components/CajaResumenCard.test.tsx > Ficha 459 — estado «flujo»: sin saldo inicial (R15/R16/R17/R22) > R16: tampoco con la cifra negativa, ni con «De las tiendas» negativo
  - tests/components/CajaResumenCard.test.tsx > Ficha 459 — estado «flujo»: sin saldo inicial (R15/R16/R17/R22) > R16: «Dinero en caja» no aparece en ningún texto ni nombre accesible de la tarjeta
  - tests/components/CajaResumenCard.test.tsx > Ficha 459 — estado «flujo»: sin saldo inicial (R15/R16/R17/R22) > R17: negativa y sin filtros, una línea explica que falta el dinero previo a la app
  - tests/components/CajaResumenCard.test.tsx > Ficha 459 — estado «flujo»: sin saldo inicial (R15/R16/R17/R22) > con el libro vacío (`flujoDesde` null) la pista dice que todavía no hay movimientos
  - tests/components/CajaResumenCard.test.tsx > Ficha 459 — la nota de la diferencia usa el rótulo vigente (design §3.3) > en «flujo» nombra «Flujo de dinero registrado»; en «saldo», «Dinero en caja»
- revertido: arbol limpio = True

## M2 — tarjeta: la barra se pinta tambien en «flujo»
- archivo: `app/(app)/wallet/_components/CajaResumenCard.tsx`; diff:  1 file changed, 1 insertion(+), 1 deletion(-)
- tests: tests/components/CajaResumenCard.test.tsx tests/unit/guards/caja-textos-459.guardia.test.ts
- ejecutados: 41; linea: 5 failed | 36 passed (41)
- veredicto: **ROJO**
  - tests/components/CajaResumenCard.test.tsx > Ficha 459 — con filtros, en los dos estados (R20) > R20 + R22: con filtros, la barra sigue la regla del estado
  - tests/components/CajaResumenCard.test.tsx > Ficha 459 — estado «flujo»: sin saldo inicial (R15/R16/R17/R22) > R16: tampoco con la cifra negativa, ni con «De las tiendas» negativo
  - tests/components/CajaResumenCard.test.tsx > Ficha 459 — estado «flujo»: sin saldo inicial (R15/R16/R17/R22) > R16: «Dinero en caja» no aparece en ningún texto ni nombre accesible de la tarjeta
  - tests/components/CajaResumenCard.test.tsx > Ficha 459 — estado «flujo»: sin saldo inicial (R15/R16/R17/R22) > R22: en «flujo» no se pinta la barra ni ninguno de sus mensajes
  - tests/unit/guards/caja-textos-459.guardia.test.ts > guardia 459 — R16: en «flujo» la tarjeta nunca dice «Dinero en caja» > en ninguna combinación de signo, modo y filtro
- revertido: arbol limpio = True

## M3 — tarjeta: la frase «Las tiendas le deben» pinta el importe CON signo
- archivo: `app/(app)/wallet/_components/CajaResumenCard.tsx`; diff:  1 file changed, 1 insertion(+), 1 deletion(-)
- tests: tests/components/CajaResumenCard.test.tsx
- ejecutados: 33; linea: 1 failed | 32 passed (33)
- veredicto: **ROJO**
  - tests/components/CajaResumenCard.test.tsx > CajaResumenCard — «De las tiendas» (R34 de la 173 → R23/R24 de la 459) > R23: si es negativo, dice en palabras que las tiendas le deben a Ordenex, y cuánto
- revertido: arbol limpio = True

## M4 — dialogo: la frase del pago por cuenta dice que NO sale dinero (la del cobro)
- archivo: `app/(app)/wallet/_components/wallet-conceptos-manuales.ts`; diff:  1 file changed, 1 insertion(+), 1 deletion(-)
- tests: tests/unit/components/wallet-conceptos-manuales.test.ts tests/unit/components/wallet-registrar-movimiento-dialog.test.tsx
- ejecutados: 75; linea: 3 failed | 72 passed (75)
- veredicto: **ROJO**
  - tests/unit/components/wallet-conceptos-manuales.test.ts > ⭑ FICHA 459 — la frase del efecto (R60) > cada concepto tiene su frase, con el texto literal del diseño
  - tests/unit/components/wallet-conceptos-manuales.test.ts > ⭑ FICHA 459 — la frase del efecto (R60) > el pago por cuenta dice que SALE dinero de la caja y el cobro de un costo dice que NO
  - tests/unit/components/wallet-registrar-movimiento-dialog.test.tsx > ⭑ FICHA 459 — la frase del efecto (R60) > sigue al concepto, y pago por cuenta y cobro de un costo dicen cosas opuestas de la caja
- revertido: arbol limpio = True

## M5 — dialogo: el pago por cuenta manda la referencia siempre (clave de mas con efectivo)
- archivo: `app/(app)/wallet/_components/RegistrarMovimientoCajaDialog.tsx`; diff:  1 file changed, 1 insertion(+), 1 deletion(-)
- tests: tests/unit/components/wallet-registrar-movimiento-dialog.test.tsx
- ejecutados: 52; linea: 1 failed | 51 passed (52)
- veredicto: **ROJO**
  - tests/unit/components/wallet-registrar-movimiento-dialog.test.tsx > ⭑ FICHA 459 — pago por cuenta de una tienda (R61/R62/R63) > R63: el aviso lleva el saldo del servidor con su signo y dice que la tienda le debe a Ordenex
- revertido: arbol limpio = True

## M6 — dialogo (R27): el monto del saldo inicial lleva un ejemplo de importe
- archivo: `app/(app)/wallet/_components/RegistrarMovimientoCajaDialog.tsx`; diff:  1 file changed, 1 insertion(+), 1 deletion(-)
- tests: tests/unit/components/wallet-registrar-movimiento-dialog.test.tsx
- ejecutados: 52; linea: 1 failed | 51 passed (52)
- veredicto: **ROJO**
  - tests/unit/components/wallet-registrar-movimiento-dialog.test.tsx > ⭑ FICHA 459 — saldo inicial o aporte de capital (R27/R68/R70) > R27: el monto arranca VACÍO, sin ejemplo, y sigue vacío al elegir la clase
- revertido: arbol limpio = True

## M7 — filas reclasificadas: el servicio no mira el ORIGEN (la salida reclasificada gana documento)
- archivo: `lib/services/WalletService.ts`; diff:  1 file changed, 1 insertion(+), 1 deletion(-)
- tests: tests/unit/services/wallet-service.test.ts
- ejecutados: 36; linea: 2 failed | 34 passed (36)
- veredicto: **ROJO**
  - tests/unit/services/wallet-service.test.ts > WalletService.listarMovimientos — el documento de las filas originales (R66/R67) > UNA consulta por tipo de documento presente, con solo los ids de los originales
  - tests/unit/services/wallet-service.test.ts > WalletService.listarMovimientos — el documento de las filas originales (R66/R67) > solo los ORIGINALES llevan documento; contra-asientos, reclasificados y el resto van en null
- revertido: arbol limpio = True

## M8 — filas reclasificadas/contra-asientos: el servicio no mira la CATEGORIA (el contra-asiento gana documento)
- archivo: `lib/services/WalletService.ts`; diff:  1 file changed, 1 insertion(+), 1 deletion(-)
- tests: tests/unit/services/wallet-service.test.ts tests/integration/db/libro-caja-documentos-459.test.ts
- ejecutados: 37; linea: 3 failed | 34 passed (37)
- veredicto: **ROJO**
  - tests/integration/db/libro-caja-documentos-459.test.ts > 459/T B.16 — el libro de la caja trae el documento de sus filas (Postgres real) > R66/R67: el original vigente y el anulado llevan su documento; el contra-asiento no
  - tests/unit/services/wallet-service.test.ts > WalletService.listarMovimientos — el documento de las filas originales (R66/R67) > UNA consulta por tipo de documento presente, con solo los ids de los originales
  - tests/unit/services/wallet-service.test.ts > WalletService.listarMovimientos — el documento de las filas originales (R66/R67) > solo los ORIGINALES llevan documento; contra-asientos, reclasificados y el resto van en null
- revertido: arbol limpio = True

## M9 — libro: «Anular…» tambien en el documento ya anulado
- archivo: `app/(app)/wallet/_components/DocumentoCajaAcciones.tsx`; diff:  1 file changed, 1 insertion(+), 1 deletion(-)
- tests: tests/components/WalletLedgerAcciones459.test.tsx
- ejecutados: 13; linea: 1 failed | 12 passed (13)
- veredicto: **ROJO**
  - tests/components/WalletLedgerAcciones459.test.tsx > FICHA 459 — qué filas ofrecen acciones (R66/R67) > R66: «Anular…» solo en los originales VIGENTES; «Anulado» en el ya anulado
- revertido: arbol limpio = True

## M10 — libro: la anulacion de un pago por cuenta va a la action del APORTE
- archivo: `app/(app)/wallet/_components/DocumentoCajaAcciones.tsx`; diff:  1 file changed, 1 insertion(+), 1 deletion(-)
- tests: tests/components/WalletLedgerAcciones459.test.tsx
- ejecutados: 13; linea: 2 failed | 11 passed (13)
- veredicto: **ROJO**
  - tests/components/WalletLedgerAcciones459.test.tsx > FICHA 459 — anular desde el libro (R46/R49/R65/R74) > R50: «ya estaba anulado» también cierra y relee; «no encontrado» se dice y no cierra
  - tests/components/WalletLedgerAcciones459.test.tsx > FICHA 459 — anular desde el libro (R46/R49/R65/R74) > pago por cuenta: motivo obligatorio, manda {pagoId, motivo} y el módulo relee
- revertido: arbol limpio = True

## M11 — libro de la tienda (R44): sin rotulo de origen para el pago por cuenta (se leeria crudo)
- archivo: `app/(app)/mi-wallet/_components/mi-wallet-labels.ts`; diff:  1 file changed, 1 deletion(-)
- tests: tests/unit/components/mi-wallet-labels.test.ts tests/integration/mi-wallet-page.test.tsx
- ejecutados: 44; linea: 5 failed | 39 passed (44)
- veredicto: **ROJO**
  - tests/integration/mi-wallet-page.test.tsx > ⭑ FICHA 459 — el pago por cuenta en /mi-wallet (R44) > se lee «Pago por cuenta de la tienda», con su beneficiario y referencia, nunca «Cobro de Ordenex»
  - tests/integration/mi-wallet-page.test.tsx > ⭑ FICHA 459 — la descarga de la tienda (R44/R100) > /mi-wallet: concepto y origen legibles, sin ids
  - tests/integration/mi-wallet-page.test.tsx > ⭑ FICHA 459 — la descarga de la tienda (R44/R100) > /wallet/tiendas: el mismo concepto y origen, sin ids
  - tests/unit/components/mi-wallet-labels.test.ts > FICHA 459 — ORIGEN_TIENDA_LABEL cubre cada origen que escribe en el libro de la tienda > cada origen que escribe en la tienda tiene rótulo legible (el compilador no lo obliga)
  - tests/unit/components/mi-wallet-labels.test.ts > FICHA 459 — ORIGEN_TIENDA_LABEL cubre cada origen que escribe en el libro de la tienda > el pago por cuenta se lee con el texto del diseño, y NO como «Cobro de Ordenex»
- revertido: arbol limpio = True


Once mutaciones, once en ROJO, cero supervivientes; árbol limpio tras cada una.

## Verificación (salida real)

Gate COMPLETO `./init.sh` contra `ordenex_459`, sobre `7a42d69e` (sin `tail`, `INIT_EXIT` dentro).

- Corrida 1 → `progress/gate_459_frontend_corrida1.log`: `INIT_EXIT=1`, 1 test rojo AJENO:
  `tests/integration/repositories/historico-conversaciones.int.test.ts` > «R36: un termino que no casa nada
  devuelve la lista vacia» (devolvió 2 conversaciones de OTRO archivo que sembraba a la vez en la base
  compartida; no toca nada de esta ficha). Aislado 3 veces: `Tests 27 passed (27)` ×3.
- Corrida 2 → `progress/gate_459_frontend.log`:
  - `✓ typecheck paso`
  - lint: `✖ 217 problems (0 errors, 217 warnings)` (los mismos 217 preexistentes del backend)
  - `✓ DATABASE_URL resuelta: los 277 archivos de tests contra Postgres SI se ejecutan`
  - `Test Files  2198 passed (2198)` · `Tests  31089 passed | 26 skipped (31115)`; los 26 skipped son
    `AnaliticaPage.test.tsx` (17) y `AnaliticaShell.test.tsx` (9), preexistentes: 0 en `tests/integration/db`.
  - `== init OK ==` · `INIT_EXIT=0`

**Veredicto:** frontend de A.7–A.9, B.6 (`ORIGEN_TIENDA_LABEL`), B.15–B.17 y C.6 hecho, con 11 mutaciones
rojas y el gate completo en verde; pendiente del leader: recorrido por rol (design §16) y release.
