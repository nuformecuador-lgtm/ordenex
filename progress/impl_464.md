# Ficha 464 — Excel de las wallets: detalle por orden — bitácora del BACKEND (T1, T3–T6)

Rama `feature/464-wallets-excel-por-orden`, nacida de `41674816` (dev con la 463 mergeada). Agente:
backend_dev. El frontend (T2, T7–T10 y la parte de pantalla de T11/T12) lo hace un frontend_dev
después, en esta misma rama.

Búsqueda de código: el MCP `codebase-memory` NO estaba en el conjunto de herramientas de este agente;
se usó `grep`/lectura directa de cada archivo citado.

**Sin migraciones, sin índices, sin RLS nueva, sin cambio de esquema** (design §1). El lote consulta
`cierre_detail` por `cierre_id` (la ruta caliente que ya declara `@@unique([cierreId, ordenId])`) y
`wallet_tienda_movimiento` por `id`.

## Archivos

Creados:
- `lib/types/detalle-en-lote.ts` — DTO del lote (`OrdenDelLoteDTO`, `DetalleDeMovimientoLoteDTO`),
  resultados de servicio (`DetalleEnLoteServiceResult`, `CajaConDetalleServiceResult`,
  `EstadoCuentaConDetalleServiceResult`) y `LimiteExcedidoDeHoja`.
- `lib/interfaces/services/IDetalleEnLoteService.ts` (+ `DetallarEnLoteInput`, `MovimientoDeCajaParaDetalle`).
- `lib/interfaces/services/ICajaConDetalleService.ts`, `lib/interfaces/services/IEstadoCuentaConDetalleService.ts`.
- `lib/interfaces/repositories/IMovimientosTiendaEnLoteRepository.ts`.
- `lib/services/DetalleEnLoteService.ts` — guard → relectura del ledger (tienda) → decisión de fuente →
  CONTAR por concepto y tramo → tope → leer filas y cabeceras → `aporteDeOrden` → `suma`/`cuadra` (Decimal).
- `lib/services/LibroConDetalleService.ts` — `CajaConDetalleService` y `EstadoCuentaConDetalleService`.
- Tests: `tests/unit/utils/descarga-varias-hojas-464.test.ts` (T1), `tests/unit/utils/fuente-de-movimiento-464.test.ts`
  (T3 + config), `tests/unit/services/detalle-en-lote-464.test.ts` (T5), `tests/unit/actions/libro-con-detalle-464.test.ts`
  (T6), `tests/unit/actions/libro-con-detalle-464.composition-root.test.ts` (T6, root real),
  `tests/integration/db/detalle-en-lote-464.test.ts` (T4 + T6, Postgres real).

Modificados (código):
- `lib/types/descarga.ts` — `DescargaHoja`, `DescargaConfig.hojasAdicionales?`.
- `lib/utils/xlsx-template.ts` — `buildXlsxLibro(hojas)`; `buildXlsxRows` delega en ella (misma firma, mismo resultado).
- `lib/utils/descarga-dataset.ts` — `construirDescarga` con hojas adicionales (solo xlsx; csv + hojas ⇒
  `throw`); `nombresDeHojaUnicos` (sin distinguir mayúsculas, sufijo « (n)» dentro de 31 caracteres).
  Sin hojas adicionales el camino es el de siempre, literalmente (`buildXlsxRows(..., nombreHoja(titulo))`).
- `lib/utils/aporte-por-orden.ts` — `fuenteDeMovimiento` + `DecisionDeReparto` (T3).
- `lib/services/DetalleMovimientoService.ts` — `resolverConjunto` usa `fuenteDeMovimiento`; la dependencia
  `aportes` pasa a `Pick<…>` de los tres métodos que usa (los dobles de la 344 no cambian).
- `lib/repositories/CierreAporteRepository.ts` + `lib/interfaces/repositories/ICierreAporteRepository.ts` —
  `contarAportesPorCierre`, `listarAportesDeCierres`, `cabecerasDeCierres` (`FiltroAportesEnLote`,
  `OrdenAporteEnLoteRow`); `whereDelLote` = `OR` de `buildWhere` (una rama por cierre); proyección y mapeo
  compartidos con `listarOrdenesQueAportan` (`SELECT_DE_APORTE`, `aFilaDeAporte`); `ORDEN_GESTIONES`.
- `lib/repositories/WalletTiendaMovimientoRepository.ts` — `listarPorIdsDeTienda(ids, tiendaId)` (implementa
  también `IMovimientosTiendaEnLoteRepository`).
- `lib/config/detalle-movimiento.ts` — `TRAMO_CIERRES_LOTE` (100, env `DETALLE_MOVIMIENTO_TRAMO_CIERRES_LOTE`).
- `lib/actions/wallet.ts` — `listarMovimientosCompletoConDetalleAction` + `buildCajaConDetalleService`.
- `lib/actions/estado-cuenta.ts` — `verEstadoCuentaCompletoConDetalleAction`,
  `verMiEstadoCuentaCompletoConDetalleAction` + `buildConDetalleService`.

Modificados (tests existentes, censos deliberados — nada borrado):
- `tests/unit/actions/wallet-actions.test.ts` — el censo de exports de `lib/actions/wallet.ts` gana
  `listarMovimientosCompletoConDetalleAction`.
- `tests/unit/guards/wallet-origen-total.guardia.test.ts` — `deps.origenes ?? buildOrigenes()` en
  `lib/actions/wallet.ts`: 3 → 4 (la acción nueva entrega filas del libro y les adjunta el origen).

## Adaptaciones a la realidad de la 463 (design §7) y decisiones técnicas (anotadas, no preguntadas)

1. **Esquemas de la 463, tal cual.** Caja: `listarLibroCajaCompletoSchema` (filtros + `q` + `sortBy` +
   `sortDir`, `desc` por defecto, `.strict()`). Oficina: `estadoCuentaCompletoSchema` (+ `q`/orden de la
   463) **+ `.refine(cuenta.tipo === "tienda")`** con el error en `fieldErrors.cuenta`. `/mi-wallet`:
   `miEstadoCuentaCompletoSchema` (sin cuenta, `.strict()`). La 464 no define esquema propio.
2. **Saldo inicial.** El servidor (463) NO devuelve la línea del saldo inicial: la coloca la pantalla
   (`asc` ⇒ primera, `desc` ⇒ última). El detalle por eso no tiene entrada para ella: `detalle[i]`
   corresponde a `items[i]` (caja) / `estado.filas[i]` (estado de cuenta), en el MISMO orden. La línea sin
   número la añade el cliente (`enlazarHojas`, T7) donde hoy la pone `filasDelPeriodo`.
3. **Dos orquestadores en vez de un `LibroConDetalleService`** (mismo archivo `LibroConDetalleService.ts`):
   `CajaConDetalleService(caja, detalleEnLote)` y `EstadoCuentaConDetalleService(estadoCuenta, detalleEnLote)`.
   Con una sola clase de constructor sin opcionales, la acción de la caja tendría que construir el
   estado de cuenta (y al revés) solo para satisfacerlo. Cada root inyecta exactamente lo que usa.
4. **La entrada del lote es por SUPERFICIE** (`"caja" | "tienda_oficina" | "mi_wallet"`), no
   `catalogo/tiendaId/conMensajero`: el guard, el alcance y lo que se nombra salen de la superficie, y
   en `/mi-wallet` la tienda sale SIEMPRE del actor (no hay campo que la nombre).
5. **Tienda: el lote RE-LEE las filas del ledger por id con la tienda en el `WHERE`**
   (`listarPorIdsDeTienda`, una consulta). `FilaEstadoCuentaDTO` no trae `origenId` (cierre de origen), y
   añadírselo cambiaría el DTO de la pantalla; releer además blinda R34 (un id ajeno no vuelve y el lote
   falla, no inventa un detalle). Interfaz APARTE (`IMovimientosTiendaEnLoteRepository`): ampliar
   `IWalletTiendaMovimientoRepository` rompía la compilación de 12 dobles de test ajenos.
6. **Tramos en el servicio**, no en el repositorio: los cierres (ordenados) se parten en tramos de
   `TRAMO_CIERRES_LOTE`; el repositorio recibe UN tramo. Consultas = (conceptos × tramos) para contar +
   (conceptos × tramos con algo que leer) para listar + tramos de cabeceras + 1 relectura del ledger en la
   tienda. Todas en serie (nada de `Promise.all`: la ficha 450 midió que sobre la conexión única de una
   transacción eso es falso).
7. **Orden de las gestiones: `createdAt asc, id asc`** (`ORDEN_GESTIONES`), compartido por la fila (344) y
   el lote. Antes solo `createdAt`: dos gestiones de la misma transacción empatan y su «Resultado»
   podía cambiar de sitio entre dos lecturas. El desempate por `id` no cambia ningún caso sin empate.
8. **Un cierre de origen inexistente o un id ajeno al ledger ⇒ `throw`** (sin archivo; el cliente avisa,
   R43). El detalle de una fila responde `not_found`; en el lote no hay fila que callar y un hueco mudo
   sería peor.
9. **`OrdenDelLoteDTO` no lleva `ordenId`**: no lo necesita ninguna columna (R30) ni el enlace.
   `guia` es `num_guia` congelado como texto o `null`; `remision` va aparte (la pantalla de la fila
   muestra `guia ?? remision` en una sola columna; el Excel tiene las dos, R25–R27).
10. `R37` con `TRAMO_CIERRES_LOTE` = 100 y `MAX_FILAS` = 5000: el `OR` lleva como mucho 100 ramas por
    consulta. No hizo falta índice (el plan va por `cierre_detail(cierre_id, …)`).

## Contratos para el frontend

Acciones (todas Server Actions, nacen con `@sin-superficie <motivo>`; **quien las cablee TIENE que borrar
esa anotación**, la guardia `superficie-de-uso` lo exige en los dos sentidos):

| Acción | Archivo | Entrada | `ok` |
| --- | --- | --- | --- |
| `listarMovimientosCompletoConDetalleAction(input)` | `lib/actions/wallet.ts` | la MISMA que `listarMovimientosCompletoAction` (`inputDeLibro(fw, fl)`) | `{ status: "ok", items: (WalletMovimientoDTO & { origen })[], total, detalle }` |
| `verEstadoCuentaCompletoConDetalleAction(input)` | `lib/actions/estado-cuenta.ts` | la de `verEstadoCuentaCompletoAction`; `cuenta.tipo` DEBE ser `"tienda"` | `{ status: "ok", estado: EstadoCuentaDTO, detalle }` |
| `verMiEstadoCuentaCompletoConDetalleAction(input)` | `lib/actions/estado-cuenta.ts` | la de `verMiEstadoCuentaCompletoAction` (sin cuenta) | `{ status: "ok", estado, detalle }` |

- `items` / `estado` son EXACTAMENTE los del completo sin detalle con la misma entrada (R14/R36).
- `detalle[i].movimientoId === items[i].id` (caja) / `=== estado.filas[i].ref.movimientoId` (estado de
  cuenta); mismo orden, misma longitud. Es el enlace en memoria para «N.º»; NUNCA va a una celda (R30).
- `detalle[i]`: `{ modo: "sin_reparto", motivo }` (texto: `DETALLE_MOVIMIENTO_SIN_REPARTO` /
  su gemelo de `/mi-wallet`) o `{ modo: "ordenes", cierre: { fecha (ISO), mensajeroNombre | null },
  ordenes, suma, cuadra }`. `ordenes[j]`: `{ guia: string | null, remision, destinatario,
  tiendaNombre: string | null, resultados: GestionResultado[], aporte }`. Montos STRING escala 2, el
  cliente no suma: «Detalle por orden» = «N órdenes» si `cuadra`, y si `!cuadra` el texto de R23 con
  `suma` (R16/R23). Un movimiento de cierre sin órdenes que aporten llega con `ordenes: []`, `suma "0.00"`.
- `tiendaNombre` solo en la caja (null en tienda-oficina y `/mi-wallet`); `mensajeroNombre` null en
  `/mi-wallet` (R5). La columna «Cierre del» = día CR de `cierre.fecha`.
- Errores: `limite_excedido` con `hoja: "movimientos"` (el aviso de siempre, R38) o `hoja: "detalle"`
  (el nuevo, R39: `total` = filas de detalle, `limite` = tope); `forbidden`; `unauthenticated`;
  `validation_error` (`fieldErrors.cuenta` si la oficina pide una cuenta que no es tienda; claves coladas
  por `.strict()`); estado de cuenta: `no_encontrado`. Un fallo de lectura LANZA (R43: sin archivo, aviso).
- Generador: `construirDescarga({ ..., hojasAdicionales: [{ titulo: "Detalle por orden", columnas, filas }] })`.
  Solo xlsx; con csv lanza (el control no debe ofrecer csv con detalle, R12). Nombres de hoja saneados y
  distintos (`nombresDeHojaUnicos`, exportada).
- R13: «Solo los movimientos» debe seguir llamando a las acciones de SIEMPRE (las sin detalle); las tres
  nuevas leen el detalle siempre.

## Mapa R<n> → test (parte backend)

Abreviaturas: VH = `tests/unit/utils/descarga-varias-hojas-464.test.ts`; FM = `tests/unit/utils/fuente-de-movimiento-464.test.ts`;
LS = `tests/unit/services/detalle-en-lote-464.test.ts`; AC = `tests/unit/actions/libro-con-detalle-464.test.ts`;
CR = `tests/unit/actions/libro-con-detalle-464.composition-root.test.ts`; IN = `tests/integration/db/detalle-en-lote-464.test.ts`.

| R | Test |
| --- | --- |
| R5 (servidor) | LS «R5: caja: tienda y mensajero; oficina-tienda: mensajero sin tienda; /mi-wallet: ninguno»; IN «R5/R21/R22/R34 — /mi-wallet…» (`mensajeroNombre` null, ningún «Mensajero 464» en el JSON) |
| R7 (servidor) | AC «R7: la oficina con una cuenta que no es tienda -> validation_error en el borde, sin servicio»; AC «R7: una cuenta que no es tienda -> validation_error sin leer nada» (servicio); no existe acción con detalle para mensajero/bodega |
| R10 (generador) | VH «R10: … la principal primero y «Detalle por orden» despues…» |
| R12 | VH «R12: csv con hojas adicionales no produce archivo» |
| R14 | IN «R14/R21/R22/R36 — caja…» (`items` = completo sin detalle, mismo orden/total); IN «… tienda en la oficina…» (`estado` = `leerCompleto`); AC «R14/R36: la hoja de movimientos es la del completo de siempre…» |
| R18 | IN (diferencial: una línea por orden que aporta, ni una más, por movimiento) + T4 «conteo y filas del lote = listarOrdenesQueAportan…» |
| R20 | LS «un detalle por movimiento, en el orden recibido; las ordenes en el orden del repositorio»; IN diferencial (igualdad de SECUENCIA con la fila); `ORDEN_GESTIONES` compartido (IN «hechos del escenario», o2) |
| R21 | IN diferencial ×3: caja vs `verDetalleDeMovimientoCompleto`, oficina vs `verDetalleDeFilaDeCuenta`, `/mi-wallet` vs `verDetalleDeMiMovimientoCompleto` |
| R22 | IN (cada movimiento con reparto: `suma` = monto emitido por el FEED REAL y `cuadra`); LS «R22…» |
| R23 (servidor) | LS «R23: si la suma no es el monto, cuadra=false y la suma viaja»; LS «… sin ordenes que aporten: … no cuadra» |
| R24 | VH «R24: una hoja adicional sin filas sale con su fila de encabezados»; LS «R24 (servidor): si nada tiene reparto, cero consultas…» |
| R29 | IN caja «R29: remision y destinatario son los CONGELADOS» (la orden viva dice `VIVA-…`/`Vivo …`) |
| R30 (servidor) | LS «… ningun id interno en la DTO» (sin `ordenId`); `movimientoId` solo enlace |
| R31 (servidor) | aportes/sumas STRING escala 2 en LS e IN (p. ej. «130.00», «43.33», «5000.50») |
| R32 | LS «R32: la caja…» y «R32: la tienda en la oficina…» (forbidden, cero llamadas); mutación M6 |
| R33 | LS «R33: /mi-wallet sin el rol de tienda…» (incluido el maestro); mutación M7 |
| R34 | IN oficina y `/mi-wallet` (ninguna orden de la otra tienda; ids de B con la tienda A ⇒ falla); IN T4 (conteo/filas con `tiendaId`); LS «/mi-wallet: el `tiendaId` de las tres lecturas es el del actor»; mutaciones M2, M8, M11, M12 |
| R35 | AC «R35: /mi-wallet con un identificador de tienda o de cuenta -> validation_error sin leer nada» |
| R36 | AC «R14/R36…»; IN (detalle[i].movimientoId = items[i].id / filas[i].ref.movimientoId) |
| R37 | LS «con 6 y con 40 movimientos de los mismos conceptos y cierres, las MISMAS llamadas»; «… tramos de TRAMO_CIERRES_LOTE…»; FM (config) |
| R38 | AC «R38…» (caja y estado de cuenta, hoja «movimientos», detalle no pedido); IN «R39/R40…» (tope 1 ⇒ hoja «movimientos») |
| R39 | LS «total > tope -> limite_excedido…», «frontera: total == tope SI…», «el conteo suma por MOVIMIENTO…»; AC «R39…»; IN «R39/R40…» (tope 5 con 6 filas) |
| R40 | LS (cero `listarAportesDeCierres`/`cabecerasDeCierres`); IN (espía sobre el repositorio REAL: cero lecturas de órdenes) |
| R41 | VH «R41: … una sola hoja, con el mismo nombre, columnas y celdas…», «csv sin hojas adicionales…», «buildXlsxRows delega…»; suites `tests/components/descarga/**`, `DescargarDataset`, `OrdenesCargaPreview`, `OrdenesDescarga`, `tests/unit/analytics/**` en verde (202 archivos, 2496 tests) |
| R42 | VH «R42: …» (choque sin distinguir mayúsculas, >31 caracteres, sufijos) |
| R43 (servidor) | LS «el cierre de origen que no existe falla ruidoso», «un id que no vuelve del libro de esa tienda… falla» |
| T3 | FM (cada rama de `fuenteDeMovimiento`); suites de la 344/458-D en verde (`wallet-detalle-movimiento`, `wallet-tienda-detalle-movimiento`, IN `detalle-movimiento-cierre-postgres`, `estado-cuenta-servidor-458d`) |
| Composition root | CR (las tres acciones reales construyen sus orquestadores con `WalletService`/`EstadoCuentaService` y `DetalleEnLoteService(CierreAporteRepository, WalletTiendaMovimientoRepository)`) |

Frontend (T2, T7–T10): R1–R4, R6, R8, R9, R11, R13 (en el cliente), R15–R17, R19, R25–R28, R44, y la parte
de pantalla de R5, R16, R23, R30, R31, R39, R43.

## Mutaciones (todas medidas, todas muertas)

Arnés con autocomprobación (`scratchpad/mutar.py`, no commiteado): exige la base en verde y sin
`skipped` (28 tests: 22 unitarios + 6 de Postgres), aplica cada mutación solo si el texto casa EXACTAMENTE
una vez, comprueba que el archivo cambió, corre LS + IN, restaura y verifica byte a byte; corre la base
otra vez al final (verde).

| Mutación | Resultado | Rojo en |
| --- | --- | --- |
| M1 sin `cierreId` en la gestión del `WHERE` (correlación) | MUERTA (3) | IN «hechos del escenario», IN caja diferencial, IN R39/R40 |
| M2 sin `tiendaId` en `buildWhere` | MUERTA (3) | IN oficina, IN `/mi-wallet`, IN hechos |
| M3 lote: gestiones de todos los cierres del tramo | MUERTA (4) | IN T4 equivalencia, IN hechos, IN caja, IN oficina |
| M4 cuadre: la suma no acumula | MUERTA (7) | LS R22/R23, IN caja/oficina/`/mi-wallet` |
| M5 `cuadra: true` siempre | MUERTA (2) | LS R23, LS «sin ordenes… no cuadra» |
| M6 sin guard de acceso total | MUERTA (2) | LS R32 ×2 |
| M7 sin guard de rol tienda | MUERTA (1) | LS R33 |
| M8 relectura del ledger sin `tiendaId` | MUERTA (1) | IN `/mi-wallet` (ids de B con la tienda A) |
| M9 sin tope del detalle | MUERTA (3) | LS R39 ×2, IN R39/R40 |
| M10 filtro por movimiento: órdenes de cualquier cierre del concepto | MUERTA (4) | LS orden, IN caja/oficina/`/mi-wallet` |
| M11 `tiendaId` ignorado al leer filas | MUERTA (3) | LS R34, IN oficina, IN `/mi-wallet` |
| M12 `tiendaId` ignorado al contar | MUERTA (2) | LS R34 ×2 |

No-vacuidad: IN afirma conteos exactos del escenario (flete C1 = 4, C2 = 2; tienda A 3/1; ≥ 8 movimientos
con reparto en caja y oficina; > 20 filas comparadas en T4) y no tiene ningún `if (!x) return;`. Corre
contra el Postgres local (`.env`), dentro de `enTransaccionRevertida459` (no deja datos). La caja se aísla
fechando los movimientos del feed en marzo de 2035.

## Verificación (salida real)

Gate COMPLETO `./init.sh` (el diff toca `lib/types/`), en secuencia, sin mutaciones en curso, en
`progress/gate_464_backend.log` (sin `tail`, `INIT_EXIT` dentro):

```
✓ feature_list.json: sin ids duplicados (461 fichas), cupo por zona respetado (in_progress=1) y specs en su sitio
✓ typecheck paso
✖ 220 problems (0 errors, 220 warnings)   (los mismos 220 previos; ninguno en archivos de la 464)
✓ lint paso
✓ DATABASE_URL resuelta: los 326 archivos de tests contra Postgres SI se ejecutan
 FAIL  tests/integration/recuperar-contrasena-form.test.tsx > … > R10: pulsar el ojito no restablece nada ni pierde lo tecleado
 Test Files  1 failed | 2357 passed (2358)
      Tests  1 failed | 32743 passed | 26 skipped (32770)
✗ hay rojos NUEVOS respecto del baseline
INIT_EXIT=1
```

El único rojo es AJENO a la 464 (formulario de recuperar contraseña, componente de UI; en el log, un
`toHaveValue` que no llega bajo carga y un `SASL … password must be a string` de una acción sin `.env`
en ese test). Repetido AISLADO tres veces: `Tests 11 passed (11)` ×3. La 464 no toca nada de ese
módulo. Los 26 `skipped` son los de siempre (`AnaliticaPage` 17 + `AnaliticaShell` 9); ningún archivo de
`tests/integration/db` saltado. Los seis archivos de la 464 corren en el gate:

```
✓ tests/integration/db/detalle-en-lote-464.test.ts (6 tests)
✓ tests/unit/utils/descarga-varias-hojas-464.test.ts (10 tests)
✓ tests/unit/actions/libro-con-detalle-464.test.ts (15 tests)
✓ tests/unit/services/detalle-en-lote-464.test.ts (22 tests)
✓ tests/unit/actions/libro-con-detalle-464.composition-root.test.ts (2 tests)
✓ tests/unit/utils/fuente-de-movimiento-464.test.ts (4 tests)
```

**Veredicto:** el backend de la 464 (T1, T3–T6) está hecho y verde. El gate completo marca un rojo ajeno,
que en aislado sale verde 3 de 3. Queda el frontend (T2, T7–T10, T11/T12) en esta rama.


---

# FRONTEND (T2, T7–T11; T12 abajo) — frontend_dev

Rama `fe/464` desde `origin/feature/464-wallets-excel-por-orden @ e393a799`; se empuja a esa misma rama.
Búsqueda de código: el MCP `codebase-memory` estaba en el conjunto de herramientas, pero cada archivo
tocado lo nombraba el design/impl y se leyó entero directamente (no hizo falta el grafo).

## Archivos

Creados (código):
- `components/shared/descarga-con-detalle.ts` — `enlazarHojas` (numera «N.º», enlaza cada orden con el
  número de SU movimiento, pone el texto de estado; un detalle huérfano o un movimiento sin su detalle
  LANZA: sin archivo, R36) y `EntradaFilaDetalle`.
- `components/shared/wallet/detalle-por-orden-descarga.ts` — textos de la hoja y de las dos opciones,
  columnas fijas `N.º` / `Detalle por orden`, `DETALLE_POR_ORDEN_COMUN` y `textoDetallePorOrden`
  («N órdenes», el aviso de R23 con la `suma` del servidor, o el motivo con el diccionario del panel).
- `app/(app)/wallet/tiendas/_components/estado-cuenta-tienda-descarga-columnas.ts` (R26) y
  `app/(app)/mi-wallet/_components/mi-estado-cuenta-descarga-columnas.ts` (R27): catálogo, ámbito,
  proyección y `DETALLE_DESCARGA_*` de cada superficie. Nombre `*-descarga-columnas.ts` a propósito: la
  guardia de columnas sensibles descubre por ese sufijo y ejecuta las proyecciones con su sonda (R30).

Modificados (código):
- `components/shared/DataTable.tsx` — `DataTableDescargaDetalle`, `detalle?`, `obtenerFilas(opciones?)`,
  `filasDetalle?` en el `ok`. El ámbito del detalle se tipa con `Required<Pick<…>>` (la guardia de ámbitos
  lee el árbol como texto).
- `components/shared/DescargarDatasetButton.tsx` — con `detalle` (y ámbito en la principal): selector con
  «Hojas del archivo» (R6, arranca con el detalle y no se guarda, R8) y «Columnas de la hoja» (R11, cada
  hoja su ámbito); fijas fuera del catálogo (R17); xlsx forzado con detalle (R12); sin `filasDetalle` ⇒
  aviso y sin archivo. Sin `detalle`, `obtenerFilas()` sin argumentos y el mismo control (R41).
- `components/shared/descarga-resultado.ts` — `mensajeLimiteDetalle` (R39).
- `app/(app)/wallet/_components/wallet-ledger-descarga-columnas.ts` — ámbitos de la caja, catálogo R25,
  `filaDetallePorOrdenCaja`, `DETALLE_DESCARGA_WALLET_CAJA`.
- `app/(app)/wallet/_components/WalletLedger.tsx` — `ambitoColumnas` + `detalle` en la descarga.
- `app/(app)/wallet/_components/WalletModule.tsx` — `listarConAutoriaYDetalle` (UNA petición a
  `listarMovimientosCompletoConDetalleAction` con `inputDeLibro`, autoría en tramos como hoy,
  `enlazarHojas`; `limite_excedido` por `hoja`); «Solo los movimientos» = la descarga de siempre. Y m9 de
  la 463 (ver `progress/impl_463.md`).
- `components/shared/estado-cuenta/EstadoCuenta.tsx` — prop REQUERIDA `descargaDeLaSuperficie`
  (`{ ambitoColumnas, detalle? }`, asignada en cada superficie); `LectorEstadoCuenta.leerCompletoConDetalle?`
  (lo da `lectorDeLaCuenta` solo con `tipo === "tienda"`, y `LECTOR_MI_TIENDA`); `filasDelPeriodoConDetalle`
  (las mismas líneas que `filasDelPeriodo`, saldo inicial sin número en su sitio; el enlace es
  `ref.movimientoId` del libro de la tienda, igual que `idsDeTienda` del servidor).
- `components/shared/estado-cuenta/estado-cuenta-descarga-columnas.ts` — los 4 ámbitos de la hoja de
  movimientos de los estados de cuenta (uno por superficie).
- Superficies: `EstadoCuentaTienda.tsx` y `MiEstadoCuenta.tsx` (ámbito + detalle), `EstadoCuentaMensajero.tsx`
  y `EstadoCuentaSatelite.tsx` (solo ámbito, R7).
- Listados (T10): `SaldosTiendasTable.tsx`, `CuentasPorPagarTable.tsx`, `SaldosSatelitesTable.tsx` +
  `AMBITO_DESCARGA_*` en su `*-descarga-columnas.ts`.
- `lib/actions/wallet.ts`, `lib/actions/estado-cuenta.ts` — **borradas las tres `@sin-superficie`** (solo
  el docstring; ninguna línea de código del servidor cambia).

Tests creados: DD `tests/components/descarga/DescargarDatasetDetalle464.test.tsx` (13), DP
`tests/unit/descarga/detalle-por-orden-464.test.ts` (20), CJ4 `tests/components/WalletCaja464.test.tsx` (8),
EC4 `tests/components/EstadoCuenta464.test.tsx` (7), LI4 `tests/components/descarga/WalletListados464.test.tsx`
(6), fixture `tests/fixtures/descarga-detalle-por-orden.ts` (textos del selector A MANO + «elegir Solo los
movimientos»). Todos los archivos se releen con exceljs (lo que se baja, no lo que el control dice).

Tests existentes tocados, sin borrar nada:
- `WalletDescarga.test.tsx` (×5), `WalletCaja463.test.tsx` (R42), `WalletFiltroAQuien458E.test.tsx`,
  `WalletLibroCaja458E.test.tsx`: miden la descarga de SIEMPRE, que ahora es la opción «Solo los
  movimientos» (R8 arranca con el detalle) ⇒ eligen esa opción antes de descargar (`elegirSoloLosMovimientos`).
  Sus aserciones no cambian.
- `EstadoCuenta.test.tsx`, `EstadoCuenta458DPantalla.test.tsx`, `EstadoCuenta463.test.tsx`,
  `EstadoCuentaAnulados.test.tsx`: montan `EstadoCuenta` a pelo y la prop nueva es REQUERIDA ⇒ un ámbito de
  prueba.
- `tests/unit/components/datatable-descarga-contrato.test.ts`: la guardia de «tabla sin dominio» se AMPLÍA
  (no se relaja): miembros + `detalle`, la firma de `obtenerFilas` fijada entera (`(opciones?: { conDetalle:
  boolean })`), y los miembros de `DataTableDescargaDetalle` enumerados.
- `WalletCaja463.test.tsx`: además, m9/m10/m11 de la revisión de la 463.

Decisiones técnicas (anotadas, no preguntadas):
1. **R4 con el detalle por defecto.** Con «Movimientos y detalle por orden» la hoja de movimientos lleva
   «N.º» delante y «Detalle por orden» detrás (R15/R16 lo exigen); ENTRE ellas, las columnas, encabezados
   y orden de siempre. Con «Solo los movimientos», la hoja es idéntica a la de antes. Así se leen R4 y R8 a
   la vez; los tests afirman las dos cosas.
2. El ámbito de la principal es condición del detalle: sin él, `detalle` no se ofrece (test DD R41 «sin el
   ámbito»). Todas las superficies con detalle lo declaran.
3. La opción de la hoja principal en «Columnas de la hoja» se rotula con el `titulo` de esa hoja (el control
   común no conoce «Movimientos»).
4. `N.º` sale como número (celda numérica); los montos siguen como texto (decisión del spec).
5. La hoja principal del estado de cuenta conserva el nombre saneado de siempre (31 caracteres:
   «Estado de cuenta de Tania Tien…»); el de la hoja de detalle es «Detalle por orden».
6. T11: `censo-tablas` y la guardia de columnas sensibles no necesitaron cambios (ninguna tabla nueva; los
   dos módulos nuevos `*-descarga-columnas.ts` entran solos y pasan la sonda). Las tres constantes
   `COLUMNAS_DESCARGA_DETALLE_POR_ORDEN_*` tienen su aserción de orden nombrada (DP).

## Mapa R1–R44 → test (completo; el de backend arriba se mantiene, aquí se cita por sus siglas VH/FM/LS/AC/CR/IN)

| R | Test |
| --- | --- |
| R1 | CJ4 «R1/R6/R8»; EC4 «R6: la tienda y /mi-wallet…» y «R1/R7: el mensajero y la bodega…»; LI4 «R1/R7…» ×3 |
| R2 | DP «R2 — un ámbito propio…» (11 literales distintos); DD «R2/R3/R11» (escribe SOLO en el ámbito del detalle); EC4 «R2/R4» (mensajero ≠ bodega); LI4 «R2/R3» ×3; `ambito-columnas.guardia` (unicidad) |
| R3 | DD «R2/R3/R11», DD «R3: reordenar…»; LI4 «R2/R3» ×3 |
| R4 | DP «R4: el catálogo de la caja…»; CJ4 «R4/R10/…» y «R9/R13»; EC4 «R2/R4» y «R4/R9»; LI4 «R1/R7… R4» ×3 (ver decisión 1) |
| R5 | DP «R5: en /mi-wallet…»; EC4 «/mi-wallet con «Más antiguas»… sin mensajero»; LS/IN (servidor) |
| R6 | DD «R6/R8»; CJ4 «R1/R6/R8»; EC4 «R6» |
| R7 | EC4 «R1/R7»; LI4 «R1/R7» ×3; AC «R7» (servidor) |
| R8 | DD «R6/R8», DD «R8: la opción NO se recuerda…»; CJ4 «R1/R6/R8»; EC4 «R6» |
| R9 | DD «R9/R13»; CJ4 «R9/R13»; EC4 «R4/R9»; `WalletDescarga`/CJ «R42»/458-E (la descarga de siempre, vía «Solo los movimientos») |
| R10 | DD «R10/R15/R16/R17»; CJ4 «R4/R10/…»; EC4 «tienda (oficina)…»; VH «R10» |
| R11 | DD «R17… R11» y «R2/R3/R11» |
| R12 | DD «R12»; VH «R12» |
| R13 | DD «R9/R13» (`obtenerFilas({ conDetalle: false })`); CJ4 «R9/R13» (cero llamadas con detalle); EC4 «R4/R9» (ídem en tienda y /mi-wallet) |
| R14 | DP «R14»; CJ4 «R10/R14/R36…» (misma entrada que la de siempre); EC4 «tienda (oficina)…» (saldo inicial en su sitio); IN/AC «R14/R36» |
| R15 | DP «R15/R19/R20» y «R15: la línea del saldo inicial…»; EC4 tienda (última, sin número) y /mi-wallet (primera, sin número) |
| R16 | DP «R16/R23»; CJ4 «R4/R10/…» (texto del panel de la caja); EC4 tienda |
| R17 | DD «R17: las columnas fijas no están…» y «R2/R3/R11» (siguen saliendo) |
| R18 | IN (servidor); DP «R15/R19/R20» (una fila por orden, ninguna más) |
| R19 | DP «R15/R19/R20»; CJ4 (detalle con N.º 1, 1, 3); EC4 tienda (N.º 2) |
| R20 | DP «R15/R19/R20»; LS/IN (servidor) |
| R21 | IN diferencial ×3 (servidor) |
| R22 | IN/LS (servidor); CJ4 (12.50 + 17.50 = 30.00, «2 órdenes») |
| R23 | DP «R23»; CJ4 (fila 3: «1 orden. La suma de las órdenes es 4.00 y no coincide…»); LS «R23» |
| R24 | DP «R24»; DD «R24»; VH «R24» |
| R25 | DP «R25» (literal); CJ4 (cabecera de la hoja de detalle) |
| R26 | DP «R26» (literal); EC4 tienda (cabecera de la hoja de detalle) |
| R27 | DP «R27» (literal) |
| R28 | DP «R28…»; CJ4 (Fecha/Movimiento del detalle = celdas de su fila); EC4 tienda |
| R29 | IN «R29» (servidor); DP «R28…» (la proyección emite lo del DTO congelado) |
| R30 | DP «R30»; `columnas-sensibles.guardia` (sonda sobre `filaDetallePorOrden*`); LS (servidor) |
| R31 | DP «R28…» («1234.50» tal cual); CJ4 («12.50»); EC4 («10.00») |
| R32 | LS «R32» ×2 (servidor) |
| R33 | LS «R33» (servidor) |
| R34 | IN/LS (servidor); EC4/DP (sin columna «Tienda» en tienda y /mi-wallet) |
| R35 | AC «R35» (servidor); EC4 /mi-wallet (`{ sortBy, sortDir }`, ninguna cuenta viaja) |
| R36 | DP «R36»; DD «R36: …sin las filas del detalle…»; CJ4 (una sola llamada); EC4 tienda; AC/IN |
| R37 | LS «con 6 y con 40 movimientos…» (servidor) |
| R38 | CJ4 «R38»; AC «R38» |
| R39 | DP «R39/R44»; CJ4 «R39»; EC4 «R39/R43»; LS/AC/IN |
| R40 | LS/IN (servidor) |
| R41 | DD «R41» ×2; `tests/components/descarga/**` y `tests/unit/descarga/**` en verde; `datatable-descarga-contrato` ampliada; VH «R41» |
| R42 | VH «R42»; EC4 (nombre saneado de la principal + «Detalle por orden») |
| R43 | DD «R43»; CJ4 «R43» ×2 (lanza; autoría ilegible); EC4 «R39/R43» |
| R44 | DP «R44» (todos los textos nuevos, sin «SLA») y «R39/R44» |

## Mutaciones del frontend (arnés de un solo uso con autocomprobación: el archivo CAMBIÓ, restauración byte a byte, base verde antes y después: 54/54)

| # | Mutación | Resultado |
| --- | --- | --- |
| M1 | el selector arranca SIN detalle | **Muerta** (19 rojos) |
| M2 | la hoja de detalle sin «N.º» | **Muerta** (6) |
| M3 | csv permitido con detalle | **Muerta** (1) |
| M4 | la caja con detalle llama al completo de siempre | **Muerta** (4) |
| M5 | el saldo inicial se numera | **Muerta** (2) |
| M6 | numeración sin incrementar | **Muerta** (6) |
| M7 | un detalle huérfano no falla | **Muerta** (1) |
| M8 | el tope del detalle con el aviso de siempre | **Muerta** (1) |
| M9 | `/mi-wallet` sin `leerCompletoConDetalle` | **Muerta** (3) |
| M10 | la oficina-tienda sin `leerCompletoConDetalle` | **Muerta** (4) |
| M11 | «no cuadra» se calla | **Muerta** (2) |
| M12 | un listado sin ámbito | **Muerta** (2) |

## Verificación (salida real)

Gate COMPLETO `./init.sh` en `progress/gate_464_frontend.log` (sin `tail`, `INIT_EXIT` dentro), sin
mutaciones ni dev server en curso. Un primer intento cayó en el typecheck (dobles de test con
`"entregada"`, que no es un `GestionResultado`; corregido en `f8fc8385`); el log es el del segundo:

```
✓ typecheck paso
✖ 220 problems (0 errors, 220 warnings)   (los mismos 220 de antes)
✓ lint paso
✓ DATABASE_URL resuelta: los 326 archivos de tests contra Postgres SI se ejecutan
 FAIL  tests/components/OrdenesDescarga.test.tsx > … > el nombre del archivo identifica el listado y la fecha
 FAIL  tests/components/OrdenesDescargaColumnas.test.tsx > … > R34 — con preferencia guardada NO cambian el nombre del archivo…
 Test Files  2 failed | 2361 passed (2363)
      Tests  2 failed | 32798 passed | 26 skipped (32826)
INIT_EXIT=1
```

Los dos rojos son AJENOS y de RELOJ: esperan `ordenes-2026-10-02.xlsx` y el generador da
`ordenes-2026-10-01.xlsx`. El test calcula «hoy» con la hora LOCAL de la máquina (UTC−5) y el nombre del
archivo usa el día de Costa Rica (UTC−6): entre las 00:00 y las 01:00 locales los dos días difieren, y el
gate corrió justo en esa hora (~05:30–06:00 UTC). Ni el test ni `nombreArchivoDescarga` los toca la 464.
Repetidos AISLADOS a las 06:07 UTC: `Tests 23 passed (23)` ×3. El rojo ajeno conocido
(`tests/integration/recuperar-contrasena-form.test.tsx`) salió VERDE en esta corrida (11/11). Los 26
`skipped` son los de siempre (`AnaliticaPage` 17 + `AnaliticaShell` 9); ninguno de `tests/integration/db`.
Los once archivos de la 464 corren en el gate y pasan (6 backend + 5 frontend, 113 tests).

### La app, vista (dev server propio en :3014 sobre este worktree, maestro local `maestro.qa464@ordenex.test`)

Playwright (script en el scratchpad, no en el árbol) descargó de verdad y releyó cada `.xlsx` con exceljs.

- **`/wallet`**: el selector arranca en «Movimientos y detalle por orden · dos hojas» (`aria-checked=true`).
  Archivo: **2 hojas**, «Libro de movimientos» (36 filas) y «Detalle por orden» (26). Cabecera de
  movimientos `N.º · Fecha · Movimiento · Motivo y origen · A quién · Entra o sale · Monto · Dueño ·
  Registró · Detalle por orden`; la de detalle, la de R25. 36 movimientos numerados, **0 filas de detalle
  con un «N.º» inexistente**. De los 10 movimientos con filas de detalle, **10 cuadran** (Σ órdenes =
  monto). Hay 12 movimientos de cierre con reparto y 0 órdenes: su celda dice «0 órdenes. La suma de las
  órdenes es 0.00 y no coincide con el monto del movimiento.» (los cierres viejos sin datos congelados que
  ya explica `DETALLE_MOVIMIENTO_VACIO`). Los sin reparto dicen el motivo del panel (p. ej. COD recaudado:
  «Este importe es la suma de lo que ese mismo cierre le acreditó a cada tienda…»).
  Con «Solo los movimientos»: **1 hoja** (36 filas) con las 8 columnas de siempre.
- **`/wallet/tiendas/773e9313-…` (Tania)**: 2 hojas, «Estado de cuenta de Tania Tien…» (28 filas: 27
  movimientos numerados + «Saldo inicial» SIN número) y «Detalle por orden» (40). 0 huérfanas. De 14
  movimientos con detalle, **13 cuadran** y 1 no: el N.º 25 (COD del cierre QA del 2026-08-12, abono
  124100.00, Σ de sus 6 órdenes 136600.00), y su celda lo dice: «6 órdenes. La suma de las órdenes es
  136600.00 y no coincide con el monto del movimiento.» (R23; es el mismo cierre de datos QA anteriores al
  congelado que cita `DETALLE_MOVIMIENTO_VACIO`). Con «Solo los movimientos»: 1 hoja, las 10 columnas de
  siempre.
- Un aviso de la ficha SF-001 («Confirmá el SINPE de GAM») tapaba `/wallet` en local: se cerró con
  «Ahora no»; no es de la 464.

Servidor bajado y `dev464.log` borrado. El maestro `maestro.qa464@ordenex.test` queda en la base LOCAL.

**Veredicto:** frontend de la 464 (T2, T7–T12) hecho; R1–R44 mapeados; gate completo con 2 rojos ajenos de
reloj (verdes aislados 3/3); en la app, las dos descargas con detalle enlazan y cuadran (o lo dicen).
