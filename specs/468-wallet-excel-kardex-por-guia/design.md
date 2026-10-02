# Ficha 468 — Diseño

> Amplía una pantalla EXISTENTE (el control de descarga de las wallets, ya ampliado por la 464). No hay
> pantalla ni módulo nuevo, así que no pasa por `/design`.
>
> Búsqueda: grafo `R-job-singularis-projects-ordenex` (`search_graph`) y, para cada símbolo citado, lectura
> del archivo real en `dev` @ 762c6d7d.

## 0. Lo verificado en el código (2026-10-02)

| Hecho | Dónde |
| --- | --- |
| Catálogos de reparto: en la caja, `egreso_pago_mensajero`, `ingreso_cod_recaudado` y `egreso_indemnizacion` son `sin_reparto`. En el mensajero no se reparte nada | `lib/utils/aporte-por-orden.ts:56-157` |
| `fuenteDeMovimiento` es la decisión ÚNICA de reparto, compartida por el detalle de una fila y el lote | `aporte-por-orden.ts:325-344` |
| `aporteDeOrden` ya sabe acumular un snapshot de la gestión (`cod_recaudado`: Σ `monto_recibido ?? 0`) | `aporte-por-orden.ts:382-413` |
| `gestion_orden` guarda por gestión `monto_recibido`, `pago_mensajero` (39/R12) e `indemnizacion` (158; NULL si no es `incidente`) | `db/schema.prisma:1142-1178` |
| El pago al mensajero de la caja (`egreso_pago_mensajero`) y el `pago_devengado` del mensajero valen los dos `P = cierre_dia.total_pago_mensajero`. `pago_efectivo` vale `min(P, E)` | `lib/services/WalletMensajeroFeedService.ts:40-89` |
| La indemnización tiene DOS productores: uno con origen `cierre_dia` y otro con origen `orden_incidente` | `WalletIndemnizacionFeedService.ts:56-59`, `WalletIndemnizacionIncidenteFeedService.ts:51-54` |
| El lote de la 464: guard → re-lectura con la tienda en el `WHERE` → contar → leer → `aporteDeOrden` → `suma`/`cuadra` | `lib/services/DetalleEnLoteService.ts` |
| Los orquestadores de la 464 son DOS clases: `CajaConDetalleService` y `EstadoCuentaConDetalleService` (solo tienda) | `lib/services/LibroConDetalleService.ts` |
| El `WHERE` del criterio vive en `buildWhere`, que filtra `gestiones.some({cierreId, resultado, montoRecibido>0?})` | `lib/repositories/CierreAporteRepository.ts:41-80` |
| El estado de cuenta trae `saldoCorrido` por fila: una ventana SQL sobre la cuenta ENTERA, con el periodo y los filtros aplicados después. Trae también `saldoInicial`, `abonos`, `cargos` y `saldoFinal` | `lib/repositories/EstadoCuentaRepository.ts:200-301`, `lib/types/estado-cuenta.ts:213-240` |
| En la bodega, `declarado` es `cargo` y sube el pendiente; `recibido` es `abono` y lo baja. En tienda y mensajero, el abono sube el saldo | `lib/services/EstadoCuentaService.ts:226-231`, `:403-404`, `:513-514` |
| La cifra principal de la caja es `derivarCaja(...).enCaja` = entradas de efectivo − salidas. Los cargos a tienda (`LIQUIDEZ_POR_CATEGORIA = cargo_a_tienda`) no la mueven | `lib/utils/caja-tesoreria.ts:130-168`, `:314-372` |
| La caja no tiene saldo corrido: `listarMovimientosCompleto` devuelve `{items, total}` | `lib/services/WalletService.ts:329-354` |
| `DUENO_LABEL` ya dice «Ordenex» / «Tienda» / «Ordenex (capital)» | `app/(app)/wallet/_components/wallet-labels.ts:267-271` |
| Los montos de la descarga son STRING. `buildXlsxLibro` escribe la celda tal cual (un `string` sale como texto) | `wallet-ledger-descarga-columnas.ts:83`, `lib/utils/xlsx-template.ts:236-274` |
| `XlsxCellValue` ya admite `number` y lo emite como número (feature 148) | `xlsx-template.ts:154` |
| La preferencia de columnas guarda las `ocultas`. Una clave que ya no existe se descarta y una columna nueva sale marcada | `lib/columnas/preferencia-columnas.ts:143-221` |
| `DataTableDescargaDetalle` exige `columnaEnlace` («N.º») y `columnaEstado` («Detalle por orden») | `components/shared/wallet/detalle-por-orden-descarga.ts:23-39` |

## 1. Modelo de datos

**Sin migraciones, sin tablas, sin RLS nueva y sin índices nuevos.** Todo sale de `wallet_movimiento`,
`wallet_tienda_movimiento`, `pago_mensajero_movimiento`, `cierre_detail`, `gestion_orden` y `cierre_dia`.
Las columnas `pago_mensajero` e `indemnizacion` de `gestion_orden` ya existen y ya se escriben al aprobar
el cierre. Lo único que cambia es que ahora se leen.

`lib/types/` sí cambia (contratos nuevos). El modo rápido del gate se negará, y es lo esperado: **el gate
de esta ficha es `./init.sh` completo** (además, toca archivos con nombre de dinero).

## 2. Catálogo de reparto: cuatro conceptos más (R27, R28)

### 2.1 Una fuente nueva, del mismo tipo que la que ya existe

```ts
// lib/utils/aporte-por-orden.ts
export type CampoDeGestion = "monto_recibido" | "pago_mensajero" | "indemnizacion";
export type FuenteDeAporte =
  | { tipo: "concepto_ordenex"; concepto: WalletIngresoConcepto }
  | { tipo: "cod_recaudado" }                                   // = snapshot de monto_recibido (ya existe)
  | { tipo: "snapshot_gestion"; campo: "pago_mensajero" | "indemnizacion" }  // NUEVO
  | { tipo: "sin_reparto"; motivo: MotivoSinReparto };
```

| Catálogo | Concepto | Antes | Ahora |
| --- | --- | --- | --- |
| `FUENTE_CAJA` | `ingreso_cod_recaudado` | `sin_reparto: suma_del_libro_por_tienda` | `{ tipo: "cod_recaudado" }` (sin tienda en el `WHERE`: todas las gestiones del cierre) |
| `FUENTE_CAJA` | `egreso_pago_mensajero` | `sin_reparto: snapshot_del_cierre` | `{ tipo: "snapshot_gestion", campo: "pago_mensajero" }` |
| `FUENTE_CAJA` | `egreso_indemnizacion` | `sin_reparto: otro_productor` | `{ tipo: "snapshot_gestion", campo: "indemnizacion" }` |
| `FUENTE_MENSAJERO` | `pago_devengado` | `sin_reparto: snapshot_del_cierre` | `{ tipo: "snapshot_gestion", campo: "pago_mensajero" }` |
| `FUENTE_MENSAJERO` | `pago_efectivo` | `sin_reparto: snapshot_del_cierre` | **igual** (R43). Cambia solo el TEXTO del motivo (§2.4) |

La indemnización con origen `orden_incidente` sigue sin reparto: `fuenteDeMovimiento` ya devuelve
`no_nace_de_un_cierre` para todo origen que no sea `cierre_dia`, sin tocar nada.

### 2.2 El criterio: dos hechos más, los dos COLUMNAS

`CriterioDeAporte` gana `exigePagoMensajero` y `exigeIndemnizacion`, y `HechosDeAporte` gana
`hayPagoMensajero` y `hayIndemnizacion`. Es el mismo patrón de supresión de ceros que `exigeMontoRecibido`
(Q2 de la 344: lo que aporta cero no es parte del número).

```ts
export const CRITERIO_PAGO_MENSAJERO: CriterioDeAporte = {
  resultados: TODOS_LOS_RESULTADOS,      // el mismo literal que CRITERIO_COD_RECAUDADO
  exigeCobraComision: false, exigeTarifa: false, exigeMontoCobrar: false, exigeMontoRecibido: false,
  exigePagoMensajero: true, exigeIndemnizacion: false,
};
export const CRITERIO_INDEMNIZACION: CriterioDeAporte = {
  resultados: ["incidente"], /* … */ exigePagoMensajero: false, exigeIndemnizacion: true,
};
```

- `buildWhere` añade `pagoMensajero: { gt: 0 }` / `indemnizacion: { gt: 0 }` DENTRO del mismo
  `gestiones.some({ cierreId, … })`. La correlación con el cierre no cambia.
- `satisfaceCriterio` añade las dos ramas. El test de equivalencia de la 344
  (`tests/unit/utils/aporte-por-orden-equivalencia.test.ts`) se amplía con las combinaciones nuevas.
- `aporteDeOrden` con `snapshot_gestion`: Σ `g[campo] ?? "0"` sobre las gestiones de esa orden en ese
  cierre. Es la MISMA acumulación que `cod_recaudado` (exacta: sumas de valores a escala 2). Se generaliza
  en una sola función privada `acumularCampo(gestiones, campo)`, que usan las dos ramas.
- `GestionDelCierre` gana `pagoMensajero: string | null` e `indemnizacion: string | null`. Los tres selects
  de gestiones del repositorio (`CierreAporteRepository.ts:183`, `:236`) los añaden.

**No es una fórmula nueva.** El monto del movimiento ES la suma de esos snapshots, y está medido
(§9.1). Repartirlo es leer cada sumando.

### 2.3 Consecuencia en pantalla (R28, pregunta abierta 4)

`DetalleMovimientoService` (el detalle de una fila, 344/458-D) usa los mismos catálogos y la misma
`fuenteDeMovimiento`. Al cambiar el catálogo, esas filas en pantalla pasan de «no se reparte» a la lista de
órdenes. **No se escribe código de pantalla para eso:** el panel ya pinta órdenes con aporte. Lo que se
exige es el test diferencial lote = fila para los cuatro conceptos (§11).

### 2.4 Motivos sin reparto

- `suma_del_libro_por_tienda` y `otro_productor` se quedan sin productor. **Se retiran** del union
  `MotivoSinReparto`, de sus dos diccionarios de textos (`detalle-movimiento-labels.ts:81-88`,
  `detalle-mi-movimiento-labels.ts:70-73`) y del comentario de `lib/types/detalle-movimiento.ts:28-46`.
  Un `Record` total sobre el union obliga a borrarlos en el mismo commit.
- `snapshot_del_cierre` queda solo para `pago_efectivo`. Su texto pasa a decir, en español claro: «Es lo
  que se le pagó al mensajero con el efectivo que entregó en ese cierre; no se reparte por guía.» Se borra
  todo «snapshot» visible (R19). Los comentarios de `ordenes-de-fila-cuenta.ts:19` y
  `EstadoCuentaMensajero.tsx:64` se actualizan.

## 3. El kardex: saldos y totales en el servidor (R5–R16, R54)

### 3.1 La columna de monto de cada fila, decidida en el servidor

```ts
// lib/types/libro-kardex.ts (NUEVO, módulo de tipos)
export type ColumnaDeMonto = "entra" | "sale" | "cobrado_a_tiendas";
/** `monto` STRING escala 2. Solo `cobrado_a_tiendas` puede ser negativo (reverso de cargo). */
export interface MontoEnColumna { columna: ColumnaDeMonto; monto: string }
export interface TotalesPorColumna { entra: string; sale: string; cobradoATiendas: string | null } // null fuera de la caja
export interface KardexDTO {
  saldoInicial: string;
  saldoFinal: string;
  totales: TotalesPorColumna;              // Σ por columna de las filas de movimiento (R8)
  conOtrosFiltros: boolean;                // R16: lo decide el servidor con los filtros que aplicó
  filas: Array<{ monto: MontoEnColumna; saldo: string }>;   // ALINEADO por índice con los movimientos devueltos
}
```

Dos funciones puras nuevas, sin aritmética de dinero propia:

- `columnaDeCaja(categoria, tipo, monto)` en `lib/utils/caja-tesoreria.ts`, junto a
  `LIQUIDEZ_POR_CATEGORIA`. `efectivo` + `ingreso` va a `entra` y `efectivo` + `egreso` a `sale`.
  `cargo_a_tienda` + `ingreso` va a `cobrado_a_tiendas` con el monto tal cual, y `cargo_a_tienda` +
  `egreso` va a `cobrado_a_tiendas` con `new Prisma.Decimal(monto).neg()`. Es un cambio de signo, no una
  operación nueva. La clasificación es el `Record` total que ya existe: una categoría nueva no compila
  hasta que alguien la clasifique.
- `columnaDeCuenta(fila, columnaQueSube)` en `lib/utils/estado-cuenta-kardex.ts`: `abono` / `cargo` →
  `entra` / `sale` según la cuenta. Para la tienda y el mensajero sube el abono; para la bodega, el cargo.
  `columnaQueSube` sale del MISMO modo que ya usa `saldoAlFinal` (`"a_favor_del_titular"` /
  `"por_entregar"`, `EstadoCuentaService.ts:226-231`), así que no se decide dos veces.
- Los totales (`totales`) son Σ con `Prisma.Decimal` de las filas devueltas, en el servicio. No hay resta.

### 3.2 Orden cronológico (R7, pregunta abierta 2)

El cliente, al pedir la descarga, **fuerza** `sortBy: "fecha", sortDir: "asc"` en la entrada del completo
(los esquemas de la 463 ya aceptan esos valores). Así el servidor ordena con su orden total de siempre
(fecha, `created_at`, `id`) y no hace falta un orden nuevo. El término y los filtros viajan intactos (R6).

### 3.3 Estado de cuenta (tienda, mensajero, bodega, `/mi-wallet`)

Casi todo existe. El saldo por fila es `fila.saldoCorrido` (R11), y el inicial y el final son
`estado.saldoInicial` y `estado.saldoFinal` (R13). Lo nuevo:

- `EstadoCuentaService.leerCompleto` / `leerMiTiendaCompleto` devuelven, junto a `estado`, un
  `kardex: KardexDTO` armado con §3.1. `conOtrosFiltros` = hay chip, cierre o término.
- Afirmación en tiempo de ejecución, molde R22 de la 458-B (`EstadoCuentaService.ts:232`): MIENTRAS
  `!conOtrosFiltros`, el último `saldo` de `kardex.filas` debe ser igual a `saldoFinal`, y `saldoInicial`
  más Σentra menos Σsale también. Si no cuadra, se lanza un error (la descarga avisa y no sale archivo, R43
  de la 464). La resta se hace con `derivarBalance`, que ya existe, no a mano.

### 3.4 Caja: saldo corrido nuevo, misma cifra que la tarjeta (R12, R14, R15)

La caja no tiene saldo corrido. Hay que darle uno **que sea la cifra de la tarjeta**, sin escribir otra
definición de esa cifra.

- **Saldo inicial y final:** `derivarCaja(await repo.agregarPorCategoriaYTipo({ antesDe }))`, con
  `.enCaja`. `antesDe` es un filtro NUEVO y estricto (`fecha_movimiento < antesDe`) que vale el inicio del
  periodo para el inicial y el final del periodo para el final. Sin inicio, el inicial es `"0.00"`. Sin
  fin, el final usa la caja entera. Es la misma función y la misma lectura que la tarjeta: R14 se cumple
  por construcción.
- **Saldo por fila:** método nuevo
  `WalletMovimientoRepository.saldosTrasMovimientos(ids, efectivo, antesDe?)`. Hace una ventana
  `SUM(CASE WHEN categoria = ANY(${efectivo.ingresos}) THEN monto WHEN categoria = ANY(${efectivo.egresos})
  THEN -monto ELSE 0 END) OVER (ORDER BY fecha_movimiento, created_at, id)` sobre la caja ENTERA hasta
  `antesDe`, y en la consulta exterior se queda solo con los `ids` de la descarga (≤ tope). Es el molde
  exacto de `EstadoCuentaRepository.paginaDeTienda`.
  - Las dos listas de categorías **no se escriben en SQL**: el servicio las deriva en tiempo de ejecución
    de `LIQUIDEZ_POR_CATEGORIA` y del prefijo del tipo (el mismo criterio de `acumular`). Es el patrón
    «lista cerrada calculada por el servicio» de `filtroDeChip`.
  - **Atadura con la tarjeta, en tiempo de ejecución:** MIENTRAS `!conOtrosFiltros` y haya filas, el saldo
    de la última fila debe ser igual a `saldoFinal` (que sale de `derivarCaja`). Si la ventana y
    `derivarCaja` divergen (alguien añade una categoría y la ventana la clasifica distinto), la descarga
    falla ruidosa en vez de entregar un saldo que no casa con la tarjeta. Y un test de integración lo
    afirma con filtros (§11).
- `listarMovimientosCompleto` (y `CajaConDetalleService`) devuelven `kardex` junto a `items`.
  `conOtrosFiltros` = `tipo`, `categoria`, `aQuien` o término presentes.

### 3.5 Por qué hay un aviso con filtros (R16)

Con un filtro de concepto, Entra y Sale suman solo lo filtrado, pero el saldo sigue siendo el de toda la
cuenta. Es la semántica que ya tiene el estado de cuenta (`saldoCorrido` «sea cual sea el chip»). Por eso
R15 solo se promete sin otros filtros, y la hoja lo dice en una fila en lugar de dejar un descuadre
aparente sin explicar.

## 4. La hoja «Detalle por guía»: agrupar en el servidor (R33–R46)

### 4.1 El lote gana el mensajero

`DetalleEnLoteService.detallar` gana la superficie `"mensajero_oficina"` con `mensajeroId`:

- guard `esAccesoTotal` antes de la base (R55);
- re-lectura de las filas con el mensajero en el `WHERE`, con un repositorio nuevo
  `IMovimientosMensajeroEnLoteRepository.listarPorIdsDeMensajero(ids, mensajeroId)`, gemelo del de la
  tienda;
- catálogo `FUENTE_MENSAJERO`. `conMensajero = false` (es su propia cuenta: la columna no existe, R31) y
  `conTienda = true`.

`OrdenDelLoteDTO` gana `clave: string` (el id de la orden). Viaja para agrupar las órdenes sin guía y
**nunca se pinta** (R30 de la 464).

### 4.2 La agrupación, pura y con Decimal

```ts
// lib/utils/detalle-por-guia.ts (NUEVO, puro, money-safe)
export function agruparPorGuia(input: {
  movimientos: ReadonlyArray<{ id: string; monto: MontoEnColumna }>;   // en el orden de la hoja 1
  detalle: readonly DetalleDeMovimientoLoteDTO[];                        // del lote (§4.1)
  totalesHoja1: TotalesPorColumna;
}): DetallePorGuiaDTO;
```

```ts
// lib/types/libro-kardex.ts
export interface FilaDeConceptoDTO { movimientoId: string; cierreFecha: string; monto: MontoEnColumna }
export interface BloqueDeGuiaDTO {
  guia: string | null; remision: string; destinatario: string;
  tiendaNombre: string | null; mensajeroNombre: string | null;  // los del cierre más reciente (R39)
  cierres: string[];                                             // ISO, ascendentes, sin repetir (R38)
  resultados: GestionResultado[];
  filas: FilaDeConceptoDTO[];                                    // R35/R37
  total: TotalesPorColumna;                                      // R36
}
export type FilaSinGuiaDTO =
  | { tipo: "movimiento"; movimientoId: string; monto: MontoEnColumna }                     // R40/R43
  | { tipo: "diferencia"; movimientoId: string; cierreFecha: string;
      montoMovimiento: string; sumaGuias: string; monto: MontoEnColumna };                  // R41/R42
export interface DetallePorGuiaDTO {
  bloques: BloqueDeGuiaDTO[];
  sinGuia: FilaSinGuiaDTO[];
  totalGeneral: TotalesPorColumna;                                                          // R44
}
```

Reglas, en este orden:

1. Por cada movimiento con `modo: "ordenes"`, cada orden aporta una fila de concepto a su bloque. La clave
   del bloque es `guia` y, si es `null`, `"sin-guia:" + clave`. El aporte va en la MISMA columna del
   movimiento: `columna` = `movimiento.monto.columna`. En `cobrado_a_tiendas` con monto negativo (reverso),
   el aporte se niega con `.neg()`. Hoy ningún reverso de cargo es repartible (todos son
   `no_nace_de_un_cierre`), y la regla queda escrita igual para que no dependa de eso.
2. Si `cuadra === false` (o no hay órdenes): fila `diferencia` con `monto − suma` (`Prisma.Decimal.minus`).
   Es una conciliación, no una fórmula de dinero: es lo que falta para llegar al monto que ya está en el
   libro.
3. Cada movimiento `sin_reparto` da una fila `movimiento` en `sinGuia`, en el orden de la hoja 1.
4. Orden de bloques (R37): guía numérica ascendente (las guías son números en texto: se comparan por
   longitud y después lexicográficamente, sin `Number`), y las sin guía al final por remisión. Dentro del
   bloque: `cierreFecha` ascendente y, a igual fecha, el índice del movimiento en la hoja 1.
5. `total` por bloque y `totalGeneral` se suman con `Prisma.Decimal`.
6. **Invariante (R45), afirmada aquí:** `totalGeneral` debe ser igual a `totalesHoja1` columna a columna.
   Se cumple por construcción (cada céntimo del movimiento está en sus filas o en su diferencia). Si alguien
   rompe la construcción, se lanza un error y no sale un archivo descuadrado.

### 4.3 Orquestación

- `CajaConDetalleService.cajaConDetalle`: lee el completo (que ya trae `kardex`), llama a `detallar` y
  después a `agruparPorGuia`, y devuelve `{ items, total, kardex, porGuia }`.
- `EstadoCuentaConDetalleService.tiendaConDetalle` pasa a llamarse `cuentaConDetalle` y acepta
  `cuenta.tipo ∈ {tienda, mensajero}`. El refine del borde (`verEstadoCuentaCompletoConDetalleAction`)
  cambia de `=== "tienda"` a `!== "bodega"`. La bodega sigue con `validation_error` (R25).
- `miTiendaConDetalle`: igual que hoy, más `agruparPorGuia`.
- El campo `detalle` (por movimiento) **deja de viajar** al cliente: lo sustituye `porGuia`. El cliente solo
  lo usaba para «N.º» y «Detalle por orden», que desaparecen. El número de órdenes de R18 viaja como
  `ordenesPorMovimiento: Record<movimientoId, number>` dentro de `porGuia`.
- El tope (R56) es el mismo conteo de la 464 (aportes antes de leer), sin cambios, ahora también para el
  mensajero.

## 5. Generador común: montos numéricos y filas en negrita (R22, R23, R47, R59)

Cambios de contrato **opcionales**: quien no los use produce el mismo archivo (R59).

```ts
// lib/types/descarga.ts
export interface DescargaColumna { clave: string; encabezado: string; formato?: "monto" }   // NUEVO formato
export interface DescargaHoja { titulo; columnas; filas; filasDestacadas?: readonly number[] } // NUEVO
export interface DescargaConfig { /* … */ filasDestacadas?: readonly number[] }              // hoja principal
```

- `buildXlsxLibro`: una columna con `formato: "monto"` convierte su celda con `celdaMonto(texto)`
  (`lib/utils/xlsx-monto.ts`, NUEVO, el ÚNICO punto de conversión de la app) y le pone `numFmt` `#,##0.00`.
  Las filas en `filasDestacadas` (índice 0 = la primera fila de datos) van en negrita.
- `celdaMonto(texto: string): number | string`:
  1. si `texto` no casa con `^-?\d{1,13}\.\d{2}$`, devuelve el texto (nunca un número inventado);
  2. convierte y **comprueba la vuelta**: si `n.toFixed(2) !== texto`, devuelve el texto.

  Un `Decimal(12,2)` tiene como mucho 12 cifras significativas y un `double` representa sin pérdida 15,
  así que la comprobación nunca falla con datos reales. Existe para que la exactitud se mida en cada celda
  y no se suponga. El `Number(` vive solo aquí, con un comentario que lo justifica. Si alguna guardia
  money-safe censa `lib/utils/`, se le añade una excepción NOMINAL para este archivo, y una guardia nueva
  (`xlsx-monto-unico.guardia.test.ts`) afirma que ningún otro módulo de la ruta de descarga convierte.
- CSV: `buildCsvRows` no conoce `formato`. El monto sigue saliendo como el texto del servidor (R58).
- Esto **revierte de forma acotada** la decisión de la 170 («montos como texto»), solo para las columnas
  marcadas, que es lo que la 464 dejó como pregunta abierta 5.

## 6. Contrato del control de descarga (R24, R50–R52)

`DataTableDescargaDetalle` (`components/shared/DataTable.tsx`):

- Se **retiran** `columnaEnlace` y `columnaEstado` (no hay «N.º» ni «Detalle por orden»). Hoy solo los
  usan las wallets: el compilador encuentra a todos los consumidores.
- Se añaden `fijasPrincipal: readonly string[]` y `fijasDetalle: readonly string[]`: las claves que el
  selector lista pero no deja desmarcar (R51). `ColumnasPopover` gana una prop opcional `fijas` que pinta
  esas casillas marcadas y deshabilitadas, y `clavesVisiblesEnOrden` nunca las oculta. Sin `fijas`, nada
  cambia para las ~30 tablas.
- Los textos de las opciones pasan a «Solo los movimientos · una hoja» / «Movimientos y detalle por guía ·
  dos hojas», y el título de la hoja, a «Detalle por guía».
- `DescargaFilasResult` en `ok` gana `filasDestacadas?` y `filasDestacadasDetalle?`.
- **Ámbitos:** se conservan los de la 464 (`wallet-caja-libro`, `wallet-caja-detalle-orden`, …) y entra
  `wallet-mensajero-detalle-guia`. Como la preferencia guarda las `ocultas` y descarta las claves que ya no
  existen, una elección antigua produce archivo y las columnas nuevas salen marcadas (R52) sin migrar
  nada. Las claves que se conservan (`fecha`, `registro`, `aQuien`) mantienen lo que el usuario eligió.

## 7. Cliente: proyecciones y catálogos

### 7.1 Módulos de columnas (puros, uno por superficie)

| Superficie | Hoja «Movimientos» | Hoja «Detalle por guía» | Archivo |
| --- | --- | --- | --- |
| Caja | R1 | R29 | `app/(app)/wallet/_components/wallet-ledger-descarga-columnas.ts` |
| Tienda (oficina) | R2 | R30 | `app/(app)/wallet/tiendas/_components/estado-cuenta-tienda-descarga-columnas.ts` |
| Mensajero (oficina) | R2 | R31 | `app/(app)/wallet/mensajeros/_components/estado-cuenta-mensajero-descarga-columnas.ts` (NUEVO) |
| Bodega (oficina) | R2 | — (R25) | junto a su `EstadoCuenta` en `app/(app)/wallet/satelites/_components/` |
| `/mi-wallet` | R3 | R32 | `app/(app)/mi-wallet/_components/mi-estado-cuenta-descarga-columnas.ts` |

Claves de la hoja 1: `fecha`, `concepto`, `detalle`, `aQuien`, `esDineroDe`, `entra`, `sale`,
`cobradoATiendas`, `saldo`, `registro`. Las de monto llevan `formato: "monto"`. Claves de la hoja 2:
`guia`, `remision`, `destinatario`, `tienda`, `mensajero`, `cierre`, `resultado`, `concepto`, `detalle`,
`entra`, `sale`, `cobradoATiendas`. Cada catálogo se fija con un `toEqual` literal: aquí el literal ES el
contrato (memoria «literal: contrato o polizón»).

### 7.2 Adaptador común (`components/shared/wallet/libro-kardex-descarga.ts`, NUEVO, sin React)

Sustituye a `enlazarHojas` y a `detalle-por-orden-descarga.ts`, que se borran (sus tests se reescriben, no
se pierden: ver T12).

```ts
filasKardex<M>(args: {
  movimientos: readonly M[]; kardex: KardexDTO;
  filaBase: (m: M) => { fecha: string; concepto: string; detalle: string; [k: string]: DescargaCelda };
  textos: KardexTextos;
}): { filas: DescargaFila[]; filasDestacadas: number[] }

filasDetallePorGuia<M>(args: {
  porGuia: DetallePorGuiaDTO; movimientoPorId: (id: string) => M;
  conceptoDe: (m: M) => string; detalleDe: (m: M) => string; resultadosTexto: (r) => string;
  textos: DetallePorGuiaTextos;
}): { filas: DescargaFila[]; filasDestacadas: number[] }
```

El adaptador solo COLOCA: pone cada `MontoEnColumna` en su clave y cada total en su fila. No suma, no
resta y no convierte (la guardia money-safe de `components/shared/wallet/` ya lo vigila).

### 7.3 «Detalle» (R18)

`detalleDeFila = [origenLegible, descripcion, pagoTexto, ordenesTexto?, anulacionTexto].filter(no vacío)
.join(" · ")`. Cada parte sale de la función que ya pinta esa parte en pantalla: `textoDeOrigen`
(caja), las líneas de `estado-cuenta-lineas.ts` (estado de cuenta) y la columna «Estado» de hoy para la
anulación. `ordenesTexto` = «1 orden» / «N órdenes», de `porGuia.ordenesPorMovimiento`. Sin detalle
(«Solo los movimientos») la hoja 1 tiene que ser idéntica (R57), así que el número viaja también en el
completo: `kardex.filas[i].ordenes: number | null` (`null` si no es repartible). Lo da un método nuevo del
lote, `DetalleEnLoteService.contar(input, actor)`, con el mismo guard y los mismos pasos 1–4 de `detallar`
(decisión de fuente y `contarAportesPorCierre`) **sin leer ninguna orden** (R61, que sustituye a R13 de la
464). Es una consulta por concepto y tramo, no por movimiento (R37 de la 464). En el estado de cuenta de la
bodega el conteo no se pide (no hay repartibles): `ordenes` es siempre `null`.

> El completo de la caja y el de las cuentas ganan así una dependencia del conteo del lote. Para que el
> composition root no la olvide, el constructor no la marca como opcional, y el test de la acción afirma
> que se inyecta.

### 7.4 Textos (R60), en `components/shared/wallet/libro-kardex-labels.ts`

«Saldo al inicio del periodo», «Total del periodo», el aviso de R16 (variante cuenta / caja), «Total de la
guía», «Movimientos sin guía», «Diferencia sin repartir», su detalle («Cierre del {día} · {concepto}: el
movimiento es {monto} y sus guías suman {suma}») y «TOTAL GENERAL». Los montos dentro de un texto se
pintan con `money` (presentación), nunca convertidos.

## 8. Alcance por superficie

| Superficie | Hoja 1 kardex | Hoja 2 por guía | Conceptos repartidos |
| --- | --- | --- | --- |
| Caja | sí (R1, saldo de la tarjeta) | sí | los 6 de la 344 + contra-entrega + pago al mensajero + indemnización de cierre |
| Tienda (oficina) | sí | sí | los 6 débitos + contra-entrega (ya en la 464) |
| `/mi-wallet` | sí | sí | ídem, sin mensajero ni personas (R49) |
| Mensajero (oficina) | sí | **sí (nuevo)** | pago devengado. El pago tomado del efectivo va sin guía (R43) |
| Bodega satélite | sí | no (R25) | — |
| Listados de wallets | sin cambios | — | — |

## 9. Mediciones que exige la ficha

### 9.1 Ya medido por el humano (prod, 2026-10-02, solo lectura)

Por `wallet_movimiento.origen_id = gestion_orden.cierre_id`: `ingreso_cod_recaudado` cuadra con Σ
`monto_recibido` en 206 de 206 movimientos (₡39.506.131), `egreso_pago_mensajero` con Σ `pago_mensajero`
en 207 de 207 (₡4.576.100) y `egreso_indemnizacion` con Σ `indemnizacion` en 1 de 1.

### 9.2 Falta medir (T1, antes de implementar; solo lectura con el MCP de Supabase)

1. **`pago_devengado` del mensajero** contra Σ `gestion_orden.pago_mensajero` del cierre:
   ```sql
   SELECT count(*) AS movimientos,
          count(*) FILTER (WHERE m.monto = s.suma) AS cuadran
   FROM pago_mensajero_movimiento m
   JOIN (SELECT cierre_id, SUM(COALESCE(pago_mensajero,0)) AS suma
         FROM gestion_orden WHERE cierre_id IS NOT NULL GROUP BY cierre_id) s
     ON s.cierre_id = m.origen_id
   WHERE m.categoria = 'pago_devengado' AND m.origen_tipo = 'cierre_dia';
   ```
2. **`cod_recaudado` del libro de cada tienda** contra Σ `monto_recibido` de las gestiones de esa tienda
   en el cierre (por `cierre_detail.tienda_id`). Ya se reparte desde la 464, y nadie lo ha medido.
3. **Los seis conceptos del feed** (flete, IVA flete, flete por rechazo, IVA flete por rechazo, comisión,
   IVA comisión). Su aporte se re-deriva con `derivarIngresoOrden`. Repetirlo en SQL sería escribir la
   fórmula otra vez, así que **no se mide en SQL**. Se mide con el propio sistema después del despliegue
   (T16): se descarga la caja de todo el historial con detalle y se cuentan las filas «Diferencia sin
   repartir». El número esperado es 0, y si sale distinto se reporta con su cierre y su concepto. La red
   de R41 garantiza que, aun así, el archivo cuadre.

Si la medición 1 no da el 100 %, `pago_devengado` se queda igualmente repartido (la fila de diferencia
cubre el resto) y el número se anota en `progress/`. Producción está vacía desde el 2026-08-25: un cero es
«aún no ha pasado», no «está bien».

## 10. Qué pasa con la 464

| 464 | En la 468 |
| --- | --- |
| R15/R19/R20 (`N.º` y enlace por número) | Retirados: el enlace es el bloque de guía |
| R16/R23 (columna «Detalle por orden» y texto de no cuadra) | Retirados: «Detalle» (R18) + fila «Diferencia sin repartir» (R41) |
| R17 (columnas fijas) | Sustituido por R51 |
| R25/R26/R27 (catálogos de detalle) | Sustituidos por R29–R32 |
| R31 (montos como texto) | Sustituido por R22 (xlsx) y R58 (csv) |
| R7 (sin detalle en el mensajero) | Ampliado: el mensajero gana detalle (R24, R31) |
| R4 (catálogo de movimientos «como antes») | Deja de valer por decisión del humano (R1–R4) |
| R13 (sin detalle no se lee nada del detalle) | Sustituido por R61: se leen los conteos, nunca filas de órdenes |

Los tests de la 464 que afirman lo retirado **se reescriben en la misma tarea** que retira el
comportamiento, con el R nuevo en el nombre. No se borran sin sustituto (memoria «el test que vive dentro
de lo que borras»).

## 11. Alternativas descartadas

1. **Repartir solo en la hoja 2, sin tocar el catálogo de la 344.** Es una fuente aparte para el lote.
   Descartada: la 464 unificó la decisión en `fuenteDeMovimiento` precisamente para que la fila en
   pantalla y el archivo no digan cosas distintas, y el test diferencial lote = fila se pondría rojo.
2. **Saldo corrido de la caja como «ingresos − egresos» de todas las filas.** Descartada: no es ninguna
   cifra de la tarjeta, porque cuenta los cargos a tiendas como dinero que entra (la 459 los saca de
   «Entró»). El humano pidió «el flujo acumulado de Ordenex».
3. **Cargos a tienda en «Entra» con el saldo sin moverse.** Descartada: rompe la lectura fila a fila de un
   kardex (saldo anterior + Entra − Sale) justo en las filas más frecuentes (flete, IVA).
4. **Saldo corrido de la caja calculado en el navegador.** Descartada: el navegador no suma (464 R22, R54
   aquí) y no hay librería decimal en el cliente.
5. **Hoja 2 «ancha», una fila por guía con una columna por concepto.** El humano eligió la agrupada. Además
   las columnas cambiarían con los filtros y en la caja mezclaría tres columnas de monto por concepto.
6. **Ventana SQL de la caja con las categorías escritas a mano en el `CASE`.** Descartada: sería una
   segunda clasificación de liquidez. Las listas salen de `LIQUIDEZ_POR_CATEGORIA` en tiempo de ejecución
   y una afirmación las ata a `derivarCaja`.
7. **Montos numéricos convirtiendo en cada módulo de columnas.** Descartada: dispersaría `Number(` por la
   app. Un solo punto (`celdaMonto`) con la comprobación de la vuelta.
8. **Repartir `pago_efectivo` proporcionalmente.** Descartada: sería una fórmula de dinero nueva (a qué
   guía se carga el faltante de efectivo).

## 12. Riesgos y cómo se cubren

| Riesgo | Cobertura |
| --- | --- |
| El `WHERE` nuevo (`pago_mensajero > 0`, `indemnizacion > 0`) probado solo con dobles | Integración contra Postgres del repositorio con mutación «quitar la condición» que debe ponerlo rojo (memoria «probar el WHERE donde vive») |
| Total hoja 2 ≠ total hoja 1 | Afirmación en `agruparPorGuia` + test de integración contra la base con un fixture que incluye una diferencia forzada, una guía en dos cierres, una orden con dos gestiones, una orden sin guía y movimientos sin guía, por superficie (R45) |
| Saldo de la caja distinto de la tarjeta | Afirmación en el servicio + integración: el saldo final del kardex es igual a `verResumenCaja` sin filtros con el mismo corte, y una mutación del `CASE` (cambiar una categoría de lista) lo pone rojo |
| Test de integración verde sin datos | Cada test afirma primero que el fixture tiene N > 0 filas de cada tipo (memoria) |
| Composition root que no inyecta el repositorio del mensajero | Test de la acción: el orquestador recibe las dependencias reales |
| Celda numérica con céntimos perdidos | Unitario de `celdaMonto` con extremos (9999999999.99, negativos, `0.10`), y releer el archivo con exceljs comparando `cell.value.toFixed(2)` con el texto del servidor |
| CRLF en guardias que leen archivos | `.gitattributes` vigente; correr las guardias |
| Choque con la 467 (misma zona de pantalla: `WalletModule`, `EstadoCuenta`) | La 468 toca solo la función de descarga y los módulos de columnas, no la barra. Si la 467 se mergea antes, el cableado (T13) se rebasa sobre ella. No se lanzan en worktrees que editen los mismos archivos a la vez |
| Base local compartida | Sin migraciones: no aplica |
