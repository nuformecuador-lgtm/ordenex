# Ficha 461 — bitácora del frontend (bloques C y D, auditoría P1 y P3)

- Fecha: 2026-09-25. Rama `feature/461-frontend` (nace de `c1b2cdf6`, el cierre del backend). Worktree
  propio, `pnpm install` propio (sin junction), `prisma generate` propio.
- Base: clon `ordenex_461` (el `.env` del worktree del backend, copiado sin imprimirlo);
  `prisma migrate status`: «Database schema is up to date!».
- Búsqueda: MCP `codebase-memory` (`R-job-singularis-projects-ordenex`) para ubicar labels, ledgers y
  consumidores; el índice no ve `desglose-tienda-labels.ts` nuevo ni los servicios de la 459/461. Todo se
  confirmó en el archivo real antes de tocarlo (los `:línea` de aquí son de esa lectura).
- Alcance: **T C.1–C.7, T D.1–D.2** de `tasks.md` + los fallos de pantalla **P1** y **P3** de
  `progress/auditoria_wallet.md` (`e0707f3a`). No se tocó backend, base ni rutas de API; el único archivo
  fuera de `app/`, `docs/ayuda/` y `tests/` que se mutó (`lib/types/historial-accion.ts`) fue solo para
  MEDIR (mutación M-HISTORIAL, revertida).

## 1. Lo que hace el frontend (resumen por decisión)

1. **HD3 — los nombres, desde Ordenex y diciendo quién le paga a quién.** `CATEGORIA_LABEL` (23),
   `ORIGEN_LABEL` (13), `TIPO_EGRESO_MANUAL_LABEL`, `DOCUMENTO_CAJA_NOMBRE` (design §7.2/§7.3);
   `CATEGORIA_TIENDA_LABEL` propio de `/wallet/tiendas` (§7.4) y `CATEGORIA_MI_WALLET_LABEL` en
   `/mi-wallet` (§7.5, P4: dos `Record` totales sobre el mismo enum que difieren en los 14 conceptos);
   `ORIGEN_TIENDA_LABEL` (§7.3); pistas de las dos cabeceras (§7.5, R45); los siete conceptos del
   diálogo, sus tres grupos y sus siete frases de efecto de una línea (§7.1/§7.6); las etiquetas del
   historial ya venían del backend (§7.7) y la pantalla las ofrece y las pinta (R51).
2. **HD1 — el cobro escribe en los dos libros.** El concepto `cobro_tienda` declara su cargo en la caja
   (`categoria: "ingreso_cobro_tienda"`) y su débito en la tienda (`categoriaTienda: "cobro_manual"`),
   cae en `caja_y_tienda`, y el diálogo promete los dos nombres (R46). `LibroDestino` pierde la variante
   `tienda`: ya no hay concepto que escriba solo ahí. Su cabecera dice que se anula desde la caja (no «no
   se puede deshacer»); la pista del campo de la tienda y el aviso de éxito («La tienda le debe ese dinero
   a Ordenex» con signo negativo, R54) según design §8.
3. **R66/R68 — la clave de idempotencia y `ya_registrado`.** El backend ya había dejado `claveIdempotencia:
   clave` en el envío común y `ya_registrado` como éxito; aquí se FIJA con tests (cobro, gasto y
   corrección: un solo toast de éxito, ninguno de error) y con dos mutaciones.
4. **R17/R20/R37 — anular desde el libro.** `DocumentoCajaAcciones` normaliza el resultado
   (`ResultadoAnulacion`) y dice el motivo de `no_anulable` dentro del diálogo, sin cerrar ni releer.
5. **R50** — `CAJA_RESUMEN_AVISO_TERCEROS` nombra lo que Ordenex les cobró y deja de decir que los cobros
   no pasan por la caja; la frase entra en `TEXTOS_RETIRADOS` de `caja-textos-459.guardia` con contraprueba.
6. **Auditoría P1** — la clave SWR de cada tabla (`saldos-tiendas-clave.ts`, `cuentas-por-pagar-clave.ts`)
   sale de un módulo puro y el refresco dirigido del desglose la incluye por predicado (`mutate(esClave…)`):
   `PagoTiendaAcciones` tras pagar y anular; `DesglosePagosMensajero` tras el reparto. Una lectura más (la
   página visible), sin `router.refresh()`, sin releer los otros desgloses (R33 de la 172 intacto).
7. **Auditoría P3** — `WalletLedger` pinta «Reversado» (Badge, como «Anulado») en el gasto o sueldo cuyo
   reverso ya existe, en vez de ofrecer «Reversar». **Límite declarado:** `WalletMovimientoDTO` no trae hoy
   ningún dato de «este egreso ya tiene reverso» (`documento` cubre pago de un gasto, aporte, cobro y
   corrección; nada más), así que la pantalla lo sabe (a) por el reverso presente en la página que se está
   viendo (`ingreso_ajuste` de origen `gasto` con `origenId` = el egreso, que solo escribe
   `WalletEgresoService.reversarEgreso`, uno por egreso por el índice único) y (b) por esta sesión (tras
   `ok` o `already_reversed`). Un egreso cuyo reverso vive en OTRA página sigue ofreciendo el botón (el
   comportamiento anterior; el servidor lo guarda y no hay doble asiento). **Cerrarlo del todo es del
   backend:** que `WalletService` resuelva en lote el estado del egreso administrativo como hace con
   `documento` (un lector `egresos` en `LectoresDocumentosCaja` sobre `wallet_movimiento` por
   `(origen_tipo='gasto', origen_id, categoria='ingreso_ajuste')`) y el DTO lo traiga. Queda para la 458
   (R66 allí) o para quien tome P3 completo.
8. **Composición de la ganancia (R27).** Las filas nuevas ya venían del backend; aquí sus iconos (`Store`,
   `Undo2`), y las filas de egreso se dicen en la misma voz («Gastos de Ordenex», «Pagos de Ordenex a
   mensajeros», «Correcciones de caja (resta)», «Gastos fijos de Ordenex»): «Ajustes (egreso)» y
   «Gastos variables» eran los plurales de dos nombres retirados.
9. **P9** — «contra-entrega», no «COD», en todos los rótulos de la wallet, incluida la descripción de
   `/mi-wallet` (`page.tsx`).

## 2. Archivos

### Nuevos

`app/(app)/wallet/tiendas/_components/saldos-tiendas-clave.ts`,
`app/(app)/wallet/mensajeros/_components/cuentas-por-pagar-clave.ts`,
`tests/unit/components/wallet-labels.test.ts`, `tests/components/WalletLedgerAcciones461.test.tsx`,
`tests/components/HistorialAccionesCobroTienda461.test.tsx`,
`tests/components/WalletSaldosTiendasRefrescoP1.test.tsx`,
`tests/components/WalletCuentasPorPagarRefrescoP1.test.tsx`,
`tests/unit/guards/nombres-wallet-461.guardia.test.ts`, `tests/unit/asistente/contexto-461.test.ts`.

### Modificados (app)

`wallet/_components/{wallet-labels,wallet-conceptos-manuales,composicion-detalle-labels}.ts`,
`wallet/_components/{RegistrarMovimientoCajaDialog,DocumentoCajaAcciones,WalletLedger,ComposicionGananciaCard,DesgloseEgresosLista}.tsx`,
`wallet/tiendas/_components/{desglose-tienda-labels.ts,SaldosTiendasTable.tsx,PagoTiendaAcciones.tsx}`,
`wallet/mensajeros/_components/{CuentasPorPagarTable,DesglosePagosMensajero}.tsx`,
`mi-wallet/_components/{mi-wallet-labels,mi-wallet-descarga-columnas,mi-wallet-cierres}.ts`,
`mi-wallet/_components/{DesgloseTiendaLedger,MiWalletFiltros}.tsx`, `mi-wallet/page.tsx`.

### Modificados (docs)

`docs/ayuda/oficina/wallet-caja.md`, `docs/ayuda/oficina/wallet-tiendas.md`, `docs/ayuda/tienda/mi-wallet.md`
(`actualizado: 2026-09-25`; `fuentes` + `CobroTiendaService.ts`, `CajaCobroTiendaFeedService.ts`,
`AjusteCajaService.ts`, `descripcion-cobro-tienda.ts`, `caja-tesoreria.ts`, `desglose-tienda-labels.ts`).
`historico-acciones.md` no nombra las acciones de la wallet: no se tocó.

### Decisiones que no están en el spec (anotadas, no reabren nada)

- `CABECERA_POR_LIBRO` pasa a `CABECERA_CAJA` + `cabeceraDelConcepto(concepto)` (design §7.6: «por
  concepto»); la descripción del cobro conserva la de la 381 sustituyendo «es inmutable: no se puede
  editar ni deshacer» por «no se edita: si hay un error, se anula desde el libro de la caja con un motivo».
- `DescripcionLabel` de las dos correcciones: «Motivo de la corrección» (antes «Motivo del ajuste»;
  design §7: «corrección», no «ajuste»). El aviso `catalogoCaido` del pago de un gasto dice «el pago de un
  gasto de una tienda».
- El origen «Manual» del libro del MENSAJERO (`wallet-mensajeros-labels.ts:176`) no es superficie de esta
  ficha (R42–R44) y se deja tal cual, declarado como `PENDIENTES` con número exacto en la guardia nueva
  (una aparición): la 458 lo recoge.
- Los comentarios de los archivos de la wallet no citan ningún nombre retirado entre «» ni las frases
  retiradas: la guardia lee el fuente CRUDO (como `caja-textos-459`), y por eso se reformularon dos
  comentarios propios que las repetían.

## 3. Mapa R → test (frontend)

| R | Test |
| --- | --- |
| R17 (aviso), R20, R21, R37 | `tests/components/WalletLedgerAcciones461.test.tsx` |
| R27 | `tests/components/ComposicionGananciaCard.test.tsx` (filas y totales con los nombres nuevos), `wallet-labels.test.ts` (rótulos de las filas nombradas) |
| R39, R40, R41, R46 | `tests/unit/components/wallet-conceptos-manuales.test.ts`, `tests/unit/components/wallet-registrar-movimiento-dialog.test.tsx` |
| R42 | `tests/unit/components/wallet-labels.test.ts` (36 literales), `WalletLedgerAcciones461.test.tsx` (tabla y descarga), `tests/components/descarga/WalletDescarga.test.tsx` |
| R43, R45 | `tests/unit/components/desglose-tienda-labels.test.ts`, `desglose-movimientos-tienda.test.tsx`, `tests/unit/descarga/desglose-tienda-descarga-columnas.test.ts`, `tests/integration/wallet-tiendas-desglose.test.tsx` |
| R44, R45 | `tests/unit/components/mi-wallet-labels.test.ts` (dos diccionarios totales y distintos en los 14), `tests/integration/mi-wallet-page.test.tsx`, `tests/unit/descarga/wallet-tienda-descarga-columnas.test.ts`, `desglose-tienda-ledger.test.tsx` |
| R47, R48, R49, R50 | `tests/unit/guards/nombres-wallet-461.guardia.test.ts` (16 diccionarios, 3 árboles de código, `docs/ayuda/**`; contraprueba y no-vacuidad) + `fuente-unica-nombre-estado`, `nombres-estado-retirados`, `sin-estados-retirados`, `caja-textos-459` (verdes, sin tocar salvo el retiro nuevo de la 459) |
| R51, R55 (pantalla) | `tests/components/HistorialAccionesCobroTienda461.test.tsx` |
| R52 | `WalletLedgerAcciones461.test.tsx` (sin uuids en pantalla, nombres accesibles ni descarga), `tests/unit/descarga/columnas-sensibles.guardia.test.ts` |
| R53, R54 | `wallet-registrar-movimiento-dialog.test.tsx` (payload del cobro exacto; aviso con «le debe») |
| R56, R57, R58 | `tests/unit/asistente/contexto-461.test.ts`, `contexto-460.test.ts` (reescrito), guardias `ayuda-*` y `asistente-*` (verdes) |
| R66, R68 (UI) | `wallet-registrar-movimiento-dialog.test.tsx` (clave en los tres envíos; `ya_registrado` sin toast de error) |
| P1 | `tests/components/WalletSaldosTiendasRefrescoP1.test.tsx`, `WalletCuentasPorPagarRefrescoP1.test.tsx`, `tests/integration/wallet-tiendas-pago.test.tsx` (dos casos reescritos) |
| P3 | `WalletLedgerAcciones461.test.tsx` (bloque «auditoría P3») |
| R65 | **NO en este bloque**: es T Z.3 (recorrido por rol con capturas, `progress/recorrido_461.md`); queda para el cierre Z |

### Tests reescritos o alineados (con su R)

- **A conciencia (contrato):** `wallet-conceptos-manuales.test.ts` (R39–R41, R46), `mi-wallet-labels.test.ts`
  (R44/R45), `desglose-tienda-labels.test.ts` (R43/R45; la identidad con `/mi-wallet` pasa a ser SOLO de
  tipo/origen/`money`, y el concepto se afirma DISTINTO), `wallet-tienda-descarga-columnas.test.ts` (la
  igualdad cruzada tienda↔oficina se invierte: mismo movimiento, dos lecturas del concepto; R44),
  `contexto-460.test.ts` (cinco literales de nombres retirados → nuevos; R56), `caja-textos-459.guardia`
  (+«bajan su saldo sin pasar por la caja», con contraprueba; R50), `wallet-tiendas-pago.test.tsx` (dos
  aserciones «la tabla de saldos no se vuelve a pedir» → «se relee una vez»; P1).
- **Alineados con los nombres nuevos (mismo comportamiento, otro literal):** `CajaResumenCard.test.tsx`
  (R50), `WalletLedgerAcciones459.test.tsx` (15 literales), `WalletFechaCostaRica459.test.tsx` (2),
  `ComposicionGananciaCard.test.tsx` (12), `DetalleFilaComposicion.test.tsx` (7), `DetalleMovimientoCierre.test.tsx`
  (3), `DetalleMiMovimientoCierre.test.tsx` (2), `wallet-ledger-reversa.test.tsx` (2), `wallet-indemnizacion-libro.test.tsx`
  (4), `incidente-exhaustividad.test.ts` (2), `wallet-caja-descarga-columnas.test.ts` (3),
  `desglose-movimientos-tienda.test.tsx` (8), `desglose-tienda-ledger.test.tsx` (9),
  `desglose-tienda-descarga-columnas.test.ts` (7), `wallet-tiendas-desglose.test.tsx` (4),
  `saldo-tienda-card.negativo.test.tsx` (1), `mi-wallet-page.test.tsx` (13),
  `wallet-registrar-movimiento-dialog.test.tsx` (18 + 3 casos reescritos + 2 nuevos). Ninguno desaparece
  sin reemplazo; los reemplazos se hicieron con un script que verificaba el número de apariciones de cada
  literal (`scratchpad/reemplazos.py`, tablas `tabla_c1*.json`, `tabla_c2.json`, `tabla_c4.json`).

## 4. Mutaciones (design §14.2: 11, 12, 13; y una por pieza clave del encargo)

Ejecutor: `scratchpad/mutar.sh` (aplica UNA línea con `sed`, exige `git diff` no vacío, corre SOLO los tests
nombrados, revierte con `git checkout` y exige árbol limpio). Informe completo:
`scratchpad/mutaciones_461_frontend.log` y `scratchpad/mut/*.log`. Todas en ROJO (`VITEST_EXIT=1`), con el
nombre del caso; el número de tests ejecutados nunca fue 0; `ARBOL_LIMPIO=1` en las 14.

| # | Mutación (archivo · línea cambiada) | Tests corridos | Resultado |
| --- | --- | --- | --- |
| 11 | `CATEGORIA_LABEL.ingreso_cobro_tienda = "Cobro de Ordenex"` (nombre retirado) | nombres-wallet-461.guardia, wallet-labels | **5 rojos** / 39 («dice exactamente los 23 textos…», guardia del diccionario) |
| 12 | `CATEGORIA_MI_WALLET_LABEL.cobro_manual = "Ordenex le cobra a la tienda"` (el nombre desde Ordenex) | mi-wallet-labels, wallet-tienda-descarga-columnas | **7 rojos** / 25 (R44: «es DISTINTA del nombre desde Ordenex…»; la igualdad cruzada) |
| 13 | `FRASE_DEL_EFECTO.cobro_tienda` con la frase de la 459 («La caja y la ganancia no cambian») | wallet-conceptos-manuales, nombres-wallet-461.guardia | **5 rojos** / 50 (R41 y la guardia) |
| D-clave | el diálogo deja de enviar `claveIdempotencia` (`RegistrarMovimientoCajaDialog.tsx:433`) | wallet-registrar-movimiento-dialog | **11 rojos** / 54 (todos los `toEqual` de payload, R66) |
| D-ya_registrado | el cobro deja de tratar `ya_registrado` como éxito (`:442`) | wallet-registrar-movimiento-dialog | **1 rojo** / 54 («`ya_registrado` se anuncia como registrado…», R68) |
| Línea del cobro | `ORIGEN_LABEL.cobro_tienda_completado` igual al propio (`wallet-labels.ts:347`) | wallet-labels, WalletLedgerAcciones461 | **4 rojos** / 39 (R37/R42: tabla y descarga de la línea completada) |
| Anulación (payload) | `anularCobroTiendaAction({ cobroId, motivo, monto: "1.00" })` | WalletLedgerAcciones461 | **2 rojos** / 26 (R13: «manda {cobroId, motivo} SIN monto») |
| Anulación (no_anulable) | la rama `no_anulable` desaparece (`case "no_anulable_x"`) | WalletLedgerAcciones461 | **2 rojos** / 26 (R17, los dos motivos) |
| /mi-wallet | la descarga emite `movimiento.categoria` crudo (`mi-wallet-descarga-columnas.ts:49`) | wallet-tienda-descarga-columnas, mi-wallet-page | **5 rojos** / 44 (R44/R52) |
| P1 tiendas | `PagoTiendaAcciones` deja de refrescar la tabla de saldos (`:150`) | WalletSaldosTiendasRefrescoP1, wallet-tiendas-pago | **4 rojos** / 35 («tras registrar el pago, la tabla relee…») |
| P1 mensajeros | `DesglosePagosMensajero` deja de refrescar la tabla de cuentas (`:313`) | WalletCuentasPorPagarRefrescoP1 | **1 rojo** / 2 |
| P3 | la condición de «Reversado» pasa a `false` (`WalletLedger.tsx:335`) | WalletLedgerAcciones461 | **3 rojos** / 26 (los tres casos de «Reversado») |
| Historial | `ACCION_LABELS.cobro_tienda_anulado = "Anuló un cobro"` (medida sobre `lib/types`, revertida) | HistorialAccionesCobroTienda461, catalogo-y-choke-point | **2 rojos** / 50 (R51) |
| R50 | `CAJA_RESUMEN_AVISO_TERCEROS` vuelve a «bajan su saldo sin pasar por la caja» | caja-textos-459.guardia, wallet-labels, CajaResumenCard | **3 rojos** / 55 |

## 5. El asistente, preguntado de verdad (T D.2)

Script de un solo uso (borrado tras correr; `scratchpad/asistente_461.txt` guarda la salida): mismo
`instruccionesDelSistema(rol)` + `contextoPara(docs, rol)` que arma `/api/asistente`, con
`AnthropicAsistenteClient` y la `ANTHROPIC_API_KEY` del `.env` (leída en tiempo de ejecución, no impresa),
modelo `claude-sonnet-5`. Las cuatro respuestas, correctas y con los nombres nuevos; extracto literal:

- **[maestro] «¿qué pasa con la ganancia si le cobro a una tienda?»** — «La **ganancia de Ordenex sube** en
  el monto del cobro. Ese dinero **no es nuevo en la caja**: ya estaba ahí, guardado a favor de la tienda,
  y simplemente cambia de dueño. Por eso **Entró**, **Salió** y la cifra grande de caja **no se mueven**. En
  contraparte, **lo que Ordenex les debe a las tiendas** baja en el mismo monto […] Si la tienda no tenía
  saldo suficiente a favor, su saldo **queda en contra** […] Esto es distinto de **"Ordenex paga un gasto de
  una tienda"**: ahí sí sale dinero de la caja hacia un tercero, y la ganancia de Ordenex **no cambia**.»
  `[[doc:oficina/wallet-caja]] [[doc:oficina/wallet-tiendas]]`
- **[maestro] «¿cómo anulo un cobro?»** — «Se hace desde **Wallet · Caja**, en el libro de movimientos:
  1. Buscá la línea del cobro ("Ordenex le cobra a una tienda") […] 2. En esa fila tenés la opción
  **Anular…**. 3. Te va a pedir el **motivo**, que es obligatorio […] queda marcado como **Anulado** y se
  registra hoy un **movimiento contrario** por el mismo monto […] la ganancia baje en ese monto y que lo que
  Ordenex le debe a esa tienda (y su saldo) vuelva a subir — sin afectar «Entró», «Salió» ni la cifra grande
  […] si te dice que ese cobro **no se puede anular desde ahí**, probablemente es uno de los cobros antiguos
  que ya se corrigieron como pago de un gasto de tienda […] Un gasto o sueldo registrado a mano no se anula
  así, sino que se **reversa**.» `[[doc:oficina/wallet-caja]]`
- **[admin] «¿qué es Ordenex paga un gasto de una tienda?»** — «Es un movimiento en el que **Ordenex le
  paga a un tercero en nombre de una tienda** […] **La caja baja**: sí sale dinero de verdad […] **El saldo
  de la tienda baja** […] En el libro de la tienda aparece como **«Ordenex paga un gasto de la tienda»**, y
  no cuenta como un pago a la tienda […] **Ojo, no confundirlo con «Ordenex le cobra a una tienda»** […] Ahí
  no sale dinero de la caja, solo pasa del saldo de la tienda a la ganancia de Ordenex.»
  `[[doc:oficina/wallet-caja]] [[doc:oficina/wallet-tiendas]]`
- **[adminTienda] «¿por qué dice Ordenex te cobró?»** — «Ese movimiento aparece en **Mi wallet** cuando la
  oficina te hace un cobro manual, por ejemplo por material de despacho […] **Baja tu saldo** […] se cuenta
  dentro de **Cargos de Ordenex**. Si no tenías saldo a favor suficiente, tu saldo **queda en contra** […]
  No es lo mismo que **«Ordenex pagó un gasto por ti»** […] no se corrige ni se anula desde tu cuenta — eso
  lo tiene que hacer la oficina. Si lo anulan, vas a ver una línea aparte que dice **«Ordenex anuló un cobro
  y te lo devolvió»**.» `[[doc:tienda/mi-wallet]]` (7 documentos en el contexto: la caja no le llegó, R57).

## 6. Guardias

Verdes en la corrida dirigida (17 archivos, 200 tests): `nombres-wallet-461` (nueva),
`fuente-unica-nombre-estado`, `nombres-estado-retirados`, `sin-estados-retirados`, `caja-textos-459`,
`ayuda-pantalla-ruta-existe`, `ayuda-md-viajan-a-produccion`, `ayuda-render-sin-filtracion`,
`ayuda-columna-retirada`, `asistente-sin-frontmatter`, `asistente-sin-datos`, `asistente-panel-hermano`,
`asistente-sin-persistencia`, `contexto-documental`, `acotamiento-por-rol`, `contexto-460`, `contexto-461`.

## 7. Gate

Comando: `./init.sh > progress/gate_461_frontend.log 2>&1; echo "INIT_EXIT=$?" >> progress/gate_461_frontend.log`
(gate COMPLETO, sin `tail`, contra `ordenex_461`, desacoplado con `nohup` para que un corte de la sesión no lo
mate). Se mira que `tests/integration/db` no tenga saltados: sin `.env` se saltan y el gate dice «OK».

- **1.ª corrida** (`000590d6`, guardada en `scratchpad/gate_461_frontend_1.log`): `INIT_EXIT=1` —
  2 224 archivos, **3 rojos**, los tres consecuencia de esta ficha y ninguno del dinero:
  1. `PremiosRankingPanel.test.tsx` › «el refresco dirigido apunta a claves que EXISTEN»: la guardia buscaba
     el literal `"wallet-mensajeros:cuentas"` en `CuentasPorPagarTable.tsx` y P1 lo movió al módulo puro
     `cuentas-por-pagar-clave.ts`. → La guardia apunta al módulo que hoy define la clave y gana un caso que
     exige que la tabla la importe de ahí (`claveCuentasPorPagar`) y no la escriba a mano.
  2. `wallet-ledger-dueno.test.tsx` › R36 «ninguna fuente de `app/wallet` deriva el dueño»:
     `esReversoDeUnEgreso` (P3) comparaba `categoria === "ingreso_ajuste"`. → Se reconoce el reverso por
     tipo + origen `gasto` + `origenId`, sin mirar la categoría; medido en el árbol: el único INGRESO con
     origen `gasto` es el reverso (`WalletEgresoService.ts:128-131`; los otros tres escritores con ese
     origen —`GastoFijoCobroService`, `GeneracionGastosFijosService`, el propio gasto— son egresos).
  3. `ancla-de-carga.guardia.test.ts`: mi `WalletSaldosTiendasRefrescoP1.test.tsx:185` anclaba un
     `waitFor` a `getAllByText(...).length > 0`. → `getByText("₡5.000")` en singular + `toBeInTheDocument`.
  Corregidos en `9a98c940`; los tres archivos y los que dependen de lo tocado, aislados: 6 archivos, 71
  tests, verdes.
- **2.ª corrida** (`9a98c940`), la que vale:

```
 Test Files  2224 passed (2224)
      Tests  31395 passed | 26 skipped (31421)
   Duration  789.03s
== init OK ==
INIT_EXIT=0
```

Los 26 `skipped` son los de siempre en `tests/components/AnaliticaPage.test.tsx` (17) y
`AnaliticaShell.test.tsx` (9); **0 skipped en `tests/integration/db`**.

## 8. Veredicto

Frontend de la 461 (bloques C y D) + P1/P3 de la auditoría **terminado y verde**: typecheck 0, lint 0
errores, gate completo `INIT_EXIT=0`, 14 mutaciones en rojo y revertidas (design §14.2 11–13 + una por
pieza clave), las guardias de la 455, la 459, la 460 y la nueva de la 461 verdes, y las cuatro preguntas
reales al asistente respondidas con los nombres nuevos y el acotamiento por rol. Rama
`feature/461-frontend` pusheada.

Queda fuera de este bloque y se dice: **T Z.3/R65** (recorrido por rol con capturas) es del cierre Z;
**P3 completo** (un egreso cuyo reverso vive en otra página) exige que el servidor resuelva el estado del
egreso en lote, como hace con `documento` (458 o quien tome P3); y el origen «Manual» del libro del
mensajero queda declarado en la guardia nueva como pendiente de la 458.
