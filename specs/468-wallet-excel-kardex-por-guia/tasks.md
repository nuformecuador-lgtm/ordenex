# Ficha 468 — Tareas

> Zona `fullstack`: se secuencia **backend (T1–T9) → frontend (T10–T15)**, con `backend_dev` y
> `frontend_dev`. `[P]` = puede ir en paralelo con las demás `[P]` de su mismo bloque, una vez cumplidas
> sus dependencias.
> Gate: **`./init.sh` completo** (toca `lib/types/` y archivos con nombre de dinero: el modo rápido se
> niega solo). Un commit por tarea: `feat(468): …` / `test(468): …`.
> Antes de empezar: worktree desde el SHA de `dev` que dé el leader (`checkout --detach` + merge-base). Si
> la 467 ya está mergeada, partir de ese `dev`.

## Bloque 0 — Medición (sin código)

- [ ] **T1** Medir en producción, en solo lectura y con el MCP de Supabase, las consultas 1 y 2 de
  `design.md §9.2` (`pago_devengado` contra Σ `pago_mensajero` y `cod_recaudado` de la tienda contra Σ
  `monto_recibido`).
  - **Hecho:** los dos números (movimientos / cuadran / importe) anotados en `progress/impl_468.md`. Si
    alguno no da el 100 %, se avisa al leader ANTES de T3, con los cierres que no cuadran.
  - Depende de: —

## Bloque A — Backend

- [ ] **T2** [P] Generador común: `formato: "monto"` en `DescargaColumna`, `filasDestacadas` en
  `DescargaConfig`/`DescargaHoja`, `celdaMonto` en `lib/utils/xlsx-monto.ts` con la comprobación de la
  vuelta y `numFmt` `#,##0.00`, y la negrita en `buildXlsxLibro` (`design.md §5`).
  - **Hecho:** unitarios de `celdaMonto` (9999999999.99, −1500.00, 0.10, «abc» → texto, «1.5» → texto).
    Releer con exceljs un libro con una columna `monto`: la celda es `number`, `toFixed(2)` es igual al
    texto de entrada, `numFmt` es correcto y las filas destacadas van en negrita (R22, R23, R47). Las
    suites de descarga existentes siguen verdes, y un libro sin `formato` ni `filasDestacadas` es
    idéntico al de antes (R59). Guardia `xlsx-monto-unico.guardia.test.ts` con su contraprueba. CSV con
    `formato` sigue saliendo como texto (R58).
  - Depende de: —

- [ ] **T3** Catálogo de reparto (`design.md §2`): `FuenteDeAporte.snapshot_gestion`, los criterios
  `CRITERIO_PAGO_MENSAJERO` / `CRITERIO_INDEMNIZACION`, `exigePagoMensajero` / `exigeIndemnizacion`,
  `satisfaceCriterio`, `aporteDeOrden` con `acumularCampo`, `FUENTE_CAJA` y `FUENTE_MENSAJERO` según la
  tabla §2.1, retirada de `suma_del_libro_por_tienda` y `otro_productor` y nuevo texto de
  `snapshot_del_cierre` en los dos diccionarios (sin «snapshot» visible).
  - **Hecho:** el test de equivalencia de la 344 está ampliado y verde, y una mutación (quitar
    `exigePagoMensajero` del predicado) lo pone rojo. Los unitarios de `aporteDeOrden` cubren una orden
    con dos gestiones (suma) y una gestión con `pago_mensajero` NULL. El unitario de `fuenteDeMovimiento`
    cubre que la indemnización con origen `orden_incidente` sigue `no_nace_de_un_cierre`. Test de textos:
    ningún motivo contiene «snapshot», «productor», «ledger» ni «feed» (R19).
  - Depende de: T1

- [ ] **T4** Repositorio de aportes: `buildWhere` con `pagoMensajero > 0` / `indemnizacion > 0` y los
  selects de gestiones con `pagoMensajero` e `indemnizacion` (`CierreAporteRepository`). Repositorio nuevo
  `IMovimientosMensajeroEnLoteRepository` + su implementación con el mensajero en el `WHERE`. `clave`
  (id de la orden) en `OrdenAporteEnLoteRow` → `OrdenDelLoteDTO`.
  - **Hecho:** integración contra Postgres (`tests/integration/db/`) con un fixture que afirma primero
    N > 0 gestiones con pago, con pago 0 y con indemnización. Para el cierre del fixture, Σ aportes de
    `pago_mensajero` = `total_pago_mensajero` y Σ indemnización = el egreso. Dos mutaciones («quitar
    `pagoMensajero > 0`» y «quitar la correlación del cierre») deben ponerlo rojo. Un movimiento de otro
    mensajero no vuelve de `listarPorIdsDeMensajero`.
  - Depende de: T3

- [ ] **T5** [P] Kardex de las cuentas (`design.md §3.1–§3.3`): `lib/types/libro-kardex.ts`,
  `columnaDeCuenta` y `kardex` en `leerCompleto` / `leerMiTiendaCompleto`, con `conOtrosFiltros` y la
  afirmación de cuadre con `derivarBalance`.
  - **Hecho:** unitarios de `columnaDeCuenta` en las tres cuentas. En la bodega, `declarado` va a `entra`
    porque sube el pendiente (R9). Integración contra la base por cuenta (tienda, mensajero, bodega): sin
    otros filtros, cada `saldo` es igual al anterior + entra − sale y el último es igual a `saldoFinal`
    (R11, R13, R15). Con chip, `conOtrosFiltros = true` y los totales suman solo las filas devueltas
    (R16). Una mutación del mapeo de la bodega lo pone rojo.
  - Depende de: T2 (tipos de monto, solo por contrato)

- [ ] **T6** [P] Kardex de la caja (`design.md §3.1`, `§3.4`): `columnaDeCaja`, `antesDe` en
  `agregarPorCategoriaYTipo`, `saldosTrasMovimientos` (ventana con las listas derivadas de
  `LIQUIDEZ_POR_CATEGORIA`) y `kardex` en `listarMovimientosCompleto` con la afirmación contra
  `derivarCaja`.
  - **Hecho:** unitario de `columnaDeCaja` recorriendo el SEED entero. Todo cargo va a
    `cobrado_a_tiendas`, todo reverso de cargo sale negativo y todo efectivo va a `entra`/`sale` según su
    tipo (R10). Integración contra la base: el saldo final del kardex es igual a `verResumenCaja` sin
    filtros con el mismo corte (R12, R14). El saldo inicial con `desde` es igual a `derivarCaja` de lo
    anterior. Sin `desde`, «0.00». Sin otros filtros se cumple R15 fila a fila (las filas de cargo no
    mueven el saldo). Con filtro de concepto, el saldo por fila sigue siendo el de la caja entera. Dos
    mutaciones («pasar una categoría de efectivo a la otra lista» y «quitar `created_at` del `ORDER BY`
    de la ventana») deben ponerlo rojo.
  - Depende de: T2

- [ ] **T7** Lote: superficie `mensajero_oficina` en `DetalleEnLoteService.detallar`, método `contar` (sin
  leer órdenes, R61) y `ordenesPorMovimiento`.
  - **Hecho:** unitarios del guard (`forbidden` sin acceso total, sin tocar ningún doble de repositorio,
    R55) y del tope (`limite_excedido` sin llamar a `listarAportesDeCierres`, R56). `contar` no llama a
    `listarAportesDeCierres` en ningún caso (R61). Test DIFERENCIAL de integración: para cada movimiento
    de los cuatro conceptos de R27, el lote es igual a `verDetalleDeMovimientoCompleto` /
    `verDetalleDeFilaDeCuenta` (R28).
  - Depende de: T4

- [ ] **T8** `agruparPorGuia` (`lib/utils/detalle-por-guia.ts`, `design.md §4.2`).
  - **Hecho:** unitarios con cada regla. Una guía en dos cierres da un bloque con dos días en `cierres`
    y la cabecera del más reciente (R38, R39). Una orden con dos gestiones. Una orden sin guía va al final
    con su remisión (R37). El orden numérico de guías funciona sin `Number` («9» < «10»). Un movimiento
    con `cuadra: false` da una `diferencia` igual a `monto − suma` (R41). Uno sin órdenes da una
    diferencia por el monto entero (R42). Uno `sin_reparto` sale exactamente una vez en `sinGuia` (R40,
    R46). `totalGeneral` es igual a `totalesHoja1` en las tres columnas (R44, R45). Una mutación que omite
    las diferencias hace saltar la afirmación.
  - Depende de: T5, T6 (tipos), T7 (`clave`)

- [ ] **T9** Orquestación y bordes: `CajaConDetalleService` y `EstadoCuentaConDetalleService.cuentaConDetalle`
  (tienda | mensajero) devuelven `kardex` + `porGuia`. El refine del borde cambia a `!== "bodega"`. Los
  completos sin detalle llaman a `contar`. Composition roots en `lib/actions/wallet.ts` y
  `lib/actions/estado-cuenta.ts`.
  - **Hecho:** test de cada acción. El orquestador recibe TODAS las dependencias reales (el repositorio
    del mensajero y el conteo incluidos). La bodega con detalle da `validation_error` sin leer (R25). La
    sesión ausente da `unauthenticated`. **Test de integración de la invariante contra la base (R45, R46,
    R53)**: por superficie (caja, tienda, mensajero, `/mi-wallet`), con un fixture que afirma primero que
    hay N > 0 movimientos repartibles, no repartibles y una diferencia forzada, el `totalGeneral` de
    `porGuia` es igual a `kardex.totales`, y cada movimiento del completo aparece en `porGuia`. Fuga entre
    tiendas: un cierre con guías de dos tiendas solo trae las propias (R48).
  - Depende de: T5, T6, T7, T8

## Bloque B — Frontend

- [ ] **T10** [P] Contrato del control: retirar `columnaEnlace`/`columnaEstado`; añadir
  `fijasPrincipal`/`fijasDetalle` y `fijas` en `ColumnasPopover` (casillas marcadas y deshabilitadas);
  `filasDestacadas*` en `DescargaFilasResult`; textos «Detalle por guía» (`design.md §6`).
  - **Hecho:** test del popover: una columna fija no se puede desmarcar y se puede reordenar (R51). Una
    preferencia guardada con claves de la 464 produce archivo y las columnas nuevas salen marcadas (R52).
    Una tabla sin `fijas` se comporta igual que antes (suites existentes verdes). Las opciones dicen
    «Solo los movimientos · una hoja» y «Movimientos y detalle por guía · dos hojas» (R24).
  - Depende de: T2

- [ ] **T11** [P] Adaptador `components/shared/wallet/libro-kardex-descarga.ts` + textos en
  `libro-kardex-labels.ts` (`design.md §7.2–§7.4`).
  - **Hecho:** unitarios de `filasKardex`. La primera fila es «Saldo al inicio del periodo» con las
    columnas de monto vacías (R5). La última con montos es «Total del periodo» con los totales y el saldo
    final del DTO, sin sumar nada (R8). El aviso de R16 sale solo con `conOtrosFiltros`, en sus dos
    variantes. Los índices destacados son los correctos (R23). Unitarios de `filasDetallePorGuia`: la
    cabecera, las filas de concepto en la columna de su movimiento, «Total de la guía», el título «Movimientos
    sin guía», las diferencias con su detalle y «TOTAL GENERAL» (R34–R36, R40–R44, R47). La composición de
    «Detalle» (R18) omite las partes vacías. La guardia money-safe de `components/shared/wallet/` sigue
    verde.
  - Depende de: T9 (tipos), T10

- [ ] **T12** Catálogos por superficie (`design.md §7.1`), con la reescritura de los tests de la 464 que
  afirmaban «N.º», «Detalle por orden», los catálogos R25–R27 y los montos como texto. Se borran
  `detalle-por-orden-descarga.ts` y `enlazarHojas` junto con sus tests, sustituidos por los nuevos.
  - **Hecho:** un `toEqual` literal por catálogo y hoja (R1, R2, R3, R29, R30, R31, R32). Test de que
    ninguna hoja 1 tiene las columnas de R4. Las columnas de monto llevan `formato: "monto"`. `/mi-wallet`
    no tiene «Registró», «Mensajero» ni «A quién» (R49). La caja usa `DUENO_LABEL` en «Es dinero de»
    (R21). Ningún test de la 464 queda borrado sin su sustituto: el mapa viejo → nuevo se anota en
    `progress/impl_468.md`. La guardia de columnas sensibles (sonda de uuid) está verde y comprueba que
    `clave` nunca sale en una celda.
  - Depende de: T10, T11

- [ ] **T13** Cableado: caja (`WalletModule`), estado de cuenta (`EstadoCuenta` y las cuatro superficies)
  con la entrada forzada a `sortBy: "fecha", sortDir: "asc"` (R7), las dos opciones (R24, R25 en la
  bodega), la autoría de la caja como hoy (R20) y `ordenes` en el Detalle en los dos modos (R57).
  - **Hecho:** test de cada superficie con dobles del borde. La descarga envía el orden ascendente aunque
    la pantalla esté en «Más recientes» (R7). Con detalle salen dos hojas en orden (R26). La hoja 1 de
    «Solo los movimientos» es idéntica celda a celda a la de la descarga con detalle (R57). La bodega no
    ofrece detalle (R25). El error de límite del detalle del mensajero muestra el aviso de la 464 (R56). La
    guardia de ámbitos (`ambito-columnas.guardia`) está verde con `wallet-mensajero-detalle-guia`.
  - Depende de: T12

- [ ] **T14** [P] Textos: barrido de los textos nuevos y de los motivos (R19, R60).
  - **Hecho:** test que recorre `libro-kardex-labels.ts`, los dos diccionarios de motivos y los catálogos:
    no contienen «SLA», «snapshot», «productor», «ledger» ni «feed».
  - Depende de: T11, T3

## Bloque C — Verificación

- [ ] **T15** Gate y la app real. `./init.sh` completo con `INIT_EXIT=$?` escrito dentro del log y los
  `skipped` revisados (los tests de `integration/db` deben haber corrido). Después, en el dev server local
  con datos sembrados, **descargar el archivo real** en la caja, en una tienda, en un mensajero, en
  `/mi-wallet` y en una bodega, con y sin detalle y con y sin un filtro de concepto, y abrirlo con exceljs.
  - **Hecho:** gate verde con 0 integración saltada. En cada archivo descargado se comprueba con números
    anotados en `progress/impl_468.md`: los montos son celdas numéricas. La fila 1 dice «Saldo al inicio
    del periodo». El saldo final es igual al de la tarjeta de esa pantalla. El «TOTAL GENERAL» de la hoja 2
    es igual a «Total del periodo» de la hoja 1 en cada columna. No queda ninguna columna de R4. Una guía
    con varios conceptos sale en un solo bloque. Capturas (Playwright) de la pantalla de descarga con las
    dos opciones y las columnas fijas deshabilitadas.
  - Depende de: T13, T14

- [ ] **T16** Medición posterior al despliegue de los seis conceptos del feed (`design.md §9.2.3`). Tarea
  del leader tras la release, no del implementer.
  - **Hecho:** se descarga en producción la caja de todo el historial con detalle. El número de filas
    «Diferencia sin repartir» queda anotado en `progress/` con su cierre y su concepto si no es 0. Si hay
    alguna, se abre una ficha con la evidencia, sin rediseñar.
  - Depende de: release

## Trazabilidad R → tarea (el test concreto lo anota el implementer en `progress/impl_468.md`)

| Requisitos | Tarea(s) |
| --- | --- |
| R1–R4 | T12 |
| R5, R8, R16, R23 | T11 (+ T5/T6 para los datos) |
| R6, R7 | T13 (+ T5/T6) |
| R9, R11, R13, R15 (cuentas) | T5 |
| R10, R12, R14, R15 (caja) | T6 |
| R17, R18, R20, R21 | T11, T12, T13 |
| R19, R60 | T3, T14 |
| R22 | T2, T15 |
| R24, R25, R26 | T10, T13, T9 |
| R27, R28 | T3, T4, T7 |
| R29–R32, R49 | T12 |
| R33–R47 | T8, T11 (R45/R46 también T9 integración) |
| R48 | T9 |
| R50–R52 | T10, T12 |
| R53, R54 | T9 |
| R55, R56 | T7, T13 |
| R57 | T13 |
| R58, R59 | T2 |
| R61 | T7, T9 |
