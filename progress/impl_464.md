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
