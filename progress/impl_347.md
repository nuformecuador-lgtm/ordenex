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
