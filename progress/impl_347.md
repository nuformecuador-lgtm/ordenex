# Ficha 347 — bitácora de implementación (BACKEND)

> Rama `feature/347-dinero-por-producto`. Este documento cubre el **bloque B** de `tasks.md`
> (más `B2.1`, `G4` y el adelanto de `F2`). El bloque **F** (pantalla, descarga, composición de
> «Otros resultados») y las guardias `G1`, `G2`, `G3`, `G5` **no están hechas**: las consume el
> agente de frontend contra el contrato de §Contrato.

---

## T0 — Antes de tocar nada

### T0.1 — Los 14 símbolos, confirmados EN DISCO

Confirmados con `grep` sobre el archivo real, no con el índice del MCP.
**El MCP `codebase-memory` NO aparecía en mi conjunto de herramientas**, así que toda la
búsqueda de código de esta sesión se hizo con `grep`/`sed`. Queda dicho.

| Símbolo | Archivo | Línea |
| --- | --- | --- |
| `derivarIngresoOrden` | `lib/utils/ingreso-ordenex.ts` | 145 |
| `pagoTiendaOrdenex` | `lib/utils/ingreso-ordenex.ts` | 352 |
| `resolverFlete` | `lib/utils/ingreso-ordenex.ts` | 121 |
| `CRITERIO_DE_APORTE` | `lib/utils/aporte-por-orden.ts` | 163 |
| `CRITERIO_COD_RECAUDADO` | `lib/utils/aporte-por-orden.ts` | 221 |
| `satisfaceCriterio` | `lib/utils/aporte-por-orden.ts` | 245 |
| `CriterioDeAporte` | `lib/utils/aporte-por-orden.ts` | 126 |
| `OrdenCongelada` | `lib/utils/aporte-por-orden.ts` | 262 |
| `GestionDelCierre` | `lib/utils/aporte-por-orden.ts` | 273 |
| `tarifaDe` | `lib/utils/cierre-detalle.ts` | 93 |
| `DETALLE_SELECT` | `lib/utils/cierre-detalle.ts` | 22 |
| `condicionesDeConsulta` | `lib/repositories/ConteoPorStatusRepository.ts` | 107 |
| `claveConPrefijo` | `lib/analytics/entregas-conteo.ts` | 470 |
| `etiquetaDeDesenlace` | `app/(app)/analitica/_components/entregas/ConteoEntregasAnillo.tsx` | 84 |

Los 14 existen. Ninguno hay que reabrir.

### T0.2 — Los censos, fotografiados en verde ANTES de tocar nada

Medidos, no copiados del spec (`npx vitest run` sobre los tres archivos + `grep` sobre el censo):

| Número | Valor de partida |
| --- | --- |
| `TOTAL_ARCHIVOS_CON_DATATABLE` | **32** |
| `TOTAL_INSTANCIAS_DATATABLE` | **32** |
| `totalCensado` | **33** |
| tablas `con_descarga` | **22** |
| tablas `fuera` | **11** |
| `METRICAS.length` | **25** |

`cobertura-tablas.guardia`, `alcance-fuente-unica.guardia` y `alcance-dinero.guardia`:
**3 archivos, 23 tests, todos verdes** antes de empezar.

⚠ **Los cinco censos siguen exactamente igual al cerrar el backend**, y eso es lo correcto: el
backend no monta ninguna `<DataTable>` y no añade ninguna métrica. `G5` (mover
`TOTAL_*`/`totalCensado`/`con_descarga`) es del bloque de frontend, cuando exista el panel.
`CAMPOS_DE_PRESENTACION` **sí** se movió (de 3 a 4), por el adelanto de F2 — ver §F2.

### T0.3 — El coste de la consulta de dinero, medido

Sobre la **base local** (`localhost:5432`, `prisma migrate status` = «up to date»), con el SQL de
`design.md §5.2` y **sin filtro de fecha**:

| | filas | órdenes distintas | wall |
| --- | --- | --- | --- |
| **dinero** | **18** | **17** | 276 ms (primera llamada, incluye conexión) |
| **volumen** (la de la 345) | **62** | — | 2 ms |

`EXPLAIN ANALYZE` de la de dinero: `Planning Time 1.890 ms`, **`Execution Time 0.439 ms`**,
`Buffers: shared hit=88`, sin un solo `read`. El plan es `Sort ← Hash Left Join ×2 ← Nested Loop
Left Join ← Hash Join(orden × gestion_orden)`, con `Memoize` sobre `order_status` y `usuario`. Las
`Seq Scan` son de tablas de 40–67 filas: en esta base el planificador no tiene motivo para usar
índice.

**Órdenes vivas en la base local: 67.** En producción son **768** (dato del spec). La comparación
que sostiene `design.md §1`: la lectura de volumen devuelve **62** filas (crece con el CATÁLOGO) y
la de dinero **18** (crece con las VENTAS). Hoy la de dinero devuelve *menos*, pero la asíntota es
la contraria y por eso lleva tope (R76).

⚠ **Lo que esta medición NO dice**: cómo se comporta con 768 órdenes y con el volumen de
producción. La base local es de semilla y desarrollo. El tope de 5.000 filas no se roza ni de
lejos en ninguno de los dos tamaños.

### T0.4 — `claveConPrefijo` NO incluye la concesión: el sufijo hace falta

Citado del cuerpo real (`lib/analytics/entregas-conteo.ts:470-486`), la clave se compone de
**diez** componentes y ni uno es el dinero:

```
[prefijo, d=<desdeFecha>, h=<hastaFecha>, a=<alcance>, z=, p=, c=, s=, t=, x=].join(SEP)
```

La premisa de R9 y de `design.md §6.3` es **cierta**: sin sufijo, dos actores con el mismo alcance
de datos y distinta concesión comparten entrada. El sufijo `$=<concedido|denegado>` se añade en
`claveDeConteoProductos`, **sin tocar el cuerpo compartido** (mismo patrón que
`claveDeConteoHoyGestion`). Mutación M5 verificada — ver §Mutaciones.

---

## Archivos

### Creados

| Archivo | Qué es |
| --- | --- |
| `lib/utils/dinero-por-producto.ts` | Módulo PURO: `CRITERIO_RECAUDO_ENTREGA`, `RESULTADOS_QUE_APORTAN` (derivado), `esLiquidada`, `repartoDeOrden`, `aporteEsCero` |
| `lib/interfaces/repositories/IDineroProductosRepository.ts` | Contrato + `FilaDineroCruda` + `LecturaDineroProductos` |
| `lib/repositories/DineroProductosRepository.ts` | El SQL del dinero |
| `lib/types/dinero-productos.ts` | DTOs del detalle + `detalleDineroProductoSchema` (`.strict()`) |
| `lib/services/DetalleDineroProductoService.ts` | El detalle orden por orden |
| `lib/actions/detalle-dinero-producto.ts` | Server Action del detalle (`@sin-superficie` hasta que llegue F5) |
| `tests/unit/utils/dinero-por-producto.test.ts` | 26 casos |
| `tests/unit/analytics/productos-dinero-alcance.test.ts` | 19 casos |
| `tests/unit/analytics/dinero-productos-sql.test.ts` | 26 casos |
| `tests/unit/analytics/conteo-productos-dinero.test.ts` | 25 casos |
| `tests/unit/analytics/detalle-dinero-producto.test.ts` | 26 casos |
| `tests/unit/analytics/_dinero-falso.ts` | fixtures compartidos (no es archivo de test) |
| `tests/integration/repositories/dinero-productos.int.test.ts` | 14 casos contra **Postgres real** |

### Modificados

| Archivo | Qué cambió |
| --- | --- |
| `lib/analytics/metrics.ts` | `+ ALCANCE_PRODUCTOS_DINERO` (`METRICAS.length` NO se mueve: sigue en 25) |
| `lib/analytics/productos-consulta.ts` | `+ resolverAlcanceProductosDinero`, `+ dinero` en `ConsultaProductos`, quinto paso de la preparación, sufijo `$=` en la clave |
| `lib/analytics/presentacion.ts` | `+ productosDinero` (adelanto de F2, ver §F2) |
| `lib/services/ConteoProductosService.ts` | tercer parámetro de constructor, `leerDinero`, `ordenesQueAportan`, `cifrasDelGrupo`, `fundirDinero`, `claveDeGrupoProducto`, `ordenesAcompanadas` en `fundir` |
| `lib/types/conteo-productos.ts` | `+ ordenesAcompanadas`, `+ dinero` por fila, `+ DineroProductoDTO`, `+ EstadoDineroProductos` |
| `lib/actions/conteo-productos.ts` | construye el servicio con los DOS repositorios |
| `tests/unit/analytics/alcance-dinero.guardia.test.ts` | **bloque nuevo** de `design.md §3.3` (G4), con dos autocomprobaciones. Los dos bloques anteriores NO se tocan |
| `tests/unit/analytics/tablero-operativo-frontera.guardia.test.ts` | `CAMPOS_DE_PRESENTACION` 3 → 4, con su motivo escrito |
| `tests/unit/analytics/presentacion.test.ts` | el contrato de claves + caso nuevo de los cinco roles |
| `tests/unit/analytics/conteo-productos-servicio.test.ts` | constructor con el repo de dinero; el `toEqual` literal del DTO reescrito **a mano** |
| `tests/unit/utils/aporte-por-orden-equivalencia.test.ts` | `+ 2` casos: las 40 combinaciones del criterio nuevo y las 4 celdas donde DIVERGE del ledger |
| `tests/components/*.tsx`, `tests/unit/{analytics,descarga}/*.ts` | fixtures del DTO con los dos campos nuevos (mínimo para compilar; las aserciones de UI son de F) |

**Ni migración, ni tabla, ni columna, ni índice, ni RLS** (R79): `git status` no muestra nada bajo
`db/migrations/**`.

---

## Las 7 preguntas, y dónde quedó escrita cada decisión

| | Decisión | Dónde está escrita |
| --- | --- | --- |
| ⟨Q1⟩ | Recaudado = **solo entregas**, con filtro explícito | docstring de `CRITERIO_RECAUDO_ENTREGA`, con los números («0 gestiones con recaudo que no sean entrega») |
| ⟨Q2⟩ | Liquidado exige cierre **aprobado** | docstring de `ESTADO_CIERRE_LIQUIDADO` («un cierre solicitado se ha llegado a borrar») |
| ⟨Q3⟩ | Anuladas **excluidas** | cabecera de `DineroProductosRepository`, con «2 gestiones, ₡33.564, las dos fuera de todo cierre y de todo snapshot» |
| ⟨Q4⟩ | Tope = la configuración de la 344 | `topeDeOrdenes()` en el repositorio + caso `⟨Q4⟩` en el test de SQL |
| ⟨Q5⟩ | Descarga del detalle **fuera** | no se implementó `G2`; ver §Lo dudoso |
| ⟨Q6⟩ | Rótulos de la wallet | es de pantalla; el contrato entrega las cifras separadas y no impone rótulo |
| ⟨Q7⟩ | Sin acción | una sola lectura, un solo parser: `claveDeGrupoProducto` es la única composición |

---

## F2, adelantado — y por qué

`lib/analytics/presentacion.ts` gana `productosDinero: "visible" | "oculta"`, y
`CAMPOS_DE_PRESENTACION` del guardia de frontera pasa de 3 a 4.

**Es una tarea del bloque F en `tasks.md` y la hice yo.** El motivo: el archivo vive en `lib/` y
es la **proyección del permiso** que declara mi tabla (`ALCANCE_PRODUCTOS_DINERO`); dejar un
cambio de `lib/` a un agente de frontend es peor. **Lo que NO hice es `F3`**: `app/(app)/analitica/
page.tsx` sigue sin pasar la prop, y la tabla sigue sin recibirla. Eso es de frontend.

---

## Contrato para el frontend

### 1. La tabla — `consultarConteoProductos(raw, deps?)` (`lib/actions/conteo-productos.ts`)

**No cambia su entrada.** Sigue siendo el filtro `.strict()` de la sección de entregas (seis
facetas + rango opcional). El campo `dinero` **NO se manda**: lo resuelve el servidor.

Lo que cambia es el DTO (`lib/types/conteo-productos.ts`):

```ts
ConteoProductosDTO {
  filas: readonly FilaProductoDTO[]
  ordenes: number
  ordenesSinProducto: number
  dinero: EstadoDineroProductos          // NUEVO
  lastSync: string
}

EstadoDineroProductos =
  | { estado: "concedido" }
  | { estado: "denegado" }
  | { estado: "limite_excedido"; limite: number }

FilaProductoDTO {
  tiendaId, tienda, producto, unidades, ordenes, porStatus      // de la 345/346, sin cambios
  ordenesAcompanadas: number                                    // NUEVO — entero, ADITIVO
  dinero: DineroProductoDTO | null                              // NUEVO
}

DineroProductoDTO {
  recaudado: string                       // STRING escala 2
  liquidado: {
    recaudado: string                     // STRING escala 2
    ordenex:  string | null               // STRING escala 2, o AUSENTE
    tienda:   string | null               // STRING escala 2, o AUSENTE
    ordenes:  number                      // entero
  }
  pendiente: { recaudado: string; ordenes: number }   // recaudado STRING escala 2
  retorno: string | null                  // STRING escala 2, o AUSENTE
}
```

**Campos que son DINERO (STRING escala 2, `money()` de `lib/config/moneda.ts`, jamás
`Number()`/`parseFloat`/`toFixed`):** `dinero.recaudado`, `dinero.liquidado.recaudado`,
`dinero.liquidado.ordenex`, `dinero.liquidado.tienda`, `dinero.pendiente.recaudado`,
`dinero.retorno`.
**Campos que son ENTEROS (conteos, no dinero):** `ordenes`, `unidades`, `ordenesAcompanadas`,
`liquidado.ordenes`, `pendiente.ordenes`.

**Los `null` son obligatorios y significan «no hay», no «cero» (R30):** si la fila no tiene
NINGUNA orden liquidada, `ordenex`, `tienda` y `retorno` llegan `null`. Se pintan `—`, **nunca
`0,00`**. `liquidado.recaudado` en ese caso vale `"0.00"` (es una suma sobre un conjunto vacío, y
hace falta para que `liquidado.recaudado + pendiente.recaudado === recaudado` siga siendo cierta).

**`fila.dinero === null`** significa una de tres, y `datos.dinero.estado` dice cuál: `denegado`
(el rol no lo tiene), `limite_excedido` (el recorte supera el tope) o `concedido` pero esa fila no
tiene ninguna orden que aporte.

⚠ **`dinero.recaudado` NO SE PUEDE SUMAR HACIA ABAJO.** Es el importe COMPLETO de cada orden
atribuido a CADA producto que contiene. `ordenesAcompanadas` dice en cuántas de sus órdenes eso
está pasando.

**Estados de salida (sin cambios respecto de la 345):** `ok` · `unauthenticated` · `forbidden`
(sin motivo) · `validation_error` con `fieldErrors`.

### 2. La presentación — `recorteDePresentacion(actor)` (`lib/analytics/presentacion.ts`)

Gana `productosDinero: "visible" | "oculta"`. La página **no puede** importar `metrics`; lee
`recorte.productosDinero` y lo pasa como prop (tarea F3, **pendiente**).

### 3. El detalle — `consultarDetalleDineroProducto(raw, deps?)` (`lib/actions/detalle-dinero-producto.ts`)

**Entrada, `.strict()` en los dos niveles:**

```ts
{
  filtro: <el MISMO filtro de la sección>,   // con tienda_id: [<la tienda de la fila>]
  producto_clave: string,                    // min 1, sin tope de longitud
  page?: number,                             // int >= 1, default 25 → 1
  pageSize?: number,                         // int 1..100, default 25
}
```

- `filtro.tienda_id` DEBE traer **exactamente una** tienda: es el `tiendaId` de la fila que se
  abrió. Cero o dos ⇒ `validation_error`.
- `producto_clave` se normaliza en el servidor con `claveDeProducto`: da igual `"base c"`,
  `"BASE C"`, `"  Base   C  "` o `"Base C."`.
- Cualquier clave desconocida (`dinero`, `rol`, `tiendaId` suelto…) ⇒ `validation_error` **sin
  tocar la base y sin resolver el actor**.

**TODOS los estados de salida:**

| `status` | Cuándo | Qué trae |
| --- | --- | --- |
| `ok` | hay órdenes que aportan | `datos: DetalleDineroProductoPayload` |
| `vacio` | ese producto no tiene NINGUNA orden que aporte | nada |
| `limite_excedido` | el recorte supera el tope | `limite: number` |
| `unauthenticated` | sin sesión | nada |
| `forbidden` | rol sin analítica de productos, rol sin dinero, o tienda ajena | nada, y **sin motivo** |
| `validation_error` | la entrada no valida | `fieldErrors: Record<string, string[]>` |

**El payload:**

```ts
DetalleDineroProductoPayload {
  producto: string          // forma visible, re-derivada en el servidor
  tiendaNombre: string
  totales: DineroProductoDTO   // las MISMAS cifras que la fila (R38)
  total: number             // N órdenes del CONJUNTO, contado por el servidor
  page: number
  pageSize: number
  ordenes: readonly OrdenDineroDTO[]
}

OrdenDineroDTO {
  ordenId: string           // rowKey. NUNCA al archivo
  guia: string              // num_guia si la hay, si no num_remision
  destinatario: string
  resultados: readonly GestionResultado[]
  estado: "liquidada" | "pendiente"
  recaudado: string         // DINERO, STRING escala 2
  ordenex: string | null    // DINERO, o AUSENTE si está pendiente
  tienda:  string | null    // DINERO, o AUSENTE
  retorno: string | null    // DINERO, o AUSENTE
}
```

Orden total de las filas: `numGuia` asc (numérico, `null` al final) → `guia` → `ordenId`.
Ninguna fila del detalle aporta cero en las cuatro cifras (R39).

### 4. Lo que el frontend TIENE que hacer y aún no está

`F1` (composición de «Otros resultados»), `F3` (page.tsx pasa la prop), `F4` (columnas + avisos +
fila expandible), `F5` (panel + SWR), `F6` (tests de componente), `G1`, `G2`, `G3`, `G5`.
Y **borrar la anotación `@sin-superficie`** de `consultarDetalleDineroProducto` al cablear el
panel: la guardia también falla cuando una anotación sobrevive a su motivo.

---

## Mutaciones — las 9 aplicadas, con la línea de fallo REAL

Cada una: aplicada al árbol, tests ejecutados, línea copiada, árbol restaurado y **re-medido
verde** después.

### M1 — quitar `estado = 'aprobado'` del criterio de liquidada · **ROJA (3)**
```
FAIL tests/unit/utils/dinero-por-producto.test.ts > un cierre SOLICITADO no liquida (⟨Q2⟩…)
AssertionError: expected true to be false
FAIL tests/unit/analytics/conteo-productos-dinero.test.ts > ⚠ M1 · un cierre NO aprobado deja el dinero en PENDIENTE
AssertionError: solicitado: expected '0.00' to be '10000.00'
FAIL tests/integration/repositories/dinero-productos.int.test.ts > (e) R26 · un cierre SOLICITADO no liquida…
AssertionError: expected '0.00' to be '5000.00'
```

### M2 — sacar el `tiendaId` del recorte · **tres variantes medidas, y una SOBREVIVE**

**M2a — `condicionDeAlcance` case `"tienda"` devuelve `TRUE`. → los tests de integración
SOBREVIVEN. Solo cae el de SQL:**
```
FAIL tests/unit/analytics/dinero-productos-sql.test.ts > R7 · el ALCANCE es la PRIMERA condicion…
AssertionError: expected 'TRUE' to contain 'o."tienda_id"'
```
⚠ **Y sobrevive TAMBIÉN el test de integración de la ficha 345** (`conteo-productos.int.test.ts`,
8/8 en verde con la mutación puesta). Es un hallazgo, no una excusa: **la afirmación de
`impl_345.md` de que esa mutación deja aquel archivo rojo ya no es cierta.** El motivo es
concreto: para un `adminTienda`, `recortarFiltroConteoEntregas` escribe la tienda **también en la
faceta del filtro**, así que `condicionesDeConsulta` emite `o."tienda_id" IN ($1)` además del
recorte de alcance. Son **dos condiciones independientes** que hacen lo mismo; matar una deja la
otra en pie. Es defensa en profundidad real, pero significa que **ningún test de integración de
este repo mide el recorte de alcance en aislado**.

**M2b — quitar la faceta `tienda_id` de `condicionesDeConsulta` (alcance intacto). → los tests de
integración SOBREVIVEN; caen dos tests preexistentes de la 122/345:**
```
FAIL tests/unit/analytics/conteo-por-status-sql.test.ts > cada faceta se traduce a su columna de `orden` con `IN (...)`
FAIL tests/unit/analytics/conteo-productos-sql.test.ts > el repositorio no interpola ningun id: todos viajan como parametros
```

**M2c — las DOS a la vez (que es «sacar el `tiendaId` del recorte» de verdad). → ROJA, 6 casos, y
el dinero de la otra tienda se cuela en la suma:**
```
FAIL tests/integration/repositories/dinero-productos.int.test.ts > (a) R7/R43 · un adminTienda NO ve NI UNA fila de dinero de la otra tienda
AssertionError: expected [ { …(12) }, { …(12) }, …(17) ] to deeply equal []
FAIL … > (a ter) y su DINERO tampoco se mezcla: las cifras de A no contienen las de B
AssertionError: expected { recaudado: '10000.00', …(3) } to be undefined
FAIL … > (j) R38/R40 · EL CUADRE — las CINCO aserciones sobre el detalle real
AssertionError: expected '45000.00' to be '35000.00'
FAIL tests/integration/repositories/conteo-productos.int.test.ts > (d) un adminTienda NO ve ni una fila de la otra tienda (R54)
AssertionError: expected [ { …(5) }, { …(5) }, { …(5) }, …(60) ] to deeply equal []
```

### M3 — meter `retorno` dentro de `ordenex` · **ROJA (5)**
```
FAIL tests/unit/utils/dinero-por-producto.test.ts > una rechazada liquidada aporta retorno y NO toca `ordenex` ni `tienda`
AssertionError: expected '2260.00' to be '0.00'
FAIL tests/unit/utils/dinero-por-producto.test.ts > R20 sigue siendo cierta con una entrega Y un rechazo en la misma orden
AssertionError: expected '6215.00' to be '3955.00'
FAIL tests/unit/analytics/conteo-productos-dinero.test.ts > ⚠ MUTACION M3 · una rechazada liquidada suma `retorno` y deja `ordenex` intacto
AssertionError: expected '6215.00' to be '3955.00'
FAIL tests/integration/repositories/dinero-productos.int.test.ts > (h) … las cifras del grupo, CALCULADAS A MANO
AssertionError: expected '17402.00' to be '15142.00'
FAIL tests/integration/repositories/dinero-productos.int.test.ts > (v4) EL CUADRE CONTRA LA BASE, con un SQL escrito A MANO…
AssertionError: expected '15142.00' to be '17402.00'
```

### M4 — escribir `["entregada","rechazada"]` a mano · **ROJA (1)**
```
FAIL tests/unit/utils/dinero-por-producto.test.ts > un septimo concepto con un resultado nuevo aparece SOLO en la lista sin tocar el modulo
AssertionError: expected [ 'entregada', 'rechazada' ] to deeply equal [ 'entregada', 'rechazada', …(1) ]
```
Los otros 51 casos del archivo siguen **verdes** con la lista escrita a mano: el caso del concepto
inyectado es lo único que distingue derivar de escribir.

### M5 — quitar el sufijo de concesión de la clave de caché · **ROJA (1)**
```
FAIL tests/unit/analytics/productos-dinero-alcance.test.ts > ⚠ MUTACION M5 · dos consultas IGUALES salvo la concesion NO comparten entrada
AssertionError: expected 'conteo-productosd=*h=*\u0…' not to be 'conteo-productosd=*h=*\u0…'
```
⚠ Los 47 casos restantes (incluidos los de caché de la 345) siguen **verdes**: ninguna prueba
anterior ejercitaba dos concesiones distintas. Sin ese caso, la fuga no la vería nadie.

### M6 — `null` → `"0.00"` cuando no hay nada liquidado · **ROJA (9)**
```
FAIL tests/unit/utils/dinero-por-producto.test.ts > una entrega SIN cierre trae su recaudo y NINGUNA cifra de reparto
AssertionError: expected '0.00' to be null
FAIL tests/unit/analytics/conteo-productos-dinero.test.ts > ⚠ M6 · sin nada liquidado el reparto es `null`, NUNCA `"0.00"`
AssertionError: expected '0.00' to be null
FAIL tests/unit/analytics/detalle-dinero-producto.test.ts > una fila por ORDEN, con guia, destinatario, resultados, estado y sus cuatro cifras
AssertionError: expected { ordenId: 'oC', guia: '2', …(7) } to match object { estado: 'pendiente', …(4) }
FAIL tests/integration/repositories/dinero-productos.int.test.ts > (e) R26 · un cierre SOLICITADO no liquida…
```

### M7 — `total` = filas de la página en vez del conjunto · **ROJA (2)**
```
FAIL tests/unit/analytics/detalle-dinero-producto.test.ts > ⚠ MUTACION M7 · `total` es el del CONJUNTO, no el de la pagina
AssertionError: expected 2 to be 4
FAIL tests/unit/analytics/detalle-dinero-producto.test.ts > una pagina mas alla del final viene vacia pero con el total del conjunto
AssertionError: expected +0 to be 4
```
⚠ El test de integración **sobrevive** a M7, y se sabe por qué: allí el conjunto (5 órdenes) cabe
entero en la página (25). El caso que lo mata es el de unidad, con `pageSize: 2`.

### M10 — dejar que una orden en dos cierres cuente dos veces · **ROJA (9)**
```
FAIL tests/unit/analytics/conteo-productos-dinero.test.ts > ⚠ MUTACION M10 · sus aportes se SUMAN y el cardinal NO se dobla
AssertionError: expected 2 to be 1
FAIL tests/unit/analytics/detalle-dinero-producto.test.ts > R35 · una orden con DOS gestiones sale UNA vez, con la suma y sus dos resultados
AssertionError: expected [ …(2) ] to have a length of 1 but got 2
FAIL tests/integration/repositories/dinero-productos.int.test.ts > (i) R18 · en los CARDINALES la orden de dos cierres cuenta UNA sola vez
AssertionError: expected 5 to be 4
FAIL tests/integration/repositories/dinero-productos.int.test.ts > (j) … EL CUADRE …
AssertionError: expected [ 't347-1bdb8da2-850', …(5) ] to deeply equal [ 't347-1bdb8da2-850', …(4) ]
```

### M-anuladas (⟨Q3⟩) — incluir las gestiones anuladas · **ROJA (5)**
```
FAIL tests/unit/analytics/dinero-productos-sql.test.ts > ⟨Q3⟩ · el JOIN a `gestion_orden` EXCLUYE las anuladas
FAIL tests/integration/repositories/dinero-productos.int.test.ts > (b) ⟨Q3⟩ · las gestiones ANULADAS quedan fuera, aunque hayan recaudado
AssertionError: expected true to be false
FAIL tests/integration/repositories/dinero-productos.int.test.ts > (h) … las cifras del grupo, CALCULADAS A MANO
AssertionError: expected '68564.00' to be '35000.00'
```
Los **₡33.564** sembrados a propósito con el importe medido en producción se cuelan exactamente en
la cifra. Es la evidencia más directa de por qué la decisión importa.

### M8 y M9 — **NO aplicadas**: son de frontend
M8 (lista de desenlaces escrita a mano en la composición) y M9 (total al pie de una columna de
dinero) muerden `otros-resultados.ts` y `ProductosTabla.tsx`, que no existen todavía. Las tiene
que aplicar el agente de frontend con `F1` y `G3`.

---

## V4 — el cuadre contra la base, en SQL y por fuera del código

`tests/integration/repositories/dinero-productos.int.test.ts > (v4)`. La fórmula se **vuelve a
escribir en SQL** —flete + IVA + comisión + IVA sobre las columnas CONGELADAS de `cierre_detail`,
sin llamar a `derivarIngresoOrden`, ni a `pagoTiendaOrdenex`, ni a `repartoDeOrden`— y se compara
con lo que produce el código sobre EXACTAMENTE las mismas filas. Cuadran las tres cifras.

**Demostración de que no es tautológico:** una variante del mismo SQL que afloja el filtro de
resultado (deja entrar la RECHAZADA) da **otro número** (`ordenex` mayor), y el test lo afirma. Y
la mutación M3 lo pone rojo con `expected '15142.00' to be '17402.00'`.

⚠ **Lo que NO se pudo hacer: V4 contra datos REALES.** Medido en la base local:
**cero gestiones `entregada` dentro de un cierre `aprobado`.** Las 21 gestiones con cierre
aprobado son 10 `reprogramada`, 5 `devuelta`, 5 `rechazada` y 1 `incidente`. O sea: en esta base
**no existe ni un solo `liquidado.ordenex` real**, solo `retorno`. Producción está vacía a
propósito desde el 2026-08-25. El cuadre se hace sobre datos SEMBRADOS por el propio test — que
sigue siendo una comprobación válida (dos implementaciones independientes de la fórmula sobre las
mismas filas), pero **no** es «tres productos reales con dinero» como pedía `tasks.md V4`. Queda
como deuda para cuando producción tenga cierres aprobados con entregas.

---

## Salida real de las órdenes de verificación

```
$ npx tsc --noEmit
TSC_EXIT=0
```

```
$ npx eslint .
✖ 145 problems (0 errors, 145 warnings)
ESLINT_EXIT=0
```
(145 warnings, todas `@typescript-eslint/no-unused-vars` sobre parámetros `_x` de dobles de test,
heredadas de `dev` y no tocadas por esta ficha. **Cero errores.**)

```
$ npx vitest run          # suite COMPLETA
 Test Files  1 failed | 1643 passed (1644)
      Tests  1 failed | 23129 passed | 26 skipped (23156)
   Duration  510.89s
VITEST_EXIT=1
```
**El único archivo rojo de los 1.644 es el heredado.** `grep "FAIL"` sobre el log entero devuelve
exactamente una línea, la de abajo. Los 26 `skipped` son los tests que exigen Postgres en suites
que lo declaran opcional; los de esta ficha **corrieron** (14 casos de
`dinero-productos.int.test.ts`, `passed`, no `skipped`).

**El único rojo tolerado, heredado de `dev`:**
```
FAIL tests/unit/guards/superficie-de-uso.guardia.test.ts > ninguna Server Action de `lib/actions/**` es inalcanzable…
+ [ "lib/actions/tarifas.ts:67 obtenerTarifa" ]
```
Verificado que la acción NUEVA de esta ficha (`consultarDetalleDineroProducto`) **no** aparece en
esa lista: lleva su `@sin-superficie` con motivo, como hizo la 345.

---

## Trazabilidad `R<n> → test`

**Backend (bloque B + G4 + F2).** Los requisitos marcados `→ F` los cubre el bloque de frontend y
**no están cubiertos todavía**.

| R | Dónde se cubre (nombre EXACTO del caso) |
| --- | --- |
| R1 | `productos-dinero-alcance` › «declara los cinco roles y ninguno mas» |
| R2 | `productos-dinero-alcance` › «se cumple para los CINCO roles, recorriendo `ROLES_ANALITICA`» · `alcance-dinero.guardia` › «(1) R2 · para los CINCO roles: prohibido, o EXACTAMENTE el alcance del volumen» + «(1 ter) AUTOCOMPROBACION…» |
| R3 | `productos-dinero-alcance` › «maestro y admin: concedido y con alcance GLOBAL (todas las tiendas)» |
| R4 | `productos-dinero-alcance` › «R4 · adminTienda: concedido y ACOTADO a su propia tienda, en el alcance de la consulta» |
| R5 | `conteo-productos-dinero` › «cuenta las llamadas: cero» · `detalle-dinero-producto` › «R5 · un rol con el dinero denegado no recibe detalle, aunque forje la consulta» · `productos-dinero-alcance` › «R5 · adminSatelite y mensajero: DENEGADO» |
| R6 | `presentacion` › «FICHA 347 · `productosDinero` para los CINCO roles, y sin nombrar ninguno en el modulo» · **el render → F6** |
| R7 | `dinero-productos-sql` › «R7 · el ALCANCE es la PRIMERA condicion…» + «R7 · el id de la tienda viaja como PARAMETRO…» · `dinero-productos.int` › «(a) R7/R43 · un adminTienda NO ve NI UNA fila de dinero de la otra tienda» |
| R8 | `productos-dinero-alcance` › «una clave que pretenda concederla es un `validation_error`» · `detalle-dinero-producto` › «una clave que pretenda conceder el dinero es `validation_error`» |
| R9 | `productos-dinero-alcance` › «⚠ MUTACION M5 · dos consultas IGUALES salvo la concesion NO comparten entrada» |
| R10 | `detalle-dinero-producto` › «registra el denegado y responde `forbidden` a secas» + «el rastro nombra esta puerta y no la de la tabla» |
| R11 | `conteo-productos-dinero` › «una entrega liquidada da recaudado, ordenex y tienda con los numeros de la tarifa» · `dinero-productos.int` › «(h) …las cifras del grupo, CALCULADAS A MANO» |
| R12 | `conteo-productos-dinero` › «una orden multiproducto aporta ENTERA a los dos grupos» · `dinero-productos.int` › «(g) R12 · el importe COMPLETO de una orden multiproducto cuenta en CADA producto» |
| R13 | `conteo-productos-dinero` › «cuenta las ordenes con DOS O MAS productos distintos, y es aditiva» + «el mismo producto repetido en una orden NO la hace acompanada» |
| R14 | `dinero-por-producto` › «las cuatro cifras salen con los numeros calculados a mano» + «sin comision COD la orden solo factura flete + IVA (R14)» |
| R15 | `dinero-por-producto` › «las cuatro cifras salen con los numeros calculados a mano» · `dinero-productos.int` › «(h)…» |
| R16 | `dinero-productos.int` › «(v4) EL CUADRE CONTRA LA BASE, con un SQL escrito A MANO y fuera del codigo de la ficha» |
| R17 | `dinero-por-producto` › «dos gestiones liquidadas con tarifas congeladas DISTINTAS derivan cada una con la suya» · `dinero-productos.int` › «(d) R18 · la orden en DOS cierres trae DOS filas, cada una con SU snapshot» |
| R18 | `dinero-por-producto` › «dos gestiones liquidadas con tarifas congeladas DISTINTAS…» · `conteo-productos-dinero` › «⚠ MUTACION M10 · sus aportes se SUMAN y el cardinal NO se dobla» · `dinero-productos.int` › «(i) R18 · en los CARDINALES la orden de dos cierres cuenta UNA sola vez» |
| R19 | `dinero-por-producto` › «una rechazada liquidada aporta retorno y NO toca `ordenex` ni `tienda`» · `conteo-productos-dinero` › «⚠ MUTACION M3 · una rechazada liquidada suma `retorno` y deja `ordenex` intacto» |
| R20 | `dinero-por-producto` › «R20 · `ordenex + tienda === liquidado.recaudado`, EXACTO y sin margen» · `conteo-productos-dinero` › «R20 · … para TODAS las filas fundidas» · `dinero-productos.int` › «(h)…» |
| R21 | `dinero-por-producto` › «R21 · `liquidado + pendiente === recaudado`, EXACTO, con la orden a caballo» · `conteo-productos-dinero` › «R21 · … para TODAS las filas fundidas» |
| R22 | `dinero-por-producto` › «R22 · todo importe es STRING con DOS decimales; ninguno es `number`» · `dinero-productos-sql` › «los importes salen como STRING escala 2 y NUNCA como number ni Decimal» · `dinero-productos.int` › «(k) R22 …» · **el barrido money-safe del componente → F4/G3** |
| R23 | `dinero-por-producto` › «R23 · con cierre aprobado pero SIN tarifa congelada tampoco liquida» · `dinero-productos.int` › «(f) R23 · con cierre aprobado y SIN tarifa congelada tampoco se deriva nada» |
| R24 | `dinero-por-producto` › «un septimo concepto con un resultado nuevo aparece SOLO en la lista sin tocar el modulo» · `dinero-productos-sql` › «R24 · `resultado IN (...)` sale de `RESULTADOS_QUE_APORTAN`…» |
| R25 | `dinero-por-producto` › «la misma entrada da la misma salida, sin reloj y sin orden de llegada» · `conteo-productos-dinero` › «la misma entrada produce el mismo mapa…» · `dinero-productos-sql` › «R25 · el `ORDER BY` es total y estable: `o.id, g.id`» |
| R26 | `dinero-por-producto` › «un cierre SOLICITADO no liquida (⟨Q2⟩…)» · `conteo-productos-dinero` › «⚠ M1 · un cierre NO aprobado deja el dinero en PENDIENTE» · `dinero-productos.int` › «(e) R26 …» |
| R27 | `dinero-por-producto` › «una entrega SIN cierre trae su recaudo y NINGUNA cifra de reparto» · `detalle-dinero-producto` › «una fila por ORDEN, con guia, destinatario, resultados, estado y sus cuatro cifras» |
| R28 | `conteo-productos-dinero` › «una fila con parte liquidada y parte pendiente reparte solo lo liquidado» · `dinero-productos.int` › «(e) R26 …» |
| R29 | **→ F6** |
| R30 | `conteo-productos-dinero` › «⚠ M6 · sin nada liquidado el reparto es `null`, NUNCA `"0.00"`» · `dinero-productos.int` › «(e) R26 …» |
| R31 | `dinero-por-producto` › «R23 · con cierre aprobado y SIN tarifa congelada tampoco hay reparto, y el recaudo queda pendiente» · **el render → F6** |
| R32 | `detalle-dinero-producto` › «una fila por ORDEN, con guia, destinatario, resultados, estado y sus cuatro cifras» |
| R33 | **→ F5** |
| R34 | **→ F5** |
| R35 | `detalle-dinero-producto` › «R35 · una orden con DOS gestiones sale UNA vez, con la suma y sus dos resultados» · `dinero-productos.int` › «(j) …» |
| R36 | `detalle-dinero-producto` › «una fila por ORDEN…» · `dinero-productos-sql` › «sin fila de snapshot, `congelada` es `null` (no un objeto con ceros)» · **el enlace a la orden → F5** |
| R37 | `detalle-dinero-producto` › «una fila por ORDEN…» |
| R38 | `dinero-productos.int` › «(j) R38/R40 · EL CUADRE — las CINCO aserciones sobre el detalle real» · `detalle-dinero-producto` › «R38 · los `totales` de la cabecera son EXACTAMENTE la fila de la tabla» · `dinero-productos.int` › «(v4) …» |
| R39 | `detalle-dinero-producto` › «una orden que aporta cero en las cuatro cifras no aparece» · `conteo-productos-dinero` › «una entrega sin recaudo y sin cierre no genera grupo» · `dinero-productos.int` › «(j) …» (punto 6) |
| R40 | `detalle-dinero-producto` › «⚠ MUTACION M7 · `total` es el del CONJUNTO, no el de la pagina» · `dinero-productos.int` › «(j) …» |
| R41 | `detalle-dinero-producto` › «R41 · el tamano de pagina y su tope salen de la configuracion, no de un literal» |
| R42 | `detalle-dinero-producto` › «R42 · un producto sin ninguna orden que aporte responde `vacio`, no una lista vacia» |
| R43 | `dinero-productos.int` › «(a) R7/R43 …» · `detalle-dinero-producto` › «su propia tienda SI, y el `tienda_id` acaba en el alcance de la consulta» |
| R44 | `detalle-dinero-producto` › «R44 · una tienda ajena da `forbidden`, NO un resultado vacio» |
| R45–R58 | **→ F4, F6, G1, G3** |
| R59–R65 | **→ F6** |
| R66–R72 | **→ G1, G2** |
| R73 | `productos-dinero-alcance` › «R73 · si no valida, NO se resuelve el alcance ni se toca nada mas» · `detalle-dinero-producto` › «una clave que pretenda conceder el dinero es `validation_error`» (afirma que `getActor` no se llamó) |
| R74 | `dinero-productos-sql` › «el `where` lleva `deleted_at IS NULL` y sale de `condicionesDeConsulta`» · `dinero-productos.int` › «(c) R74 · una orden BORRADA no aporta, aunque su gestion recaudara» |
| R75 | `dinero-productos-sql` › «"%s": el `where` es identico al de `condicionesDeConsulta`» (10 casos) + «EL REPOSITORIO NO ESCRIBE NINGUNA CONDICION DE RECORTE PROPIA» · `alcance-dinero.guardia` › «(2)…» + «(2 bis)…» + «(2 ter) AUTOCOMPROBACION…» |
| R76 | `dinero-productos-sql` › «si vuelven MAS filas que el tope, NO se sirve ninguna cifra» + «justo EN el tope si se sirve…» · `conteo-productos-dinero` › «`limite_excedido` apaga TODAS las cifras y deja el volumen intacto» · `detalle-dinero-producto` › «`limite_excedido` no viene con filas» |
| R77 | `productos-dinero-alcance` › «lleva el prefijo propio de la vertical» · `conteo-productos-servicio` › «escribe bajo la clave de `claveDeConteoProductos` y con el tag de productos» · **el control de actualizar → F6** |
| R78 | `conteo-productos-dinero` › «las cifras de dinero se adosan a la fila de volumen que YA tiene esa clave» + «hay UN solo `lastSync`, sellado dentro del productor, para las dos consultas» |
| R79 | V1: no hay `db/migrations/**` en el diff (`git status`) |

**Requisitos SIN cubrir todavía, y son del bloque F:** R6 (render), R29, R31 (render), R33, R34,
R36 (enlace), R45–R58, R59–R65, R66–R72, R77 (refresco).

---

## Lo dudoso, dicho

1. **La mutación M2a sobrevive, y también en la 345.** Ya está arriba con su medición. Lo que
   significa: **ningún test de integración de este repo mide el recorte de alcance en aislado**,
   porque para `adminTienda` hay DOS condiciones que hacen lo mismo. No lo he «arreglado» porque
   arreglarlo sería quitar una de las dos, y las dos existen por buenas razones. Lo dejo dicho:
   quien crea que aquel test protege el `condicionDeAlcance`, se equivoca.

2. **`liquidado.ordenes` y `pendiente.ordenes` son disjuntos, pero los IMPORTES se particionan por
   GESTIÓN.** Consecuencia declarada en el contrato: una orden con dos gestiones —una en cierre
   aprobado y otra no— cuenta en `liquidado.ordenes` y, a la vez, su segunda gestión aporta a
   `pendiente.recaudado`. La alternativa (contarla en los dos cardinales) rompería el cuadre del
   detalle, que es la comprobación que de verdad atrapa un `WHERE` flojo. **Decisión mía**, no del
   spec.

3. **⟨Q4⟩ interpretada como «no hay archivo de config nuevo».** `tasks.md B5.1` pedía
   `lib/config/dinero-productos.ts`; la resolución del humano dice «el tope reusa la configuración
   de la 344, no un número nuevo». Elegí lo segundo: **no existe ese archivo**. El tamaño de
   página y su tope salen de `detalleMovimientoConfig` (25/100) y el tope de órdenes de
   `descargaConfig.MAX_FILAS` (5.000), que es el mismo con el que la 344 dice `limite_excedido`.
   Si el leader prefiere el archivo propio, es un cambio pequeño y localizado.

4. **`producto_clave` no tiene tope de longitud.** Un tope convertiría el nombre largo de un
   producto real en un `validation_error` o —peor— en un panel vacío, y `orden.producto` es texto
   libre sin límite. Lo que acota el payload es el límite de cuerpo de la petición. **Decisión
   mía.**

5. **Exijo EXACTAMENTE una tienda en el filtro del detalle.** No está en el spec. Sin ello, un
   maestro que no mandara `tienda_id` abriría un panel que mezcla tiendas y cuyos `totales` no
   serían los de ninguna fila de la tabla — un cuadre roto que nadie vería. **Decisión mía**, con
   su test.

6. **F2 adelantado.** `lib/analytics/presentacion.ts` y `CAMPOS_DE_PRESENTACION` los toqué yo
   aunque `tasks.md` los pone en el bloque F. Motivo en §F2. **F3 (`page.tsx`) NO está hecho**, así
   que hoy el campo existe y nadie lo consume: es lo mismo que le pasó a `productos` entre B y F en
   la 345.

7. **V4 sin datos reales.** Medido y explicado arriba: en la base local no hay ni una entrega
   dentro de un cierre aprobado, así que el «cuadre contra tres productos reales con dinero» de
   `tasks.md V4` **no se pudo hacer**. Lo que hay es el mismo cuadre sobre datos sembrados por el
   test, con la fórmula reescrita en SQL y con su demostración de no-tautología.

8. **El MCP `codebase-memory` no estaba disponible en esta sesión.** Toda la localización de código
   se hizo con `grep`. Los 14 símbolos de T0.1 están confirmados en el archivo real, que es lo que
   `CLAUDE.md` exige de todos modos.

9. **Ni una `<DataTable>` nueva, así que los censos de `G5` no se movieron.** Cuando llegue el
   panel del detalle habrá que moverlos y **ver la guardia fallar antes** de tocarla.

---

## Veredicto

Backend de la 347 completo y verificado: una sola lectura, importes STRING de punta a punta,
ninguna fórmula de dinero nueva, las dos invariantes ciertas por construcción y nueve mutaciones
—incluidas las cuatro obligatorias— con su línea de fallo real; queda pendiente todo el bloque F
y la corrida de la 345 que sobrevive a M2a, que se reporta como agujero de cobertura.

---

## Corrección del leader (2026-09-01) — M2a SÍ está cubierta, y por dónde

La bitácora de arriba afirma que «la afirmación de `impl_345.md` de que esa mutación deja aquel
archivo rojo ya no es cierta». **Medido: es al revés.** El leader aplicó la mutación
(`condicionDeAlcance`, `case "tienda"` → `` Prisma.sql`TRUE` ``) y corrió los tests:

- `tests/unit/analytics/conteo-productos-sql.test.ts` → **rojo**:
  `× el ALCANCE es la PRIMERA condicion, antes que cualquier faceta del cliente`
- `tests/unit/analytics/dinero-productos-sql.test.ts` → **rojo**:
  `× R7 · el ALCANCE es la PRIMERA condicion, antes que cualquier faceta del cliente`

Las dos observaciones son compatibles y hay que leerlas juntas, porque cada una dice una cosa
distinta: **los tests de INTEGRACIÓN no la cazan** (8/8 verdes) —eso el informe lo acertó, y el
motivo es real: para un `adminTienda` el recorte viaja también en la faceta, así que hacen falta
las dos barreras para que se filtre nada—, pero **los tests de SQL sí la cazan**, tanto en el
camino del volumen como en el del dinero. La conclusión de que no había cobertura fue un salto: se
midió en un solo tipo de test.

**Lo que queda cierto y merece seguir escrito:** ningún test de INTEGRACIÓN mide el recorte de
alcance en aislado, y ésa sigue siendo la vía por la que una mutación de una sola barrera pasa
desapercibida si alguien solo corre integración. La red existe; está en otro sitio del que el
informe suponía.

---

# Ficha 347 — bitácora de implementación (FRONTEND)

> Continúa el documento de arriba, **no lo sustituye**. Cubre el bloque **F** de `tasks.md`
> (F1, F3, F4, F5, F6) más `G1`, `G3` y `G5`. `F2` lo adelantó el backend (ver §F2).
> `G2` **no se implementa**; el motivo, medido, está en §«Lo dudoso, dicho (frontend)».
>
> El MCP `codebase-memory` **sí** estaba disponible en esta sesión y se usó para localizar
> `ProductosTabla` y la vertical de entregas; todo lo que se afirma de un símbolo está
> confirmado leyendo el archivo real, que es lo que `CLAUDE.md` exige de todos modos.

## Archivos

### Creados

| Archivo | Qué es |
| --- | --- |
| `app/(app)/analitica/_components/entregas/otros-resultados.ts` | **Entrega B**: `composicionOtrosResultados` + `textoComposicionOtrosResultados`. Módulo PURO |
| `app/(app)/analitica/_components/entregas/etiqueta-desenlace.ts` | `etiquetaDeDesenlace`, MUDADA desde el anillo (ver §La mudanza) |
| `app/(app)/analitica/_components/entregas/DineroProductoDetalle.tsx` | El panel de la fila abierta (F5) |
| `app/(app)/analitica/_components/entregas/dinero-producto-swr.ts` | Clave SWR y fetcher del detalle (F5) |
| `tests/unit/analytics/otros-resultados.test.ts` | 19 casos, con el sexto desenlace inyectado |
| `tests/unit/analytics/dinero-producto-no-sumable.guardia.test.ts` | G3: estática + dinámica + autocomprobación, 11 casos |
| `tests/components/ProductosTablaDinero.test.tsx` | F6: 29 casos |

### Modificados

| Archivo | Qué cambió |
| --- | --- |
| `app/(app)/analitica/_components/entregas/ProductosTabla.tsx` | 3 columnas de dinero, 2 líneas de contexto, 2 avisos, el sello de `lastSync`, la composición de «Otros resultados», la fila que se abre, la vista de teléfono y la prop `dinero` |
| `app/(app)/analitica/_components/entregas/analitica-productos-descarga-columnas.ts` | G1: `+ otros_resultados_detalle`, `+ COLUMNAS_..._DINERO` (9 columnas), `+ columnasDescargaAnaliticaProductos(conDinero)` |
| `app/(app)/analitica/_components/entregas/efectividad.ts` | `+ DESENLACES_CON_COLUMNA_PROPIA` (exportada, para que la composición no escriba su propia pareja) |
| `app/(app)/analitica/_components/entregas/ConteoEntregasAnillo.tsx` | `etiquetaDeDesenlace` se muda y se RE-EXPORTA con su nombre de siempre |
| `app/(app)/analitica/page.tsx` | **F3**: lee `recorte.productosDinero` y lo pasa como prop. Sin importar `metrics` ni `alcance` |
| `lib/actions/detalle-dinero-producto.ts` | **`@sin-superficie` BORRADO**: la acción ya tiene consumidor de producción |
| `tests/unit/descarga/censo-tablas.ts` + `cobertura-tablas.guardia.test.ts` | **G5**: la tabla del detalle, `fuera` con motivo |
| `tests/unit/descarga/analitica-productos-descarga-columnas.test.ts` | los `toEqual` de las DOS constantes, reescritos a mano (11 y 20 claves) |
| `tests/components/ProductosTabla.test.tsx` | `cifraDeCelda`: lee la CIFRA de la celda, no su `textContent`, que ahora arrastra la composición |

**Ni una migración, ni un archivo de `lib/services/**`, `lib/repositories/**` ni `db/**`**: el
diff del frontend toca `app/`, dos archivos de tests de censo y la anotación de la acción.

## La mudanza de `etiquetaDeDesenlace`, y por qué hizo falta

R55 exige nombrar cada desenlace «reutilizando el mecanismo de etiquetas que ya existe». Ese
mecanismo vivía en `ConteoEntregasAnillo.tsx`, que es un componente de cliente y arrastra
`recharts`. La composición la necesitan TRES sitios y uno es
`analitica-productos-descarga-columnas.ts`, que es **puro por contrato** y lo **ejecuta**
`columnas-sensibles.guardia` en un entorno de node: importar el anillo desde allí habría metido
una gráfica dentro de un barrido de columnas.

Se mudó a `etiqueta-desenlace.ts` y el anillo la **re-exporta** con su nombre de siempre, así que
ni él ni `tests/unit/analytics/conteo-entregas-pliegue.test.ts` cambian un import. Es el mismo
patrón con el que `money()` se mudó a `lib/config/moneda.ts`: una mudanza, no un cambio de
comportamiento.

## Las guardias, vistas FALLAR antes de tocar sus números (G5)

La convención del árbol es ésa y se cumplió. Salida literal, **antes** de escribir nada en el
censo:

```
FAIL tests/unit/descarga/cobertura-tablas.guardia.test.ts > toda tabla del árbol o declara descarga…
AssertionError: hay tablas sin registrar en tests/unit/descarga/censo-tablas.ts:
+ [ "app/(app)/analitica/_components/entregas/DineroProductoDetalle.tsx #1" ]

FAIL tests/unit/descarga/columnas-asercion-de-orden.guardia.test.ts > ninguna constante COLUMNAS_DESCARGA_*…
+ [ "COLUMNAS_DESCARGA_ANALITICA_PRODUCTOS_DINERO (app/(app)/analitica/…/analitica-productos-descarga-columnas.ts)" ]
```

Números MEDIDOS, movidos después: `TOTAL_ARCHIVOS_CON_DATATABLE` 32 → **33**,
`TOTAL_INSTANCIAS_DATATABLE` 32 → **33**, exclusiones 10 → **11**, `totalCensado` 33 → **34**,
`fuera` 11 → **12**. Las **22** `con_descarga` NO se mueven.

Y dos guardias más se pusieron rojas por defectos REALES de este cambio, no por números:

- **`flete-por-rechazo-censo.guardia`** → `DineroProductoDetalle.tsx:83`. El panel rotulaba
  «Flete de devolución + IVA de las rechazadas». La ficha 338 renombró ese cobro a **«Flete por
  rechazo»** en toda la app porque **sólo un RECHAZO lo cobra**: el nombre viejo decía justo el
  caso que NO cobra. Corregido en el panel y en el encabezado del archivo.
- **`ancla-de-carga.guardia`** → el caso de G3 esperaba con
  `waitFor(() => expect(document.querySelectorAll("tfoot")).toHaveLength(0))`, un ancla que el
  estado de CARGA también cumple. Reanclado al contenido (`findByText("Producto 2")`).

---

## Verificación en el navegador (V3) — Chromium, sesión real, cuatro anchos

`pnpm dev` en `:3000` (uno solo; `.next` borrado antes de arrancar), login real de
`admin.qa@ordenex.test`. La contraseña **no se leyó ni se rotó**: el script corre con
`node --env-file=.env`, así que `QA_PASSWORD` entra por el entorno y no se imprime nunca.

### Los cuatro anchos, con el árbol final

| ancho | desborde del DOCUMENTO | scroller de la tabla (clientW / scrollW / desborde) | última columna, fuera de la ventana | flechas de scroll | palabras partidas |
| --- | --- | --- | --- | --- | --- |
| 390×844 | **0** | 308 / 308 / **0** | «Resultado» → **0** | 0 | 1 (`USB-C`) |
| 768×1024 | **0** | 430 / 1226 / 796 | 755 px | 2 | **0** |
| 1024×800 | **0** | 686 / 1226 / 540 | 499 px | 2 | **0** |
| 1440×950 | **0** | 1102 / 1226 / **124** | **83 px** | 2 | **0** |

**El documento no desborda a ningún ancho.** Lo que desborda es el scroller horizontal de la
propia `DataTable`, que es su comportamiento declarado («si la suma de mínimos excede el ancho
disponible, la tabla desborda y aparece el scroll horizontal — comportamiento deseado»), y por eso
aparecen sus dos flechas. A 1440 hay que desplazar **83 px** para leer «Para la tienda».

### El `innerText` real de las celdas de dinero

En la base local **no hay ni un importe** (ver §«El dinero salió vacío»), así que las celdas dicen
`—`. Para medir la caja con dinero de verdad se **inyectó el texto en el DOM** —sólo el texto, sin
tocar la base ni el código— con dos magnitudes:

**`₡393.433`** (la medida real de producción para `BASE C`, del propio spec):

```
1440: innerText de las tres celdas = "₡393.433" / "₡393.433" / "₡393.433"
      recorteInterno = 0 en las tres · columnas 95/89/89 px · scroller 1102/1235/133
 390: innerText de las tres = "₡393.433" · recorteInternoMax = 0 · scroller 308/308/0
      Producto 133 → 108 px · Resultado 151 → 176 px
```

**`₡12.345.678`** (ocho dígitos, el peor caso imaginable):

```
1440: ancho de la cifra = 81 px · recorteInterno = 0 en las tres
```

**Cero recorte interno en todos los casos.** Ninguna cifra se pinta a medias, que es el defecto
exacto que midieron la 343 (`₡1.70` donde el DOM decía `₡1.700`) y la 344.

### Lo que el navegador CAMBIÓ del diseño: fuera el `minWidth`

Las tres columnas nacieron con `minWidth: "10rem"`, por la intuición de que un importe largo pide
sitio. **El navegador dijo lo contrario**, y por eso se retiró:

| | columnas de dinero | scroller a 1440 | última columna fuera | cifra completa |
| --- | --- | --- | --- | --- |
| con `minWidth: 10rem` | 160 / 160 / 160 px | desborde **341 px** | **300 px** | sí (81 px de 160) |
| sin `minWidth` (final) | 95 / 84 / 84 px | desborde **124 px** | **83 px** | sí, recorte 0 |

Los 160 px no los pedía el importe (ocupa 81) sino la CABECERA. Lo que protege a la cifra de
estrujarse es el `whitespace-nowrap` de `Cifra`, que fija el mínimo de la columna en el ancho del
propio número. **217 px menos de desborde por una línea de menos.**

### La composición de «Otros resultados», leída en pantalla

Legible **sin pasar el cursor** y a 390 px, que es lo que R57 pide. `innerText` real de tres
celdas de la tabla desplegada (el `|` es el salto de línea dentro de la celda):

```
1440: "0"                     ← R54: con el cubo en cero no se pinta nada debajo
1440: "1 | 1 reprogramadas"
1440: "2 | 2 reprogramadas"
 390: "… | Otros resultados | 1 | 1 reprogramadas | En proceso | 2 | …"
```

Y los cuatro párrafos de aviso, `innerText` literal a los cuatro anchos:

```
"Las cifras de dinero son de la ORDEN completa, no del producto: una orden con varios
 productos cuenta entera en cada uno. Estas columnas no se pueden sumar hacia abajo."
"«Cobró Ordenex» y «Para la tienda» son solo de las órdenes ya liquidadas (cierre aprobado).
 Lo cobrado y aún sin liquidar se muestra aparte, en la celda de Recaudado."
"67 órdenes en el rango · 0 sin producto interpretable."
"Actualizado 16:57"        ← R65, el sello de la lectura
```

### Palabras partidas: lo que hay, y cuánto cuesta esta ficha

Con los datos reales, **1** palabra partida en toda la tabla y a un solo ancho: `USB-C` a 390 px,
en la columna de PRODUCTO, partiendo por su guion. Con `₡393.433` inyectado en las tres columnas
suben a **4** (`Hemorroides`, `TURKESTERONE`, `Blanqueadora`, `Inalámbrico`), todas en la misma
columna.

Está medido cuánto de eso lo trae esta ficha. Sobre el MISMO DOM, quitando lo que la 347 añade
—la columna del control y las tres líneas de dinero de la pila—:

```
 390 CON la 347:  Producto 133 px · partidas: ["USB-C"]
 390 SIN la 347:  Producto 155 px · partidas: []
```

O sea: **22 px** menos de nombre de producto a 390 px (24 son la columna del control), y con
importes reales el nombre baja a 108 px y se parten cuatro palabras. **Es el precio declarado del
teléfono**, y se paga en el sitio correcto: R63 prohíbe recortar un importe y R64 prohíbe enseñar
menos datos en el teléfono, así que lo que cede es el NOMBRE —que se lee entero, en más líneas—
y nunca la cifra. La columna de producto usa `wrap-anywhere` por decisión escrita de la 345
(«`wrap-anywhere` y no `break-words`: el segundo no reduce el `min-content`»), así que partir es
su comportamiento previsto a anchos estrechos, no un defecto nuevo. **Si el humano lo considera
demasiado, la palanca más barata es quitar `(no sumable)` de las tres etiquetas de la vista de
teléfono** —el párrafo con el aviso completo está justo encima— y es un cambio de una línea.

### El panel del detalle: NO se pudo ver en el navegador

**0 botones** de abrir en las 37 filas, a los cuatro anchos. No es un fallo, y está medido por
qué — ver la sección siguiente. El panel queda cubierto por los **8 casos de componente** de
`ProductosTablaDinero.test.tsx` (montaje bajo demanda, dos paneles a la vez, totales, enlace a la
orden, vacío y `limite_excedido`) y **sin una sola comprobación en pantalla**. Es la deuda de
verificación de este bloque.

---

## El dinero salió vacío, y por qué — MEDIDO, no supuesto

El encargo avisaba de que el reparto saldría vacío y pedía medirlo antes de concluir. Medido
contra la base local (consultas de sólo lectura y una ejecución directa del servicio):

**1. Las entregas no recaudaron nada.**

| resultado | gestiones vivas | con `monto_recibido > 0` | en cierre `aprobado` | con tarifa congelada |
| --- | --- | --- | --- | --- |
| `entregada` | 12 | **0** | **0** | 0 |
| `rechazada` | 6 | 0 | 5 | 5 |
| `reprogramada` | 12 | 7 | 10 | 10 |
| `devuelta` | 7 | 0 | 5 | 5 |
| `incidente` | 2 | 1 | 1 | 1 |

`SELECT count(*) … resultado = 'entregada' AND monto_recibido > 0` → **0**, suma **0**. Así que
`recaudado` es cero para todo producto: no hay «entrega que haya cobrado» en esta base.

**2. Las rechazadas SÍ están liquidadas, y aun así su retorno es cero.** Las cuatro órdenes
(`990001` Audifonos bluetooth, `990002` Cafetera, `990004` Set de sartenes, `990010` Perfume
importado) tienen cierre `aprobado` y `cierre_detail` con `tarifa_id`. Pero su snapshot dice
`es_central = true`, y para una orden central `resolverFlete` toma
`tarifa_valor_flete_devuelto_gam`, que en esas filas vale **`0.00`** (el `valor_flete_devuelto`
no-GAM sí vale `1000.00`, y es el que confunde al mirar por encima).

**3. Ejecutado el servicio real contra la base**, sin navegador y sin caché:

```
CONCESION DE DINERO: concedido
LECTURA DINERO: estado ok, 18 filas crudas, 17 órdenes
repartoDeOrden de las 17: TODAS con recaudado "0.00"; las 4 rechazadas liquidadas dan
  { ordenex: "0.00", tienda: "0.00", retorno: "0.00", hayLiquidado: true }
DTO: dinero {"estado":"concedido"}, 37 filas, FILAS CON DINERO: 0
```

**Conclusión:** `dinero: null` en las 37 filas es **el contrato cumpliéndose**, no un fallo.
`aporteEsCero` descarta el grupo, la pantalla pinta `—` en las tres columnas (R30) y no ofrece el
control de abrir en una fila que no tiene nada que detallar. Lo que falta para verlo con cifras es
**una entrega con `monto_recibido > 0` dentro de un cierre aprobado**, que en esta base no existe
y en producción tampoco (vacía a propósito desde el 2026-08-25). **No se sembró nada**: alterar la
base para ver una columna habría cambiado el dato de todas las demás sesiones.

---

## Mutaciones (V2, parte de frontend) — SEIS, con su línea de fallo REAL

Cada una: aplicada al árbol, tests ejecutados, línea copiada, árbol restaurado y **re-medido
verde** después (44 archivos / 358 casos).

### 1 — pintar `0,00` donde debe ir `—` (M6 en la pantalla) · **ROJA (1)**
`importeDeFila`: `dinero.liquidado.ordenex` → `dinero.liquidado.ordenex ?? "0.00"`.
```
FAIL tests/components/ProductosTablaDinero.test.tsx > R30 — sin nada liquidado se pinta «—», nunca `0,00`
     > las dos celdas del reparto son el marcador de dato ausente
AssertionError: expected '₡0' to be '—'
```

### 2 — quitar el aviso de que la columna no se suma · **ROJA (1)**
```
FAIL tests/components/ProductosTablaDinero.test.tsx > R45 — y el aviso está escrito arriba, con todas las letras
TestingLibraryElementError: Unable to find an element with the text: Las cifras de dinero son de
la ORDEN completa, no del producto: una orden con varios productos cuenta entera en cada uno.
Estas columnas no se pueden sumar hacia abajo.
```

### 3 — `Number()` sobre un importe · **ROJA (1)**
`return dinero.recaudado` → `return String(Number(dinero.recaudado))`.
```
FAIL tests/unit/analytics/dinero-producto-no-sumable.guardia.test.ts
     > `app/(app)/analitica/_components/entregas/ProductosTabla.tsx` es money-safe: ni una de las cuatro llamadas
AssertionError: expected [ '\bNumber\s*\(' ] to deeply equal []
```

### 4 — M8: la lista de desenlaces escrita a mano en la composición · **ROJA (1 de 19)**
`new Set(DESENLACES)` → `new Set(["entregada","devuelta","rechazada","reprogramada","incidente"])`.
```
FAIL tests/unit/analytics/otros-resultados.test.ts
     > un SEXTO desenlace aparece en la composición sin tocar la pantalla
AssertionError: expected [] to deeply equal [ { …(2) } ]
```
⚠ Los **18 casos restantes siguen verdes**, incluido el que compara la composición contra
`calcularEfectividad`. El caso del sexto desenlace inyectado es **lo único** que distingue
derivar de escribir — exactamente lo que la 346 midió y por lo que la etiqueta no enumera.

### 5 — M9: un total al pie de la columna de dinero · **ROJA (3, las tres mitades)**
Un `<p>` con `visibles.reduce(… + Number(f.dinero?.recaudado ?? "0"), 0).toFixed(2)`.
```
FAIL … > `…/ProductosTabla.tsx` no contiene ninguna forma de total al pie
AssertionError: expected [ "\\breduce\\s*\\([\\s\\S]{0,120}?\\b(recaudado|ordenex|liquidado|pendiente|retorno)\\b" ] to deeply equal []
FAIL … > `…/ProductosTabla.tsx` es money-safe: ni una de las cuatro llamadas
AssertionError: expected [ '\bNumber\s*\(', '\.toFixed\s*\(' ] to deeply equal []
FAIL … > con tres importes en pantalla, su suma NO está en el DOM
AssertionError: expected [ '₡1.230' ] to deeply equal []
```

### 6 — M9b: el MISMO total, pero money-safe y sin `reduce` · **solo la mitad DINÁMICA lo caza**
Suma en céntimos con `BigInt` dentro de un `for`. **Ni `Number(`, ni `toFixed(`, ni `reduce(`, ni
`<tfoot`**: la mitad estática pasa entera.
```
 10 casos VERDES (toda la mitad estática y las dos autocomprobaciones)
FAIL tests/unit/analytics/dinero-producto-no-sumable.guardia.test.ts
     > con tres importes en pantalla, su suma NO está en el DOM
AssertionError: expected [ '₡1.230' ] to deeply equal []
```
⚠ **Ésta es la mutación que justifica que la guardia tenga mitad dinámica.** Un barrido de texto
sobre la fuente es fácil de esquivar sin querer —basta escribir la suma de otra manera— y el
único predicado que no depende de CÓMO se escriba el total es «el número no está en el DOM».
Es la respuesta ejecutable a la pregunta del encargo: si mañana alguien pone un total al pie de
esa columna, **algo se pone rojo**, y este caso dice cuál.

**Ninguna sobrevivió.** Las tres obligatorias del encargo son la 1, la 2 y la 3.

---

## Órdenes de verificación

```
$ npx tsc --noEmit
TSC_EXIT=0

$ npx eslint .
✖ 145 problems (0 errors, 145 warnings)
ESLINT_EXIT=0
```
Las 145 son `@typescript-eslint/no-unused-vars` sobre parámetros `_x` de dobles de test,
heredadas de `dev` y **el mismo número exacto que midió el backend**. Cero errores.

```
$ npx vitest run tests/unit tests/components
 Test Files  1 failed | 1369 passed (1370)
      Tests  1 failed | 19990 passed | 26 skipped (20017)
```

**El único rojo es el heredado y tolerado:**
```
FAIL tests/unit/guards/superficie-de-uso.guardia.test.ts > ninguna Server Action de `lib/actions/**` es inalcanzable…
+ [ "lib/actions/tarifas.ts:67 obtenerTarifa" ]
```
Comprobado que `consultarDetalleDineroProducto` **ya no aparece** en esa lista: borrar su
`@sin-superficie` fue correcto porque la acción tiene consumidor de producción
(`ProductosTabla` → `renderExpanded` → `DineroProductoDetalle` → `dinero-producto-swr` → la
acción). **El gate completo (`./init.sh`) lo corre el leader**: esta sesión sólo midió `tests/`.

---

## Trazabilidad `R<n> → test` (los requisitos del bloque F)

| R | Dónde se cubre (nombre EXACTO del caso) |
| --- | --- |
| R6 | `ProductosTablaDinero` › «sin la prop, la tabla queda exactamente como la dejó la 346» + «con la prop pero con la respuesta DENEGADA, tampoco: el servidor manda» + «las columnas de VOLUMEN siguen ahí en los dos casos» |
| R29 | `ProductosTablaDinero` › «R29 — dice que el reparto es SÓLO de lo ya liquidado» |
| R30 | `ProductosTablaDinero` › «las dos celdas del reparto son el marcador de dato ausente» + «una fila SIN ninguna orden que aporte pinta «—» en las tres» (mutación 1) |
| R31 | `ProductosTablaDinero` › «las dos celdas del reparto son el marcador de dato ausente» (no se proyecta nada: la celda queda ausente) |
| R32 | `ProductosTablaDinero` › «R32 — abrir una fila consulta EXACTAMENTE una vez, y con SU tienda y SU producto» |
| R33 | `ProductosTablaDinero` › «R33 — con las filas CERRADAS, el detalle no se consulta ni una vez» |
| R34 | `ProductosTablaDinero` › «R34 — dos filas abiertas consultan LO SUYO y no se pisan» |
| R36 | `ProductosTablaDinero` › «R38/R36/R37 — el panel enseña los totales para cotejar, y la orden con su guía» (afirma `href="/ordenes?q=77001"`) |
| R37 | idem (`Entregadas` + la insignia «Liquidada») |
| R38 | idem (los cuatro importes de la cabecera, que son los de la fila) |
| R42 | `ProductosTablaDinero` › «R42 — un producto sin ninguna orden que aporte enseña su estado vacío, no un error» |
| R45 | `ProductosTablaDinero` › «R45 — los TRES encabezados llevan la marca de no sumable» + «R45 — y el aviso está escrito arriba, con todas las letras» (mutación 2) |
| R46 | `ProductosTablaDinero` › «R46 — no hay ningún `<tfoot>` ni total al pie» · `dinero-producto-no-sumable.guardia` › «con tres importes en pantalla, su suma NO está en el DOM» |
| R47 | `dinero-producto-no-sumable.guardia` › «`…/ProductosTabla.tsx` no contiene ninguna forma de total al pie» + «con tres importes en pantalla, su suma NO está en el DOM» (mutaciones 5 y 6) |
| R48 | `dinero-producto-no-sumable.guardia` › «(c) AUTOCOMPROBACIÓN — el predicado estático detecta un total introducido a propósito» + «(c) AUTOCOMPROBACIÓN — el barrido money-safe detecta una conversión introducida» + «(c) AUTOCOMPROBACIÓN — el predicado dinámico detecta el total si alguien lo pinta» |
| R49 | `analitica-productos-descarga-columnas` › «los VEINTE encabezados salen en este orden, con la marca de no-sumable donde toca» + «R49 — las SEIS columnas de importe llevan la marca; las de conteo, no» |
| R50 | `otros-resultados` › «la captura de la 346 se compone de sus dos desenlaces, con su cantidad» · `ProductosTablaDinero` › «R50 — la celda dice CUÁNTAS arriba y DE QUÉ debajo, sin tocar la etiqueta» |
| R51 | `otros-resultados` › «un SEXTO desenlace aparece en la composición sin tocar la pantalla» (mutación 4) |
| R52 | idem |
| R53 | `otros-resultados` › «R53 — los dos desenlaces con COLUMNA PROPIA no entran en la composición» + «R53 — los status SIN desenlace tampoco: ésos son «En proceso», no un resultado» |
| R54 | `otros-resultados` › «R54 — sin ningún otro resultado, la composición está VACÍA y el texto también» · `ProductosTablaDinero` › «R54 — con el conteo en cero, no se pinta ninguna composición» |
| R55 | `otros-resultados` › «R55 — nombra cada desenlace con su etiqueta legible, NUNCA con el value crudo» |
| R56 | `otros-resultados` › «R56 — el orden es conteo DESCENDENTE y, a igualdad, `status` ascendente» + «R56 — la MISMA fila produce siempre el MISMO texto, venga como venga el desglose» + «el número va CRUDO, sin separador de miles: el texto viaja al archivo» |
| R57 | `ProductosTablaDinero` › «R57 — es legible SIN apuntar: es texto en el DOM, no un `title` ni un tooltip» · V3 (medido a 390 px) |
| R58 | `analitica-productos-descarga-columnas` › «R58 — la composición de «Otros resultados» sale en UNA celda de texto» |
| R59 | `ProductosTablaDinero` › «R59 — cambiar el filtro vuelve a consultar y las cifras se releen» |
| R60 | `ProductosTabla` (345) › los casos del prefijo `CLAVE_TABLERO`; el detalle lo hereda porque `claveDetalleDineroProducto` empieza por el MISMO prefijo — **ver §Lo dudoso, punto 4** |
| R61 | `ProductosTablaDinero` › «R61 — mientras carga no pinta ni un importe» |
| R62 | `ProductosTablaDinero` › «R62 — un `limite_excedido` del detalle lo dice, y no como una tabla vacía» · `ProductosTabla` (345) › los cuatro estados |
| R63 | `ProductosTablaDinero` › «pinta los tres importes con `money`, COMPLETOS y sin abreviar» + «R63 — ninguna celda de dinero lleva `truncate`, `line-clamp` ni `overflow-hidden`» · V3 (`recorteInterno = 0` a los cuatro anchos) |
| R64 | `ProductosTablaDinero` › «las tres cifras de dinero y sus dos líneas de contexto están en la pila» |
| R65 | `ProductosTablaDinero` › «R65 — pinta el instante en que estas cifras se leyeron de la base» |
| R66 | `analitica-productos-descarga-columnas` › «las VEINTE claves salen en este orden y no en otro» + «R66/R67 — el selector devuelve la lista que corresponde a la concesión» |
| R67 | `analitica-productos-descarga-columnas` › «R67 — SIN concesión, la fila no lleva NI UNA clave de dinero» |
| R68 | `analitica-productos-descarga-columnas` › «R68 — las claves de la fila son EXACTAMENTE las columnas declaradas, en su orden» |
| R69 | `analitica-productos-descarga-columnas` › «R69 — ninguna columna de dinero es un identificador interno» + «R49 — el uuid de la tienda NO llega al archivo por ninguna celda» |
| R70 | `analitica-productos-descarga-columnas` › «R70 — un importe ausente es celda VACÍA, nunca `0`» + «R70 — una fila SIN ninguna orden que aporte deja las ocho celdas de dinero vacías» |
| R71 | `ProductosDescarga` (345) › la descarga proyecta el DTO en pantalla, sin segunda consulta |
| **R72** | **SIN CUBRIR.** Ver §Lo dudoso, punto 1 |
| R76 | `ProductosTablaDinero` › «R76 — con el tope superado lo dice, y NO pinta columnas de dinero vacías» + «R62 — un `limite_excedido` del detalle lo dice…» |
| R77 | `dinero-producto-swr` lleva `CLAVE_TABLERO` como primer componente de la clave — **ver §Lo dudoso, punto 4** |

---

## Lo dudoso, dicho (frontend)

1. **R72 no está cubierto: el detalle NO se descarga, y no es un olvido.** El borde de la ficha
   sólo sirve el detalle **paginado**: no hay un modo COMPLETO como el que la 344 le dio a su
   hermano (`verDetalleDeMovimientoCompletoAction`). Con lo que hay, un archivo saldría **truncado
   a una página** —lo que R76 y la doctrina de `filasDesdeResultado` prohíben, «o van todas las
   filas o no hay archivo»— o **reconstruido con N llamadas desde el navegador**, que es
   exactamente la MEDIA MIGRACIÓN que la feature 184 retiró del árbol y que
   `adaptador-conjunto.guardia` vigila. Añadir ese modo es backend, y el encargo prohíbe tocarlo.
   La bitácora del backend ya había resuelto ⟨Q5⟩ como «fuera»; esto lo confirma con el motivo
   técnico. La tabla queda censada `fuera` **con ese motivo escrito**, así que el día que exista
   la puerta la guardia obliga a volver a decidir.

2. **El panel del detalle no se vio nunca en un navegador.** 0 filas con dinero en la base local,
   por las razones medidas de §«El dinero salió vacío». Está cubierto por 8 casos de componente y
   por nada más. Es la deuda de verificación más grande de este bloque.

3. **La segunda línea de la celda cuesta 22 px de nombre de producto a 390 px** (155 → 133), y con
   importes reales el nombre baja a 108 px y se parten cuatro palabras. Está medido arriba y es
   una decisión, no un descuido: lo que cede es el nombre y nunca la cifra. La palanca barata, si
   el humano lo ve mal, es quitar `(no sumable)` de las etiquetas de la vista de teléfono.

4. **R60 y R77 (el botón «Actualizar» refresca el detalle abierto) se apoyan en el PREFIJO de la
   clave, y eso no tiene test propio.** `claveDetalleDineroProducto` empieza por `CLAVE_TABLERO`,
   que es lo único que `ActualizarAnalitica` mira
   (`mutate((c) => Array.isArray(c) && c[0] === CLAVE_TABLERO)`). Es el mismo mecanismo —y el
   mismo grado de cobertura— que tienen las otras seis lecturas de la sección, pero conviene
   saberlo: si alguien reescribiera ese prefijo a mano, el panel abierto se quedaría con datos
   viejos y ningún test lo diría.

5. **`(c) AUTOCOMPROBACIÓN` de la mitad dinámica compara un texto sintético, no un render.**
   Renderizar un componente que SÍ lleva el total exigiría un doble del componente entero; se
   eligió aplicar el MISMO predicado al texto que ese total dejaría en el DOM. La mutación 6 es la
   que demuestra que el predicado muerde sobre el render de verdad, y por eso está en la bitácora.

6. **Decisión mía: el dinero se pinta sólo si la prop Y la respuesta lo conceden.** El spec sólo
   pedía la prop (R6). Con `limite_excedido` la concesión existe pero no hay cifras, y pintar las
   columnas con `—` en cada fila se leería como «este producto no movió dinero», que es falso.
   Tiene su caso («R76 — con el tope superado lo dice, y NO pinta columnas de dinero vacías»).

7. **Decisión mía: `Con otro producto: 3 de 5` en vez de `3 acompañadas`.** El diseño escribía
   «N acompañadas»; una etiqueta fija delante del número evita el singular («1 acompañada») y se
   lee mejor apilada en el teléfono. El dato es el mismo.

8. **Decisión mía: el panel repite el aviso de «no sumable» dentro.** No lo pedía el spec. Va
   porque el panel se lee abierto, con la cabecera de la tabla fuera de la vista, y sus `totales`
   son las mismas cifras que la fila.

9. **El árbol queda con el servidor de desarrollo levantado en el puerto 3000** y `.next`
   reconstruido desde cero (se borró antes de arrancar, y no se levantó ningún segundo servidor).
   Si otra sesión dependía de uno anterior, ya no existe.

10. **No se rotó ninguna contraseña QA.** El login del navegador se hizo con
    `node --env-file=.env`, leyendo `QA_PASSWORD` del entorno sin imprimirla. Correr
    `seed-usuarios-qa.ts` habría rotado las CUATRO cuentas y roto el login de cualquier otra
    sesión en marcha.

## Veredicto (frontend)

Bloque F cerrado con las dos entregas: las tres columnas de dinero con su aviso triple y su fila
que se abre, y la composición de «Otros resultados» derivada del catálogo —no escrita— con el
caso del sexto desenlace que lo demuestra. Seis mutaciones, ninguna superviviente, incluida la
que prueba que la mitad dinámica de la guardia no es redundante. Medido en Chromium a 390, 768,
1024 y 1440: cero desborde del documento, cero recorte de importes y el precio en ancho del
teléfono dicho con números. Queda sin cubrir **R72** (hace falta un modo completo en el borde) y
sin ver en pantalla el panel del detalle, porque en esta base **ninguna entrega ha cobrado**.
