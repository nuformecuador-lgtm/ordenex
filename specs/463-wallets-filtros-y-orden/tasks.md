# Ficha 463 — Tareas

Zona `fullstack`: se secuencia **backend (T1–T4) → frontend (T5–T10)**. `[P]` = puede ir en paralelo
con las otras `[P]` del mismo bloque (no comparten archivos). Gate de cada task: `./init.sh --rapido`
en verde; T1 toca `lib/types/` (y con él todo lo que se commitee encima hasta T4), así que el modo
rápido se niega y manda al completo:
`./init.sh` (correr secuencial, nunca a la vez que otro agente mute el árbol).

Antes de empezar: leer las preguntas abiertas de `requirements.md`; si el humano cambió alguna al
aprobar, este desglose se ajusta primero.

## Backend

- [x] **T1 — Contratos de borde** (deps: ninguna)
  - `lib/config`: `BUSQUEDA_LIBRO_MIN_CHARS = 3` y `CAMPOS_ORDEN_LIBRO = ["fecha"]`.
  - `lib/types/wallet.ts`: `listarLibroCajaSchema` y `listarLibroCajaCompletoSchema` (design §2.1);
    `listarMovimientosSchema` sin cambios de forma.
  - `lib/types/estado-cuenta.ts`: `q` + `sortBy`/`sortDir` en `filtrosDelExtracto` (design §2.2).
  - `lib/types/wallet-tienda.ts`: `busqueda` en el paginado (hereda el completo).
  - **Hecho:** tests unitarios de esquema verdes para R14 (resumen/desglose/detalle de fila con `q` o
    `sortDir` ⇒ `validation_error`), R40 (dirección o campo inválido ⇒ `validation_error`), default
    `desc` presente en los cuatro esquemas del estado de cuenta y en el del libro de caja.

- [x] **T2 — Repositorio de la caja** (deps: T1) [P con T3]
  - `WalletMovimientoRepository.listar` y el modo completo: término (R25, R28) y `sortDir` con
    `ordenTotal` en los dos caminos (Prisma y SQL con «A quién»).
  - **Hecho:** integración contra Postgres (`tests/integration/db/…`) que siembra movimientos con
    empate de `fecha_movimiento` y comprueba: R24 (mayúsculas), R25 (cada uno de los cuatro campos
    encuentra su fila), R28 (`%` y `_` literales), R36 (recorrer todas las páginas en `asc` y en
    `desc` da cada id una vez). Una mutación que quite una rama del `OR` o el escapado pone rojo al
    menos un test (anotar la mutación y el rojo en `progress/impl_463.md`). Los tests NO deben pasar
    en verde sin filas (comprobar que el conjunto sembrado no está vacío).

- [x] **T3 — Repositorio y servicio del estado de cuenta** (deps: T1) [P con T2]
  - `VentanaDeLibro` + `paginar` + `paginaDeBodega`: `ORDER BY` final según `sortDir`, término en el
    `WHERE` exterior, nombre del registrador solo con `conNombreRegistrador` (design §3.2).
  - `EstadoCuentaService.leerCuenta`: propagar `q`, `sortDir`, `conNombreRegistrador = vista ===
    "oficina"`; tarjetas y R22 intactos.
  - **Hecho:** integración contra Postgres: R37 (mismo `saldoCorrido` por id en `asc` y `desc`, en
    tienda, mensajero y bodega), R36 en los tres tipos, R26, R27 (en vista tienda, buscar el nombre del
    registrador da el mismo resultado que un texto ausente), R11 a nivel servicio (tarjetas iguales con
    y sin `q`/`chip`/`sortDir`). Mutación: invertir también el `OVER (ORDER BY …)` ⇒ R37 rojo.

- [x] **T4 — Acciones y listado de tiendas** (deps: T1, T2, T3)
  - `listarMovimientosAction`/`listarMovimientosCompletoAction` parsean los esquemas nuevos;
    `verResumenCajaAction`, `verDesgloseEgresosAction`, `listarMovimientosDeFilaAction` sin cambio.
  - `listarSaldosTiendasPaginadoAction`/completo: `busqueda` hasta el repositorio (molde de cuentas por
    pagar).
  - **Hecho:** tests de acción para R14 (por la acción, no solo el esquema), R40, R44 (tope de descarga
    igual que hoy con término y orden) y R45 en servidor (integración: la búsqueda acota el listado y
    el completo). `./init.sh` completo verde.

## Frontend

- [ ] **T5 — `FilterComponent`: modo «Aplicar»** (deps: ninguna; puede empezar en paralelo al backend) [P]
  - Prop `aplicarConBoton` (design §5.1).
  - **Hecho:** tests de componente: R21 (editar no emite; pulsar emite una vez y sin debounce), R17
    (botón deshabilitado con borrador = aplicado), R18 (rango invertido ⇒ botón deshabilitado y
    cero emisiones), `siembra` en modo aplicar deja el botón en reposo, y R22 (sin la prop, mismas
    emisiones que antes: test que fije la secuencia de llamadas con temporizadores falsos). Suites
    existentes de `FilterComponent` y de sus consumidores verdes sin tocarlas.

- [ ] **T6 — Etiquetas** (deps: ninguna) [P]
  - Textos de design §5.5 en los `*-labels.ts` de caja, estado de cuenta y tiendas.
  - **Hecho:** test que afirma como LITERAL los textos de contrato (R2 alcance de las dos zonas, R33
    «Más recientes»/«Más antiguas») y que ningún texto nuevo contiene «SLA» (R48).

- [ ] **T7 — Caja: dos zonas** (deps: T4, T5, T6)
  - Partir el estado de `WalletModule` en `FiltrosWallet`/`FiltrosLibro`, `inputDeWallet`/
    `inputDeLibro`, `recargarTodo`/`recargarLibro` (design §5.2).
  - `WalletFiltrosCaja.tsx` (zona de la wallet, encima de `CajaResumenCard`) y `LibroCajaBarra.tsx`
    (zona del libro, por la prop `filtros` de `DataTable`); retirar `WalletFiltros.tsx` y mover/borrar
    sus tests SIN perder la red que cubrían (revisar qué afirmaban antes de borrarlos).
  - `ComposicionGananciaCard` recibe solo los filtros de la wallet.
  - **Hecho:** tests de componente con dobles de acción: R1/R2/R3/R5 (estructura y nombres
    accesibles), R8 y R20 (una llamada a cada una de las tres acciones con el input de la wallet,
    página 1), R9 (cambiar término/Entra-Sale/categoría/orden ⇒ solo `listarMovimientosAction`, cero
    llamadas a resumen/desglose), R12 (el input de resumen/desglose/detalle no lleva `tipo`,
    `categoria`, `q` ni orden), R13 (las opciones de categoría se piden con periodo y A quién
    aplicados), R15/R16/R19, R29, R30, R31 (`leerDeUrl` apagado: entrar con `?q=x` no filtra), R32,
    R34, R35, R42 (la descarga recibe filtros de las dos zonas, término y orden), R49.

- [ ] **T8 — Estado de cuenta: dos zonas y orden** (deps: T4, T5, T6) [P con T7]
  - `EstadoCuenta.tsx`: zona de la wallet arriba con `FilterComponent` en modo «Aplicar»; zona del
    libro con `BuscadorFiltros` + orden + chips + cierre en el selector (design §5.3).
  - Clave SWR con término y orden; `posicionSaldoInicial`; `filasDelPeriodo` con término y orden.
  - **Hecho:** tests de componente: R1/R2/R4/R6/R7, R10, R11 (cambiar chip/término/orden no cambia
    las tarjetas pintadas), R15–R19, R24 (aviso de mínimo), R29, R30, R33, R34, R38 y R39 (con
    `total` múltiplo y no múltiplo de `pageSize`, y `total = 0`), R41 (claves distintas con término u
    orden distinto; `esClaveDeLaCuenta` sigue casando todas), R43 (primera/última fila del Excel), R47.
    Las cuatro superficies (`EstadoCuentaTienda`, `EstadoCuentaMensajero`, `EstadoCuentaSatelite`,
    `MiEstadoCuenta`) montan las dos zonas (un test por superficie que encuentre las dos por nombre
    accesible).

- [ ] **T9 — Listado de tiendas** (deps: T4, T6) [P con T7 y T8]
  - `SaldosTiendasTable` con `BuscadorFiltros` (design §5.4).
  - **Hecho:** test de componente R45 (término ⇒ página 1, en la clave SWR y en la descarga).

- [ ] **T10 — Cierre y verificación** (deps: T7, T8, T9)
  - Mapa `R<n> → test` completo en `progress/impl_463.md` (R1–R49, sin huecos).
  - `./init.sh` completo verde (toca `lib/types/`); revisar `skipped` de `tests/integration/db`, no solo
    el código de salida.
  - Verificación visual en el navegador (dev server propio, uno solo): caja, una tienda, un mensajero,
    una satélite y `/mi-wallet`; captura de las dos zonas y del orden «Más antiguas» con el saldo
    inicial arriba y «Más recientes» con el saldo inicial al final de la última página.
  - Actualizar la ficha 328 y la parte wallet de la 145/326 lo hace el leader, no esta task.
  - **Hecho:** gate verde, mapa completo, capturas referenciadas en `progress/impl_463.md`.
