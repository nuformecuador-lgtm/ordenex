# Ficha 469 — Tareas

> Gate de la ficha: **`./init.sh` completo** (toca `lib/types/`). Implementación: `backend_dev` (T0–T10) →
> `frontend_dev` (T11–T15), en worktree. `[P]` = paralelizable con la tarea hermana indicada.
> Cada test lleva el `R<n>` en el nombre; el mapa R→test va en `progress/impl_469.md`.

## Preparación

- [ ] **T0 — Base: la 468 en `dev`.** Ramificar de `dev` con la 468 ya mergeada (catálogo con
  `snapshot_gestion`, `CRITERIO_PAGO_MENSAJERO`, `CRITERIO_INDEMNIZACION`). Si la 468 aún no está, PARAR y
  avisar al leader.
  *Hecho:* `git merge-base` contiene el merge de la 468; `FUENTE_MENSAJERO.pago_devengado` es
  `snapshot_gestion` en el árbol.

- [ ] **T1 — Mediciones de `design.md §7`** (solo lectura, MCP de Supabase). Depende de: nada. `[P]` con T0.
  *Hecho:* los tres números (con fecha) en `progress/medicion_469.md`, y la decisión escrita: identificar
  por `orden` (si las diferencias son 0) y con o sin índice de remisión (regla de 50 ms). Si alguna decisión
  cambia el diseño, se para y se avisa antes de T2.

## Servidor

- [ ] **T2 — Tipos.** `lib/types/busqueda-por-guia.ts` (`ParDeGuia`, `BusquedaResuelta`); `modoBusqueda` en
  las respuestas del libro de la caja y del estado de cuenta; `resaltar` en las tres entradas del detalle;
  `destacadas` y `resaltada` en `DetalleMovimientoPayload` / `OrdenAporteDTO`. Depende de: T0, T1.
  *Hecho:* typecheck verde; los esquemas siguen `.strict()`; unitarios de esquema: `resaltar` con 2
  caracteres ⇒ `validation_error` (R33).

- [ ] **T3 — Identificar órdenes** (`IOrdenIdentificadaRepository` + implementación). Depende de: T2.
  *Hecho:* integración contra Postgres: guía exacta sí, prefijo no (R3); remisión sin mayúsculas (R4);
  `tiendaId` acota (R5); remisión en dos tiendas ⇒ las dos sin `tiendaId` (R7); término no numérico no
  escribe la rama de guía; término de 10 cifras no revienta. Mutación «quitar `tiendaId`» ⇒ rojo.

- [ ] **T4 — `CierreAporteRepository.cierresDondeAporta` y `ordenIds` en `listarOrdenesQueAportan`.**
  Depende de: T2. `[P]` con T3.
  *Hecho:* integración contra Postgres con un cierre de dos órdenes (A entregada con tarifa, comisión,
  `monto_recibido > 0` y `pago_mensajero > 0`; B devolución por rechazo): para el criterio de flete de
  devolución, A no sale y B sí (R9). Mutaciones «rama sin `buildWhere`» y «sin `tiendaId`» ⇒ rojas. El
  test de equivalencia de la 344 sigue verde sin tocarlo.

- [ ] **T5 — `BusquedaPorGuiaService.resolver` / `identificar`.** Depende de: T3, T4.
  *Hecho:* unitarios con dobles: modo texto si no hay órdenes (R6); los criterios salen del catálogo, sin
  lista escrita (test que recorre los tres catálogos y afirma que toda categoría con `criterioDeFuente`
  entra, y `pago_efectivo` no: R12, R13); los pares de una sola orden solo con la opción de la pregunta
  abierta 1 (R14); un movimiento con dos órdenes identificadas da un solo par (R15).

- [ ] **T6 — Caja: `porGuia` en `whereLibroCajaConTerminoSql` y `listar`.** Depende de: T2. `[P]` con T7.
  *Hecho:* integración: con `porGuia` no cuenta el texto (una nota manual que lleva la guía en la
  descripción NO sale: R10); lista vacía ⇒ 0 filas y total 0; `AND` con periodo, Entra/Sale, Concepto y
  «A quién» (R16); total = filas (R19); los dos sentidos del orden (R20). Mutación «`OR` con el texto» ⇒
  roja.

- [ ] **T7 — Estado de cuenta: `porGuia` en `VentanaDeLibro` y `busquedaSql`.** Depende de: T2.
  *Hecho:* integración en tienda y mensajero: `saldoCorrido` de cada fila encontrada igual que sin búsqueda
  (R17); tarjetas iguales (R18); `AND` con chip y cierre (R16); `count` = filas (R19). La bodega no recibe
  `porGuia` (R36). Mutación «filtro dentro de la ventana» ⇒ roja por R17.

- [ ] **T8 — Servicios y acciones del libro.** `WalletService` y `EstadoCuentaService` (paginado, completo,
  `/mi-wallet`) resuelven `q` y devuelven `modoBusqueda`; composition root. Depende de: T5, T6, T7.
  *Hecho:* tests de acción: el servicio recibe `BusquedaPorGuiaService` real; resumen y desglose de la caja
  sin llamadas nuevas (R18); `modoBusqueda` correcto en los dos modos (R2, R6); en `/mi-wallet` el
  `tiendaId` sale del actor (R5).

- [ ] **T9 — Integración de punta a punta contra la base (la red de la ficha).** Depende de: T8.
  Fixture: dos cierres, órdenes A y B de la tienda T1, orden C de T2 con la misma remisión que A, un ajuste
  manual con la guía de A en la descripción, un pago tomado del efectivo y (si la pregunta abierta 1 sale
  «sí») un cobro por rechazo y una indemnización por incidente de A.
  *Hecho:* buscar la guía de A en la caja da exactamente los movimientos a los que A aporta, incluidos
  contra-entrega, pago al mensajero e indemnización de cierre (R8, R12); NO el flete de devolución del
  cierre donde A está pero no aporta (R9), ni el ajuste (R10), ni el pago tomado del efectivo en el
  mensajero (R13). **Diferencial R11:** para cada movimiento repartible del fixture, «sale» ⇔
  `verDetalleDeMovimiento` lista A. En `/mi-wallet` de T2, la guía de A devuelve lo mismo que un texto
  ausente (R5). Cada aserción va precedida de la comprobación de que el fixture tiene esas filas.

- [ ] **T10 — Detalle con `resaltar`.** `DetalleMovimientoService` (caja, cuenta, `/mi-wallet`). Depende de:
  T5, T4.
  *Hecho:* integración: `destacadas` trae A con el mismo aporte que su fila en la lista (R25, R27) aunque A
  esté en la página 2 (fixture con más órdenes que `pageSize`); `resaltada` solo en A (R26); sin `resaltar`,
  payload igual al de antes salvo `destacadas: []` y `resaltada: false` (R28); en `/mi-wallet` de T2,
  `resaltar` con la guía de A ⇒ `destacadas: []` (R29); un movimiento sin reparto sigue `sin_reparto`.

## Pantalla

- [ ] **T11 — Textos.** Aviso (R21), vacío (R22), textos de ayuda por superficie con la clave propia de la
  satélite (R24, R36), «Guía buscada». Depende de: T2. `[P]` con T12.
  *Hecho:* los literales que son contrato (R21, R22) fijados con `toEqual` literal; guardia de «SLA» verde
  (R35).

- [ ] **T12 — Libro: aviso y vacío.** Caja (`WalletModule`/`WalletLedger`) y `EstadoCuenta` pintan el aviso
  y el vacío según `modoBusqueda` de la lectura pintada. Depende de: T8, T11.
  *Hecho:* tests de componente: aviso solo en modo guía (R21, R23); vacío con su texto (R22); si la lectura
  nueva falla, el aviso es el de la lectura que sigue pintada (regla R49 de la 463).

- [ ] **T13 — Panel de detalle.** `FuenteDetalleMovimiento.leer` con `resaltar`, clave SWR con `resaltar`,
  bloque «Guía buscada» y filas resaltadas con texto accesible, en el panel de la caja/cuentas y en el de
  `/mi-wallet`. Depende de: T10, T12.
  *Hecho:* tests de componente: `resaltar` solo viaja con `modoBusqueda === "guia"` (R28); el bloque pinta
  las destacadas con `money` sin operar (R25, R27); la fila resaltada tiene nombre accesible (R26); dos
  términos ⇒ dos claves SWR.

- [ ] **T14 — Descarga.** Sin código nuevo esperado: comprobar que el completo con `q` en modo guía da las
  filas de la pantalla y que la hoja 2 cuadra. Depende de: T8.
  *Hecho:* integración: hoja «Movimientos» = todas las páginas de la pantalla (R30); TOTAL GENERAL = «Total
  del periodo» con búsqueda por guía en caja, tienda, mensajero y `/mi-wallet` (R31); aviso de filtros
  presente (R32).

## Cierre

- [ ] **T15 — Verificación en la app** (Playwright, dev server propio; memorias «ver la app» y «la sonda de
  toast mira tarde»). Depende de: T12, T13, T14.
  *Hecho:* en `progress/impl_469.md`, con capturas: (1) caja, escribir una guía real ⇒ aviso y solo sus
  movimientos; (2) abrir el flete de esa fila ⇒ la guía destacada arriba y resaltada en la lista; (3) la
  misma guía en el estado de cuenta de su tienda y de su mensajero; (4) `/mi-wallet` de otra tienda con esa
  guía ⇒ sin aviso; (5) un texto normal sigue buscando como antes; (6) descargar con detalle y comprobar en
  el archivo que el TOTAL GENERAL es igual al «Total del periodo». Se dice qué se vio, con números.

- [ ] **T16 — Gate y mapa.** `./init.sh` completo en verde (mirar los `skipped` de `integration/db`, no solo
  el código de salida) y el mapa R1–R36 → test en `progress/impl_469.md`. Depende de: todas.
  *Hecho:* `INIT_EXIT=0` escrito en el log, 0 integraciones saltadas por falta de `.env`, ningún R sin test
  (R36 y R14 según la respuesta a las preguntas abiertas 1 y 2).
