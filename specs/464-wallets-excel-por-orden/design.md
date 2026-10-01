# Ficha 464 — Diseño

> Amplía pantallas EXISTENTES (el control de descarga de las wallets); no hay pantalla ni módulo nuevo,
> así que no pasa por `/design`. Lo único nuevo en `components/shared/` es una capacidad opcional del
> control de descarga común (hoja de detalle) y del generador (varias hojas).
>
> Búsqueda hecha con el grafo `R-job-singularis-projects-ordenex` (`search_graph`) y confirmada leyendo
> cada archivo citado abajo; los repositorios y servicios de la 344 no estaban en el índice y se leyeron
> directamente.

## 0. Lo verificado en el código (2026-10-01)

| Hecho | Dónde |
| --- | --- |
| El control común descarga UNA hoja; el selector solo se monta con `ambitoColumnas` | `components/shared/DescargarDatasetButton.tsx:89-95`, `:191-200` |
| Contrato de la tabla: `titulo`, `columnas`, `obtenerFilas()`, `formatos?`, `ambitoColumnas?` | `components/shared/DataTable.tsx:108-140` |
| El despachador arma UNA hoja (`buildXlsxRows(..., nombreHoja(titulo))`) o un CSV | `lib/utils/descarga-dataset.ts:141-177` |
| `buildXlsxRows` crea un libro con una sola `addWorksheet` | `lib/utils/xlsx-template.ts:203-238` |
| `nombreHoja` sanea el nombre (prohibidos, 31 car., `History`) suponiendo «una sola hoja» | `lib/utils/descarga-dataset.ts:97-107` |
| `ColumnasPopover` acepta `encabezado` (usado para elegir el nivel en cierres); no tiene columnas fijas | `components/shared/ColumnasPopover.tsx:15-38` |
| Precedente de «nivel de detalle» dentro del selector, con un ámbito por nivel, sin persistir el nivel | `app/(app)/cierres-admin/_components/DescargarCierresButton.tsx` |
| Ninguna wallet declara `ambitoColumnas` | grep en `app/(app)/wallet`, `app/(app)/mi-wallet`, `components/shared/estado-cuenta` |
| Caja: descarga = `listarMovimientosCompletoAction` + autoría en tramos de 100 ids | `app/(app)/wallet/_components/WalletModule.tsx:192-208`, `lib/types/libro-caja-autoria.ts:15` |
| Caja: columnas de la hoja | `app/(app)/wallet/_components/wallet-ledger-descarga-columnas.ts:41-50` |
| Estado de cuenta: `filasDelPeriodo` (saldo inicial + filas) y columnas oficina / `/mi-wallet` | `components/shared/estado-cuenta/EstadoCuenta.tsx:181-202`, `:390-394`; `estado-cuenta-descarga-columnas.ts` |
| Detalle de UNA fila: `DetalleMovimientoService` (caja, tienda oficina, mensajero, `/mi-wallet`) | `lib/services/DetalleMovimientoService.ts` |
| Pasos del detalle: guard → movimiento con alcance → fuente → cabecera → página + count → `aporteDeOrden` | `DetalleMovimientoService.ts:225-279` |
| Criterio → `WHERE` en un solo sitio (`buildWhere`), orden total `numGuia asc nulls last, id` | `lib/repositories/CierreAporteRepository.ts:39-80` |
| Catálogos `FUENTE_CAJA` / `FUENTE_TIENDA` / `FUENTE_MENSAJERO` (todo el mensajero es `sin_reparto`) | `lib/utils/aporte-por-orden.ts:56-157` |
| Textos de motivo sin reparto y de resultados | `app/(app)/wallet/_components/detalle-movimiento-labels.ts:73`, `:150`; `app/(app)/mi-wallet/_components/detalle-mi-movimiento-labels.ts:141` |
| Resultado del modo completo (`ok` / `limite_excedido` / error), tope en el servidor | `lib/types/descarga-listado.ts`, `lib/types/estado-cuenta.ts:239-242` |
| Tope único: `descargaConfig.MAX_FILAS` (por defecto 5000) | `lib/config/descarga.ts:22` |
| La guardia de ámbitos lee el árbol como texto y exige `ambitoColumnas: <CONSTANTE>` único | `tests/unit/descarga/ambito-columnas.guardia.test.ts` (descrito en `DescargarCierresButton.tsx:117-123`) |

## 1. Modelo de datos

**Sin migraciones, sin tablas, sin RLS nueva, sin índices nuevos.** Todo sale de `cierre_detail`,
`gestion_orden`, `cierre_dia` y los libros ya existentes, con las mismas consultas que la 344 hace
fila a fila, agrupadas.

## 2. Contratos

### 2.1 Generador común (sin dominio)

```ts
// lib/types/descarga.ts
export interface DescargaHoja {
  titulo: string;               // nombre de la hoja (se sanea)
  columnas: DescargaColumna[];
  filas: DescargaFila[];
}
export interface DescargaConfig {
  tipo?: DescargaTipo;
  titulo: string;
  columnas: DescargaColumna[];
  filas: DescargaFila[];
  /** NUEVO. Solo xlsx. Ausente o vacío ⇒ archivo idéntico al de hoy (R41). */
  hojasAdicionales?: DescargaHoja[];
}
```

- `lib/utils/xlsx-template.ts`: nueva `buildXlsxLibro(hojas: { nombre; columns; rows }[])`.
  `buildXlsxRows(columns, rows, sheetName)` pasa a ser `buildXlsxLibro([{ ... }])`, misma firma y mismo
  resultado (sus tres consumidores directos y las ~30 tablas no cambian).
- `construirDescarga`: con `tipo === "csv"` y `hojasAdicionales` no vacío ⇒ `throw` (R12; el control
  no lo ofrece). Con xlsx: hoja principal = `nombreHoja(titulo)`, adicionales = `nombreHoja(h.titulo)`;
  nueva `nombresDeHojaUnicos(nombres)` añade « (2)», « (3)»… respetando los 31 caracteres (R42).

### 2.2 Control de descarga (sin dominio)

```ts
// components/shared/DataTable.tsx
export interface DataTableDescargaDetalle {
  titulo: string;                         // «Detalle por orden»
  columnas: DescargaColumna[];            // catálogo de la hoja de detalle, SIN la columna de enlace
  ambitoColumnas: string;                 // obligatorio: R2/R11
  etiquetaOpcion: string;                 // «Movimientos y detalle por orden · dos hojas»
  etiquetaSinDetalle: string;             // «Solo los movimientos · una hoja»
  columnaEnlace: DescargaColumna;         // «N.º» (fija, R15/R17/R19)
  columnaEstado: DescargaColumna;         // «Detalle por orden» (fija, R16/R17)
}
export interface DataTableDescarga {
  /* …lo de hoy… */
  obtenerFilas: (opciones?: { conDetalle: boolean }) => Promise<DescargaFilasResult>;
  detalle?: DataTableDescargaDetalle;     // NUEVO, opcional
}
export type DescargaFilasResult =
  | { status: "ok"; filas: DescargaFila[]; filasDetalle?: DescargaFila[] }
  | { status: "error"; mensaje: string };
```

- `obtenerFilas` gana un parámetro OPCIONAL: los consumidores actuales (funciones sin parámetro) siguen
  compilando y se comportan igual.
- El comentario de `DataTable.tsx:117-119` dice que ampliar este contrato es «señal de que el diseño
  falló». Se amplía igualmente, y se deja escrito: lo nuevo sigue sin dominio (hojas, columnas y un
  booleano), no filtros ni roles. La alternativa —un control propio de las wallets— está en §8.3.

`DescargarDatasetButton` con `detalle` declarado:

- Monta UN `ColumnasPopover` (aunque no haya `ambitoColumnas` de la principal, que las wallets sí
  declaran) con un `encabezado` de dos `RadioGroup`:
  1. «Qué se descarga»: `etiquetaSinDetalle` / `etiquetaOpcion`. Estado local, por defecto con
     detalle (R8, Pregunta 2), sin persistir.
  2. Solo con detalle: «Columnas de la hoja»: «Movimientos» / «Detalle por orden». Decide qué ámbito y
     qué catálogo lista el popover (R11). Molde: `DescargarCierresButton`.
- Al descargar: `obtenerFilas({ conDetalle })`. Con detalle, las columnas efectivas son
  `[columnaEnlace, ...visiblesPrincipal, columnaEstado]` y `[columnaEnlace, ...visiblesDetalle]`.
  Las columnas fijas NO están en el catálogo del selector, así que no se pueden desmarcar (R17).
- Con detalle, el formato es siempre xlsx: si `formatos` incluye csv, el menú de formato solo aparece
  con «Solo los movimientos» (R12).
- Sin `detalle` declarado: el componente no cambia en nada (R41).

### 2.3 Borde: lectura «completa con detalle» (una acción por superficie con detalle)

Una sola llamada devuelve la hoja de movimientos Y el detalle (R36):

```ts
// lib/types/detalle-en-lote.ts (módulo de tipos, sin Prisma salvo el union GestionResultado)
export interface OrdenDelLoteDTO {
  guia: string | null;          // num_guia congelado como texto; null si no llegó a tenerla
  remision: string;             // num_remision congelado
  destinatario: string;
  tiendaNombre: string | null;  // null en las vistas de tienda (oficina-tienda y /mi-wallet)
  resultados: GestionResultado[];
  aporte: string;               // escala 2, lo deriva aporteDeOrden (R21/R31)
}
export type DetalleDeMovimientoLoteDTO =
  | { movimientoId: string; modo: "ordenes";
      cierre: { fecha: string; mensajeroNombre: string | null };  // null en /mi-wallet
      ordenes: OrdenDelLoteDTO[];
      suma: string; cuadra: boolean }                             // R22/R23: lo decide el servidor
  | { movimientoId: string; modo: "sin_reparto"; motivo: MotivoSinReparto };

export type DetalleEnLoteServiceResult =
  | { status: "ok"; detalle: DetalleDeMovimientoLoteDTO[] }
  | { status: "limite_excedido"; total: number; limite: number }   // solo conteos (R40)
  | { status: "forbidden" };
```

| Acción (nueva) | Archivo | Entrada (zod `.strict()`) | Salida `ok` |
| --- | --- | --- | --- |
| `listarMovimientosCompletoConDetalleAction` | `lib/actions/wallet.ts` | `listarLibroCajaCompletoSchema` (463 §2.1) | `{ items: WalletMovimientoDTO[]; total; detalle }` |
| `verEstadoCuentaCompletoConDetalleAction` | `lib/actions/estado-cuenta.ts` | `estadoCuentaCompletoSchema` (con lo de la 463) **+ refine `cuenta.tipo === "tienda"`** | `{ estado: EstadoCuentaDTO; detalle }` |
| `verMiEstadoCuentaCompletoConDetalleAction` | `lib/actions/estado-cuenta.ts` | `miEstadoCuentaCompletoSchema` (sin cuenta, R35) | `{ estado; detalle }` |

Errores: los del completo de cada superficie, más `limite_excedido` con `hoja: "movimientos" |
"detalle"` para que el cliente redacte el aviso correcto (R38/R39).

- El id del movimiento VIAJA en el DTO (enlace en memoria) y nunca se pinta (R30); en el estado de
  cuenta el enlace es `fila.ref.movimientoId`.
- La acción del mensajero/bodega NO existe: su superficie no declara `detalle` (R7).

## 3. Repositorio (`CierreAporteRepository`, ampliado)

Dos métodos nuevos en `ICierreAporteRepository`, sobre el MISMO `buildWhere` (no se escribe el criterio
otra vez):

```ts
interface FiltroAportesEnLote { criterio: CriterioDeAporte; cierreIds: readonly string[]; tiendaId?: string }

contarAportesPorCierre(f): Promise<Map<string /*cierreId*/, number>>;
listarAportesDeCierres(f): Promise<Array<OrdenAporteRow & { cierreId: string }>>;
cabecerasDeCierres(cierreIds: readonly string[]): Promise<Map<string, CabeceraDeCierre>>;
```

- `where = { OR: cierreIds.map((id) => buildWhere(id, criterio, tiendaId)) }`. Cada rama lleva su
  `cierreId` correlacionado con el de la gestión (`orden.gestiones.some({ cierreId: id, … })`), que es
  lo que un `cierreId IN (...)` plano NO garantiza (una orden que pasó por dos cierres del conjunto
  casaría con la gestión del otro). `tiendaId` sigue escrito al final de cada rama.
- `contarAportesPorCierre`: `cierreDetail.groupBy({ by: ["cierreId"], where, _count: true })`.
- `listarAportesDeCierres`: misma proyección que `listarOrdenesQueAportan` + `cierreId`; las gestiones
  se piden con `where: { cierreId: { in: tramo } }` y el repositorio se queda con las de la fila
  (`g.cierreId === d.cierreId`, se selecciona `cierreId`); orden `[cierreId, ...ORDEN_TOTAL]`.
- Los `cierreIds` se parten en tramos de `detalleMovimientoConfig.TRAMO_CIERRES_LOTE` (nuevo, 100 por
  defecto) para acotar el tamaño del `OR`. Consultas = conceptos distintos × tramos (R37).

## 4. Servicio (`DetalleEnLoteService`, nuevo)

`lib/services/DetalleEnLoteService.ts` + `lib/interfaces/services/IDetalleEnLoteService.ts`.

```ts
detallar(input: {
  movimientos: ReadonlyArray<{ id: string; categoria: string; monto: string; origenTipo: string; origenId: string | null }>;
  catalogo: "caja" | "tienda";
  tiendaId?: string;          // del ACTOR o de la cuenta de la oficina, nunca de la entrada libre
  conMensajero: boolean;      // false en /mi-wallet
}, actor: Actor): Promise<DetalleEnLoteServiceResult>;
```

1. **Fuente por movimiento**: la MISMA decisión que `resolverConjunto` (pasos 3 y 3b). Se extrae a una
   función pura compartida `fuenteDeMovimiento(movimiento, fuente)` en `lib/utils/aporte-por-orden.ts`
   que devuelve `{ criterio, cierreId } | { motivo }`, y `DetalleMovimientoService` pasa a usarla, para
   que fila y lote no puedan decidir distinto.
2. **Agrupar** los movimientos con reparto por concepto → conjunto de `cierreIds`.
3. **Contar** (`contarAportesPorCierre` por concepto y tramo). `total = Σ_movimiento cuenta[concepto][cierre]`.
   Si `total > descargaConfig.MAX_FILAS` ⇒ `limite_excedido` y NO se llama a `listarAportesDeCierres`
   (R39/R40). Así nunca se materializan más filas que el tope (espíritu de la ficha 191).
4. **Leer** filas (`listarAportesDeCierres`) y cabeceras (`cabecerasDeCierres`, una consulta).
5. **Derivar** cada aporte con `aporteDeOrden` (sin aritmética nueva) y armar, por movimiento y en el
   orden recibido, sus órdenes en `ORDEN_TOTAL`. `suma` = Σ aportes con `Prisma.Decimal`, `cuadra` =
   `suma.equals(monto)` (R22/R23). El navegador no suma.
6. `tiendaNombre` solo con `catalogo === "caja"`; `mensajeroNombre` solo con `conMensajero`.

Y ANTES del paso 1, **guard antes de la base** (R32/R33), igual que la 344: `catalogo === "caja"` o tienda en la
   oficina ⇒ `esAccesoTotal(actor.rol)`; `/mi-wallet` ⇒ `actor.rol === "adminTienda"` y
   `tiendaId === actor.usuarioId`. No se fía de que el servicio que leyó los movimientos ya lo hiciera.

**Orquestación**: `LibroConDetalleService` (nuevo, `lib/services/`), con dependencias estrechas
(`Pick<IWalletService, "listarCompleto">`, `Pick<IEstadoCuentaService, "leerCompleto" |
"leerMiTiendaCompleto">`, `IDetalleEnLoteService`). Cada método: completo de la superficie → si no es
`ok`, se devuelve tal cual (R38) → `detallar` con los movimientos de ese resultado → une. Las tres
acciones de §2.3 lo instancian en su composition root con TODAS sus dependencias (constructor sin
opcionales; un test lo afirma, por la lección del «composition root que no inyecta»).

## 5. Cliente

### 5.1 Adaptador de cliente (`components/shared/descarga-con-detalle.ts`, nuevo, sin React)

```ts
enlazarHojas<M>(args: {
  movimientos: readonly M[];
  idDe: (m: M) => string | null;            // null = línea sin número (saldo inicial)
  filaDe: (m: M) => DescargaFila;           // la proyección de HOY de la hoja de movimientos
  detalle: readonly DetalleDeMovimientoLoteDTO[];
  filaDetalleDe: (m: M, o: OrdenDelLoteDTO, cierre) => DescargaFila;
  textoEstado: (d: DetalleDeMovimientoLoteDTO | undefined) => string;
  claveEnlace: string; claveEstado: string;
}): { filas: DescargaFila[]; filasDetalle: DescargaFila[] }
```

Numera en el orden recibido (R15, R19, R20), pone el texto de estado (R16, R23) y proyecta cada orden.
Más `mensajeLimiteDetalle(total, limite)` (R39) junto a `mensajeLimite` en `descarga-resultado.ts`.

### 5.2 Columnas (un archivo por superficie, módulo puro)

| Superficie | Ámbito hoja principal | Ámbito hoja detalle | Archivo |
| --- | --- | --- | --- |
| Caja | `wallet-caja-libro` | `wallet-caja-detalle-orden` | `wallet-ledger-descarga-columnas.ts` (+ detalle) |
| Tienda (oficina) | `wallet-tienda-estado-cuenta` | `wallet-tienda-detalle-orden` | `app/(app)/wallet/tiendas/_components/estado-cuenta-tienda-descarga.ts` (nuevo) |
| Mensajero | `wallet-mensajero-estado-cuenta` | — | `app/(app)/wallet/mensajeros/_components/…` |
| Bodega | `wallet-satelite-estado-cuenta` | — | `app/(app)/wallet/satelites/_components/…` |
| `/mi-wallet` | `mi-wallet-estado-cuenta` | `mi-wallet-detalle-orden` | `app/(app)/mi-wallet/_components/mi-estado-cuenta-descarga.ts` (nuevo) |
| Listado tiendas / mensajeros / satélites | `wallet-tiendas-saldos` / `wallet-mensajeros-cuentas` / `wallet-satelites-saldos` | — | junto a cada tabla |

- Catálogos principales: los de HOY sin tocar claves, encabezados ni orden (R4).
- Catálogos de detalle: R25/R26/R27 (enumeración fijada con `toEqual` literal en su test: aquí el
  literal ES el contrato). «Movimiento» sale de `CATEGORIA_LABEL` (caja) o `rotulos.concepto(fila)`
  (estado de cuenta), los MISMOS que la hoja principal (R28); «Resultado» de `resultadosTexto` de cada
  superficie; el motivo de «Detalle por orden» de `DETALLE_MOVIMIENTO_SIN_REPARTO` (y su gemelo de
  `/mi-wallet`). Así el renombre de la 466 («devolución a origen») llega solo.
- «Cierre del» = día CR de `cierre.fecha`; «Fecha» = la de la fila principal.
- Cada ámbito se asigna como `ambitoColumnas: AMBITO_X` en UN solo módulo (guardia de ámbitos).
  `EstadoCuenta` (compartido) recibe de la superficie una prop `descargaDeLaSuperficie` ya armada; no
  asigna ningún ámbito él mismo.

### 5.3 Cableado

- **Caja** (`WalletModule`/`WalletLedger`): `obtenerFilasDescarga({ conDetalle })`. Sin detalle: hoy
  (`listarConAutoria(inputDeLibro(fw, fl))`). Con detalle: `listarMovimientosCompletoConDetalleAction
  (inputDeLibro(fw, fl))`, autoría de esos ids en tramos (como hoy), `enlazarHojas`.
- **Estado de cuenta**: `LectorEstadoCuenta` gana `leerCompletoConDetalle?`; solo lo dan el lector de
  la tienda (oficina) y el de `/mi-wallet`. `filasDelPeriodo` se parte: la línea del saldo inicial
  (posición según el orden de la 463) entra como fila sin número.
- **Mensajero, bodega y listados**: solo `ambitoColumnas` (R1, R7).

## 6. Flujo de una descarga con detalle (caja)

```
Descargar (con detalle)
 └─ listarMovimientosCompletoConDetalleAction(inputDeLibro)          ← UNA petición (R36)
      ├─ WalletService.listarCompleto(...)   limite? → limite_excedido{hoja:"movimientos"}
      └─ DetalleEnLoteService.detallar(movs)
           ├─ guard (acceso total)                                    (R32)
           ├─ fuenteDeMovimiento × N (en memoria)
           ├─ contarAportesPorCierre × (conceptos × tramos)           (R37)
           │    total > tope → limite_excedido{hoja:"detalle"}         (R39/R40)
           ├─ listarAportesDeCierres × (conceptos × tramos)
           ├─ cabecerasDeCierres × 1
           └─ aporteDeOrden + suma/cuadra                             (R21–R23)
 ├─ autoriaDelLibroCajaAction × ceil(N/100)   (ya existe)
 └─ enlazarHojas → construirDescarga({ ..., hojasAdicionales: [detalle] })
```

## 7. Puntos de contacto con la 463 (sin aprobar)

| De la 463 | Cómo lo usa la 464 | Si la 463 cambia al aprobarse |
| --- | --- | --- |
| `listarLibroCajaCompletoSchema` (§2.1) | Entrada de la acción con detalle de la caja | Se usa el que quede; la 464 no define esquema propio |
| `filtrosDelExtracto` + `q`/`sortBy`/`sortDir` (§2.2) | Entrada de las acciones del estado de cuenta (vía los completos existentes) | Igual |
| `inputDeLibro(fw, fl)` (§5.2) | Lo que la descarga de la caja envía | Si se llama distinto, se usa la traducción única que quede |
| `FiltrosDeLectura` con término y orden (§5.3) | Lo que `leerCompletoConDetalle` recibe | Igual |
| Saldo inicial primero/último según el orden (R43 de la 463) | La línea sin número sigue esa posición | La numeración no depende de ella |
| R42–R44 de la 463 (la descarga respeta filtros, orden y tope) | R9, R14, R38 aquí se apoyan en ellos | Si la 463 se reduce, R14 sigue diciendo «los mismos que la hoja sin detalle» |

**Orden de implementación**: la 464 se implementa sobre `dev` con la 463 ya mergeada. Si se adelanta,
las tareas T1–T6 (generador, control, repositorio, servicio) no tocan nada de la 463 y pueden ir antes;
el cableado (T8–T10) espera.

## 8. Alternativas descartadas

1. **Hoja de detalle «ancha»** (una fila por orden y cierre, columnas COD, flete, comisión, IVA, neto).
   Descartada como opción por defecto (Pregunta 1): (a) con el filtro de categoría o de chip vigente
   enseñaría conceptos que la hoja de movimientos no tiene, y la promesa «cuadra 1:1» se rompe; (b) el
   «neto» por orden sería una suma de dinero nueva que ningún productor hace hoy (la 344 prohíbe
   fórmulas nuevas, R46); (c) en la caja el COD recaudado no se reparte por orden, así que una columna
   COD saldría vacía en la caja y llena en la tienda. Con la forma larga, una tabla dinámica de Excel
   sobre «Movimiento» × «Guía» da la ancha si alguien la quiere.
2. **Filas de detalle intercaladas en la misma hoja** (debajo de cada movimiento). Descartada: la hoja
   deja de cuadrar 1:1 con el libro, la columna Monto suma dos veces el mismo dinero y filtrar la hoja
   en Excel mezcla dos granos.
3. **Un control de descarga propio de las wallets** en vez de ampliar el común. Descartada: el pedido es
   usar «el componente de descargas configurable de la app», y un segundo control es la divergencia
   que la 170 retiró (tope, mensajes y selector escritos dos veces).
4. **Detalle pedido por ids desde el cliente, en tramos** (como la autoría). Descartada: el tope
   quedaría evaluado en el navegador sumando tramos —la «media migración» que la 184 cerró— y la hoja
   de detalle podría hablar de un conjunto distinto del de la hoja de movimientos si el libro cambia
   entre llamadas. Una sola acción con los filtros (R36) lo evita.
5. **Llamar a `listarOrdenesQueAportan` por cada movimiento** en el servidor. Descartada: es el N+1
   (5000 movimientos = 10.000 consultas) que la ficha pide evitar (R37).
6. **`cierreId IN (...)` plano en un `where` nuevo.** Descartada: no correlaciona la gestión con su
   cierre y daría aportes de otro cierre a una orden que pasó por dos; además sería una segunda
   traducción del criterio. El `OR` de `buildWhere` reutiliza la única que hay.

## 9. Riesgos y cómo se cubren

| Riesgo | Cobertura |
| --- | --- |
| El lote dice algo distinto que el detalle de una fila | Test de integración DIFERENCIAL contra Postgres: para cada movimiento de un fixture con varios cierres, tiendas, una orden en dos cierres y una con dos gestiones, el lote = `verDetalleDeMovimientoCompleto` / `verDetalleDeMiMovimientoCompleto` / `verDetalleDeFilaDeCuenta` (R21) |
| `WHERE` probado solo con dobles (memoria del repo) | Integración del repositorio + mutación del `OR` (quitar la correlación de `cierreId` en la gestión) que debe ponerlo rojo |
| Fuga entre tiendas | Integración: cierre con órdenes de dos tiendas; `/mi-wallet` y tienda (oficina) solo ven las suyas (R34) |
| Romper a los ~30 consumidores de la descarga | R41: test del generador (una hoja, nombre y celdas iguales releyendo con exceljs) + suites de descarga existentes |
| Suma que no cuadra y nadie lo ve | R22 con fixture real; R23 con doble que fuerza la discrepancia y afirma el texto de la celda |
| Composition root sin inyectar | Test de las tres acciones: el servicio orquestador recibe las tres dependencias reales |
| Guardias de censo (`censo-tablas`, `ambito-columnas.guardia`, columnas sensibles con sonda de uuid) | Correr `./init.sh --rapido`; actualizar los censos en la misma tarea que añade cada ámbito |
| `lib/types/` en el diff ⇒ el modo rápido se niega | Esperado: el gate de esta ficha es `./init.sh` completo |
