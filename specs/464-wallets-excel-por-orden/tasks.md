# Ficha 464 — Tareas

> Requisito previo: spec aprobado por el humano y la **463 mergeada en `dev`** para el cableado
> (T8–T10). T1–T7 no tocan nada de la 463 y pueden empezar antes.
> Zona `fullstack`: se secuencia backend (T3–T6) → frontend (T7–T10), con T1–T2 en paralelo al backend.
> Gate: `./init.sh` COMPLETO (el diff toca `lib/types/`; el modo rápido se negará).
> Mapa R→test en `progress/impl_464.md`.

## Base común (sin dominio)

- [ ] **T1 [P] — Generador de varias hojas.** `DescargaHoja` y `hojasAdicionales` en
  `lib/types/descarga.ts`; `buildXlsxLibro` en `lib/utils/xlsx-template.ts` con `buildXlsxRows`
  delegando en ella; `construirDescarga` con hojas adicionales, `throw` con csv + hojas, y
  `nombresDeHojaUnicos`.
  *Hecho:* tests unitarios releyendo el binario con exceljs: sin hojas adicionales, una hoja con el
  mismo nombre y celdas que antes (R41); con una adicional, dos hojas en orden y con nombres válidos y
  distintos, también con títulos que chocan o pasan de 31 caracteres (R42); csv + hojas ⇒ error sin
  archivo (R12). Suites `tests/unit/descarga/**` existentes en verde.

- [ ] **T2 — Control de descarga con hoja de detalle.** Depende de T1. `DataTableDescargaDetalle`,
  `obtenerFilas(opciones?)` y `filasDetalle` en `components/shared/DataTable.tsx`;
  `DescargarDatasetButton` con el `encabezado` de dos grupos de opciones, columnas fijas de enlace y
  estado fuera del catálogo, xlsx forzado con detalle.
  *Hecho:* tests de componente: sin `detalle`, mismas llamadas y mismo archivo que hoy (R41); con
  `detalle`, las dos opciones con su texto (R6), arranca con detalle y no lo recuerda al remontar (R8),
  «Solo los movimientos» llama a `obtenerFilas({ conDetalle: false })` y produce una hoja (R9, R13),
  con detalle dos hojas (R10), el selector cambia de catálogo y ámbito por hoja (R11), las columnas
  fijas no aparecen en el selector y siempre salen (R17), csv no se ofrece con detalle (R12).

## Servidor

- [ ] **T3 [P] — Decisión de fuente compartida.** Extraer `fuenteDeMovimiento` a
  `lib/utils/aporte-por-orden.ts` y hacer que `DetalleMovimientoService.resolverConjunto` la use.
  *Hecho:* tests unitarios de la función para cada rama (concepto con reparto y cierre; concepto con
  reparto sin cierre ⇒ `no_nace_de_un_cierre`; `sin_reparto` con su motivo); suites de la 344 y la
  458-D sin cambios y en verde.

- [ ] **T4 [P] — Repositorio en lote.** `contarAportesPorCierre`, `listarAportesDeCierres` y
  `cabecerasDeCierres` en `ICierreAporteRepository` / `CierreAporteRepository`, con el `OR` de
  `buildWhere` por cierre, tramos de `detalleMovimientoConfig.TRAMO_CIERRES_LOTE` (nuevo en
  `lib/config/detalle-movimiento.ts`) y gestiones filtradas a su cierre.
  *Hecho:* integración contra Postgres (`tests/integration/db`): para un fixture con dos cierres, dos
  tiendas, una orden presente en los dos cierres y una con dos gestiones, el conteo y las filas por
  cierre son iguales a `listarOrdenesQueAportan` cierre a cierre; con `tiendaId` solo salen órdenes de
  esa tienda (R34). Mutación: quitar `cierreId` de la rama de la gestión pone el test rojo (anotar el
  resultado en `progress/impl_464.md`). Comprobar que el test NO se salta sin `.env` (mirar `skipped`).

- [ ] **T5 — `DetalleEnLoteService`.** Depende de T3 y T4. Interfaz en
  `lib/interfaces/services/IDetalleEnLoteService.ts`, tipos en `lib/types/detalle-en-lote.ts`.
  *Hecho:* tests unitarios con dobles: guard antes de cualquier llamada al repositorio (R32, R33);
  `total > tope` ⇒ `limite_excedido` con conteos y CERO llamadas a `listarAportesDeCierres` (R39,
  R40); el número de llamadas al repositorio es el mismo con 1 y con 40 movimientos de los mismos
  conceptos y cierres dentro de un tramo (R37); orden de salida = orden de entrada y órdenes en
  `ORDEN_TOTAL` (R20); `suma`/`cuadra` con Decimal, incluido un caso forzado que no cuadra (R22, R23);
  `tiendaNombre`/`mensajeroNombre` nulos donde toca (R5).

- [ ] **T6 — Orquestación y acciones.** Depende de T5 y de los esquemas de la 463.
  `LibroConDetalleService` y las tres acciones de `design.md §2.3` con `limite_excedido.hoja`.
  *Hecho:* tests de borde: `.strict()` rechaza `tiendaId`/`cuenta` en `/mi-wallet` sin leer (R35); la
  acción de la oficina rechaza `cuenta.tipo` distinto de `tienda`; un `limite_excedido` del completo
  pasa tal cual con `hoja: "movimientos"` (R38); el composition root pasa las tres dependencias
  reales (test que lo afirma). Integración DIFERENCIAL: para cada movimiento del fixture de T4, el
  detalle del lote = el de `verDetalleDeMovimientoCompleto`, `verDetalleDeMiMovimientoCompleto` y
  `verDetalleDeFilaDeCuenta` (R21), y la suma de cada uno = su monto (R22); los movimientos del `ok`
  son los mismos y en el mismo orden que los del completo sin detalle con los mismos filtros (R14, R36).

## Cliente

- [ ] **T7 [P] — Adaptador y catálogos.** `components/shared/descarga-con-detalle.ts`
  (`enlazarHojas`), `mensajeLimiteDetalle` en `descarga-resultado.ts`, los catálogos de detalle y los
  ámbitos de `design.md §5.2`.
  *Hecho:* tests unitarios: numeración desde 1 en el orden recibido y saldo inicial sin número (R15,
  R19); texto de «Detalle por orden» por cada estado, leído de las fuentes de etiquetas (R16, R23,
  R28); hoja de detalle vacía con encabezados (R24); catálogos de detalle afirmados con `toEqual`
  literal (R25, R26, R27); «Fecha» y «Movimiento» iguales a la fila principal (R28); montos como el
  texto del servidor (R31); sonda de uuid sobre todas las proyecciones (R30); `/mi-wallet` sin
  columnas con nombres de Ordenex (R5); mensaje de R39 con total, tope y qué hacer.

- [ ] **T8 — Caja.** Depende de T2, T6, T7 y de la 463 en `dev`. `WalletLedger`/`WalletModule`:
  `ambitoColumnas`, `detalle` y `obtenerFilas({ conDetalle })` sobre `inputDeLibro`.
  *Hecho:* test de componente con dobles de acción: sin tocar el selector, columnas de hoy (R4); con
  detalle, una sola llamada a la acción con detalle y los filtros, término y orden vigentes (R14, R36);
  sin detalle, cero llamadas a ella (R13); error de lectura ⇒ aviso y sin archivo (R43).

- [ ] **T9 — Estado de cuenta.** Depende de T2, T6, T7 y de la 463. `EstadoCuenta` recibe
  `descargaDeLaSuperficie`; lectores de tienda (oficina) y `/mi-wallet` con `leerCompletoConDetalle`;
  mensajero y bodega solo con ámbito.
  *Hecho:* tests de componente: tienda y `/mi-wallet` ofrecen el detalle, mensajero y bodega no (R6,
  R7); la línea del saldo inicial sin número en la posición que dicta el orden (R15); las cuatro con
  su ámbito y sus columnas de hoy por defecto (R1, R2, R4).

- [ ] **T10 [P] — Listados.** Depende de T2. `ambitoColumnas` en `SaldosTiendasTable`,
  `CuentasPorPagarTable` y `SaldosSatelitesTable`.
  *Hecho:* tests: el selector aparece y sin tocarlo salen las columnas de hoy (R1, R4); desmarcar y
  reordenar se refleja en el archivo (R3).

## Cierre

- [ ] **T11 — Guardias, textos y censos.** Depende de T8–T10. Actualizar `censo-tablas`,
  `ambito-columnas.guardia` (un ámbito por módulo, sin duplicados, R2) y la guardia de columnas
  sensibles; revisar textos nuevos (R44: español claro, sin «SLA»).
  *Hecho:* guardias en verde sin excepciones nuevas; test de textos que afirma la ausencia de «SLA».

- [ ] **T12 — Gate y verificación en la app.** Depende de todo.
  `./init.sh` completo con `INIT_EXIT=$?` escrito en el log y revisión de `skipped` en
  `tests/integration/db`. Descargar en la app (dev server único) la caja y `/mi-wallet` con detalle y
  abrir el `.xlsx`: dos hojas, «N.º» enlaza, y en un movimiento de cierre la suma de su detalle
  coincide con su monto.
  *Hecho:* gate verde, `progress/impl_464.md` con el mapa R1–R44 → test y lo observado al abrir los
  archivos.
