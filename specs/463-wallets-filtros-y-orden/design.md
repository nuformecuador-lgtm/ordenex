# Ficha 463 — Diseño

> Reorganización de pantallas EXISTENTES (caja, cuatro estados de cuenta y el listado de tiendas).
> No hay pantalla ni módulo nuevo, así que **no pasa por `/design`** (la regla aplica a pantallas
> nuevas). Se reutilizan los controles compartidos que ya existen; lo único nuevo en
> `components/shared/` es un modo opcional de `FilterComponent`.

## 0. Lo verificado en el código (2026-10-01)

| Hecho | Dónde |
| --- | --- |
| La caja recarga libro + resumen + desglose con UN mismo input (`buildInput`) | `app/(app)/wallet/_components/WalletModule.tsx:275-307` |
| Los filtros de la caja (`WalletFiltros`) viven en la banda de la tarjeta del libro, al final | `WalletModule.tsx:443-449` |
| `inputDeFiltros` es la única traducción filtros→borde (libro, descarga, detalle de fila) | `WalletFiltros.tsx:81-91` |
| Resumen, desglose y detalle de fila parsean `listarMovimientosSchema` (o derivan de él) | `lib/actions/wallet.ts:306`, `lib/actions/wallet-egresos.ts:122`, `lib/types/wallet.ts:685` |
| `listarMovimientosSchema` es `.strict()` | `lib/types/wallet.ts:638-655` |
| Libro de caja ya en DESC con orden total (`fecha_movimiento, created_at, id`) | `lib/repositories/WalletMovimientoRepository.ts:279`, `:290` |
| Estado de cuenta: periodo con borrador + «Aplicar»; chips y cierre aplican al instante | `components/shared/estado-cuenta/EstadoCuenta.tsx:286-377` |
| Chips y cierre filtran FILAS; las tarjetas son las del periodo | `lib/types/estado-cuenta.ts:38-53`, `lib/services/EstadoCuentaService.ts:193-230` |
| Ventana del saldo corrido sobre la cuenta entera; paginado ASC al final | `lib/repositories/EstadoCuentaRepository.ts:186`, `:201`, `:233`; `ORDER BY` final `:244` (bodega) y `:266` |
| La línea de saldo inicial va en la página 1 y como primera fila del Excel | `EstadoCuenta.tsx:383`, `:195` |
| Clave SWR del estado de cuenta: sin término ni orden | `components/shared/estado-cuenta/estado-cuenta-clave.ts` |
| `FilterComponent` emite con debounce, sin modo «Aplicar» | `components/shared/FilterComponent.tsx:336-340`, props `:88-129` |
| `BuscadorFiltros` ya tiene `siembra` (hueco 1 de la 328, ficha 453) | `components/shared/BuscadorFiltros.tsx:136` |
| Contrato de orden compartido (`esquemaOrdenamiento`, `ordenTotal`, `claveDeOrden`) | `lib/types/ordenamiento-listado.ts` |
| Patrón de orden en la barra: `SegmentedToggle` dentro de `BuscadorFiltros` | `app/(app)/ordenes/_components/OrdenesListado.tsx:1418-1431` |
| Escapado de comodines LIKE ya existe | `lib/utils/escapar-like.ts` (`escaparComodinesLike`) |
| `/wallet/tiendas`: sin buscador; borde `.strict()` solo con `page`/`pageSize` | `SaldosTiendasTable.tsx:122`, `lib/types/wallet-tienda.ts:152` |
| `/wallet/mensajeros` ya usa `BuscadorFiltros` (molde para tiendas) | `CuentasPorPagarTable.tsx:265-271` |
| Superficies que montan `EstadoCuenta` | `EstadoCuentaTienda`, `EstadoCuentaMensajero`, `EstadoCuentaSatelite`, `MiEstadoCuenta` |

Nota sobre la ficha 328: su texto cita `MiWalletFiltros`, `DesglosePagosMensajero` y
`DesgloseMovimientosTienda`, que ya no existen en `app/`. El índice del grafo aún los devuelve
(rancio). Esta ficha cierra su hueco 2 con un solo consumidor real nuevo (la zona de la wallet).

## 1. Modelo de datos

**Sin migraciones, sin tablas, sin RLS nueva, sin índices nuevos.**

- El orden DESC sobre la misma tupla que ya se usa no cambia el plan: en la caja el índice de
  `fecha_movimiento` sirve igual en los dos sentidos; en el estado de cuenta el `ORDER BY` final se
  aplica sobre el resultado de la ventana, que ya se materializa entero hoy.
- El término se resuelve con `ILIKE '%…%'` sobre texto de una cuenta (estado de cuenta) o del rango
  filtrado (caja). Sin índice trigram: el conjunto ya está acotado por cuenta/periodo y el libro de la
  caja es de bajo volumen (producción arrancó vacía el 2026-08-25). Si algún día pesa, se mide antes.

## 2. Contratos de borde (zod)

### 2.1 Caja

Se separan los filtros por nivel **en el esquema**, no solo en la pantalla:

```ts
// lib/types/wallet.ts
// Base (SIN cambios de forma): periodo, A quién, tipo, categoría. La siguen usando resumen,
// desglose y detalle de fila (R12/R14). Sigue siendo .strict(): q/sortBy/sortDir ⇒ validation_error.
listarMovimientosSchema

// NUEVO: solo el libro (paginado) y su descarga.
export const CAMPOS_ORDEN_LIBRO = ["fecha"] as const;
export const listarLibroCajaSchema = listarMovimientosSchema
  .extend({
    q: z.string().trim().min(BUSQUEDA_LIBRO_MIN_CHARS).max(100).optional(),
    ...esquemaOrdenamiento(CAMPOS_ORDEN_LIBRO, "fecha", "desc"),
  })
  .strict();
export const listarLibroCajaCompletoSchema = listarLibroCajaSchema
  .omit({ page: true, pageSize: true }).strict();
```

- `listarMovimientosAction` y `listarMovimientosCompletoAction` pasan a parsear los esquemas nuevos.
- `verResumenCajaAction`, `verDesgloseEgresosAction` y `listarMovimientosDeFilaAction` NO cambian de
  esquema: al ser `.strict()` rechazan `q`/`sortBy`/`sortDir` (R14). Siguen aceptando `tipo` y
  `categoria` por compatibilidad del borde, pero la pantalla deja de enviarlos (R12).
- `BUSQUEDA_LIBRO_MIN_CHARS = 3` en `lib/config` (mismo valor que `BUSQUEDA_MIN_CHARS` de órdenes),
  compartido por caja y estado de cuenta.
- `q` vacío no viaja (lo filtra la pantalla); por debajo del mínimo ⇒ `validation_error` (el
  buscador ya no lo emite).

### 2.2 Estado de cuenta

```ts
// lib/types/estado-cuenta.ts — se suman a `filtrosDelExtracto` (las cuatro variantes heredan)
q: z.string().trim().min(BUSQUEDA_LIBRO_MIN_CHARS).max(100).optional(),
...esquemaOrdenamiento(CAMPOS_ORDEN_LIBRO, "fecha", "desc"),
```

- Default `desc` en el esquema: el Server Component que pre-lee la página 1 la recibe ya en «Más
  recientes» sin tocar `page.tsx` (R34/R47).
- `VentanaDeLibro` (interfaz del repositorio) gana `termino?: string`, `sortDir: DireccionOrden` y
  `conNombreRegistrador: boolean` (false en vista «tienda», R27).

### 2.3 Listado de tiendas

`listarSaldosTiendasPaginadoSchema` gana `busqueda: z.string().optional()` (molde exacto de
`listarCuentasPorPagarPaginadoSchema`); el completo lo hereda por `omit`.

## 3. Repositorios

### 3.1 `WalletMovimientoRepository.listar` / modo completo

- `q`: condición `OR` sobre `descripcion`, `wallet_anotacion.contraparte_nombre`,
  `wallet_anotacion.referencia` y el nombre de `usuario` de `registrado_por` (R25), con
  `escaparComodinesLike` (R28). La anotación y el usuario son relaciones 0..1, así que entran como
  `EXISTS`/`LEFT JOIN` sin multiplicar filas.
- `sortDir`: la tupla `fecha_movimiento, created_at, id` en el sentido pedido, LAS TRES en el mismo
  sentido (R36). En los dos caminos (Prisma y SQL con «A quién») se construye con `ordenTotal`.
- `agregarPorCategoriaYTipo` y el resto de agregados NO reciben `q` ni orden (no está en su tipo).

### 3.2 `EstadoCuentaRepository.paginar` / `paginaDeBodega`

- La CTE `libro` (ventana del saldo corrido) **no se toca**: sigue `ORDER BY fecha, created_at, id`
  ascendente dentro de `OVER`, así que el corrido es el mismo en los dos sentidos (R37).
- Solo cambia el `ORDER BY` final: `ASC` o `DESC` en las tres columnas (`fecha, created_at, id`; en
  bodega `fecha, orden, id`).
- El término se suma al `WHERE` exterior (que ya filtra periodo, chip y cierre después de la ventana):
  `l.descripcion ILIKE $t` y, si `conNombreRegistrador`, `OR NOMBRE_SQL ILIKE $t` (el `LEFT JOIN
  usuario` ya está ahí). El `count(*)` usa el mismo `WHERE`.

### 3.3 Saldos de tiendas

`busqueda` normalizada como en cuentas por pagar, en el `WHERE` del listado y del completo.

## 4. Servicios

- `EstadoCuentaService.leerCuenta`: propaga `q`, `sortDir` y `conNombreRegistrador = vista ===
  "oficina"`. **No** toca el cálculo de tarjetas ni la comprobación R22 (el término y el orden no
  entran en los totales del periodo).
- `comoCompleto` sin cambios.
- `WalletService` (caja): `listar` y `listarCompleto` reciben los campos nuevos; `verResumenCaja` y
  `verDesglose` no.

## 5. Componentes

### 5.1 `FilterComponent` — modo «Aplicar» (cierra el hueco 2 de la 328)

Prop opcional nueva: `aplicarConBoton?: { etiqueta?: string; onQuitar?: () => void }`.

- **Ausente ⇒ comportamiento idéntico al actual** (R22): mismo debounce, mismas emisiones.
- **Presente:** la selección de los controles es un BORRADOR; `onChange` se emite SOLO al pulsar el
  botón «Aplicar» (texto por defecto «Aplicar»), sin debounce (R21). El botón está deshabilitado si
  el borrador es igual a lo último emitido (R17) o si algún `dateRange` está inválido (R18; el control
  ya marca el rango invertido como inválido y no emite).
- `siembra` en modo «Aplicar» reemplaza borrador Y aplicado (sin emitir), para que «Quitar» desde
  fuera deje el botón en reposo.
- `leerDeUrl` lo pasa el consumidor; las wallets usan `false` (R31).

### 5.2 Caja (`WalletModule`)

Estado partido en dos:

```ts
type FiltrosWallet = { desde: string; hasta: string; aQuien?: AQuienFiltro };   // zona de la wallet
type FiltrosLibro  = { tipo: string; categoria: string; termino: string; sortDir: DireccionOrden };
```

- `inputDeWallet(fw)` ⇒ resumen, desglose, composición y detalle de fila (R12).
- `inputDeLibro(fw, fl)` ⇒ libro paginado y descarga (R42). Es la composición de la primera más los
  campos del libro; lo vacío no viaja (misma regla que `inputDeFiltros` hoy).
- `recargarTodo(fw, fl, page)` (R8/R20) y `recargarLibro(fw, fl, page)` (R9). `recargarTrasCambio`
  (registrar/anular/adjuntar) sigue siendo `recargarTodo`.
- **Zona de la wallet** (nuevo `WalletFiltrosCaja.tsx`, sustituye a `WalletFiltros.tsx`): banda encima
  de `CajaResumenCard` con texto de alcance (R2) + `FilterComponent` en modo «Aplicar» con un único
  filtro `dateRange` «Periodo» + `SelectorBuscable` de «A quién» que aplica al elegir (R20). Las
  opciones de «A quién» se leen con el periodo APLICADO.
- **Zona del libro** (nuevo `LibroCajaBarra.tsx`), pasada a la tabla por la prop `filtros` de
  `DataTable` (misma línea que la descarga, como en `/ordenes`):
  `BuscadorFiltros` (`leerDeUrl={false}`, `minChars=3`, placeholder que enumera los campos de R25,
  `onLimpiarTodo`) con hijos siempre visibles: `SegmentedToggle` de orden («Más recientes»/«Más
  antiguas», con texto, no solo icono) y `SegmentedToggle` Todo/Entra/Sale; y en el selector
  «Filtros» la clave `categoria`, que monta un `FilterComponent` `single` (inmediato, sin modo
  «Aplicar»: el libro es una sola lectura paginada, sin agregados).
- `WalletLedger` no cambia de contrato (sigue recibiendo un callback de descarga).

### 5.3 Estado de cuenta (`EstadoCuenta`)

- **Zona de la wallet**: sube ANTES de `encabezado` y de `TarjetasEstadoCuenta`. Texto de alcance
  (R2) + `FilterComponent` en modo «Aplicar» con un `dateRange` «Periodo». Sustituye al formulario
  Desde/Hasta propio (`:335-376`), cuyo aviso de periodo inválido pasa a ser el del control.
- **Zona del libro**: `BuscadorFiltros` encima de la tabla con hijos visibles: orden + `ChipsEstadoCuenta`
  (tal cual). La clave `cierre` se ofrece en el selector «Filtros» solo si la superficie pasa
  `selectorCierre`, y monta el selector que la superficie ya construye. Placeholder distinto en vista
  «tienda» (no nombra «quién registró», R27).
- Clave SWR: `FiltroEstadoCuenta` gana `termino` y `sortDir` (R41); `esClaveDeLaCuenta` sigue
  igual (prefijo + tipo + id), así que el refresco dirigido R30 de la 458-D no cambia.
- **Saldo inicial** (R38/R39): `TablaEstadoCuenta` recibe `posicionSaldoInicial: "primera" | "ultima"
  | null`. Con `asc` ⇒ `"primera"` en página 1; con `desc` ⇒ `"ultima"` solo si
  `page === ceil(total / pageSize)` (o `total === 0`). La línea no cuenta en `total`.
- **Descarga** (`filasDelPeriodo`): recibe término y orden en `FiltrosDeLectura`; el saldo inicial va
  delante con `asc` y detrás con `desc` (R43).

### 5.4 Listado de tiendas (`SaldosTiendasTable`)

Copia del molde de `CuentasPorPagarTable`: `BuscadorFiltros` sin `filtros` ni `onLimpiarTodo`,
término aplicado ⇒ página 1, término en la clave SWR y en la descarga (R45).

### 5.5 Textos (todos en `*-labels.ts` junto a cada superficie)

- Alcance de la zona de la wallet: «Estos filtros cambian toda la wallet».
- Alcance de la zona del libro: «Estos filtros solo afectan al libro de movimientos».
- Orden: «Ordenar el libro» (nombre del grupo), «Más recientes», «Más antiguas».
- Placeholder caja: «Buscar por descripción, nombre o referencia anotada, o quién registró».
- Placeholder oficina: «Buscar por descripción o quién registró»; `/mi-wallet`: «Buscar por descripción».
- Ninguno usa «SLA» (R48). Los literales los fija el implementador en el archivo de etiquetas y los
  tests los leen de ahí salvo los que son contrato (R2, R33), que se afirman como literal.

## 6. Flujo de una lectura (caja)

```
Aplicar periodo / elegir A quién ──► recargarTodo(fw, fl, 1)
     ├─ listarMovimientosAction(inputDeLibro)      ─► libro + total
     ├─ verResumenCajaAction(inputDeWallet)        ─► resumen + composición
     └─ verDesgloseEgresosAction(inputDeWallet)    ─► desglose
Término / Entra-Sale / categoría / orden ──► recargarLibro(fw, fl, 1)
     └─ listarMovimientosAction(inputDeLibro)      ─► libro + total   (cifras intactas)
```

Si una de las lecturas falla: toast y NO se pisa ningún estado (R49) — hoy ya es así en `recargar`,
se conserva.

## 7. Alternativas descartadas

1. **Debounce más largo en vez de modo «Aplicar».** Descartada: elegir un periodo son dos clics
   (desde y hasta) y un debounce dispara una lectura intermedia con solo «desde» sobre agregados de
   dinero, que es exactamente lo que el censo de la 326/328 dijo que no se debe hacer.
2. **`DateRangeFilter` suelto con un botón «Aplicar» propio en cada wallet.** Descartada: es volver a
   escribir el borrador local por pantalla —el patrón que la 326 censó como duplicado— y deja abierto
   el hueco 2 de la 328 para el siguiente consumidor.
3. **Ordenar en el cliente la página recibida.** Descartada: el libro pagina en el servidor; ordenar
   25 filas de 300 parecería correcto y sería falso (razonamiento de `lib/types/ordenamiento-listado.ts`).
4. **En el estado de cuenta, invertir también la ventana del saldo corrido.** Descartada: el saldo
   corrido es cronológico por definición; invertir la ventana daría saldos que no existieron nunca.
   Solo se invierte el `ORDER BY` final (R37).
5. **Mantener un único esquema de borde para libro y cifras y que la pantalla «no mande» el término a
   las cifras.** Descartada: con un esquema común, `verResumenCajaAction` aceptaría `q` y lo ignoraría
   en silencio — un fallo mudo. Con esquemas separados y `.strict()` el borde lo rechaza (R14).
6. **Poner el orden en la cabecera de la columna «Fecha».** Descartada por lo mismo que la 356 en
   `/ordenes`: el control debe estar siempre a la vista en la barra.

## 8. Riesgos y cómo se cubren

| Riesgo | Cobertura |
| --- | --- |
| Romper a los ~15 consumidores de `FilterComponent` | R22: test de que sin la prop las emisiones son idénticas (snapshot de llamadas con debounce) + suites existentes |
| Las cifras de la caja cambian sin que nadie lo note (pregunta abierta 1) | R46 con base de datos real: mismas cifras sin filtros; R9 con doble de acción: cero llamadas a resumen/desglose |
| El `WHERE` del término probado solo con dobles (memoria del repo) | Tests de integración contra Postgres para R24–R28, R36, R37 y una mutación del `WHERE` que debe ponerlos rojos |
| Saldo inicial en página equivocada con DESC | Test de componente para R38/R39 con `total` múltiplo y no múltiplo de `pageSize` |
| Fuga de nombres de Ordenex a la tienda por la búsqueda | R27: integración con un registrador de nombre conocido; buscarlo en `/mi-wallet` devuelve lo mismo que buscar un texto ausente |
| Guardias de censo (`censo-tablas`, contadores de cabecera) | Correr `./init.sh --rapido`; si una guardia lista archivos, actualizar su censo en la misma task |
