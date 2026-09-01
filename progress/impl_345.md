# Ficha 345 — Bitácora de implementación: BACKEND (B0–B5)

> Rama `feature/345-analitica-productos`. Alcance de esta bitácora: **B0, B1, B2, B3, B4, B5**.
> **B6, B7 y B8 (frontend + descarga) NO están hechos** y los hace otro agente con el contrato
> que se declara en §7. Nada de UI se ha tocado: ni componentes, ni páginas, ni layouts.

---

## 1 — B0.1 · Los ocho símbolos, confirmados EN DISCO

Leídos en el archivo real (no en el índice del MCP, que devuelve de más). Los ocho están donde
`design.md` supone; **no hubo que parar**.

| Símbolo | Archivo | Línea (antes de esta ficha) |
| --- | --- | --- |
| `ROLES_ANALITICA` | `lib/analytics/types.ts` | 54 |
| `RolAnalitica` | `lib/analytics/types.ts` | 62 |
| `AlcanceMetrica` | `lib/analytics/types.ts` | 70 |
| `Metrica.alcance: Readonly<Record<RolAnalitica, AlcanceMetrica>>` | `lib/analytics/types.ts` | 195 |
| `ALCANCE_OPERATIVA` | `lib/analytics/metrics.ts` | 52 |
| `ALCANCE_FINANCIERA` | `lib/analytics/metrics.ts` | 65 |
| `conteoEntregasFiltroSchema` | `lib/analytics/entregas-conteo.ts` | 88 |
| `recortarFiltroConteoEntregas` | `lib/analytics/entregas-conteo.ts` | 245 |
| `ConsultaConteoEntregas` | `lib/analytics/entregas-conteo.ts` | 297 (hoy 318) |
| `condicionesDeConsulta` | `lib/repositories/ConteoPorStatusRepository.ts` | 97 (hoy 107) |
| `calcularEfectividad` | `app/(app)/analitica/_components/entregas/efectividad.ts` | 83 |
| `orden.producto` (`String` NOT NULL) | `db/schema.prisma` | 578 |
| `orden.tienda_id` (FK → `usuario`, NOT NULL) | `db/schema.prisma` | 573 |

---

## 2 — B0.2 · El coste de la consulta viva, MEDIDO

⚠ **Contra la base alcanzable, que es la LOCAL (`localhost:5432`), no producción.** En esta sesión
no hay herramienta MCP de Supabase en el conjunto del agente, así que producción no era
alcanzable. Las cifras de producción (768 órdenes, 855 líneas, 84 productos, cantidad máxima 6,
media 1,36) son **las que midió el leader** y se toman como dadas; lo de abajo es la medición
propia sobre el corpus local.

SQL de `design.md §5.2` sin filtro de fecha, `WHERE TRUE AND o."deleted_at" IS NULL`:

| Medida | Valor |
| --- | --- |
| Órdenes vivas | **67** |
| Filas devueltas | **62** |
| Wall time (ida y vuelta desde Node) | **14 ms** |
| `Execution Time` del `EXPLAIN ANALYZE` | **0,827 ms** (planning 0,509 ms) |
| Textos de producto distintos | **41** |

**Filas (62) < órdenes (67):** el `GROUP BY` colapsa, que es la condición de parada que T0.2
exigía comprobar. El plan es `GroupAggregate ← Sort ← Nested Loop Left Join`, con `Memoize` sobre
`order_status` (55 hits / 12 misses) y `shared hit=237` — todo en caché, cero lecturas de disco.
Sin índice nuevo.

### 2.1 — El corpus local, parseado (medición propia)

Corriendo `parsearProducto` sobre los 67 `orden.producto` vivos:

| Medida | Parser de esta ficha | Regex GREEDY (ver §3.1) |
| --- | --- | --- |
| Productos distintos | **37** | **38** |
| Líneas de producto | 71 | — |
| Unidades | 83 | — |
| Cantidad máxima / media | 2 / 1,17 | — |
| Órdenes sin ítem interpretable | 0 | — |
| Nombres que contienen `*` | **0** | — |

Los 2 fantasmas del greedy en el corpus local son de la familia exacta que el spec nombra:
`'parche antivarices l. 1 * gel de abejas'` y
`'lima eléctrica profesional para pies. 1 * gel de abejas'` — dos productos fundidos en uno.

---

## 3 — B0.3 · Los censos, fotografiados en verde ANTES de tocar nada

Los seis, verdes en el baseline: **6 archivos / 72 tests passed**.

Números que la ficha mueve, medidos en el baseline:

- `TOTAL_ARCHIVOS_CON_DATATABLE = 31` (`tests/unit/descarga/cobertura-tablas.guardia.test.ts:141`)
- `TOTAL_INSTANCIAS_DATATABLE = 31` (`:142`)

⚠ **Esos dos números siguen en 31 y NO los he tocado**: los mueve T8.3, que es del frontend. El
que los suba a 32 tiene el número de partida escrito aquí.

`METRICAS.length` sigue siendo **25** y el catálogo no se ha tocado: `ALCANCE_PRODUCTOS` es una
constante exportada más de `metrics.ts`, no una entrada del catálogo (no lleva `dominio:`, así que
tampoco activa el censo de declaraciones de métrica).

---

## 3.1 — ⚠ HALLAZGO: la «regex mala» del spec NO es la que infla el catálogo

`tasks.md § T1.3` exige comprobar a mano que la regex con anticipación citada en el contexto
—`(\d+)\s*\*\s*(.+?)(?=\s*\d+\s*\*|$)`— pone en ROJO las aserciones (a) y (c). **Medido: NO las
pone.** Escrita LITERALMENTE como aparece en `requirements.md §5` y `design.md §2.4`, con
`matchAll`, esa regex da el resultado **correcto**:

```
lazy (la del spec, literal) | caso A | items=2 | con '*'=false | ["Base Dr","BASE C"]
lazy (la del spec, literal) | caso B | items=2 | con '*'=false | ["BASE DE COLAGENO | …","Dile Adiós…"]
```

La que sí reproduce el síntoma que el spec nombra por su nombre es la **GREEDY** (`(.+)` en vez de
`(.+?)`):

```
greedy (.+ en vez de .+?) | caso A | items=1 | con '*'=true | ["Base Dr. 1 * BASE C"]
greedy (.+ en vez de .+?) | caso B | items=1 | con '*'=true | ["BASE DE COLAGENO | … . 3 * Dile Adiós…"]
```

`"Base Dr. 1 * BASE C"` es **exactamente** el producto fantasma citado en `requirements.md §5`. La
variante `lazy sin flag `g`` también falla (devuelve 1 ítem, el primero).

**Consecuencia:** las aserciones (a) y (c) están escritas y son las que el spec pide, y **matan la
regex que de verdad rompía**. Lo que NO es cierto es la atribución del spec: la regex citada en el
texto no es la culpable. Queda anotado y no se ha «arreglado» el spec desde aquí.

---

## 4 — Archivos

### Creados

| Archivo | Qué es |
| --- | --- |
| `lib/analytics/producto-parse.ts` | el parser puro (`parsearProducto`, `claveDeProducto`) |
| `lib/analytics/productos-consulta.ts` | alcance, tipo opaco `ConsultaProductos`, clave y tag |
| `lib/interfaces/repositories/IConteoProductosRepository.ts` | contrato + `FilaProductoCruda` |
| `lib/repositories/ConteoProductosRepository.ts` | el SQL |
| `lib/services/ConteoProductosService.ts` | `fundir()` (pura, exportada) + caché + `lastSync` |
| `lib/types/conteo-productos.ts` | DTO y `ResultadoConteoProductos` |
| `lib/actions/conteo-productos.ts` | la Server Action (`"use server"`) |
| `tests/unit/analytics/producto-parse.test.ts` | las reglas del parser |
| `tests/unit/analytics/producto-parse-corpus.test.ts` | las cadenas REALES, literales |
| `tests/unit/analytics/productos-alcance.test.ts` | quién ve qué |
| `tests/unit/analytics/productos-consulta.test.ts` | consulta preparada, clave de caché |
| `tests/unit/analytics/conteo-productos-sql.test.ts` | el `where` y la forma del SQL |
| `tests/unit/analytics/conteo-productos-servicio.test.ts` | la fusión |
| `tests/unit/analytics/conteo-productos-action.test.ts` | el borde |
| `tests/integration/repositories/conteo-productos.int.test.ts` | **Postgres REAL** |

### Modificados

| Archivo | Cambio |
| --- | --- |
| `lib/analytics/metrics.ts` | `+ ALCANCE_PRODUCTOS` (exportada, junto a las otras dos tablas) |
| `lib/analytics/entregas-conteo.ts` | `+ RecorteDeOrdenes`; `entradaDeRango` y `claveConPrefijo` pasan a exportadas, y `claveConPrefijo` ensancha su parámetro a `RecorteDeOrdenes` |
| `lib/repositories/ConteoPorStatusRepository.ts` | `condicionesDeConsulta` ensancha su parámetro a `RecorteDeOrdenes`. **El cuerpo NO se toca** |
| `lib/actions/analitica-refrescar.ts` | `+ TAG_CONTEO_PRODUCTOS` en `TAGS_ANALITICA` (6 → 7 verticales) |
| `tests/unit/analytics/alcance-obligatorio.guardia.test.ts` | `+ "ConsultaProductos"` en `TIPOS_OPACOS` y en `FUENTES_OPACAS`; dos casos nuevos (recibirlo pasa / forjarlo cae) |
| `tests/unit/analytics/refrescar-cache-analitica.test.ts` | el `toEqual` de tags se actualiza **a mano** (es el contrato) + caso de cuenta |

**Ni migración, ni tabla, ni columna, ni índice, ni policy RLS.** Esta ficha SOLO LEE, y
`orden.producto` ya existía. Por eso no hay `db/migrations/**/down.sql` que escribir.

---

## 5 — Las mutaciones: 7 aplicadas, línea de fallo real, y 2 SUPERVIVIENTES

Cada una se aplicó al árbol, se corrieron los tests, se copió la línea y se revirtió. El árbol
quedó verde después de revertir (comprobado).

### M1 — sacar `tienda_id` del `WHERE` del alcance · **SOBREVIVIÓ al test de integración**

`ConteoPorStatusRepository.condicionDeAlcance`, `case "tienda"` → `Prisma.sql\`TRUE\``.

```
tests/integration/repositories/conteo-productos.int.test.ts   →  8 passed (8)
```

**Por qué sobrevive, y es un hallazgo real:** el recorte por tienda viaja **dos veces**. Además de
la condición de alcance, `recortarFiltroConteoEntregas` ESCRIBE `tienda_id: [propia]` dentro del
filtro, y esa faceta produce su propio `o."tienda_id" IN (...)`. Son cinturón y tirantes, y con uno
de los dos puesto el aislamiento se mantiene. **No es que el test no mire donde debe: es que hay
dos barreras y ninguna mutación de UNA sola las derriba.**

Lo que SÍ la caza son los tests de SQL:

```
FAIL tests/unit/analytics/conteo-por-status-sql.test.ts > El recorte por ROL es la primera condición, siempre > va en la POSICIÓN 0, antes que cualquier faceta del cliente
AssertionError: expected 'TRUE' to contain 'o."tienda_id"'

FAIL tests/unit/analytics/conteo-por-status-sql.test.ts > … > el id del alcance viaja como parámetro, no incrustado en el texto
AssertionError: expected [] to deeply equal [ 't-con\'comilla' ]

FAIL tests/unit/analytics/conteo-productos-sql.test.ts > R56 · el `where` NO se vuelve a escribir… > el ALCANCE es la PRIMERA condicion, antes que cualquier faceta del cliente
AssertionError: expected 'TRUE' to contain 'o."tienda_id"'
                                                                  →  3 failed | 59 passed (62)
```

### M1-bis — quitar LAS DOS barreras (alcance `TRUE` **y** la faceta `tienda_id`) · **CAZADA**

```
FAIL tests/integration/repositories/conteo-productos.int.test.ts > … > (d) un adminTienda NO ve ni una fila de la otra tienda (R54)
AssertionError: expected [ { …(5) }, { …(5) }, { …(5) }, …(60) ] to deeply equal []

FAIL … > (d bis) el adminTienda ve TODO lo suyo: el recorte no se pasa de frenada
AssertionError: expected [ { …(5) }, …(63) ] to deeply equal [ { …(5) }, { …(5) }, { …(5) } ]
                                                                  →  2 failed | 6 passed (8)
```

Es la demostración de que el test de integración mide el aislamiento **donde vive**: con las dos
barreras fuera, la tienda A ve las 63 filas ajenas y el test lo dice.

### M2 — quitar `MARCADOR.lastIndex = 0` · **SOBREVIVIÓ**

```
tests/unit/analytics/producto-parse*.test.ts   →  47 passed (47)
```

**No es un agujero de cobertura: la línea es redundante.** Medido con el motor:

```
tras 2 exec, lastIndex = 9
tras el 3.º (null), lastIndex = 0
```

El bucle corre hasta que `exec` devuelve `null`, y en ese instante el motor pone `lastIndex` a 0
él solo. **Ningún test puede matar esa línea porque no cambia el comportamiento.** Se conserva
(la garantía depende de la FORMA del bucle: un `break` futuro la rompería en silencio) y el
comentario del código dice ahora esto mismo, medido y fechado, en vez de prometer una protección
que no está soportando peso.

### M3 — dejar que el `*` sobreviva en el nombre (`nombreVisible` sin el corte) · **CAZADA**

```
FAIL tests/unit/analytics/producto-parse-corpus.test.ts > R14 · (c) NINGUN nombre contiene el caracter `*` > tampoco en los casos degenerados donde el `*` sobrevive a la particion
AssertionError: 0 * X: expected '0 * X' not to contain '*'

FAIL tests/unit/analytics/producto-parse.test.ts > R21 … > `0 *` NO parte, y su texto queda dentro del nombre... sin el asterisco (R14)
AssertionError: expected [ { cantidad: 1, …(2) } ] to deeply equal [ { cantidad: 1, nombre: 'X', …(1) } ]
                                                                  →  3 failed | 44 passed (47)
```

### M4 — `unidades += cantidad` en vez de `cantidad * fila.n` · **CAZADA**

```
FAIL tests/unit/analytics/conteo-productos-servicio.test.ts > R24 / R25 · unidades y ordenes > las unidades son la suma de las cantidades; las ordenes, cuantas ordenes lo llevan
AssertionError: expected 3 to be 8 // Object.is equality

FAIL … > la cantidad multiplica por el numero de ordenes de la fila cruda, no lo sustituye
AssertionError: expected 3 to be 21 // Object.is equality

FAIL … > El corpus REAL, fundido > las cadenas de produccion producen las filas contadas a mano
AssertionError: expected [ [ 'BASE C', 3, 4 ], …(4) ] to deeply equal [ [ 'BASE C', 4, 4 ], …(4) ]
                                                                  →  6 failed | 22 passed (28)
```

### M5 — quitar la deduplicación por clave dentro de la orden (R26) · **CAZADA**

```
FAIL tests/unit/analytics/conteo-productos-servicio.test.ts > R26 · el mismo producto dos veces en la MISMA orden > suma las cantidades y cuenta la orden UNA vez
AssertionError: expected 1 to be 3 // Object.is equality

FAIL … > y lo hace tambien con `n > 1`
AssertionError: expected 5 to be 10 // Object.is equality
                                                                  →  2 failed | 26 passed (28)
```

### M6 — dejar entrar las gestiones ANULADAS en el `LATERAL` · **CAZADA en las dos capas**

```
FAIL tests/integration/repositories/conteo-productos.int.test.ts > … > (e) el desenlace es el de la ULTIMA gestion VIGENTE (R27)
AssertionError: expected 'devuelta' to be 'rechazada' // Object.is equality

FAIL tests/unit/analytics/conteo-productos-sql.test.ts > R27 … > el `LEFT JOIN LATERAL` con su `LIMIT 1` y su desempate
AssertionError: expected '\n      SELECT o."tienda_id"         …' to contain 'g."anulada_at" IS NULL'
                                                                  →  2 failed | 29 passed (31)
```

### M7 — que la Server Action devuelva el motivo del denegado al cliente · **CAZADA**

```
FAIL tests/unit/analytics/conteo-productos-action.test.ts > R9 … > la RESPUESTA no dice cual de los motivos fue
AssertionError: expected { status: 'forbidden', …(1) } to deeply equal { status: 'forbidden' }

FAIL … > los tres motivos distintos producen la MISMA respuesta al cliente
AssertionError: expected [ { status: 'forbidden', …(1) }, …(2) ] to deeply equal [ { status: 'forbidden' }, …(2) ]
                                                                  →  6 failed | 14 passed (20)
```

---

## 6 — Salida real de las herramientas

```
$ npx tsc --noEmit                                   # = pnpm typecheck
TYPECHECK_EXIT=0        (sin salida)

$ npx eslint .                                       # = pnpm lint
LINT_EXIT=0
✖ 144 problems (0 errors, 144 warnings)
  (el único warning de archivos de esta ficha es `'_consulta' is defined but never used` en
   conteo-productos-action.test.ts — el MISMO que ya tienen conteo-entregas-action.test.ts:16
   y conteo-cargadas-action.test.ts:23; convención existente, no deuda nueva)

$ npx vitest run tests/unit/analytics/ tests/integration/repositories/conteo-productos.int.test.ts
TESTS_EXIT=0
 Test Files  158 passed (158)
      Tests  1934 passed (1934)
   Duration  34.21s

$ npx vitest run tests/components/ActualizarAnalitica.test.tsx tests/unit/descarga/
EXIT=0
 Test Files  40 passed (40)
      Tests  263 passed (263)

$ npx vitest run guard
EXIT=1
 Test Files  1 failed | 170 passed (171)
      Tests  1 failed | 2568 passed (2569)
```

### El rojo de `vitest run guard`, identificado CONTRA EL BASELINE

`tests/unit/guards/superficie-de-uso.guardia.test.ts` reportaba DOS Server Actions sin superficie:

```
+   "lib/actions/conteo-productos.ts:68 consultarConteoProductos",
+   "lib/actions/tarifas.ts:67 obtenerTarifa",
```

- **`obtenerTarifa` es HEREDADO, medido y no supuesto.** Retirando temporalmente mi archivo de
  acción del árbol, la guardia sigue roja y sigue reportándolo. Además `obtenerTarifa` no lo
  importa NINGÚN módulo de `app/ lib/ components/ scripts/` (grep: una sola aparición, su propio
  `export`), y el último commit que tocó `lib/actions/tarifas.ts` es `b7bd887a` (2026-08-24,
  ficha 273). **No es mío.**
- **`consultarConteoProductos` era mío y está resuelto** con la vía que la propia guardia declara:
  `/** @sin-superficie <motivo> */` junto al export. El motivo escrito dice que la 345 va
  backend-primero y que la anotación **CADUCA**: la guardia exige retirarla en cuanto el
  componente importe la acción, y se pone roja sola si no se hace.

⚠ **RECADO PARA EL AGENTE DE FRONTEND (T7.1/T7.2):** cuando `productos-swr.ts` /
`ProductosTabla.tsx` importen `consultarConteoProductos`, **hay que borrar el bloque
`@sin-superficie` de `lib/actions/conteo-productos.ts`**. La suite lo va a exigir.

---

## 7 — EL CONTRATO PARA EL FRONTEND

### 7.1 La Server Action

```ts
// lib/actions/conteo-productos.ts
export async function consultarConteoProductos(
  raw: unknown,
  deps?: ConteoProductosDeps,
): Promise<ResultadoConteoProductos>
```

`deps` existe SOLO para los tests (servicio, logger, actor y reloj inyectables). La pantalla la
llama con un argumento: `consultarConteoProductos(filtroSerializado)`.

### 7.2 La entrada — es `.strict()`

Es **exactamente** `conteoEntregasFiltroSchema` (`lib/analytics/entregas-conteo.ts:88`), el mismo
objeto que ya usan las otras seis lecturas de la sección. **Una clave de más es
`validation_error`, no un extra inocuo.**

```ts
{
  rango?: "dia" | "semana" | "mes" | "personalizado";
  desde?: string;   // "YYYY-MM-DD", SOLO con rango: "personalizado"
  hasta?: string;   // "YYYY-MM-DD", SOLO con rango: "personalizado"
  zona_id?:      [string, ...string[]];   // lista NO vacía
  provincia_id?: [string, ...string[]];
  canton_id?:    [string, ...string[]];
  distrito_id?:  [string, ...string[]];
  tienda_id?:    [string, ...string[]];
  mensajero_id?: [string, ...string[]];
}
```

- `{}` es válido y significa **SIN filtro de fecha** (todas las órdenes), no un preset por defecto.
- una lista `[]` es un **rechazo**, no un «sin filtro».
- `desde`/`hasta` sueltos sin `rango: "personalizado"` son un rechazo; ventana máxima 366 días.
- **el alcance NUNCA se manda**: no hay `rol`, ni `usuario_id`, ni `alcance`. Mandarlos es
  `validation_error`.

### 7.3 La salida — los CUATRO estados, todos

```ts
type ResultadoConteoProductos =
  | { status: "ok"; datos: ConteoProductosDTO }
  | { status: "unauthenticated" }                                   // no hay sesión
  | { status: "forbidden" }                                         // SIN motivo, a propósito
  | { status: "validation_error"; fieldErrors: Record<string, string[]> };
```

`forbidden` cubre tres casos que el cliente **no puede distinguir** (es deliberado, R9):
`adminSatelite`, `mensajero`, rol desconocido y «pediste una tienda que no es tuya». La pantalla
pinta un solo mensaje para los cuatro.

```ts
interface ConteoProductosDTO {
  filas: readonly FilaProductoDTO[];  // orden ya fijado, ver 7.4
  ordenes: number;                    // universo del recorte (entero)
  ordenesSinProducto: number;         // entero; texto no interpretable
  lastSync: string;                   // ISO-8601 UTC
}

interface FilaProductoDTO {
  tiendaId: string;                   // clave de fila. NO va al archivo (R49)
  tienda: string;                     // usuario.nombre — la columna «Tienda»
  producto: string;                   // forma visible; NUNCA contiene `*`
  unidades: number;                   // ENTERO
  ordenes: number;                    // ENTERO
  porStatus: readonly { status: string; conteo: number }[];
}
```

**No hay ninguna cifra de dinero, ni ningún porcentaje.** Los porcentajes los calcula la pantalla.

### 7.4 Lo que el frontend NO tiene que volver a decidir

- **Orden de las filas: ya viene hecho** — `unidades` desc, `ordenes` desc, `producto` asc,
  `tienda` asc, determinista. No reordenar: rompería la paginación entre lecturas.
- **`porStatus` se pasa TAL CUAL a `calcularEfectividad(fila.porStatus)`**, fila a fila. Está
  tipado a propósito con la forma que esa función come, para que la efectividad por producto no
  se pueda calcular de otra manera. Denominador = todas las órdenes del recorte que contienen ese
  producto, **incluidas las que siguen en proceso**.
- **Columna «Tienda»**: se decide por el CONTENIDO (`new Set(filas.map(f => f.tiendaId)).size > 1`),
  nunca por el rol. Un `adminTienda` recibe siempre una sola tienda y la columna desaparece sola.
- **Nunca hay filas con `ordenes === 0`.** «Vacío» es `filas.length === 0`, que es un estado
  distinto de `forbidden`.
- **El rótulo de R36 es obligatorio**: `Σ filas[].ordenes` PUEDE superar `ordenes` sin que sea un
  error (una orden con varios productos cuenta en cada uno). Medido en test:
  4 órdenes → columna que suma 8.

### 7.5 Caché y refresco (ya cableado)

- Tag: `TAG_CONTEO_PRODUCTOS = "conteo-productos"`, exportado de
  `lib/analytics/productos-consulta.ts`.
- **Ya está dentro de `TAGS_ANALITICA`** (`lib/actions/analitica-refrescar.ts`), así que el botón
  «Actualizar» ya invalida esta lectura. R42 por el lado del servidor: hecho y con test.
- Clave SWR sugerida por el diseño: `[CLAVE_TABLERO, "conteo-productos", filtroSerializado]`.
  **Importar `CLAVE_TABLERO`, no reescribirlo.**

### 7.6 Lo que le queda al frontend (B6, B7, B8) — nada de esto está hecho

- **T6.1/T6.2** — `efectividad.ts` gana `rechazadas` y `tasaRechazo`. Comprobado en disco: la
  función YA cuenta `rechazadas` internamente (`efectividad.ts:88`) y sólo no la expone; el
  cambio es aditivo. `tasaRechazo = rechazadas / total`, FRACCIÓN, `null` si `total === 0`.
- **T7.1–T7.5** — `productos-swr.ts`, `ProductosTabla.tsx`, montaje en `page.tsx`
  (`ALCANCE_PRODUCTOS[rol] !== "prohibido"`, importando la constante de `metrics.ts` y sin
  escribir ningún literal de rol), y sus tests.
- **T8.1–T8.4** — `analitica-productos-descarga-columnas.ts` (nueve columnas), su test de orden
  con el esperado a mano, y los censos: `TOTAL_ARCHIVOS_CON_DATATABLE` y
  `TOTAL_INSTANCIAS_DATATABLE` **de 31 a 32**.
- **Borrar el `@sin-superficie`** de `lib/actions/conteo-productos.ts` (ver §6).

---

## 8 — Trazabilidad `R<n> → test` (lo cubierto por el BACKEND)

| R | Test (archivo › nombre exacto del caso) | Estado |
| --- | --- | --- |
| R1 | `productos-alcance.test.ts` › «`ALCANCE_PRODUCTOS` tiene una entrada por cada rol de `ROLES_ANALITICA`, y ninguna mas» + «la tabla es la que dice el pedido humano, escrita a mano» | ✅ |
| R2 | `productos-alcance.test.ts` › «maestro resuelve `global`» / «admin resuelve `global`» | ✅ |
| R3 | `productos-alcance.test.ts` › «resuelve `tienda` con su propio `usuarioId`» + «la tienda sale del ACTOR y nunca de un campo que el actor traiga puesto» | ✅ |
| R4 | `productos-alcance.test.ts` › «adminSatelite esta PROHIBIDO, no acotado a su zona» / «mensajero esta PROHIBIDO» · `conteo-productos-action.test.ts` › «%s recibe `forbidden` y el servicio no se llama» | ✅ |
| R5 | *(frontend, T7.4 — `AnaliticaPage.test.tsx`)* | ⛔ pendiente |
| R6 | `productos-alcance.test.ts` › «{rol : ALCANCE_PRODUCTOS[rol] === 'total'} == ROLES_ACCESO_TOTAL» + «y rol por rol, el que resuelve `global` es el que `esAccesoTotal` reconoce» | ✅ |
| R7 | `productos-consulta.test.ts` › «un adminTienda que pide OTRA tienda es `filtro_fuera_de_alcance`» | ✅ |
| R8 | `productos-consulta.test.ts` › «una clave desconocida es `validation_error`» + «intentar colar el alcance por el filtro es un RECHAZO, no un extra inocuo» | ✅ |
| R9 | `conteo-productos-action.test.ts` › «audita el motivo, el rol, el usuario y QUE se intento leer» + «la RESPUESTA no dice cual de los motivos fue» | ✅ |
| R10 | `producto-parse.test.ts` › «un solo producto con su cantidad» + «la cantidad viaja como ENTERO, no como texto» | ✅ |
| R11 | `producto-parse.test.ts` › «un punto SIN marcador detras no parte nada» + «una barra vertical SIN marcador detras no parte nada» | ✅ |
| R12 | `producto-parse-corpus.test.ts` › «`1 * Base Dr. 1 * BASE C.` produce EXACTAMENTE dos items» | ✅ |
| R13 | `producto-parse-corpus.test.ts` › «la cadena de las barras produce EXACTAMENTE dos items» | ✅ |
| R14 | `producto-parse-corpus.test.ts` › «en todo el corpus real» + «tampoco en los casos degenerados donde el `*` sobrevive a la particion» | ✅ |
| R15 | `producto-parse-corpus.test.ts` › «las tres de prueba dan un item de cantidad 1 con el texto entero» | ✅ |
| R16 | `producto-parse.test.ts` › «quita el punto final, que es terminador del item y no parte del nombre» + «colapsa espacios repetidos y recorta los extremos» | ✅ |
| R17 | `producto-parse.test.ts` › «las cinco variantes comparten clave» + «dos productos DISTINTOS no comparten clave» | ✅ |
| R18 | `conteo-productos-servicio.test.ts` › «gana la variante con MAS ordenes» + «en empate gana la menor por comparacion de cadena, no el orden de llegada» | ✅ |
| R19 | `producto-parse.test.ts` › «no se descarta en silencio» | ✅ |
| R20 | `producto-parse.test.ts` › «la cadena vacia da `[]`» · `conteo-productos-servicio.test.ts` › «`ordenes` cuenta TODAS las filas crudas, den producto o no» | ✅ |
| R21 | `producto-parse.test.ts` › «`0 *` NO parte, y su texto queda dentro del nombre... sin el asterisco (R14)» + «una cifra que no es entero seguro no parte nada» | ✅ |
| R22 | `producto-parse.test.ts` › «no lanza con ninguna entrada degenerada» + «IDEMPOTENTE: la misma entrada produce siempre la misma salida» | ✅ |
| R23 | `producto-parse-corpus.test.ts` › «`«…»` produce N item(s)» (11 casos) + «el numero de claves distintas del corpus es exactamente 11» | ✅ |
| R24 | `conteo-productos-servicio.test.ts` › «las unidades son la suma de las cantidades…» + «la cantidad multiplica por el numero de ordenes de la fila cruda, no lo sustituye» | ✅ |
| R25 | `conteo-productos-servicio.test.ts` › «las unidades son la suma de las cantidades; las ordenes, cuantas ordenes lo llevan» | ✅ |
| R26 | `conteo-productos-servicio.test.ts` › «suma las cantidades y cuenta la orden UNA vez» + «y lo hace tambien con `n > 1`» | ✅ |
| R27 | `conteo-productos-sql.test.ts` › «el `LEFT JOIN LATERAL` con su `LIMIT 1` y su desempate» · `conteo-productos.int.test.ts` › «(e) el desenlace es el de la ULTIMA gestion VIGENTE (R27)» | ✅ |
| R28 | *(frontend, T7.4 — `ProductosTabla.test.tsx`)*. El backend lo hace INEVITABLE tipando `porStatus` con `ConteoDeStatus` | ⛔ pendiente |
| R29 | *(frontend, T6.2 — `efectividad-rechazo.test.ts`)* | ⛔ pendiente |
| R30 | *(frontend, T6.2)* | ⛔ pendiente |
| R31 | `conteo-productos-servicio.test.ts` › «ninguna fila con cero ordenes» | ✅ |
| R32 | *(frontend, T7.4)*. El backend distingue vacío de denegado: `{status:"ok", datos.filas: []}` ≠ `{status:"forbidden"}` | ⛔ pendiente |
| R33 | `conteo-productos-servicio.test.ts` › «unidades desc, ordenes desc, producto asc, tienda asc» + «el orden NO depende del orden en que la base devolvio las filas» | ✅ |
| R34 | `conteo-productos-servicio.test.ts` › «unidades y ordenes son ENTEROS» + «NINGUNA cifra de dinero por producto: el DTO no tiene mas campos que los declarados» | ✅ |
| R35 | `conteo-productos-servicio.test.ts` › «`ordenes` cuenta TODAS las filas crudas, den producto o no» | ✅ |
| R36 | *(frontend, T7.4 — el rótulo)*. El backend lo mide: `conteo-productos-servicio.test.ts` › «dos productos DISTINTOS de la misma orden cuentan en los dos (R36)» | 🟡 dato ✅ / rótulo ⛔ |
| R37 | `conteo-productos-servicio.test.ts` › «dos tiendas con el MISMO texto son DOS filas» | ✅ |
| R38 | `conteo-productos-servicio.test.ts` › «la fila lleva el NOMBRE de la tienda y su id como clave» | ✅ |
| R39 | `conteo-productos.int.test.ts` › «(a) dos tiendas con el MISMO texto de producto dan DOS filas, nunca una» | ✅ |
| R40–R47 | *(frontend, B7/B8)* | ⛔ pendiente |
| R42 | `refrescar-cache-analitica.test.ts` › «el tag de productos está, y el total de tags subió de 6 a 7 verticales» *(mitad servidor)* | 🟡 servidor ✅ / SWR ⛔ |
| R48–R52 | *(frontend, B8)* | ⛔ pendiente |
| R53 | `conteo-productos-action.test.ts` › «un filtro invalido no toca el servicio NI el log» + «el parseo va ANTES que el alcance: filtro malo + rol prohibido = `validation_error`» | ✅ |
| R54 | `conteo-productos.int.test.ts` › «(d) un adminTienda NO ve ni una fila de la otra tienda (R54)» **(mutación M1-bis ⇒ rojo, §5)** | ✅ |
| R55 | `conteo-productos-sql.test.ts` › «excluye las ordenes borradas» · `conteo-productos.int.test.ts` › «(c) una orden BORRADA no cuenta en ningun bucket (R55)» | ✅ |
| R56 | `conteo-productos-sql.test.ts` › «`«…»`: el SQL del `where` es identico, fragmento a fragmento» (10 casos) | ✅ |
| R57 | `conteo-productos.int.test.ts` › «(b) N ordenes con el mismo texto son UNA fila con `n = N` (R57)» | ✅ |
| R58 | `conteo-productos-servicio.test.ts` › «escribe bajo la clave de `claveDeConteoProductos` y con el tag de productos» · `productos-consulta.test.ts` › «con el MISMO filtro, no coincide con ninguna de las otras seis lecturas de la seccion» | ✅ |

**Resumen: 37 de 58 requisitos cubiertos y ejecutándose.** Los 21 restantes son de B6/B7/B8
(frontend), más R36 y R42 que están a medias por diseño (la mitad de servidor hecha).

---

## 9 — Lo que quedó DUDOSO / abierto

1. **La atribución de la «regex mala» del spec es incorrecta** (§3.1). Las aserciones pedidas
   están y matan la regex que de verdad rompe (la greedy), pero el texto del spec culpa a una
   regex que da el resultado correcto. No lo he corregido en `requirements.md`/`design.md`.
2. **La medición de T0.2 es LOCAL, no de producción** (§2). No había herramienta MCP de Supabase
   en este agente. Los números de producción son los del leader.
3. **El aislamiento por tienda tiene DOS barreras redundantes** (§5, M1). Ninguna mutación de una
   sola las derriba. No es un fallo, pero conviene saberlo: si algún día alguien «simplifica»
   `recortarFiltroConteoEntregas` para no escribir el recorte dentro del filtro, el aislamiento
   pasa a depender ENTERAMENTE de `condicionDeAlcance` y esa mutación entonces sí sería fatal.
4. **`MARCADOR.lastIndex = 0` es inmatable** (§5, M2). Se deja documentado como tal.
5. **`obtenerTarifa` sin superficie** es un rojo heredado en `dev` (§6). No es de esta ficha; el
   leader decide si abre ficha aparte.
6. **⟨Q3⟩ (tope de filas) sigue sin número.** El backend no impone ninguno: devuelve todas las
   filas del recorte. Con 84 productos hoy no es un problema; si el catálogo creciera, el tope
   es una decisión que sigue sin tomarse.
7. **Los supuestos del leader sobre ⟨Q1⟩, ⟨Q2⟩, ⟨Q6⟩ están implementados tal cual**: el punto
   final se quita (`Base Dr.` → `Base Dr`), no hay vista agregada entre tiendas, no hay alias.
   ⟨Q7⟩ (porcentaje en puntos con un decimal) es del frontend y no lo he tocado.

---
---

# PARTE 2 — EL FRONTEND (B6, B7, B8)

> Escrito por el `frontend_dev` el 2026-09-01, **añadido al final** de la bitácora del backend, que
> no se toca. Rama `feature/345-analitica-productos`, sobre `76616410`.

## 10 — Qué se construyó

| Archivo | Qué es | Tarea |
| --- | --- | --- |
| `app/(app)/analitica/_components/entregas/efectividad.ts` | `+ rechazadas`, `+ tasaRechazo` | T6.1 |
| `tests/unit/analytics/efectividad-rechazo.test.ts` | los dos campos nuevos, con las cifras medidas | T6.2 |
| `app/(app)/analitica/_components/entregas/productos-swr.ts` | clave SWR (`[CLAVE_TABLERO, "conteo-productos", filtro]`) y fetcher | T7.1 |
| `app/(app)/analitica/_components/entregas/ProductosTabla.tsx` | la tabla, sus estados, su paginación y su descarga | T7.2 / T8.3 |
| `app/(app)/analitica/_components/entregas/analitica-productos-descarga-columnas.ts` | las nueve columnas y la proyección | T8.1 |
| `app/(app)/analitica/page.tsx` | monta la sección dentro del `FiltroEntregasProvider` | T7.3 |
| `lib/analytics/presentacion.ts` | `+ productos: "visible" / "oculta"` en `RecortePresentacion` | T7.3 (ver §11) |
| `lib/actions/conteo-productos.ts` | **se retira** la anotación `@sin-superficie` | T7.2 |
| `tests/components/ProductosTabla.test.tsx` (21 casos) | los cuatro estados, columnas, orden, paginación, rótulo | T7.4 |
| `tests/components/descarga/ProductosDescarga.test.tsx` (5 casos) | R47 / R49 / R50 / R52 | T8.4 |
| `tests/unit/descarga/analitica-productos-descarga-columnas.test.ts` (8 casos) | los dos `toEqual` a mano, `null` = celda vacía, redondeo | T8.2 |
| `tests/components/AnaliticaPage.test.tsx` | `+ 6 casos` de R5 | T7.4 |
| `tests/components/ActualizarAnalitica.test.tsx` | `+ 1 caso` de R42 (SWR por prefijo) | T7.5 |
| `tests/unit/analytics/presentacion.test.ts` | `+ 8 casos` del campo nuevo | T7.3 |
| `tests/unit/descarga/censo-tablas.ts` + `cobertura-tablas.guardia.test.ts` | la tabla nueva, `con_descarga` | T8.3 |
| `tests/unit/analytics/tablero-operativo-frontera.guardia.test.ts` | el tercer campo del contrato de presentación | §11 |

**Los censos que se movieron**, con el número de partida MEDIDO (la guardia se vio fallar antes de
tocar nada — «hay tablas sin registrar: `…/ProductosTabla.tsx #1`»):

| Constante | Antes | Después |
| --- | --- | --- |
| `TOTAL_ARCHIVOS_CON_DATATABLE` | 31 | **32** |
| `TOTAL_INSTANCIAS_DATATABLE` | 31 | **32** |
| `totalCensado` (instancias + tabla cruda) | 32 | **33** |
| tablas `con_descarga` | 21 | **22** |
| tablas `fuera` | 11 | **11** (sin cambio) |

Es la **primera `<DataTable>` de `/analitica`**: hasta hoy esa pantalla eran sólo gráficas.

## 11 — La desviación del diseño, y por qué

`design.md §7.2` dice que `page.tsx` decida con `ALCANCE_PRODUCTOS[rol] !== "prohibido"`. **Eso no
pasa los guardias vivos.** Escrito así, la página se pone roja por dos sitios:

```
tablero-operativo-frontera.guardia.test.ts
  x el tablero no reimplementa alcance ni identidad
    -> app/(app)/analitica/page.tsx
  x toda arista de la ruta hacia lib/analytics esta escrita en la allowlist, con sus nombres
    -> app/(app)/analitica/page.tsx: importa "@/lib/analytics/alcance", que NO esta en la allowlist nominal
    -> app/(app)/analitica/page.tsx: importa "@/lib/analytics/metrics", que NO esta en la allowlist nominal
```

La allowlist nominal de esa ruta tiene **dos** entradas (`types` y `presentacion`) y hay un caso
sintético que declara `import { listarMetricas } from "@/lib/analytics/metrics";` **infractor**.
Las tres salidas posibles:

1. **Ensanchar la allowlist** con `metrics` y `alcance`. Es relajar el guardia, y además rompe su
   propia aserción `expect(modulos).toEqual(["…/types", "…/presentacion"])`. Descartada.
2. **Razonar en la página sobre `recorte.alcance`** (`"global" | "tienda"` = visible). Sería una
   SEGUNDA regla del mismo permiso, que diverge el día que `ALCANCE_PRODUCTOS` cambie. Descartada.
3. **La elegida:** la decisión baja a `lib/analytics/presentacion.ts` —el módulo cuya única razón
   de ser es «qué control se dibuja»— como un campo más del recorte, `productos: "visible" |
   "oculta"`, derivado de `ALCANCE_PRODUCTOS`. Cero aristas nuevas, una sola fuente de la regla, y
   la página no escribe ni un literal de rol.

`"visible" | "oculta"` y **no un `boolean`**: el bloque (b) de ese mismo guardia exige que cada
campo del contrato sea una etiqueta o una lista de etiquetas, y esa exigencia es justo lo que
mantiene los campos de DATOS fuera. Un enum cumple la regla sin tocarla; un `boolean` habría
obligado a ensanchar `esSoloEtiquetas`. Lo único que se edita del guardia es
`CAMPOS_DE_PRESENTACION` (`["alcance","facetas"]` mas `"productos"`), con su motivo escrito.

Precedente literal, ya en la cabecera de `page.tsx`: **«el guardia manda sobre la prosa del
diseño»**.

## 12 — La verificación en el NAVEGADOR (T9.2)

Chromium, dev server local en `:3000` (los DOS que había vivos devolvían **500** en `/`, `/login` y
`/analitica`; se pararon, se borró `.next` y se levantó **uno**). Usuarios QA sembrados en la base
local con `scripts/seed-usuarios-qa.ts` — no existían, y por eso el login fallaba con «Correo o
contraseña inválidos».

**La base local, medida antes de interpretar nada** (sonda de sólo lectura, ya borrada):
**67 órdenes vivas · 41 textos de producto distintos · UNA sola tienda** (`Tania` =
`tienda.qa@ordenex.test`, dueña de las 67). La pantalla dice `1-25 de 37`: 41 textos crudos dan 37
productos tras el parser.

### 12.1 · 390 x 844 (teléfono)

- Encabezados: `["Producto", "Resultado"]` — la vista de dos columnas.
- `innerText` de la primera fila: `Unidades 10 · Órdenes 6 · Entregadas 2 · Rechazadas 1 ·
  En proceso 3 · Efectividad de entrega 33,3% · % de rechazo 16,7%`. Cuadra: 2+1+3 = 6 = órdenes;
  2/6 = 33,3 %; 1/6 = 16,7 %.
- Caja de la celda numérica más a la derecha: **x = 196, ancho = 153, borde derecho = 349** sobre
  una ventana de **390** = **dentro del área visible**.
- Tabla 308 px, sección 342 px. **Desborde horizontal de la sección: 0 px. Del documento: 0 px.**
- Nombre de producto más largo pintado: `Spray Analgésico Dental l Alivio del dolor de muelas`
  (52 caracteres), entero y sin truncar.

**Ajuste hecho POR ESTA MEDICIÓN.** La primera versión ponía cada línea de cifra en
`whitespace-nowrap` entera: «Efectividad de entrega: 33,3%» fijaba **204 px** de mínimo para la
columna de cifras y dejaba el nombre del producto en **104 px**, partiendo palabras por la mitad
(`Hemorroide/s`). Dejando que la ETIQUETA se parta y manteniendo `nowrap` sólo en la cifra:
**producto 104 -> 155 px**, cifras **204 -> 153 px**, y el desborde sigue en 0.

### 12.2 · 1440 x 950 (escritorio)

- Encabezados: `["Producto","Unidades","Órdenes","Entregadas","Rechazadas","En proceso",
  "Efectividad de entrega","% de rechazo"]` — ocho, **sin «Tienda»**, que es lo correcto: la
  respuesta trae UNA sola tienda.
- Celdas de la primera fila: `10 · 6 · 2 · 1 · 3 · 33,3% · 16,7%`.
- Última columna numérica: **x = 1294, ancho = 105, borde derecho = 1399** sobre 1440 = dentro.
- Tabla 1102 px, sección 1136 px. **Desborde: 0 px** en la sección y en el documento.

### 12.3 · El nombre de 62 caracteres de PRODUCCIÓN

La base local no tiene ninguno. Se inyectó en el DOM la cadena real
`BASE DE COLAGENO | MAQUILLAJE HIDRATANTE | BASE DE ALTA COBERTURA` (65 caracteres con las barras)
y se volvió a medir:

| Viewport | última celda | desborde sección | desborde documento |
| --- | --- | --- | --- |
| 390 x 844 | x=145, ancho=204, derecha=349 (< 390) | **0 px** | **0 px** |
| 1440 x 950 | x=1304, ancho=95, derecha=1399 (< 1440) | **0 px** | **0 px** |

`wrap-anywhere` en el nombre es lo que lo sostiene: reduce el `min-content` de esa columna, que es
la medida que aquí manda (misma lección que la 344).

### 12.4 · Los roles y la descarga

| Comprobación | Resultado |
| --- | --- |
| `adminSatelite` entra a `/analitica` | 200, ve «Detalle - Movimiento de las ordenes» |
| `adminSatelite` ve la sección de productos | **NO**: ni el título, ni la palabra «Productos», ni «Unidades», ni el aviso. R5 medido en el navegador. |
| `adminTienda` (`tienda.qa`) la ve | Sí, con las mismas 67 órdenes — **no es una fuga**: esa cuenta ES la dueña de las 67 |
| Botón «Descargar Productos» | presente; descarga `productos-2026-09-01.xlsx`, 8.293 bytes |
| El archivo, abierto con exceljs | hoja `Productos`, **38 filas** (1 cabecera + 37), **9 columnas** |
| Cabecera del archivo | `Tienda · Producto · Unidades · Órdenes · Entregadas · Rechazadas · En proceso · Efectividad de entrega (%) · Rechazo (%)` |
| R50 — Tienda en el archivo con la columna oculta en pantalla | **sí**: la pantalla no la pinta y el archivo trae `"Tania"` en cada fila |
| Primera fila del archivo | `Tania · Spray Herbal… · 10 · 6 · 2 · 1 · 3 · 33.3 · 16.7` — puntos, no fracción, y NÚMEROS (no texto) |
| Un cero legítimo | `Polvo Destapador…` sale con `Rechazo (%) = 0`, no celda vacía |
| Errores de consola | ninguno en ninguna de las corridas |
| OTP para `adminTienda` | **no lo pidió** (coherente con `AUTH_RISK_THRESHOLD` alto) |

## 13 — Las mutaciones (seis, todas revertidas)

| # | Mutación | Test que la caza | Línea de fallo REAL |
| --- | --- | --- | --- |
| M1 | **Reordenar las filas en el cliente**: `filas` pasa a `[...filas].sort((a,b) => a.producto.localeCompare(b.producto))` | `ProductosTabla.test.tsx › las pinta en el orden EXACTO en que llegaron` | `AssertionError: expected [ 'Alfa', 'Mu', 'Zeta' ] to deeply equal [ 'Zeta', 'Alfa', 'Mu' ]` |
| M2 | La columna «Tienda» se decide por NOMBRE: `new Set(filas.map(f => f.tienda))` | `ProductosTabla.test.tsx › la decisión es por CONTENIDO: se cuenta por tiendaId, no por nombre` | `AssertionError: expected false to be true // Object.is equality` |
| M3 | `tasaRechazo: total > 0 ? rechazadas/total : 0` (el `null` del universo vacío pasa a `0`) | `efectividad-rechazo.test.ts › con el universo VACÍO la tasa es null` **y** `analitica-productos-descarga-columnas.test.ts › R51` | `AssertionError: expected +0 to be null` (las dos) |
| M4 | Permutadas las dos últimas columnas del archivo (`rechazo` antes que `efectividad`) | `analitica-productos-descarga-columnas.test.ts` (3 casos) | `AssertionError: expected [ 'tienda', 'producto', …(7) ] to deeply equal [ 'tienda', 'producto', …(7) ]` |
| M5 | Un `forbidden` se degrada al estado vacío (`case "forbidden": return null`) | `ProductosTabla.test.tsx › R44 — forbidden enseña su mensaje y NO una tabla vacía` | `TestingLibraryElementError: Unable to find an element with the text: No tienes acceso a esta metrica…` |
| M6 | `seccionDeProductos` ignora `ALCANCE_PRODUCTOS` y devuelve siempre `"visible"` | `presentacion.test.ts` (3 casos) + `AnaliticaPage.test.tsx` (1) | `AssertionError: expected 'visible' to be 'oculta'` · `AssertionError: expected <div data-slot="card-title" …> to be null` |

### 13.1 · M6 SOBREVIVIÓ la primera vez, y eso arregló un test que mentía

Con M6 aplicada, `presentacion.test.ts` se puso rojo pero **`AnaliticaPage.test.tsx` siguió VERDE**
(`40 passed`). El motivo: la fixture del `adminSatelite` era `{ usuarioId: "u1", rol: "adminSatelite" }`
**sin `zonaId`**, y un satélite sin zona lo DENIEGA `resolverAlcance` (R13 de la 122). El recorte
caía por su rama `denegado`, que oculta la sección por otro motivo — el caso de R5 pasaba **por la
puerta equivocada** y no medía la tabla de esta ficha.

Corregido: la fixture de ese bloque lleva `zonaId`, así que el satélite resuelve alcance `zona` y la
única razón de que no vea la sección es `ALCANCE_PRODUCTOS`. Con la fixture arreglada, M6 **sí** cae
en `AnaliticaPage.test.tsx`. Queda escrito en el propio archivo, junto a la fixture.

## 14 — Verificación y estado

- `pnpm typecheck` — **verde**.
- `pnpm lint` — **0 errores**, 144 warnings, ninguno en archivos de esta ficha (todos preexistentes).
- `pnpm exec vitest run tests/unit/analytics tests/unit/descarga tests/unit/guards tests/components`
  — **7.640 pasan, 1 falla**: `superficie-de-uso.guardia › ninguna Server Action … es inalcanzable`
  con `lib/actions/tarifas.ts:67 obtenerTarifa`. Es el **rojo heredado de `dev`** ya anotado en §9
  de esta bitácora por el backend; `consultarConteoProductos` **no** aparece ahí, que es la prueba de
  que retirar su `@sin-superficie` fue correcto (el componente la importa y le da superficie).

## 15 — Trazabilidad del frontend (completa el mapa de §8)

| R | Test | Estado |
| --- | --- | --- |
| R5 | `presentacion.test.ts` › «adminSatelite: la sección de productos queda "oculta"» y «mensajero: …» · `AnaliticaPage.test.tsx` › «el rol `adminSatelite` entra a la página pero NO ve la sección» | OK |
| R28 | `ProductosTabla.test.tsx` › «R28 — la fila pinta EXACTAMENTE lo que devuelve `calcularEfectividad`» | OK |
| R29 | `efectividad-rechazo.test.ts` › «R29 — el denominador INCLUYE las órdenes que siguen en proceso» | OK |
| R30 | `efectividad-rechazo.test.ts` › «reparte entregadas, rechazadas y en proceso…», «el caso MEDIDO `Spray Protector`…», «el caso MEDIDO `Bálsamo Tensor`…» | OK |
| R32 | `ProductosTabla.test.tsx` › «R32 — sin ninguna fila hay un estado vacío EXPLÍCITO» | OK |
| R33 (cliente) | `ProductosTabla.test.tsx` › «las pinta en el orden EXACTO en que llegaron» **(mutación M1 = rojo)** | OK |
| R36 | `ProductosTabla.test.tsx` › «pinta el aviso de que una orden con varios productos cuenta en cada uno» | OK |
| R40 | `ProductosTabla.test.tsx` › «la primera consulta va SIN filtro y SIN ninguna clave de más» | OK |
| R41 | `ProductosTabla.test.tsx` › «R41 — cambiar el filtro vuelve a consultar, con el filtro nuevo» | OK |
| R42 (SWR) | `ActualizarAnalitica.test.tsx` › «pulsar «Actualizar» vuelve a consultar la tabla de productos» | OK |
| R43 | `ProductosTabla.test.tsx` › «R43 — mientras carga NO pinta ceros: el universo del recorte no aparece» | OK |
| R44 | `ProductosTabla.test.tsx` › «R44 — `forbidden`/`unauthenticated` enseña su mensaje», «un filtro inválido…», «si la lectura revienta…» **(M5 = rojo)** | OK |
| R45 | `ProductosTabla.test.tsx` › «con 30 productos enseña 25…», «la segunda página enseña las cinco restantes», «sin filas no hay barra» | OK |
| R46 | `ProductosTabla.test.tsx` › «pinta producto, unidades, órdenes…», «con UNA sola tienda la columna Tienda NO se pinta», «con DOS tiendas aparece» **(M2 = rojo)** | OK |
| R47 | `ProductosDescarga.test.tsx` › «R47 — la tabla ofrece su control y el archivo trae una fila por producto» | OK |
| R48 | `analitica-productos-descarga-columnas.test.ts` › «las NUEVE claves salen en este orden» y «los NUEVE encabezados…» **(M4 = rojo)** | OK |
| R49 | `analitica-productos-descarga-columnas.test.ts` › «R49 — el uuid de la tienda NO llega al archivo» · `columnas-sensibles.guardia` (existente) | OK |
| R50 | `ProductosDescarga.test.tsx` › «R50 — el archivo lleva la TIENDA aunque la pantalla haya ocultado esa columna» | OK |
| R51 | `analitica-productos-descarga-columnas.test.ts` › «R51 — sin órdenes los dos porcentajes son CELDA VACÍA» **(M3 = rojo)** | OK |
| R52 | `ProductosDescarga.test.tsx` › «R52 — las filas salen de la pantalla: la acción NO se vuelve a llamar» | OK |

**Con esto los 58 requisitos tienen un caso que existe y se ejecuta.**

## 16 — Lo que quedó DUDOSO

1. **La desviación de `design.md §7.2` está sin aprobar por el humano.** La decisión de dónde vive
   `verProductos` (§11) la tomé yo contra dos guardias vivos. Toca `lib/analytics/presentacion.ts`,
   que estrictamente está fuera de «capa de presentación de UI» aunque su nombre y su docstring
   digan exactamente eso. **Si el leader prefiere otra salida, la alternativa es ensanchar la
   allowlist nominal — y eso sí es relajar un guardia.**
2. **La columna «Tienda» NO se pudo ver aparecer en el navegador.** La base local tiene UNA sola
   tienda con órdenes, así que el camino «dos tiendas = la columna aparece» sólo está cubierto por
   `ProductosTabla.test.tsx`. En producción hoy `Crema Especial MLX` está en 2 tiendas, así que es
   un camino real que no he visto con mis ojos.
3. **La descarga se abrió, pero con `exceljs` desde un script, no con Excel.** La tarea T9.2 pide
   «abrirlo»; lo que puedo afirmar es la estructura (38 filas x 9 columnas, tipos numéricos), no
   cómo lo pinta una hoja de cálculo real.
4. **⟨Q7⟩ sigue sin responder** y el archivo va con la opción del diseño (puntos porcentuales con un
   decimal: `33.3`). Si se prefiere la fracción cruda, es una línea en `puntosPorcentuales` y dos
   aserciones.
5. **El tamaño de página inicial (25) y las opciones (10/25/50/100) los elegí yo.** ⟨Q3⟩ no da
   número. El tope real de la descarga NO es mío: sale de `descargaConfig.MAX_FILAS` (5.000) a
   través del adaptador común `filasLocales`.
6. **La fila de teléfono es alta**: siete cifras apiladas por producto. Con 25 filas la página mide
   ~7.170 px de alto. Es legible y no recorta nada, pero es mucho scroll; si molesta, la salida
   natural es bajar el tamaño de página por defecto en móvil, y eso es una decisión de producto.
7. **Sembré los usuarios QA en la base LOCAL** (`scripts/seed-usuarios-qa.ts`) porque no existían y
   sin ellos no había forma de entrar. Base `localhost:5432/ordenex`, verificada con
   `prisma migrate status` antes de tocarla. Y **paré los dos dev servers que había vivos** (los dos
   devolvían 500 en todas las rutas) y dejé **uno** en `:3000`, con su log en `dev.log`.
