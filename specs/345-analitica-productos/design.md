# Ficha 345 — Diseño

> El CÓMO. Los requisitos (el QUÉ) están en `requirements.md`; el desglose, en `tasks.md`.

## 0 — Resumen de la decisión

Una **vertical viva más** de la sección de entregas de `/analitica`, con la misma forma que las
seis que ya existen (`conteo-entregas`, `conteo-por-status`, `conteo-cargadas-por-dia`,
`conteo-hoy-gestion`, `conteo-devoluciones`, `ciclo-vida`): filtro compartido, tipo opaco,
repositorio con SQL crudo, servicio con caché de 15 min, Server Action con auditoría, y un
componente que lee por SWR con el prefijo `CLAVE_TABLERO`.

Lo propio de esta ficha son tres piezas:

1. **`lib/analytics/producto-parse.ts`** — el parser, módulo puro y con tabla de casos reales.
2. **`ALCANCE_PRODUCTOS`** — la tabla rol→alcance, declarada en `lib/analytics/metrics.ts` (el
   único archivo del repo donde el censo permite que viva; ver §3).
3. **La agregación en dos mitades**: la base cuenta órdenes por `(tienda, texto crudo, desenlace)`
   —lo que sabe hacer barato y con los índices que ya tiene— y Node parsea **cada texto distinto
   una sola vez** y funde. Así lo que cruza la frontera está acotado por el catálogo de textos, no
   por el número de órdenes (R57).

**Ni una tabla nueva, ni una migración, ni un cambio de RLS.** `orden.producto` ya existe
(`db/schema.prisma:578`, `String` NOT NULL) y esta ficha sólo lee.

---

## 1 — Mapa de archivos

| Archivo | Qué es | Estado |
| --- | --- | --- |
| `lib/analytics/producto-parse.ts` | parser puro + normalización + clave de agrupación | NUEVO |
| `lib/analytics/productos-consulta.ts` | alcance, tipo opaco `ConsultaProductos`, clave y tag de caché | NUEVO |
| `lib/analytics/metrics.ts` | `+ ALCANCE_PRODUCTOS` (exportada) | EDITADO |
| `lib/analytics/entregas-conteo.ts` | `+ RecorteDeOrdenes` (tipo estructural, ver §5) | EDITADO |
| `lib/types/conteo-productos.ts` | DTO y resultado de la acción | NUEVO |
| `lib/interfaces/repositories/IConteoProductosRepository.ts` | contrato del repositorio | NUEVO |
| `lib/repositories/ConteoProductosRepository.ts` | el SQL | NUEVO |
| `lib/repositories/ConteoPorStatusRepository.ts` | `condicionesDeConsulta` acepta `RecorteDeOrdenes` | EDITADO |
| `lib/services/ConteoProductosService.ts` | parseo, fusión, caché, `lastSync` | NUEVO |
| `lib/actions/conteo-productos.ts` | el borde (`"use server"`) | NUEVO |
| `lib/actions/analitica-refrescar.ts` | `+ TAG_CONTEO_PRODUCTOS` en `TAGS_ANALITICA` | EDITADO |
| `app/(app)/analitica/_components/entregas/efectividad.ts` | `+ rechazadas`, `+ tasaRechazo` | EDITADO |
| `app/(app)/analitica/_components/entregas/ProductosTabla.tsx` | la tabla + su descarga | NUEVO |
| `app/(app)/analitica/_components/entregas/productos-swr.ts` | clave SWR y fetcher | NUEVO |
| `app/(app)/analitica/_components/entregas/analitica-productos-descarga-columnas.ts` | contrato del archivo | NUEVO |
| `app/(app)/analitica/page.tsx` | monta la sección si el rol la tiene concedida | EDITADO |
| `tests/unit/analytics/alcance-obligatorio.guardia.test.ts` | `+ "ConsultaProductos"` en `TIPOS_OPACOS` | EDITADO |
| `tests/unit/descarga/censo-tablas.ts` + `cobertura-tablas.guardia.test.ts` | registro y totales | EDITADO |

---

## 2 — El parser (`lib/analytics/producto-parse.ts`)

Módulo **puro**: vive en `lib/analytics/`, que el guardia de pureza barre entero
(`tests/unit/analytics/modulo-puro.guardia.test.ts:171`, `archivosDeAnalytics()` lee el
directorio), así que no puede importar `@prisma/client` como valor, ni `db`, ni repositorios, ni
servicios, ni acciones. No importa nada.

### 2.1 Contrato

```ts
export interface ItemProducto {
  /** entero >= 1 */
  readonly cantidad: number;
  /** forma VISIBLE, ya limpia: sin espacios sobrantes y sin puntos finales */
  readonly nombre: string;
  /** clave de agrupación: `nombre` en minúsculas */
  readonly clave: string;
}

export function parsearProducto(texto: string): readonly ItemProducto[];
```

### 2.2 El algoritmo, paso a paso

1. Si `texto` no es una cadena o `texto.trim()` es vacío ⇒ `[]` (R20, R22).
2. **Marcadores.** Se buscan todas las apariciones de `/(\d+)\s*\*/g`. Una aparición es un
   marcador VÁLIDO si su número, leído con `Number.parseInt(_, 10)`, es un entero seguro `>= 1`
   (R21). Lo que no lo sea (`0 *`, un número de 30 dígitos) **no parte nada** y se queda dentro del
   nombre que lo contiene: mejor un nombre feo que una unidad inventada.
3. Si no hay ningún marcador válido ⇒ un solo ítem `{cantidad: 1, nombre: limpiar(texto)}` (R15).
   Ésta es la rama por la que pasan las **7 filas de prueba** medidas.
4. **Prefijo.** El texto anterior al primer marcador, si `limpiar()` lo deja no vacío, produce su
   propio ítem de cantidad 1 (R19). Hoy no existe ningún caso así en producción; existe para que
   nada se pierda en silencio si aparece.
5. **Un ítem por marcador.** El nombre del ítem *i* es el texto que va desde el final del marcador
   *i* hasta el comienzo del marcador *i+1* (o hasta el final del texto). **Se parte por el
   marcador, no por el punto ni por la barra** (R11): de ahí salen R12 y R13 sin ningún caso
   especial.
6. Si `limpiar(nombre)` queda vacío (`"2 * "`, `"1 * 2 * X"`), ese ítem se descarta: un producto
   sin nombre no es un producto.

### 2.3 `limpiar(s)` y la clave

```
limpiar(s):  trim  →  colapsar espacios repetidos a uno  →  quitar puntos y espacios FINALES  →  trim
clave(s):    limpiar(s).toLowerCase()
```

- Los puntos finales se van porque **son el terminador del ítem** y no hay forma de distinguirlos
  de una abreviatura sin una lista de excepciones. Consecuencia asumida y declarada: `Base Dr.` se
  muestra `Base Dr` (⟨Q1⟩ de `requirements.md`).
- `toLowerCase()` **sin locale** a propósito: `toLocaleLowerCase` depende del entorno (la `I` turca)
  y esta clave decide qué se funde con qué. Determinismo antes que corrección tipográfica.
- Medido: normalizar así **no colapsa ningún nombre** de los 84 de producción. La normalización no
  está para fundir productos, está para que el mismo producto escrito con un espacio de más no se
  cuente dos veces.
- **No** hay equivalencia por tildes, ni por singular/plural, ni alias (⟨Q6⟩): eso fundiría
  productos que las tiendas escribieron distintos a propósito.

### 2.4 La tabla de casos (va en el test, con las cadenas LITERALES)

| Entrada (literal de producción) | Salida esperada |
| --- | --- |
| `1 * Dr Melaxin` | 1 ítem: `1 × Dr Melaxin` |
| `1 * Base Dr. 1 * BASE C.` | **2** ítems: `1 × Base Dr`, `1 × BASE C` |
| `1 * Dr Melaxin. 1 * BASE C.` | 2 ítems |
| `2 * Creatina Monohidratada. 1 * BASE C.` | 2 ítems: `2 × …`, `1 × …` |
| `1 * BASE DE COLAGENO \| MAQUILLAJE HIDRATANTE \| BASE DE ALTA COBERTURA. 3 * Dile Adiós a los Hongos \| Aceite Milagroso 3X1.` | **2** ítems, no 5 |
| `PRUEBA` | 1 ítem: `1 × PRUEBA` |
| `PRUEBA 27 08 26` | 1 ítem: `1 × PRUEBA 27 08 26` |
| `Camiseta talla M` | 1 ítem: `1 × Camiseta talla M` |
| `""`, `"   "` | `[]` |
| `3 *` | `[]` |
| `0 * X` | 1 ítem: `1 × 0 * X`… **no**: el `*` no puede sobrevivir (R14) ⇒ ver nota |

> **Nota sobre `0 * X`.** R14 prohíbe que un nombre contenga `*`. Con la regla de §2.2(2) el `0 *`
> no es marcador, así que caería en la rama 3 con el `*` dentro del nombre. Para no romper R14, el
> paso 3 aplica una última limpieza: **si el texto sin marcadores válidos contiene un `*`, se
> descarta todo lo anterior al último `*` y lo que queda es el nombre** (`0 * X` ⇒ `X`, cantidad 1).
> Es la única regla del parser que no sale de una cadena real medida; se escribe explícita para que
> la invariante R14 sea cierta por construcción y no por suerte, y se prueba con ese caso.

**El test que impide la inflación** (R23): además de contar ítems, comprueba que **ningún nombre
producido contiene `*`** y que `1 * Base Dr. 1 * BASE C.` da exactamente 2. Es el par de
aserciones que la regex con anticipación (`(\d+)\s*\*\s*(.+?)(?=\s*\d+\s*\*|$)`) **no** pasa: ésa
produce `Base Dr. 1 * BASE C` como un solo nombre. Los 41 productos fantasma de la medición salen
de ahí.

---

## 3 — El alcance por rol, y por qué la tabla vive en `metrics.ts`

```ts
// lib/analytics/metrics.ts  (junto a ALCANCE_OPERATIVA y ALCANCE_FINANCIERA)
export const ALCANCE_PRODUCTOS = {
  maestro: "total",
  admin: "total",
  adminSatelite: "prohibido",
  adminTienda: "acotado",
  mensajero: "prohibido",
} as const satisfies Readonly<Record<RolAnalitica, AlcanceMetrica>>;
```

**Es el mecanismo que ya existe** (`AlcanceMetrica` + `Record<RolAnalitica, _>` de
`lib/analytics/types.ts`), no un scoping nuevo: el `Record` exhaustivo hace que **omitir un rol no
compile** (R1), y el conjunto `total` se comprueba contra `esAccesoTotal` por test (R6).

**Por qué en `metrics.ts` y no junto a la vertical**, que es donde uno la pondría: el guardia
`tests/unit/analytics/alcance-fuente-unica.guardia.test.ts:123` censa `app/`, `lib/`, `components/`
y `scripts/` buscando el DATO `maestro: "total"` y **falla si aparece fuera de `metrics.ts`**.
Escribir esta tabla en `lib/analytics/productos-consulta.ts` pone rojo ese censo. No se relaja el
guardia y no se evade con un truco de escritura: se pone la tabla donde el guardia dice que vivan
las tablas de alcance por rol, que además es exactamente lo que el guardia quiere («la regla por rol
se declara una sola vez, en `metrics.ts`»).

**Lo que NO se hace: una 26.ª métrica en el catálogo.** `METRICAS` está congelado en 25 por decisión
humana fechada, y el propio guardia lo atornilla (`expect(METRICAS.length).toBe(25)`). Añadir una
entrada movería ese número y con él media docena de guardias del lote 122-135, para expresar algo
que —igual que el conteo de entregas, ver `entregas-conteo.ts:6-13`— **no es expresable como
`Metrica`**: universo `orden` viva, fecha efectiva por `COALESCE`, grano «producto» que no existe en
`DIMENSIONES`. `ALCANCE_PRODUCTOS` es una constante exportada más del archivo, no una métrica: no
lleva `dominio:`, así que tampoco activa el censo de declaraciones de métrica
(`modulo-puro.guardia.test.ts:347`).

### 3.1 El resolutor

`lib/analytics/productos-consulta.ts` traduce la tabla a `AlcanceDatos`:

| `ALCANCE_PRODUCTOS[rol]` | resultado |
| --- | --- |
| `total` | `{ tipo: "global" }` |
| `acotado` + rol `adminTienda` | `{ tipo: "tienda", tiendaId: actor.usuarioId }` |
| `prohibido` | `denegado("metrica_prohibida")` |
| rol que no es lector, actor sin id, rol no-cadena | `denegado(...)` |

`switch` exhaustivo sin `default` permisivo, igual que `alcanceAcotado` de `alcance.ts`: un sexto
rol lector no compila en vez de heredar alcance. Se reutilizan `esRolAnalitica` y
`rolTieneAccesoTotal` de `lib/analytics/alcance.ts`; **no se escribe ninguna lista de roles nueva**.

En este esquema **el `adminTienda` ES la tienda**: `orden.tienda_id` es FK a `usuario`
(`db/schema.prisma:573`), el mismo criterio que ya usan `alcance.ts:337` y `entregas-conteo.ts:200`.

---

## 4 — El tipo opaco `ConsultaProductos`

```ts
declare const marcaProductos: unique symbol;

export interface ConsultaProductos extends RecorteDeOrdenes {
  readonly [marcaProductos]: true;
}
```

Se construye **sólo** dentro de `prepararConsultaProductos(raw, actor, now)`, que hace los cuatro
pasos en este orden y sin vías alternativas: parsear → resolver rango → resolver alcance →
intersecar filtro con alcance. Si el parseo falla, no se pregunta por el alcance y no se toca la
base (R53).

Se **reutiliza sin copiar**: `conteoEntregasFiltroSchema` (las 6 facetas + rango opcional, con su
`.strict()` que hace de R8 un error de validación), `resolverRango` y
`recortarFiltroConteoEntregas` — los tres exportados de `entregas-conteo.ts`, que es un módulo puro.
Compartir el filtro **es el punto**: la barra de entregas mueve las siete lecturas a la vez.

**Por qué un tipo propio y no reusar `ConsultaConteoEntregas`** (alternativa A5 de §8): el alcance
DIVERGE. Allí un `adminSatelite` obtiene `{tipo:"zona"}`; aquí está **prohibido**. Con el tipo
compartido, pasar una consulta de entregas al repositorio de productos **compilaría**, y eso es
exactamente la fuga que la decisión del humano cierra. Con dos tipos, no compila.

Consecuencia: hay que añadir `"ConsultaProductos"` a `TIPOS_OPACOS` en
`tests/unit/analytics/alcance-obligatorio.guardia.test.ts:120`. Es el punto de extensión que ese
guardia declara por escrito, y con la condición que exige: **marca `unique symbol`**. Sin ese
añadido, el repositorio nuevo pondría el censo en rojo (y con razón: para el censo estaría
consultando `orden` sin consulta preparada).

---

## 5 — La consulta (`ConteoProductosRepository`)

### 5.1 El `where` NO se vuelve a escribir

`ConteoPorStatusRepository.condicionesDeConsulta()` ya es una función **pura y exportada** que
devuelve el array de fragmentos `Prisma.Sql`: alcance primero, `deleted_at IS NULL`, las cinco
facetas geográficas/tienda por `IN`, el `EXISTS` del mensajero y la ventana semiabierta sobre
`COALESCE(u.created_at, o.created_at)`. **Se importa y se usa tal cual** (R56).

Su cabecera ya declara que hay DOS implementaciones del mismo `where` y que pueden divergir. Una
tercera sería peor. Para poder llamarla con `ConsultaProductos` se **ensancha su parámetro** al tipo
estructural que las dos consultas cumplen, declarado en `entregas-conteo.ts`:

```ts
export interface RecorteDeOrdenes {
  readonly filtro: FiltroConteoEntregas;
  readonly rango: RangoResuelto | null;
  readonly alcance: AlcanceDatos;
}
```

Esto **no afloja la frontera**: la opacidad se exige donde importa, en la firma del método del
repositorio (`contarProductos(consulta: ConsultaProductos)`), y el censo de
`alcance-obligatorio.guardia` sigue mordiendo — un archivo que forjase un `RecorteDeOrdenes` a mano
y lanzara `$queryRaw` no mencionaría ningún tipo opaco y caería igual. Lo que **no** se puede hacer
es `consulta as unknown as ConsultaConteoEntregas` en el repositorio: ese cast es literalmente lo
que `FORJA_LA_CONSULTA` detecta (`:123`), y dejaría el censo rojo.

### 5.2 El SQL

```sql
SELECT o."tienda_id"                            AS tienda_id,
       t."nombre"                               AS tienda_nombre,
       o."producto"                             AS producto,
       COALESCE(u."resultado"::text, s."value") AS status,
       COUNT(*)::int                            AS n
FROM "orden" o
JOIN "order_status" s ON s."id" = o."estatus_id"
JOIN "usuario"      t ON t."id" = o."tienda_id"
LEFT JOIN LATERAL (
  SELECT g."resultado", g."created_at"
  FROM "gestion_orden" g
  WHERE g."orden_id" = o."id" AND g."anulada_at" IS NULL
  ORDER BY g."created_at" DESC, g."id" DESC
  LIMIT 1
) u ON TRUE
WHERE <condicionesDeConsulta(consulta)>
GROUP BY 1, 2, 3, 4
ORDER BY 1, 3, 4
```

- El `LEFT JOIN LATERAL … LIMIT 1` y su desempate `created_at DESC, id DESC` son **copia literal**
  de `ConteoPorStatusRepository`: es lo que garantiza que el desenlace de una orden sea el MISMO en
  las dos pantallas (R27). `LEFT` y no `INNER`: las órdenes sin gestión entran por `s."value"`.
- `JOIN "usuario"` es INNER sin riesgo: `orden.tienda_id` es NOT NULL con FK
  (`db/schema.prisma:573`).
- **`GROUP BY` sobre el texto CRUDO** (R57): N órdenes con el mismo texto ⇒ una fila. Hoy el corpus
  entero son 768 órdenes y 84 productos; las filas de esta consulta están acotadas por
  `textos distintos × tiendas × desenlaces`, y ese número **crece con el catálogo, no con las
  ventas**.
- Ningún índice nuevo: el `WHERE` es el mismo de una consulta que ya corre, y los índices de `orden`
  (`tienda_id`, `zona_id`, `created_at`, `estatus_id`, `mensajero_asignado_id`) ya existen. El
  `GROUP BY` es post-filtro sobre un conjunto pequeño.

Salida del repositorio:

```ts
export interface FilaProductoCruda {
  readonly tiendaId: string;
  readonly tiendaNombre: string;
  /** el texto TAL CUAL está en la base; el repositorio NO parsea */
  readonly producto: string;
  readonly status: string;
  readonly n: number;
}
```

---

## 6 — El servicio (`ConteoProductosService`)

Gemelo de `ConteoPorStatusService`: repositorio + `IAnaliticaCache` + reloj inyectable; envuelve en
`cache.envolver(claveDeConteoProductos(consulta), [TAG_CONTEO_PRODUCTOS], productor)`; sella
`lastSync` **dentro** del productor (si no, cada acierto de caché escribiría la hora del render).
Caché: `crearConteoEntregasCacheDeNext()`, el mismo TTL de 15 min y el mismo kill-switch que las
otras seis lecturas vivas.

### 6.1 La fusión

Por cada fila cruda:

1. `items = parsearProducto(fila.producto)`. **Se memoiza por texto** dentro de la llamada: una
   fila por desenlace repite el mismo texto y no hay por qué volver a parsearlo.
2. Si `items` está vacío ⇒ `ordenesSinProducto += fila.n` y se pasa a la siguiente.
3. Se deduplican los ítems **por `clave` dentro de la misma orden** (R26): las cantidades se suman;
   la orden cuenta UNA vez.
4. Para cada `(clave)` resultante, en el grupo `(fila.tiendaId, clave)`:
   `unidades += cantidad × fila.n`; `ordenes += fila.n`; `porStatus[fila.status] += fila.n`.
5. `ordenes` (universo) `= Σ fila.n` sobre TODAS las filas crudas.

**Forma visible** (R18): entre las variantes crudas que comparten `clave`, gana la de más órdenes;
empate, la menor por comparación de cadena (`<`, orden de unidades de código — **no**
`localeCompare`, que depende del ICU del entorno).

**Orden de las filas** (R33): `unidades` desc → `ordenes` desc → `producto` asc → `tienda` asc. Los
cuatro criterios porque los tres primeros pueden empatar y una respuesta con orden inestable rompe
tanto el `toEqual` de un test como la paginación de la pantalla.

Todo son **enteros** (R34): `unidades` y `ordenes` se acumulan con `+` sobre enteros; no hay
`Decimal`, no hay dinero, y no hay ningún `parseFloat`.

### 6.2 El DTO

```ts
// lib/types/conteo-productos.ts
import type { ConteoDeStatus } from "@/lib/types/conteo-por-status";

export interface FilaProductoDTO {
  readonly tiendaId: string;
  readonly tienda: string;      // usuario.nombre
  readonly producto: string;    // forma visible
  readonly unidades: number;    // entero
  readonly ordenes: number;     // entero
  /** los desenlaces de ESAS órdenes; misma forma que el desglose por status */
  readonly porStatus: readonly ConteoDeStatus[];
}

export interface ConteoProductosDTO {
  readonly filas: readonly FilaProductoDTO[];
  readonly ordenes: number;             // universo del recorte
  readonly ordenesSinProducto: number;  // R35
  readonly lastSync: string;            // ISO-8601 UTC
}

export type ResultadoConteoProductos =
  | { readonly status: "ok"; readonly datos: ConteoProductosDTO }
  | { readonly status: "unauthenticated" }
  | { readonly status: "forbidden" }
  | { readonly status: "validation_error"; readonly fieldErrors: Record<string, string[]> };
```

`porStatus` se tipa con `ConteoDeStatus` **a propósito**: es exactamente lo que come
`calcularEfectividad`, así que la pantalla no puede calcular la efectividad de otra manera aunque
quiera (§7.1).

---

## 7 — El borde y la pantalla

### 7.0 La Server Action

`lib/actions/conteo-productos.ts`, copia estructural de `conteo-por-status.ts`: resuelve el actor,
llama a `prepararConsultaProductos`, y

- `validation_error` ⇒ se devuelve sin consultar y **sin auditar** (una entrada malformada no puede
  servir para sondear permisos);
- `forbidden` ⇒ `logger.logError(describirDenegado({motivo, actor, metricaId: "conteo_productos", filtro: raw}))`
  y respuesta `unauthenticated` (sólo `sin_sesion`) o `forbidden` (todo lo demás). El motivo NO
  viaja al cliente (R9).

Server Action y no `app/api/`: es una lectura interna, y `docs/architecture.md` reserva los route
handlers para webhooks y API pública.

### 7.1 La efectividad se REUSA, no se redefine

`app/(app)/analitica/_components/entregas/efectividad.ts` gana **dos campos derivados de lo que ya
calcula**, sin tocar ninguna de las cifras existentes:

```ts
readonly rechazadas: number;          // ya se contaba dentro; ahora se expone
readonly tasaRechazo: number | null;  // rechazadas / total, FRACCIÓN; null si total === 0
```

`ProductosTabla` llama `calcularEfectividad(fila.porStatus)` **fila a fila**. Consecuencias, las dos
buscadas:

- el denominador por producto es, por construcción, el mismo que el de la fila de KPIs: **todas las
  órdenes del recorte que contienen ese producto, incluidas las que siguen en proceso** (R29). Esa
  elección ya está razonada y firmada en el docstring de `calcularEfectividad` («de todo lo que
  entró, cuánto se entregó») y esta ficha **no la reabre**;
- «rechazada» significa aquí lo mismo que en el resto del tablero: el desenlace de la última gestión
  vigente, no `orden.estatus`.

`efectividadGestion` (entregadas + rechazadas / total) existe y **no se pinta** en esta tabla: en la
lectura por producto lo que interesa es el rechazo COMERCIAL, y mostrar dos porcentajes que suman
distinto en la misma fila invita a leer uno por el otro.

### 7.2 Dónde se monta

⚠ **Las regiones «Filtros», «Tablero operativo» y «Tablero financiero» de `AnaliticaShell` están
comentadas**: hoy la página sólo pinta el slot `destacado`. Un panel colgado de
`catalogo-paneles.ts` **no se vería**. Por eso la sección de productos entra como una
`SeccionFiltrable` + `ContenedorSeccion` **hermana** de «Detalle - Movimiento de las órdenes`»,
DENTRO del mismo `<FiltroEntregasProvider>` (si no, no sería descendiente de quien filtra).

`page.tsx` decide server-side si la monta:
`ALCANCE_PRODUCTOS[rol] !== "prohibido"` ⇒ se monta; si no, **no se renderiza nada** (R5), sin
`EmptyState` — el mismo criterio y por el mismo motivo que la región financiera del shell. No se
escribe ningún literal de rol en la página.

Eso NO sustituye a la defensa: la acción deniega igual (R4), y hay test para las dos capas.

### 7.3 La tabla

`<DataTable>` con paginación (R45). Columnas:

| Columna | Nota |
| --- | --- |
| Tienda | sólo si la respuesta trae **más de una** tienda distinta (R46) |
| Producto | forma visible |
| Unidades | entero, alineado a la derecha |
| Órdenes | entero, alineado a la derecha |
| Entregadas / Rechazadas / En proceso | de `calcularEfectividad` |
| Efectividad de entrega | `formatearValor(_, "porcentaje")` sobre la fracción |
| % de rechazo | ídem sobre `tasaRechazo` |

La columna «Tienda» se decide **por el contenido de la respuesta** y no por el rol: para un
`adminTienda` siempre hay una sola tienda, así que la columna desaparece sola sin que el cliente
razone sobre permisos; y un maestro que filtre una tienda tampoco la necesita. **En el archivo va
siempre** (R50): un fichero que circula tiene que decir de quién es cada fila.

Rótulo obligatorio bajo el título (R36): *«Una orden con varios productos cuenta en cada uno: la
suma de la columna Órdenes puede superar el total del rango.»* Con el total del recorte y las
órdenes sin producto al lado (R35).

SWR: clave `[CLAVE_TABLERO, "conteo-productos", filtroSerializado]`. El prefijo `CLAVE_TABLERO` es
lo que hace que el botón «Actualizar» la revalide sin conocerla (R41, R42).

### 7.4 La descarga — CONTRATO

`analitica-productos-descarga-columnas.ts` (el nombre importa: el censo de columnas sensibles
descubre por la convención `*-descarga-columnas.ts`):

```ts
export const COLUMNAS_DESCARGA_ANALITICA_PRODUCTOS: DescargaColumna[] = [
  { clave: "tienda",      encabezado: "Tienda" },
  { clave: "producto",    encabezado: "Producto" },
  { clave: "unidades",    encabezado: "Unidades" },
  { clave: "ordenes",     encabezado: "Órdenes" },
  { clave: "entregadas",  encabezado: "Entregadas" },
  { clave: "rechazadas",  encabezado: "Rechazadas" },
  { clave: "en_proceso",  encabezado: "En proceso" },
  { clave: "efectividad", encabezado: "Efectividad de entrega (%)" },
  { clave: "rechazo",     encabezado: "Rechazo (%)" },
];
```

- **Nueve columnas, sin ningún uuid** (R49): `tiendaId` se queda en el DTO como clave de fila y no
  entra al archivo.
- Los dos porcentajes se escriben como **puntos porcentuales con un decimal** (`37.5`), con la
  unidad en el encabezado; `null` ⇒ **celda vacía**, nunca `0` (R51). El redondeo es
  `Math.round(f * 1000) / 10`, determinista. (⟨Q7⟩ si se prefiere la fracción cruda.)
- `obtenerFilas` proyecta el DTO **que ya está en pantalla** (R52): sin segunda consulta, así que el
  archivo no puede discrepar de la tabla.
- Sin `ambitoColumnas`: sin selector de columnas, salen las nueve.

Y lo que esto obliga a tocar, porque son censos vivos:
`tests/unit/descarga/censo-tablas.ts` (una entrada nueva, estado `con_descarga`) y
`cobertura-tablas.guardia.test.ts` (`TOTAL_ARCHIVOS_CON_DATATABLE` y `TOTAL_INSTANCIAS_DATATABLE`
pasan de **31 a 32**), más el test de orden con el esperado **escrito a mano**, que es lo que exige
`columnas-asercion-de-orden.guardia.test.ts`.

---

## 8 — Alternativas descartadas

**A1 — Un rollup diario `producto_daily` (+ backfill), como `analytics_daily`.** DESCARTADA.
(a) *Congela el parser*: el rollup guarda el resultado del parseo del día en que se escribió, así
que el día que el parser mejore —y va a mejorar: las 7 filas de prueba de hoy son la prueba de que
las tiendas escriben lo que quieren— el histórico sigue mintiendo hasta un re-backfill completo. Los
41 productos fantasma serían permanentes. Con consulta viva, arreglar el parser arregla el pasado.
(b) *No cabe en el rollup que hay*: el grano de `analytics_daily` es
`(fecha, zona, tienda, mensajero, estatus, causa_devolucion)` (`db/schema.prisma:2727`) y añadir
«producto» multiplicaría las filas por el catálogo entero.
(c) *El coste no lo justifica hoy*: 768 órdenes, 855 líneas, y la consulta agrupa en la base
devolviendo filas acotadas por textos distintos (§5.2), detrás de una caché de 15 min.
La puerta queda declarada, no cerrada: `IAnaliticaOperativaRollupRepository` e
`IAnaliticaBackfillService` existen y son el camino si algún día hace falta. ⟨Q4⟩ pregunta con qué
número se dispara.

**A2 — Parsear en SQL (`regexp_matches` / `regexp_split_to_table`).** DESCARTADA. El parser es el
corazón de la ficha y sus dos trampas se prueban con **cadenas reales y sin base de datos**; en SQL
esas pruebas exigirían Postgres y el repo ya tiene medida esa lección al revés (los tests de
servicio con dobles no ven el SQL). Además el mismo parser hace falta en Node para la deduplicación
por orden (R26), así que en SQL habría **dos** implementaciones de la misma regla.

**A3 — Partir por `. ` (punto+espacio) o por `|`.** DESCARTADA **por medición**: infla el catálogo
de 84 a 125 y funde dos productos en uno (`Base Dr. 1 * BASE C`). Está aquí porque es la solución
que parece obvia leyendo el dato.

**A4 — Declararlo como la 26.ª métrica del catálogo.** DESCARTADA: `METRICAS` está congelado en 25
por decisión humana y un guardia lo atornilla; y la definición no es expresable como `Metrica`
(§3). Mismo razonamiento, y mismo precedente, que `entregas-conteo.ts:6-13`.

**A5 — Reusar `ConsultaConteoEntregas` como tipo opaco.** DESCARTADA: el alcance diverge
(`adminSatelite` es `zona` allí y `prohibido` aquí), así que compartir el tipo dejaría COMPILAR el
paso de una consulta de entregas al repositorio de productos — la fuga exacta que la decisión del
humano cierra. Coste asumido: hay que ampliar `TIPOS_OPACOS` del guardia, que es su punto de
extensión declarado.

**A6 — Una definición propia de «efectividad» para productos** (por ejemplo, sobre las órdenes ya
cerradas). DESCARTADA: la pantalla enseñaría dos porcentajes con el mismo nombre y distinto
denominador, a dos secciones de distancia. El docstring de `calcularEfectividad` ya prevé ese
debate y lo zanja: si algún día se quiere «sobre las cerradas», es una métrica con su propio nombre
y su propio rótulo, no un divisor cambiado a escondidas.

**A7 — Devolver una fila por ORDEN y agregar entero en Node.** DESCARTADA: lo que cruza crecería
con las ventas (hoy 768 filas, mañana las que sean) en vez de con el catálogo. Agrupando por texto
crudo en la base, N órdenes iguales son una fila (R57).

**A8 — Repartir el flete de la orden entre sus productos para dar «ingreso por producto».**
DESCARTADA por el límite innegociable: en el 12 % multiproducto sería una cifra inventada. La única
variante defendible (sólo las órdenes de un producto) queda como ⟨Q5⟩, **no especificada**.

---

## 9 — Lo que esta ficha NO hace

- No añade tabla, columna, índice, migración ni policy RLS. **Sólo lee.**
- No toca el catálogo de 25 métricas, ni el rollup, ni el job diario, ni el backfill.
- No emite ninguna cifra de dinero por producto.
- No cambia ninguna cifra ya visible del tablero: los dos campos nuevos de `efectividad.ts` son
  aditivos y `KpisEfectividad` sigue pintando las mismas cuatro tarjetas.
- No abre la analítica a ningún rol nuevo: `mensajero` sigue sin puerta
  (`ROLES_SIN_ACCESO_ANALITICA`) y `adminSatelite` entra a `/analitica` pero **no** ve esta sección.
