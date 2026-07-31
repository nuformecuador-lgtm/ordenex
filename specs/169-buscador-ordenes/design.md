# Feature 169 — Buscador de texto en el listado de órdenes · design.md

> Decisiones técnicas ANTES de código. Todo lo de aquí se contrastó con el código de este
> worktree; donde la dirección recibida no encajaba con el repo, se dice **explícitamente**
> (§1.1).
> El humano pidió esta feature con un aviso expreso: **cuidado con el rendimiento**. Este
> documento decide y justifica; no deja "a criterio del implementer" nada que afecte al
> plan de ejecución de la consulta.

---

## 0. Decisiones cerradas

| # | Decisión | Origen |
| --- | --- | --- |
| (a) | Campos buscables: `num_guia`, `num_remision`, `telefono_dest`, `destinatario`. Sin dirección, producto ni nombre de tienda | humano |
| (b) | Superficie: solo `/ordenes`; el rollout es la 145 | humano |
| (c) | Se diseña para decenas de miles de filas, no para el volumen de hoy | humano |
| (d) | Mínimo 3 caracteres + espera antes de consultar | humano |
| (e) | `pg_trgm` + GIN sobre **una** columna generada `STORED` que concatena los cuatro campos normalizados. **NO** `tsvector`/FTS | leader, aprobado por el humano; confirmado aquí (§10.1) |
| (f) | Ruta rápida por igualdad contra `num_guia` cuando el término es solo dígitos | leader, aprobado; **matizada** en §5 (con fallback) |
| (g) | Se indexa AHORA porque la tabla es pequeña | leader, aprobado; cuantificado en §2.2 |
| (h) | Sin `unaccent`: plegado de acentos con `translate()` y un mapa explícito espejado en TS | **decisión de este spec** (§3) |
| (i) | El `count(*)` exacto se mantiene en v1, con plan B diseñado y disparador medible | **decisión de este spec** (§6) |

---

## 1. Estado del arte verificado

### 1.1 Dos correcciones a la dirección recibida

1. **`OrdenRepository.list` NO usa `$transaction([findMany, count])`.** Usa
   `Promise.all([findMany, count])` (líneas 745-754), sin transacción, con el **mismo**
   objeto `where` en las dos consultas. La consecuencia para esta feature es la misma
   (el conteo exacto se paga en cada tecleo), pero el diagnóstico correcto importa:
   **no hay un `BEGIN` que alargue una transacción durante la búsqueda**, son dos
   consultas independientes que compiten por el pool, y el plan B del §6 no necesita
   tocar ninguna semántica transaccional.
2. **`adminSatelite` no lista órdenes en esta superficie.** La dirección recibida pedía
   componer el término con "lo de su zona". En el código: `OrdenService` solo reconoce
   `maestro`, `admin`, `adminTienda` y `mensajero` (`KNOWN_ROLES`); cualquier otro rol
   recibe `forbidden` **antes** de construir el `where`, y `app/(app)/ordenes/page.tsx`
   manda `adminSatelite` a `notFound()`. Los acotamientos reales que el término debe
   respetar son **`adminTienda` → su tienda** y **`mensajero` → sus asignadas** (§7). El
   requisito de "no ser una fuga" no cambia; cambia a quién hay que testear.

### 1.2 Lo que ya existe y se reutiliza tal cual

- El `filter` `.strict()` de `listarOrdenes` y su whitelist (`ORDEN_FILTER_FIELDS`).
- `OrdenService.construirWhere`, **compartido** por `listar` y `listarCompleto`: añadir
  ahí el término da R20 (la descarga de la 151 busca lo mismo) sin escribir código nuevo.
- `FilterComponent` con su **debounce de emisión de 500 ms ya implementado**: el "no
  dispares una consulta por tecla" (R34) **no necesita mecanismo nuevo**, solo un `kind`
  de control que escriba en el estado agregado.
- `serializarFiltro` → key SWR → reset a página 1 + limpieza de selección
  (`OrdenesModule`): R38 y R39 salen gratis con una clave escalar más.

---

## 2. Modelo de datos

### 2.1 Una columna generada, un índice

```sql
ALTER TABLE "orden"
  ADD COLUMN "busqueda_texto" text
  GENERATED ALWAYS AS (
    btrim(regexp_replace(
      lower(translate(
        coalesce("num_guia"::text, '')                            || ' ' ||
        coalesce("num_remision", '')                              || ' ' ||
        coalesce("telefono_dest", '')                             || ' ' ||
        regexp_replace(coalesce("telefono_dest", ''), '[^0-9]', '', 'g') || ' ' ||
        coalesce("destinatario", ''),
        'áàäâãéèëêíìïîóòöôõúùüûñçÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ',
        'aaaaaeeeeiiiiooooouuuuncAAAAAEEEEIIIIOOOOOUUUUNC'
      )),
      '\s+', ' ', 'g'))
  ) STORED;

CREATE INDEX "orden_busqueda_texto_trgm_idx"
  ON "orden" USING gin ("busqueda_texto" extensions.gin_trgm_ops);
```

Por qué cada pieza, en orden:

- **`STORED` y no `VIRTUAL`.** Postgres 17 solo implementa `STORED`; y un índice solo
  puede construirse sobre una columna materializada.
- **Un solo índice para los cuatro campos.** Es la decisión del humano y es correcta: un
  `LIKE '%x%'` sobre cuatro columnas obligaría a cuatro índices y a un `BitmapOr` de
  cuatro recorridos con su *recheck* cada uno.
- **`num_guia::text`.** Es la única forma de que la guía participe de la coincidencia
  parcial. El cast entero→texto se resuelve por I/O (`int4out`/`textin`), ambas
  `IMMUTABLE`, así que es admisible en una expresión generada (a diferencia de
  `timestamp::text`, que depende de `DateStyle` y **no** lo es). **Se verifica aplicando
  la migración** (task T1.4), no por fe.
- **`||` y no `concat()`.** `concat()`/`concat_ws()` son `STABLE` (pueden invocar funciones
  de salida no inmutables) y Postgres **rechazaría** la columna generada. `||` con
  `coalesce` es equivalente y `IMMUTABLE`.
- **Forma solo-dígitos del teléfono** como quinto segmento: hace que "88880000" encuentre
  un teléfono guardado como "8888-0000" **sin** una segunda consulta. Es el mismo truco que
  ya usa el buscador del mensajero (feature 114) en cliente.
- **Separador de un espacio.** Un término compuesto solo por dígitos **no puede** cruzar la
  frontera entre segmentos (no hay espacios en él), así que la ruta más frecuente no
  produce falsos positivos. Un término **con** espacio sí podría cruzar dos segmentos
  contiguos (p. ej. `"88880000 juan"`): es un falso positivo raro, siempre un
  **superconjunto** —nunca una fuga— y se documenta como coste aceptado.
- **`btrim` + `regexp_replace('\s+',' ')`.** Espeja el colapso de espacios de
  `normalizeName`; sin él, un destinatario con doble espacio sería inencontrable
  tecleándolo con espacio simple (R8).
- **`gin` y no `gist`.** GIN es netamente más rápido en lectura para trigramas; GiST solo
  gana en *build*/actualización. Esto es un buscador: se lee mucho más de lo que se
  escribe.

**Nulabilidad:** la columna se declara **NULLable** aunque la expresión nunca produzca
`NULL` (todo va con `coalesce`). Motivo: en Prisma se declara `String?` y así el campo no
entra como obligatorio en los tipos de `create`; declararla `NOT NULL` en SQL y opcional en
Prisma sería drift (§2.5).

### 2.2 Por qué se indexa AHORA (y no cuando duela)

`ADD COLUMN ... GENERATED ... STORED` **reescribe la tabla entera** y toma un
`ACCESS EXCLUSIVE` durante toda la reescritura: mientras dura, `orden` no admite lecturas
ni escrituras. `CREATE INDEX` (no `CONCURRENTLY`, ver §11.3) toma además un `SHARE` que
bloquea escrituras.

- Con las pocas miles de filas de hoy: instantáneo, sin ventana.
- Con las decenas de miles que el humano espera: segundos, molesto.
- Con medio millón y las cargas masivas corriendo: **ventana de mantenimiento**, con la
  ingesta de órdenes parada.

Es la razón por la que esta feature se hace **antes** de que la tabla crezca y no cuando la
búsqueda se sienta lenta. Queda escrito aquí porque es un argumento de calendario, no de
código. *Verificación previa obligatoria (T0.1): contar filas de `orden` en producción; si
supera el umbral de 200 000 filas se pide ventana en vez de aplicar en caliente.*

### 2.3 La extensión, el esquema `extensions` y el `search_path`

Supabase instala sus extensiones en el esquema **`extensions`**, no en `public`, y ese
esquema **no está en el `search_path` de todos los roles**. Un Postgres local recién creado
**no tiene** ese esquema. La migración cubre los dos casos y **no adivina**:

```sql
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;
```

y luego **cualifica la clase de operadores**: `USING gin ("busqueda_texto"
extensions.gin_trgm_ops)`. Nada depende del `search_path` del rol que ejecute la migración
ni del que ejecute las consultas.

**Riesgo asumido a propósito:** si alguna base ya tuviera `pg_trgm` instalada en OTRO
esquema, `CREATE EXTENSION IF NOT EXISTS` no la mueve y `extensions.gin_trgm_ops` no
existirá → **la migración falla en voz alta**. Es lo correcto: el modo de fallo alternativo
(no cualificar el opclass) sería un índice creado en una base y no en otra, con la búsqueda
lenta solo en producción y sin ninguna señal. Se reduce a cero comprobándolo antes
(pregunta abierta P2 y task T0.2):

```sql
SELECT e.extname, n.nspname FROM pg_extension e
JOIN pg_namespace n ON n.oid = e.extnamespace WHERE e.extname = 'pg_trgm';
```

Si apareciera en otro esquema, la reparación es una línea:
`ALTER EXTENSION pg_trgm SET SCHEMA extensions;`.

### 2.4 `down.sql`: orden inverso, idempotente, y qué NO deshace

```sql
-- DOWN (orden inverso del UP)
DROP INDEX IF EXISTS "orden_busqueda_texto_trgm_idx";
ALTER TABLE "orden" DROP COLUMN IF EXISTS "busqueda_texto";
-- La extensión NO se elimina: ver justificación abajo.
```

- **Orden inverso**: índice → columna. Al revés, `DROP COLUMN` fallaría o arrastraría el
  índice por dependencia, dejando el DOWN mintiendo sobre lo que hizo.
- **Idempotente** con `IF EXISTS` en las dos sentencias (`scripts/db-rollback.ts` puede
  reejecutarse).
- **NO se hace `DROP EXTENSION pg_trgm`.** El UP la crea con `IF NOT EXISTS`, así que en
  una base que ya la tuviera el UP **no la creó**; un DOWN que la elimine borraría algo que
  no era suyo y que otra feature podría estar usando. Coste de no hacerlo: tras un rollback
  queda una extensión instalada sin ningún objeto que dependa de ella — coste cero en
  disco, en escritura y en planificación. **Y el esquema `extensions` no se toca jamás**:
  es infraestructura compartida de Supabase.
- **Tras el DOWN, el listado sigue vivo** (R29): sin la columna, el `where` de búsqueda no
  se construye porque la clave `q` deja de existir en el `filter`… **no**: el DOWN solo
  revierte la base, no el código. Por eso el orden de despliegue es **migración primero,
  código después**, y el rollback de esta feature es **código primero, migración después**
  (T5.3). Se deja escrito porque es el error clásico de un rollback parcial.

### 2.5 `schema.prisma`: declarar la columna y el índice (o habrá drift)

`prisma migrate dev --create-only` diffea **schema.prisma contra el árbol de migraciones**.
Si la columna y el índice existen en el árbol pero no en el modelo, la siguiente migración
que alguien genere propondrá `DROP COLUMN`/`DROP INDEX` fantasma — exactamente la clase de
deuda que ya documenta `tests/integration/db/schema-drift-saneamiento.test.ts` (diez
sentencias ajenas aparecieron al generar la migración de la 167).

```prisma
model Orden {
  // …
  /// GENERADA en la base (STORED). NUNCA se escribe desde la aplicación: Postgres
  /// rechaza cualquier INSERT/UPDATE sobre ella. Se declara para (a) poder filtrar
  /// con Prisma y (b) que schema.prisma no diverja del SQL aplicado.
  busquedaTexto String? @map("busqueda_texto")
  // …
  @@index([busquedaTexto(ops: raw("extensions.gin_trgm_ops"))], type: Gin, map: "orden_busqueda_texto_trgm_idx")
}
```

**Esto hay que verificarlo, no suponerlo** (task T1.5): Prisma no tiene representación de
primera clase para columnas generadas ni garantía de cómo normaliza un `ops` cualificado
por esquema. **Criterio de hecho:** tras aplicar la migración,
`pnpm run db:migrate:create` sobre un árbol sin cambios **no propone ninguna sentencia**
sobre `busqueda_texto` ni sobre `orden_busqueda_texto_trgm_idx`. Si la propone:

1. Ajustar la declaración (probar `ops: raw("gin_trgm_ops")` sin cualificar, y/o
   `@@index` sin `ops`) hasta que el diff salga vacío; documentar en el impl cuál quedó.
2. Si ninguna variante da diff vacío → **plan B ejecutable del §10.2** (tres índices GIN
   sobre las columnas reales, sin columna generada), que Prisma expresa sin fricción a
   costa de perder el plegado de acentos y la coincidencia parcial sobre la guía.

### 2.6 ¿Rompe algún `SELECT *` o algún DTO?

- **Prisma nunca hace `SELECT *`**: enumera columnas. Aun así, un `findMany` sin `select`
  trae **todos** los escalares, incluida la nueva columna. Los mapeadores del repositorio
  (`toDTO`, `toListItemDTO`, `toEtiquetaRow`, `toApiOrdenRow`, `toResumenDTO`,
  `toRecepcionSateliteRow`, `toManifiestoOrdenRow`) construyen el DTO **campo a campo**, así
  que **ningún DTO cambia** (R28) sin tocar nada.
- Aun así **se declara `omit` global** en el cliente
  (`lib/db/prisma-client.ts`: `new PrismaClient({ adapter, omit: { orden: { busquedaTexto: true } } })`)
  por dos razones concretas: (i) la descarga de la 151 materializa hasta
  `DESCARGA_MAX_FILAS` (5000 por defecto) filas de orden y la columna duplica el texto de
  cuatro campos por fila —cientos de KB de transferencia por descarga, a cambio de nada—;
  (ii) hace **imposible por construcción** que la columna se cuele en un DTO futuro. El
  `omit` no afecta al `where`: se puede seguir filtrando por ella.
- **RLS:** esta migración **no crea tablas**, así que no introduce RLS nueva; la columna
  hereda exactamente los permisos y políticas de `orden`. No hay *grants* por columna en
  este repo, así que no abre ninguna vía de acceso nueva. Sí **duplica PII** (nombre y
  teléfono del destinatario) dentro de la misma fila: por eso el `omit` global y R28.

---

## 3. `unaccent()` no es `IMMUTABLE`: decisión y coste

**El problema.** `unaccent(text)` (una sola arg) es **`STABLE`**, porque resuelve el
diccionario por `search_path`. Postgres exige `IMMUTABLE` en la expresión de una columna
generada, así que `ADD COLUMN ... GENERATED ALWAYS AS (lower(unaccent(...)))` **falla al
aplicar la migración**. Las salidas conocidas son tres:

| Opción | Qué implica | Veredicto |
| --- | --- | --- |
| **A. Envoltorio `IMMUTABLE` propio** — `CREATE FUNCTION public.immutable_unaccent(text) ... SELECT extensions.unaccent('extensions.unaccent'::regdictionary, $1)` marcado `IMMUTABLE` | Extensión `unaccent` + función propia con `SET search_path` fijo + una **mentira controlada** (si el diccionario cambia, los valores almacenados quedan obsoletos y solo un `REINDEX`/rewrite los arregla) + dependencia de orden en cualquier `pg_dump`/restore/branch de Supabase + un objeto más que el `down.sql` debe revertir | **Descartada** |
| **B. Solo `lower()`** | Cero infraestructura; "José" no se encuentra tecleando "Jose" | **Descartada**: el destinatario es uno de los cuatro campos y en Costa Rica los nombres llevan tilde (María, Hernández, Solís). Rompe el caso de uso |
| **C. `translate()` con mapa explícito** (elegida) | Función **built-in `IMMUTABLE`**, cero extensiones, cero funciones propias, cero `search_path`, y **espejable carácter a carácter en TypeScript** | **ELEGIDA** |

**Por qué C gana a A, en concreto:** el término que teclea el usuario se normaliza en
**Node**, y el valor indexado se normaliza en **Postgres**. Si las dos normalizaciones no
coinciden **exactamente**, la búsqueda falla en silencio y de forma imposible de
diagnosticar. Con `unaccent` esa paridad es un acto de fe (sus reglas viven en
`unaccent.rules`, plegan cosas que `String.normalize("NFD")` no pliega —`ß`→`ss`— y pueden
cambiar con la versión del servidor). Con un **mapa explícito de 48 caracteres** compartido
—la misma tabla `from`/`to` en SQL y en TS— la paridad es **demostrable**, y hay un test
que la demuestra ejecutando ambas contra el mismo corpus (T1.6).

**Orden de las operaciones: `translate` ANTES de `lower`.** `lower()` depende de la
*collation* de la base: en una base creada con `LC_CTYPE=C`, `lower('Á')` devuelve `'Á'`.
Plegando primero (`'Á'`→`'A'`) y bajando después, el resultado es correcto **en cualquier
locale**, porque solo se pide a `lower()` que baje ASCII. Por eso el mapa incluye las 24
minúsculas acentuadas **y** sus 24 mayúsculas.

**Coste de C, dicho sin adornos:** solo se pliegan los 48 caracteres enumerados (vocales
con tilde/diéresis/circunflejo/tilde-ñ, `ñ`, `ç`, en ambas cajas). Un carácter fuera de esa
lista (`ø`, `ł`, `å`, cirílico) **no se pliega en ninguno de los dos lados**, así que no hay
asimetría ni falso negativo por desajuste: simplemente hay que teclearlo tal cual está
escrito. Para la operación en Costa Rica es irrelevante; si algún día deja de serlo, ampliar
el mapa es una migración de una línea **más una reescritura de la tabla** (la columna
generada se recalcula), y eso sí hay que planificarlo. Queda anotado como deuda conocida.

**Efecto lateral aceptado:** `ñ`→`n` hace que "peña" y "pena" se encuentren mutuamente. Es
el comportamiento estándar de cualquier búsqueda sin acentos (y lo que ya hace el buscador
del mensajero con `normalizeName`).

### 3.1 El normalizador compartido

`lib/utils/busqueda-orden.ts` (puro, sin React, sin Prisma):

```ts
/** Mapa de plegado de acentos. ESPEJO EXACTO del `translate()` de la columna generada. */
export const ACENTOS_FROM = "áàäâãéèëêíìïîóòöôõúùüûñçÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ";
export const ACENTOS_TO   = "aaaaaeeeeiiiiooooouuuuncAAAAAEEEEIIIIOOOOOUUUUNC";

/** Normalización del TÉRMINO. Debe producir lo mismo que la expresión SQL. */
export function normalizarTerminoBusqueda(termino: string): string;

/** ¿El término es solo dígitos y separadores de teléfono? -> su forma solo-dígitos. */
export function soloDigitosSiPareceNumero(termino: string): string | null;
```

**No se reutiliza `normalizeName`** (feature 24/114) a propósito: usa `NFD` + descarte de
marcas combinantes, que pliega **más** caracteres que el mapa SQL. Reutilizarlo
reintroduciría justo la asimetría que C viene a eliminar. `normalizeName` se queda donde
está, intacto (R42).

---

## 4. Contrato y capas

### 4.1 Borde (`lib/types/orden.ts`)

```ts
export const BUSQUEDA_MIN_CHARS = 3;   // decisión (d) del humano
export const BUSQUEDA_MAX_CHARS = 80;  // acota el patrón; ver §4.4

export const ORDEN_FILTER_FIELDS = [ /* …las 10 actuales… */, "q" ] as const;

// dentro de ordenFilterSchema (sigue `.strict()`, sigue con sus dos `refine`)
q: z.string().trim().min(BUSQUEDA_MIN_CHARS).max(BUSQUEDA_MAX_CHARS).optional(),
```

- **`q`** y no `search`/`texto`: es corto, es la convención universal de un buscador y
  **no coincide con ningún nombre de columna**, lo que deja claro que no es un filtro de
  columna (como sí lo son `zona_id`…). Misma familia que `created_preset` y `reasignables`:
  claves públicas que el service traduce, no columnas.
- `.trim()` antes de `.min()`: `"  a  "` es 1 carácter, no 5 (R3).
- `.strict()` intacto → R19 sin código nuevo.
- `BUSQUEDA_MIN_CHARS` se **exporta** y lo consume también la UI: un único origen del 3.

### 4.2 Service (`OrdenService.construirWhere`)

`q` **no** entra en `FILTER_TO_COLUMN` (no es una columna), igual que las claves temporales
y `reasignables`. Se traduce así, **antes** del acotamiento por rol:

```ts
if (input.filter?.q !== undefined) {
  const digitos = /^\d+$/.test(input.filter.q.trim()) ? input.filter.q.trim() : null;
  const guia = digitos && Number(digitos) <= MAX_INT4 ? Number(digitos) : null;
  if (guia !== null) where.numGuia = guia;              // ruta rápida (§5)
  else where.busqueda = normalizarTerminoBusqueda(input.filter.q);
}
// … y AL FINAL, como hoy:
if (actor.rol === "adminTienda") where.tiendaId = actor.usuarioId;
if (actor.rol === "mensajero")   where.mensajeroAsignadoId = actor.usuarioId;
```

`ListOrdenesWhere` (`lib/interfaces/repositories/IOrdenRepository.ts`) gana dos claves:

```ts
/** Término YA normalizado (minúsculas, sin acentos, espacios colapsados). Nunca un patrón. */
busqueda?: string;
/** Ruta rápida: igualdad contra la guía (índice único preexistente). */
numGuia?: number;
```

El service entrega un **término**, no un patrón: la sintaxis del motor (comodines, escapes)
es dialecto de la capa de datos y vive en el repositorio.

### 4.3 Repositorio (`OrdenRepository.list`)

```ts
...(params.where.numGuia !== undefined ? { numGuia: params.where.numGuia } : {}),
...(params.where.busqueda ? { busquedaTexto: { contains: escaparLike(params.where.busqueda) } } : {}),
```

- **Sin `mode: "insensitive"`**. La columna ya está en minúsculas y sin acentos, y el
  término también: `LIKE` a secas es lo que el índice trigram acelera mejor (`ILIKE`
  obligaría a plegar caja en cada *recheck* para nada).
- **`escaparLike`** duplica `\` y escapa `%` y `_` (R7). Prisma interpola el valor dentro
  del patrón `%valor%` **sin escaparlo**: sin esto, buscar `"100%"` devolvería todo lo que
  empieza por `100`. Como Prisma no emite cláusula `ESCAPE`, se usa el escape por defecto
  de Postgres (`\`), que es exactamente el que aplica `escaparLike`. *Verificar el SQL real
  emitido durante la medición (T4.1)*.
- El `count` sigue usando **el mismo objeto `where`** (R15), sin cambios.

### 4.4 Por qué 80 caracteres de tope

El patrón `%término%` viaja como parámetro; un término largo no rompe nada, pero un término
de 3 caracteres genera **1 trigrama** y uno de 80 genera 78: cuanto más largo, más
selectivo y más barato. El tope existe para acotar el peso de la clave de caché SWR y para
que nadie use el campo como canal de datos. 80 cubre cualquier nombre real de destinatario.

---

## 5. Ruta rápida numérica (y su matiz)

**Regla:** término solo dígitos → **igualdad contra `num_guia`** usando el índice único
`orden_num_guia_key` ya existente. Es el caso más frecuente en operación (el operador tiene
la guía delante) y cuesta una búsqueda por índice único: no toca el trigram.

**El matiz imprescindible (R10):** la ruta rápida **no puede ser terminal**, porque el
segundo caso de uso más frecuente —"los últimos 4 dígitos del teléfono"— también es solo
dígitos. Secuencia:

1. `where.numGuia = N` (+ resto de filtros + acotamiento por rol) → `repo.list`.
2. **Si `total === 0`** → se reconstruye el `where` con `busqueda` (trigram) y se repite.

**El disparador del fallback es `total`, nunca `items.length`** (R11): pidiendo la página 3
de una guía exacta, `items` viene vacío y `total` vale 1; con `items.length` se caería al
trigram en unas páginas sí y en otras no, y la paginación mostraría resultados distintos
según por dónde se entre. Es el bug sutil que este párrafo existe para evitar.

**Coste:** una consulta extra —de índice único, sobre 0 filas— solo cuando el término
numérico no es una guía. Frente a la alternativa (mandar siempre al trigram) ahorra el
*recheck* del caso más común; frente a "solo guía" no rompe el caso del teléfono.

**Guarda de rango:** `num_guia` es `int4`; un término de más de 10 dígitos o mayor que
2 147 483 647 **no se intenta** como guía (iría a un error de cast) y va directo al trigram
(R12).

**Semántica elegida (pregunta abierta P3):** cuando el término numérico **sí** es una guía,
se devuelve **esa orden y solo esa**, aunque el mismo número aparezca dentro de otros
teléfonos. Es la lectura operativa de "buscar la guía 12345".

---

## 6. El `count(*)` de la paginación: estrategia, plan B y disparador

**El problema real.** Con un término, `count` recorre **todas** las coincidencias en cada
consulta. Pero el análisis honesto del plan dice algo más importante:

> La consulta de página **ya paga ese mismo coste**. `ORDER BY prioridad DESC, created_at
> DESC LIMIT 25` sobre un predicado trigram **no puede** resolverse con un índice ordenado:
> Postgres recoge **todas** las filas que casan (bitmap index scan + *recheck* en heap) y
> hace un *top-N sort*. Es decir, `findMany` es `O(coincidencias)` **con o sin** `count`.

**Decisión (i): en v1 se mantiene el conteo exacto.** Capar el conteo no eliminaría el
coste dominante —lo eliminaría a medias, dejando intacto el `O(coincidencias)` del
`findMany`— y sí rompería el contrato `total` que consumen `Pagination` y R15 (feature 144)
sin ninguna ganancia demostrada. Además, las dos consultas van en `Promise.all` (§1.1): el
conteo no alarga la latencia serie, consume una conexión más del pool.

**Lo que sí acota el coste, y por eso está en los requisitos:** el mínimo de 3 caracteres
(R3) y el debounce (R34). Un término de 1 carácter sería un `Seq Scan` garantizado
(pg_trgm no genera trigramas útiles por debajo de 3) — de ahí que el mínimo sea una
decisión de rendimiento, no de UX.

**Plan B (diseñado, no implementado):** conteo con tope.

```ts
// ordenesConfig.BUSQUEDA_TOTAL_TOPE = 500
const total = await repo.contarConTope(where, TOPE);   // SELECT count(*) FROM (… LIMIT TOPE+1) t
return { …, total: Math.min(total, TOPE), totalEsTope: total > TOPE };
```

La UI pinta "más de 500 resultados" y la paginación se acota al tope. **Cambio de
contrato**: `ListarOrdenesResult` gana `totalEsTope?: boolean` (aditivo, opcional, sin
romper consumidores) y `Pagination` recibe el tope. **Plan C** (si ni con tope): paginación
por *keyset* (`WHERE (prioridad, created_at, id) < (…)`), que elimina el `OFFSET` pero
obliga a rehacer el contrato de paginación de `DataTable` — fuera de alcance aquí.

**Qué se mide para decidir el cambio (task T4.1, con números en el impl):** sobre una base
sembrada con **50 000 órdenes**, con `EXPLAIN (ANALYZE, BUFFERS)` y 10 repeticiones:

| Escenario | Término | Umbral de acción |
| --- | --- | --- |
| E1 guía exacta | 8 dígitos que existen | p95 > 50 ms → revisar la ruta rápida |
| E2 término selectivo | fragmento con < 100 coincidencias | p95 > 300 ms → plan B |
| E3 término amplio | fragmento con > 5 000 coincidencias | p95 > 500 ms → plan B |
| E4 término + filtros | E3 + estado + rango de fechas | debe ser ≤ E3 |
| E5 escritura | carga masiva de 200 órdenes, antes/después del índice | +20 % de tiempo → revisar (GIN `fastupdate`) |

Y dos aserciones de plan, no de reloj: **(i)** en E2/E3 aparece `Bitmap Index Scan on
orden_busqueda_texto_trgm_idx` y **no** `Seq Scan on orden` (R31); **(ii)** en E1 aparece
`Index Scan using orden_num_guia_key`.

---

## 7. Alcance por rol: el término compone en AND, siempre

`construirWhere` ya escribe el acotamiento por rol **al final**, de modo que **pisa**
cualquier filtro. El término se escribe **antes** de esa línea, así que:

- Un `adminTienda` que busque el nombre de un destinatario de otra tienda obtiene
  **0 resultados y `total: 0`** (R22): `where.tiendaId` se sobrescribe con el suyo.
- Un `mensajero` que busque una guía que no le fue asignada obtiene **0 resultados** (R23).
- Un `adminSatelite` no llega: `forbidden` antes de construir el `where` (R24).
- La descarga completa (`listarCompleto`) **comparte `construirWhere`**, así que hereda las
  tres cosas sin código nuevo (R20).

**Regla de review:** el término solo puede aparecer como clave hermana del `where` (AND).
Cualquier construcción que lo meta dentro de un `OR` con otra cosa que no sean los cuatro
campos buscables es un rechazo automático: ahí es donde nacen las fugas.

---

## 8. Interfaz

### 8.1 Un `kind: "text"` nuevo en el componente genérico

`FilterComponent` gana un quinto tipo. Es genérico —no sabe qué es una orden— y es
exactamente lo que la 145 necesitará en las 31 tablas restantes:

```ts
export type FilterKind = "multi" | "single" | "dateRange" | "boolean" | "text";

// en FilterDef, solo para `text`:
minChars?: number;   // por debajo, el control NO emite (default 0)
```

Comportamiento (R32-R37, R41):

- Render: `components/ui/input.tsx` con `type="search"`, `aria-label` = `label`,
  `placeholder` del `FilterDef`, botón/afordancia de limpiar.
- El input responde **al instante** (estado interno); lo que se aplaza es la **emisión**,
  que ya hace el `FilterComponent` con su `debounceMs` de 500 ms. **No se añade un segundo
  debounce**: hacerlo sumaría dos esperas.
- Emite `[termino]` cuando `termino.trim().length >= minChars`; en otro caso **la clave
  desaparece** de la selección (patrón `boolean`/`dateRange`: "sin selección" = clave
  ausente), de modo que 1-2 caracteres **no** viajan y **no** producen `validation_error`
  (R35). Bajo el campo, un aviso `aria-live` con "Escribe al menos 3 caracteres".
- "Limpiar todo" lo vacía vía el `resetSignal` que ya existe para `DateRangeFilter` (R37).

### 8.2 Declaración en órdenes

`ordenes-filtros-def.ts`: **primer** elemento del array (R32), delante del estado.

```ts
export const CLAVE_BUSQUEDA = "q";
{
  key: CLAVE_BUSQUEDA, label: "Buscar", kind: "text",
  minChars: BUSQUEDA_MIN_CHARS,
  placeholder: "Guía, remisión, teléfono o destinatario",
}
```

`seleccion-a-filter.ts`: `q` es **escalar**, no lista →
`if (key === CLAVE_BUSQUEDA) { out.q = values[0]; continue; }`.

`serializarFiltro` ya serializa escalares (`q=juan perez`) ⇒ **R38 y R39 salen gratis**:
cambiar el término cambia la key SWR, y `OrdenesModule` ya vuelve a página 1 y limpia la
selección de filas ante cualquier cambio de key.

### 8.3 Vacío con búsqueda activa (R40)

`OrdenesModule` ya conoce `filter`; pasa un `emptyState` distinto cuando `filter?.q`:

```
title: "Sin coincidencias"
description: `Ninguna orden coincide con "<término>". Revisa el texto o limpia la búsqueda.`
```

No se toca `DataTable` (ya recibe `emptyState` por props) → R42.

### 8.4 Lo que NO se hace en la UI

- **No se usa `components/shared/TableFilters.tsx`**: no tiene ningún consumidor en todo el
  repo, es texto libre sin ids y duplicaría la barra que la 144 dejó montada.
- No se resalta el fragmento coincidente ni se ordena por relevancia (§10.5).
- No se lleva el término a la URL: la 144 decidió (decisión (g)) que la selección de
  filtros no persiste al recargar; el buscador sigue esa misma regla para no tener dos
  comportamientos distintos en la misma barra.

---

## 9. Capas tocadas

| Capa | Archivo | Cambio |
| --- | --- | --- |
| DB | `db/migrations/<ts>_orden_busqueda_trgm/migration.sql` | **nuevo**: schema+extensión, columna generada, índice GIN |
| DB | `db/migrations/<ts>_orden_busqueda_trgm/down.sql` | **nuevo**: índice → columna, idempotente |
| DB | `db/schema.prisma` | `busquedaTexto String?` + `@@index(..., type: Gin)` |
| DB | `lib/db/prisma-client.ts` | `omit: { orden: { busquedaTexto: true } }` |
| Utils | `lib/utils/busqueda-orden.ts` | **nuevo**: mapa de acentos + normalizador + solo-dígitos |
| Tipos | `lib/types/orden.ts` | `q` en la whitelist + `BUSQUEDA_MIN_CHARS`/`MAX_CHARS` |
| Interfaces | `lib/interfaces/repositories/IOrdenRepository.ts` | `busqueda?`, `numGuia?` en `ListOrdenesWhere` |
| Service | `lib/services/OrdenService.ts` | traducción de `q` + ruta rápida con fallback |
| Repo | `lib/repositories/OrdenRepository.ts` | `contains` sobre `busquedaTexto` + `escaparLike` |
| UI | `components/shared/FilterComponent.tsx` | `kind: "text"` + `minChars` |
| UI | `app/(app)/ordenes/_components/ordenes-filtros-def.ts` | declaración del buscador (primero) |
| UI | `app/(app)/ordenes/_components/seleccion-a-filter.ts` | `q` escalar |
| UI | `app/(app)/ordenes/_components/OrdenesModule.tsx` | `emptyState` con término |
| Bench | `scripts/bench-busqueda-ordenes.ts` | **nuevo**: siembra 50 k + `EXPLAIN ANALYZE` (T4.1) |

**No se toca**: `DataTable`, `TableFilters`, `MultiSelectFilter`, `DateRangeFilter`,
`normalizeName`, el buscador del mensajero (114), ni ningún otro consumidor de
`OrdenesModule`. **`package.json` no cambia** (dependencias nuevas: ninguna).

---

## 10. Alternativas descartadas

### 10.1 `tsvector` + GIN (búsqueda de texto completo)

**Descartada.** FTS indexa **palabras** (lexemas): `to_tsquery('juan')` encuentra "juan
perez", pero **no** encuentra "8888-0000" tecleando "0000", ni "REM-2026-0912" tecleando
"0912". El caso de uso declarado por el humano es exactamente ése: **fragmentos en medio de
una cadena**. Se podría emular con `:*` (prefijo), pero solo cubre el **principio** de cada
palabra — sigue sin cubrir el sufijo del teléfono. FTS además arrastra diccionario/stemmer
por idioma (otra dependencia de configuración con la misma clase de problema que
`unaccent`). Coste de descartarla: no hay ranking por relevancia — que aquí no se quiere
(R16).

### 10.2 Tres índices GIN trigram sobre las columnas reales (sin columna generada) — **es el plan B ejecutable**

`CREATE INDEX ... USING gin (destinatario extensions.gin_trgm_ops)` (y para
`num_remision`, `telefono_dest`) + `OR` de tres `contains` con `mode: "insensitive"`.
Ventajas reales: **no reescribe la tabla**, no añade columna, Prisma lo expresa sin
fricción y no hay riesgo de drift. **Descartada como plan A** porque: (i) pierde el
plegado de acentos (`ILIKE` resuelve caja, no tildes) — el campo destinatario es medio
buscador; (ii) **no puede buscar fragmentos de la guía** (`num_guia` es `int` y Prisma no
puede expresar `num_guia::text LIKE …`), lo que obligaría a un cuarto índice de expresión
inalcanzable desde el ORM; (iii) tres recorridos de índice + `BitmapOr` + tres *rechecks*
por consulta en vez de uno. **Se conserva escrita como plan B** por si §2.5 demuestra que
Prisma no convive con la columna generada.

### 10.3 Envoltorio `IMMUTABLE` de `unaccent`

**Descartada** en §3: extensión + función propia + `SET search_path` + inmutabilidad
prometida (no cierta) + un objeto más en el `down.sql`, todo para conseguir una paridad con
el normalizador de Node que **sigue siendo un acto de fe**. `translate()` da la misma
funcionalidad útil con paridad demostrable por test.

### 10.4 `ILIKE '%x%'` sin índice (lo mínimo que "funciona")

**Descartada.** Es exactamente lo que el humano pidió evitar: `Seq Scan` sobre la tabla más
grande del sistema, **dos veces** (página y conteo), en cada tecleo. Con 50 000 filas ya se
nota; con las que vienen, tumba el listado.

### 10.5 Ordenar por relevancia (`similarity()` / `%`)

**Descartada.** Cambiaría el orden del listado (R16 dice que no), obligaría a calcular
`similarity` sobre todas las coincidencias (justo el coste que se intenta evitar) y rompería
la ordenación por prioridad que la feature 101 necesita. La búsqueda **filtra**, no
**ranquea**.

### 10.6 Buscar en cliente, como la feature 114

**Descartada.** `/ordenes` está paginado en servidor: filtrar en cliente solo filtraría las
25 filas visibles y daría el peor resultado posible — un buscador que "no encuentra" órdenes
que existen. Sirve como referencia de UX (§1.2), no de implementación.

### 10.7 Buscar también por nombre de tienda / dirección / producto

**Descartada por el humano.** La tienda exige un JOIN con `usuario` (y un índice sobre otra
tabla), y dirección/producto ensanchan el índice sin demanda. La tienda **ya** es filtrable
por su propio filtro de catálogo (144).

### 10.8 Conteo con tope desde el v1

**Descartada para v1** en §6: no elimina el coste dominante (el `findMany` ordenado ya es
`O(coincidencias)`), rompe el contrato `total` de la 144/151 y no hay ni una medición que
lo justifique todavía. **Queda diseñado y con disparador numérico**, que es lo que
diferencia una decisión de una omisión.

### 10.9 `CREATE INDEX CONCURRENTLY`

**Descartada.** Prisma ejecuta cada migración **dentro de una transacción** y
`CONCURRENTLY` no puede correr en una. Se acepta el `SHARE` (bloquea escrituras, no
lecturas) porque la tabla es pequeña hoy (§2.2). Si algún día hay que reindexar con la
tabla grande, se hará fuera de Prisma, en ventana.

---

## 11. Riesgos

1. **Prisma y la columna generada (drift o intento de escritura).** Mitigado con: `omit`
   global, T1.5 (diff vacío obligatorio), un test que prohíbe la aparición de
   `busquedaTexto` en rutas de escritura, y el plan B §10.2 con criterio de salto escrito.
2. **La migración falla por el cast `int::text` o por el opclass.** Mitigado: T0.2 verifica
   el estado de `pg_trgm` en cada base y T1.4 aplica la migración de verdad antes de
   escribir una línea de servicio. Fallo ruidoso, nunca índice silenciosamente ausente.
3. **Asimetría de normalización término↔columna.** Es el fallo más difícil de diagnosticar
   (la búsqueda "no encuentra" y nada peta). Mitigado por construcción (mapa compartido) y
   por el test de paridad SQL↔TS sobre corpus (T1.6).
4. **`%`/`_` sin escapar.** Mitigado con `escaparLike` + test (R7). Es un fallo de
   corrección, no solo de rendimiento: `"%"` devolvería el listado entero.
5. **Coste de escritura del GIN en la carga masiva.** `orden` se escribe en lotes de
   cientos de filas. GIN con `fastupdate` amortiza, pero se mide (E5 de §6) antes de dar la
   feature por buena.
6. **Falsos positivos por concatenación** (un término con espacio cruzando dos segmentos).
   Aceptado: superconjunto, nunca fuga; documentado en §2.1.
7. **Rollback parcial** (código desplegado sin migración, o al revés). Mitigado con el
   orden explícito de despliegue y de reversión (§2.4, T5.3).
8. **PII duplicada en una columna nueva.** Mitigado con `omit` global (§2.6) + R28. La
   columna no viaja a ningún DTO, descarga ni respuesta de API.

---

## Preguntas abiertas

Las cuatro están al final de `requirements.md` (P1 guías de menos de 3 dígitos, P2 estado
de `pg_trgm` en preview/producción, P3 semántica del término numérico que además es guía,
P4 filas actuales de `orden`). Ninguna bloquea el diseño: las cuatro tienen *default*
escrito y las dos técnicas (P2, P4) son tasks de verificación previas a aplicar la
migración.
