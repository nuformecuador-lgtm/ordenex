# Ficha 468 — Implementación, Bloque A (backend)

> Rama `feature/468-wallet-excel-kardex-por-guia`, desde `cbf02021` (dev con la 467). Spec aprobado
> (`specs/468-wallet-excel-kardex-por-guia/`). T1 medido aparte (`progress/medicion_468.md`: 100 % cuadra).
> Búsqueda de código: grafo `codebase-memory` NO disponible en este agente; se usó `grep` y lectura de
> archivos.

## Lo hecho (T2–T9)

| Tarea | Qué | Archivos |
| --- | --- | --- |
| T2 | Generador común: `formato: "monto"` (celda numérica `#,##0.00` vía `celdaMonto`, el único punto de conversión, con la vuelta comprobada) y `filasDestacadas` (negrita) en la hoja principal y en las adicionales. Sin ninguno de los dos, el archivo es el de siempre (R59); el csv no los mira (R58). Guardia `xlsx-monto-unico`. | `lib/utils/xlsx-monto.ts` (nuevo), `lib/utils/xlsx-template.ts`, `lib/utils/descarga-dataset.ts`, `lib/types/descarga.ts` |
| T3 | Catálogo de reparto: `FuenteDeAporte.snapshot_gestion` (`pago_mensajero` / `indemnizacion`), `CRITERIO_PAGO_MENSAJERO`, `CRITERIO_INDEMNIZACION`, `exigePagoMensajero`/`exigeIndemnizacion`, `acumularCampo`. Caja: contra-entrega (`cod_recaudado`, sin tienda), pago al mensajero e indemnización de cierre se reparten. Mensajero: `pago_devengado` se reparte; `pago_efectivo` NO (R43). Se retiran `suma_del_libro_por_tienda` y `otro_productor`; nuevo texto de `snapshot_del_cierre` sin «snapshot». | `lib/utils/aporte-por-orden.ts`, `lib/types/detalle-movimiento.ts`, `lib/utils/dinero-por-producto.ts` (los dos hechos nuevos en su criterio), los dos diccionarios de motivos en `app/(app)/{wallet,mi-wallet}/_components/*-labels.ts` (obligado por el `Record` total) |
| T4 | `buildWhere` con `pagoMensajero > 0` / `indemnizacion > 0` DENTRO del `gestiones.some({ cierreId })`; los selects de gestiones traen las dos columnas. Repositorio nuevo `IMovimientosMensajeroEnLoteRepository` (implementado por `EstadoCuentaRepository.listarPorIdsDeMensajero`, mensajero en el `WHERE`). | `lib/repositories/CierreAporteRepository.ts`, `lib/interfaces/repositories/IMovimientosMensajeroEnLoteRepository.ts`, `lib/repositories/EstadoCuentaRepository.ts` |
| T5 | Tipos `lib/types/libro-kardex.ts`. `kardexDeCuenta` (saldo por fila = `saldoCorrido`, inicial/final de la tarjeta) con la columna desde `sentidoDelSaldo` (nueva, la MISMA que usa `saldoAlFinal` en `EstadoCuentaService`). Afirmación R15 con `derivarBalance`. | `lib/utils/estado-cuenta-kardex.ts`, `lib/utils/libro-kardex.ts`, `lib/utils/estado-cuenta.ts`, `lib/services/EstadoCuentaService.ts` |
| T6 | `columnaDeCaja` y `CATEGORIAS_EFECTIVO` derivadas de `LIQUIDEZ_POR_CATEGORIA`; `WalletMovimientoRepository.saldosTrasMovimientos` (ventana sobre la caja entera hasta el corte, orden fecha/created_at/id); saldo inicial y final con `derivarCaja(agregarPorCategoriaYTipo({ hasta }))`. Afirmación contra la tarjeta. | `lib/utils/caja-kardex.ts`, `lib/interfaces/repositories/ISaldoCorridoCajaRepository.ts`, `lib/repositories/WalletMovimientoRepository.ts` |
| T7 | `DetalleEnLoteService`: superficie `mensajero_oficina` (guard de acceso total antes de la base, re-lectura con el mensajero en el `WHERE`, `FUENTE_MENSAJERO`, columna Tienda sí / Mensajero no), método `contar` (pasos 1–4 sin leer órdenes, R61) y `clave` (id de la orden) en `OrdenDelLoteDTO`. | `lib/services/DetalleEnLoteService.ts`, `lib/types/detalle-en-lote.ts`, `lib/interfaces/services/IDetalleEnLoteService.ts` |
| T8 | `agruparPorGuia`: bloques por guía (orden numérico sin `Number`), cabecera del cierre más reciente, filas por día y orden de la hoja 1, «Movimientos sin guía», «Diferencia sin repartir» y TOTAL GENERAL **afirmado** = total de la hoja 1 (lanza si no). | `lib/utils/detalle-por-guia.ts` |
| T9 | Orquestadores `CajaKardexService` y `CuentaKardexService` (orden FORZADO asc en el servidor, R7; conteos sin detalle / detalle con detalle; bodega con detalle → `validation_error`). Seis acciones nuevas con su composition root y `@sin-superficie` hasta que el frontend las cablee. | `lib/services/LibroKardexService.ts`, `lib/interfaces/services/I{Caja,Cuenta}KardexService.ts`, `lib/actions/wallet.ts`, `lib/actions/estado-cuenta.ts` |

## Desviaciones del spec (técnicas, decididas aquí)

1. **Clases y acciones NUEVAS en vez de cambiar las de la 464** (design §4.3 decía devolver `kardex` desde
   `listarMovimientosCompleto` y renombrar `tiendaConDetalle`). Motivo: el bloque B va después sobre esta
   rama y el gate tiene que estar verde entre medias; cambiar la forma de los completos rompía decenas de
   dobles de test de pantalla. Los orquestadores/acciones de la 464 (`CajaConDetalleService`,
   `EstadoCuentaConDetalleService`, `listarMovimientosCompletoConDetalleAction`,
   `verEstadoCuentaCompletoConDetalleAction`, `verMiEstadoCuentaCompletoConDetalleAction`) siguen vivos:
   **el frontend debe retirarlos al cablear** (o pedirlo al backend).
2. **El orden ascendente lo fuerza el servidor** (además de que el cliente lo mande): el kardex no puede
   salir en otro orden.
3. **`ordenesPorMovimiento` no existe**: el «N guía(s)» viaja en `kardex.filas[i].ordenes` en los DOS
   modos (de los conteos sin detalle; de la hoja 2 con detalle). Una sola fuente para la hoja 1 (R57).
4. **`columnaDeCaja` vive en `lib/utils/caja-kardex.ts`**, no en `caja-tesoreria.ts` (sus guardias cuentan
   restas/exportaciones de ese módulo).
5. **Reintento acotado en la caja** (3 lecturas) cuando el kardex no cuadra: las lecturas de la caja no
   comparten transacción y un movimiento registrado entre dos de ellas descuadraría sin error de dinero
   (el mismo fallo intermitente que la 458-B cerró en el estado de cuenta con REPEATABLE READ). Si sigue
   sin cuadrar, se lanza.
6. **Commits**: T4–T9 en un solo commit (`2784aedd`) porque se compilan entre sí (constructor del lote,
   tipos); la proyección de gestiones y el `WHERE` de T4 entraron ya en el commit de T3 (lo exigía el
   compilador).
7. Comentarios con «snapshot» en `ordenes-de-fila-cuenta.ts:19` y `EstadoCuentaMensajero.tsx:64` (UI) NO se
   tocaron: son comentarios, no textos visibles; quedan para el bloque B.

## Tests de la 464/344 que afirmaban lo retirado — sustituidos (ninguno borrado sin sustituto)

| Antes | Ahora |
| --- | --- |
| `detalle-movimiento-cierre-postgres` «458-D R19: la fila de cierre del mensajero … es el total del cierre» | «468 R27/R28: la fila de pago devengado del mensajero lista sus ordenes y su Σ es el importe» |
| `detalle-movimiento-cierre-postgres` «los tres conceptos sin reparto … (R48)» | «468 R27: el contra-entrega de la caja lista sus ordenes y su Σ es el Σ monto_recibido del cierre» |
| `aporte-por-orden.test` «los tres conceptos de la caja que NO se reparten …» | «468 R27 (antes 344 R48): los tres conceptos de cierre de la caja se reparten por su columna de la gestion» |
| `fuente-de-movimiento-464.test` «concepto sin reparto → su motivo …» (3 de caja) | «468 R43 (antes 464): …» con `pago_efectivo` |
| `wallet-detalle-movimiento.test` «R48: un concepto que no se reparte …» | «468 R27/R28: … listan ordenes con su criterio» + «468 R43 (antes 344 R48): la indemnizacion que nace de un incidente sigue sin reparto» |
| `wallet-detalle-movimiento.test` «el modo completo hereda el guard …» | «468 R27 (antes 344): …» (rama sin reparto con indemnización de incidente) |
| `detalle-en-lote-464.test` (unit) «un detalle por movimiento …», «R24 … si nada tiene reparto …», «la orden sin guia … ningun id interno» | «468 R27 (antes 464): …», «R24 (servidor) + 468 R27: …», «468 (antes 464 R30): … y su `clave` de enlace» |
| `detalle-en-lote-464` (integración): el movimiento sin reparto era el pago al mensajero | ahora la indemnización de incidente (`no_nace_de_un_cierre`) |
| `DetalleMovimientoCierre.test.tsx` «R48/R49: los TRES conceptos sin reparto …» | «468 R19/R27 (antes 344 R48/R49): los DOS motivos …» |
| `detalle-por-orden-464.test` «sin reparto: el motivo …» | «468 R19 (antes 464): …» (texto nuevo) |
| `aporte-por-orden-equivalencia` «ningun hecho … ajeno a las columnas» | ampliado con los dos hechos nuevos y los tres criterios |

## Mapa R → test (backend)

| R | Test |
| --- | --- |
| R5, R8, R13 | `tests/unit/utils/libro-kardex-468.test.ts` «R11/R13/R8: …»; `tests/integration/db/kardex-cuentas-468.test.ts` «T5 …» |
| R7 | `tests/unit/services/libro-kardex-468.test.ts` «R7: el archivo SIEMPRE se lee en orden cronologico ascendente…», «R7: la oficina y /mi-wallet leen en orden ascendente…»; `kardex-cuentas-468` (filas = pantalla en asc) |
| R9 | `libro-kardex-468.test.ts` «R9: tienda y mensajero…», «R9: bodega…»; `kardex-cuentas-468` (bodega) |
| R10 | `libro-kardex-468.test.ts` «R10: efectivo → Entra/Sale…» (SEED entero) |
| R11 | `kardex-cuentas-468` (saldo = `saldoCorrido`) |
| R12, R14 | `tests/integration/db/libro-kardex-468.test.ts` «T6 R12/R14/R15…» (= `verResumenCaja` con el mismo corte; sin desde 0,00); unit «R12/R14/R61…», «R14: sin fecha de inicio…» |
| R15 | unit «R15: … LANZA», «R15 (caja)…», «R12/R15: … FALLA ruidosa», «R15: un descuadre PASAJERO…»; integración T5 y T6 (recalculado) |
| R16 | unit «R16: con otros filtros…» (caja y cuenta); integración T6 (filtro de concepto) y T5 (chip) |
| R18 (conteo) | `tests/unit/services/detalle-en-lote-468.test.ts` «R61: contar devuelve…»; integración `afirmarInvariante` («N guía(s)» = filas de concepto) |
| R19 | `tests/unit/utils/aporte-por-orden.test.ts` «R19: solo quedan dos motivos…» |
| R22, R23, R47 (generador) | `tests/unit/utils/xlsx-monto-468.test.ts`; guardia `tests/unit/guards/xlsx-monto-unico.guardia.test.ts` |
| R25 | `libro-kardex-468.test.ts` «R25: la bodega con detalle…»; `tests/unit/actions/libro-kardex-468.action.test.ts` «R25: …en el BORDE» |
| R26, R53 | unit «R26/R53/R57…»; integración T9 (una lectura devuelve kardex + porGuia) |
| R27 | `aporte-por-orden-equivalencia.test.ts` «ficha 468 — R27…» (320 celdas; mutación ejecutada); `aporte-por-orden.test.ts` «468 — R27…»; integración «T4 R27…» |
| R28 | integración «T7 R28: … el lote = el detalle de esa fila en pantalla» |
| R31, R43 | `detalle-en-lote-468.test.ts` «R27/R31/R43…»; integración «T9 R31/R43/R45 — mensajero» |
| R33–R44, R46 | `tests/unit/utils/detalle-por-guia-468.test.ts` (regla a regla); integración T9 (`afirmarInvariante`) |
| R45 | unit «R44/R45…», «R45: si la construccion se rompe…»; integración T9 en caja, tienda, mensajero y /mi-wallet |
| R48 | integración «T9 R45/R46/R48 — tienda…» |
| R49 (servidor) | integración (/mi-wallet sin «Mensajero 468»); `mensajeroNombre` null en mi_wallet |
| R54 | por construcción (todo en el servidor); unit de orquestadores |
| R55 | `detalle-en-lote-468.test.ts` «R55: … forbidden sin tocar ningun repositorio» |
| R56 | `detalle-en-lote-468.test.ts` «R56: por encima del tope…» |
| R57 | unit «R26/R53/R57…»; integración T9 (`con.kardex` = `sin.kardex` en caja y tienda) |
| R58, R59 | `xlsx-monto-468.test.ts` «R58…», «R59…» |
| R61 | `detalle-en-lote-468.test.ts` «R61: …» (dos casos); unit orquestador «… sin leer ninguna orden» |

Frontend (Bloque B): R1–R4, R6, R17, R18 (composición del texto), R20, R21, R23/R47 (índices), R24,
R29–R32, R50–R52, R60.

Mutaciones ejecutadas y revertidas (todas ROJAS): sin rama `exigePagoMensajero` (equivalencia), sin
`pagoMensajero > 0` y sin correlación con el cierre (T4), pago repartido por `montoRecibido` (T7/T9),
sin diferencias (T8 unit y T9), contra-entrega fuera de `CATEGORIAS_EFECTIVO` (T6/T9), ventana sin
`created_at` (T6/T9), lado de la bodega al revés (T5).

## Contratos para el frontend

### Acciones nuevas (Server Actions)

| Superficie | «Solo los movimientos · una hoja» | «Movimientos y detalle por guía · dos hojas» |
| --- | --- | --- |
| Caja `/wallet` | `libroCajaKardexAction(input)` (`lib/actions/wallet.ts`) | `libroCajaKardexConDetalleAction(input)` |
| Tienda / mensajero / bodega (oficina) | `estadoCuentaKardexAction(input)` (`lib/actions/estado-cuenta.ts`) | `estadoCuentaKardexConDetalleAction(input)` — tienda y **mensajero**; bodega → `validation_error` |
| `/mi-wallet` | `miEstadoCuentaKardexAction(input)` | `miEstadoCuentaKardexConDetalleAction(input)` |

- Entrada: la MISMA de los completos de hoy (`listarLibroCajaCompletoSchema`,
  `estadoCuentaCompletoSchema`, `miEstadoCuentaCompletoSchema`). El orden lo fuerza el servidor a
  cronológico ascendente (R7): mandar `sortDir: "asc"` es opcional.
- Resultados (`lib/types/libro-kardex.ts`):
  - caja: `{ status: "ok", items: (WalletMovimientoDTO & { origen })[], total, kardex }` (+ `porGuia` con
    detalle); `limite_excedido` con `hoja: "movimientos" | "detalle"`; `forbidden`; `unauthenticated`;
    `validation_error`.
  - cuentas: `{ status: "ok", estado: EstadoCuentaDTO, kardex }` (+ `porGuia`); `limite_excedido` con
    `hoja`; `no_encontrado`; `forbidden`; `validation_error`; `unauthenticated`.
- Al cablearlas: borrar su `@sin-superficie` y retirar las tres acciones con detalle de la 464 y sus
  orquestadores (`LibroConDetalleService.ts`, `ICajaConDetalleService`, `IEstadoCuentaConDetalleService`),
  junto con `components/shared/wallet/detalle-por-orden-descarga.ts` y sus tests (sustituidos, design §7.2).

### `KardexDTO` → hoja «Movimientos»

`kardex.filas[i]` está ALINEADA POR ÍNDICE con `items[i]` (caja) / `estado.filas[i]` (cuentas):

- `monto: { columna: "entra" | "sale" | "cobrado_a_tiendas", monto }` — poner `monto` en ESA clave
  (`entra` / `sale` / `cobradoATiendas`) y dejar las otras vacías. `cobrado_a_tiendas` solo aparece en la
  caja y puede ser negativo (reverso de cargo).
- `saldo` — columna «Saldo».
- `ordenes: number | null` — el «N guía(s)» del Detalle (R18; texto «1 guía» / «N guías», decisión 3 del
  humano). `null` = no repartible (no se escribe nada).
- Primera fila: «Saldo al inicio del periodo» con `kardex.saldoInicial` en Saldo y montos vacíos (R5).
- Fila final: «Total del periodo» con `kardex.totales.{entra, sale, cobradoATiendas}` y `kardex.saldoFinal`
  (R8). `cobradoATiendas` es `null` fuera de la caja.
- Si `kardex.conOtrosFiltros`: fila de aviso bajo el total (R16; variante «toda la caja» en la caja).
- Nada se suma en el cliente: todo viene del servidor.

### `DetallePorGuiaDTO` → hoja «Detalle por guía»

- `porGuia.bloques[]` (ya ordenados, R37): cabecera con `guia` (`null` → «Sin guía · remisión
  <remision>»), `remision`, `destinatario`, `tiendaNombre` (null en superficies de una tienda),
  `mensajeroNombre` (null en el mensajero y en /mi-wallet), `cierres` (ISO; pintar días CR separados por
  comas, R38), `resultados`. Luego `filas[]` (ya ordenadas): `movimientoId` (para el Concepto de ese
  movimiento, el mismo rótulo que en la hoja 1), `cierreFecha`, `resultados`, `monto` (en su columna).
  Luego «Total de la guía» con `total`.
- `porGuia.sinGuia[]` (título «Movimientos sin guía»): `tipo: "movimiento"` (Concepto del movimiento;
  Detalle = fecha del movimiento + Detalle de la hoja 1; `motivo === "snapshot_del_cierre"` en el
  mensajero = pago tomado del efectivo, R43) o `tipo: "diferencia"` («Diferencia sin repartir»; Detalle con
  `cierreFecha`, el concepto de `movimientoId`, `montoMovimiento` y `sumaGuias`).
- Última fila «TOTAL GENERAL» con `porGuia.totalGeneral` (= `kardex.totales`, ya afirmado en el servidor).
- `OrdenDelLoteDTO.clave` y todo `movimientoId` son enlaces en memoria: NUNCA a una celda.

### Generador (`construirDescarga`)

- Columnas de monto: `formato: "monto"` en su `DescargaColumna` (xlsx numérico; csv texto).
- Negritas: `filasDestacadas` (índices de fila de datos, 0 = la primera) en la hoja principal y en
  `hojasAdicionales[i].filasDestacadas`.

### Lo que cambia en la UI del detalle de una fila (R28, decisión 4)

- La caja: abrir una fila de **contra-entrega**, **pago al mensajero** o **indemnización de cierre** ya no
  responde `sin_reparto`: responde `ok` con la lista de órdenes (mismo componente que el flete). La
  indemnización que nace de un incidente sigue `sin_reparto: no_nace_de_un_cierre`.
- El estado de cuenta del mensajero: el **pago devengado** lista órdenes (con tienda); el **pago tomado del
  efectivo** sigue `sin_reparto: snapshot_del_cierre` con el texto nuevo («Es lo que se le pagó al
  mensajero con el efectivo que entregó en ese cierre; no se reparte por guía.»).
- `MotivoSinReparto` ya solo tiene `no_nace_de_un_cierre` y `snapshot_del_cierre`.
- Pendiente de UI: los comentarios con «snapshot» en `ordenes-de-fila-cuenta.ts:19` y
  `EstadoCuentaMensajero.tsx:64`; revisar que el panel del mensajero pinte la columna Tienda.

### Selector de columnas (R50–R52)

- Catálogos de la hoja 1: claves `fecha, concepto, detalle, aQuien, esDineroDe, entra, sale,
  cobradoATiendas, saldo, registro`; de la hoja 2: `guia, remision, destinatario, tienda, mensajero, cierre,
  resultado, concepto, detalle, entra, sale, cobradoATiendas` (R1–R3, R29–R32 por superficie).
- Fijas (no desmarcables, R51): hoja 1 `concepto`, montos y `saldo`; hoja 2 `guia`, `concepto` y montos.
- Ámbito nuevo `wallet-mensajero-detalle-guia`.

## Verificación (salida real)

`./init.sh` COMPLETO (el diff toca `lib/types/` y nombres de dinero), con `.env` copiado al worktree
(`progress/gate_468_backend.log`, no versionado como los demás logs de gate):

```
✓ typecheck paso
✓ lint paso
✓ DATABASE_URL resuelta: los 328 archivos de tests contra Postgres SI se ejecutan
 Test Files  2376 passed (2376)
      Tests  32947 passed | 26 skipped (32973)
✓ tests: sin rojos nuevos (0 archivo(s) rojo(s) sobre 2376 ejecutado(s), todos en el baseline conocido)
! migraciones sin down.sql: 20260814120000_ruta_optimizada_trazado 20260814140000_ruta_parada_tramo 20260814160000_ruta_tramo_vivo_at   (preexistente, ajeno)
== init OK ==
INIT_EXIT=0
```

- Los 26 `skipped` son de `tests/components/AnaliticaPage.test.tsx` (17) y `AnaliticaShell.test.tsx` (9):
  ninguno de integración. Los de la 468 corrieron: `libro-kardex-468` (6), `kardex-cuentas-468` (1),
  `detalle-en-lote-464` (6).
- La primera corrida del gate dio 4 archivos rojos, todos de esta ficha (listas cerradas de acciones y de
  bordes con origen, dobles de gestión sin las dos columnas nuevas y la guardia `caja-173-alcance`, que
  exige `SUM(w."monto")`): corregidos en `c5ea7bf0` y la segunda corrida es la de arriba.
- No hay migraciones ni tablas nuevas: la base local compartida no se tocó.

**Veredicto:** Bloque A implementado y verde con el gate completo; el Bloque B tiene sus contratos arriba.
