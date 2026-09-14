# 423 — Ordenar las tablas de órdenes por número de remisión · Diseño

## 0. Lo que ya existe (verificado en el árbol el 2026-09-14, no en el grafo)

| Pieza | Dónde | Estado |
| --- | --- | --- |
| Lista blanca de campos ordenables | `lib/types/orden.ts:20` — `SORT_FIELDS = ["created_at","num_guia","num_remision"]` | **Ya acepta la remisión.** No se toca (R18). |
| Traducción clave pública → columna | `lib/repositories/OrdenRepository.ts:870` — `SORT_COLUMN` | Se amplía el valor de `num_remision` (§3). |
| `orderBy` del listado | `OrdenRepository.ts:1906` — `ordenTotal([{prioridad:"desc"},{<campo>:<dir>}], DESEMPATE_UNICO)` | Forma intacta (R7, R8). |
| Contrato compartido de ordenamiento | `lib/types/ordenamiento-listado.ts` (ficha 352) | Se consume tal cual. |
| Control de UI (solo fecha) | `app/(app)/ordenes/_components/ordenamiento-creacion.ts` (ficha 356) | Se convierte en dos dimensiones (§4). |
| Montaje del control | `OrdenesListado.tsx:795-796` (estado) y `:1175` (`SegmentedToggle`) | Se le suma un segundo conmutador. |
| Transporte, caché y reset de página | `OrdenesModule.tsx:323` (`claveDeOrden`), `:184` (prop `orden`) | **Cero cambios**: `claveDeOrden` ya serializa `sortBy`. |
| Nota de prioridad | `ordenamiento-creacion.ts:81` — `NOTA_PRIORIDAD`, consumida en `OrdenesModule.tsx:541` | Su texto nombra la fecha; se generaliza (R14). |
| Precedente de columna generada | `orden.busqueda_texto`, `GENERATED ALWAYS … STORED` (migraciones `20260731160000` y `20260808120000`) | **Es el patrón que se copia.** |

El único consumidor de `SORT_COLUMN` para órdenes es `OrdenRepository.list`, y sus dos llamadores
son `OrdenService.listar` y `OrdenService.listarCompleto` (la descarga). La API por clave **no
tiene `sortBy`** (`lib/types/api-key.ts:80`, «Sin `sortBy`/`sortDir` [D4]»). Por eso el cambio de
§3 queda confinado a `/ordenes` + su descarga y R15 sale casi gratis.

---

## 1. El problema, dicho con precisión

El orden pedido no es el orden del texto. `num_remision` es TEXT y mezcla cuatro series con
padding inconsistente (`NA-001` y `NA-1863` en la misma serie). Cualquier orden que compare la
cadena entera pone `NA-107` entre `NA-1069` y `NA-1070`.

Lo que hace falta es una clave **derivada** de `num_remision` que ordene por (serie, número), y
que esté **materializada** para poder indexarla y para no recalcularla en cada fila de cada
consulta.

---

## 2. Modelo de datos

### 2.1 La columna generada

Migración nueva: `db/migrations/20260916120000_orden_clave_remision/`.

> **El timestamp se elige por el ÚLTIMO del árbol, no por la fecha de hoy.** En este repo la
> numeración va **adelantada**: el 2026-09-14 la última migración del árbol ya era
> `20260915120000_usuario_preferencia`, y `20260914120000` estaba tomado por
> `20260914120000_notificacion_evento_reparto_manana`, aplicada y desplegada. Una migración con
> timestamp **anterior** a otra ya aplicada entra fuera de orden. Verificado el 2026-09-14: de las
> 196 migraciones del árbol, ninguna empieza por `20260916`. Y la carpeta es `db/migrations/`,
> **no** `prisma/migrations/` —esa no existe en este repo, pese a lo que imprime el mensaje de
> `prisma migrate status`—.

```sql
ALTER TABLE "orden"
  ADD COLUMN "clave_remision" text COLLATE "C"
  GENERATED ALWAYS AS (
    upper(regexp_replace(
      regexp_replace(coalesce("num_remision", ''), '[0123456789]+$', ''),
      '[^ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789]', '', 'g'))
    || lpad(
         coalesce(substring(coalesce("num_remision", '') from '[0123456789]+$'), ''),
         18, '0')
  ) STORED;
```

Qué produce, con los valores reales de producción:

| `num_remision` | `clave_remision` |
| --- | --- |
| `72912` | `000000000000072912` |
| `BS-00001` | `BS000000000000000001` |
| `NA-107` | `NA000000000000000107` |
| `NA-1069` | `NA000000000000001069` |
| `SC-050` | `SC000000000000000050` |

Byte a byte: `0…` (0x30) < `B` (0x42) < `N` (0x4E) < `S` (0x53) → numéricas puras, `BS-`, `NA-`,
`SC-` (R4). Y dentro de `NA`: `…000107` < `…001069` (R3). **`NA-107` cae antes que `NA-1069`.**

Cada pieza está elegida:

- **`STORED`** — es lo único que Postgres implementa, y un índice necesita el valor materializado.
- **Dos `regexp_replace` para el prefijo** — el primero quita el bloque final de dígitos
  (`NA-1863` → `NA-`); el segundo borra todo lo que no sea letra o dígito ASCII (`NA-` → `NA`).
  El prefijo queda **sin puntuación**, que es lo que hace que ninguna collation lingüística tenga
  un «peso variable» que interpretar.
- **`upper()` DESPUÉS de la limpieza, nunca antes** — tras el filtro solo quedan ASCII, y sobre
  ASCII `upper()` da el mismo resultado en cualquier locale. Es el mismo razonamiento de orden de
  operaciones que la migración de `busqueda_texto` (`translate` antes de `lower`). Agrupa
  `na-001` con `NA-001`, y eso **no fusiona ninguna serie existente**: medido contra producción el
  2026-09-14 sobre 2.287 órdenes (incluidas las borradas), hay **0** remisiones con alguna letra
  en minúscula, **0** con caracteres fuera de `[A-Za-z0-9-]` y **0** sin ningún dígito. O sea que
  `upper()` y el filtro de no-alfanuméricos no tocan ni una fila de las que hay: existen para que
  la columna **no pueda lanzar** ante lo que entre mañana (§2.2), no para arreglar lo de hoy.
- **Clases de caracteres ENUMERADAS, no rangos (`[0123456789]`, no `[0-9]`)** — la documentación
  de Postgres advierte de que un rango dentro de una expresión regular es sensible a la
  collation. Es exactamente la desviación que la migración `20260731160000` ya escribió a mano
  para `[ \t\n\r\f\v]` en vez de `\s`, y por el mismo motivo: si la clase se interpretase distinto
  en el build msvc local y en el glibc de Supabase, la columna se calcularía distinto en cada base
  y R6 sería indemostrable.
- **`COLLATE "C"`** — el segundo candado de R6. La comparación es byte a byte, idéntica en
  cualquier build y cualquier locale, y el btree que se crea encima hereda esa collation, así que
  el índice y el `ORDER BY` no pueden discrepar.
- **`lpad(…, 18, '0')`** — 18 dígitos es el techo de un `bigint`, el mayor número que un sistema
  de tienda puede razonablemente emitir; lo medido hoy son 5 dígitos.
- **NULLable aunque la expresión nunca produzca NULL** — Prisma la declarará `String?` y
  declararla `NOT NULL` en SQL sería drift (idéntico a `busqueda_texto`).

### 2.2 Riesgo 1 — la expresión NO puede lanzar (R5)

**Cómo se resuelve: no hay ningún cast a número en ninguna parte.** El «valor numérico» se
consigue con relleno de **texto** (`lpad`), no convirtiendo a `bigint`. Las cinco funciones que
intervienen —`coalesce`, `regexp_replace`, `substring(text from text)`, `lpad`, `upper`— son
totales sobre cualquier `text` y ninguna tiene modo de error para una entrada inesperada.

Esto es lo que evita el desastre: una columna generada se evalúa en el `INSERT`, así que una
expresión que lance **bloquearía la creación de órdenes**, incluida la carga masiva por lotes.
Comportamiento ante entradas que no encajan (degradan, no fallan):

| `num_remision` | `clave_remision` | Efecto |
| --- | --- | --- |
| `SIN NUMERO` | `SINNUMERO000000000000000000` | Ordena en su propia «serie» al final |
| `---` | `000000000000000000` | Cae con las numéricas, al principio |
| `NA-` | `NA000000000000000000` | Encabeza la serie `NA` |
| `📦-5` | `000000000000000005` | El emoji se cae del prefijo |
| 25 dígitos | clave truncada a 18 | Desordenada respecto a otra de 25 dígitos, **sin error** |

Las dos últimas filas son **colisiones conocidas y aceptadas**: dos remisiones distintas pueden
compartir clave (también `NA-1` y `N-A1`). No es un fallo — la clave **no es una identidad**, es
una clave de orden, y el desempate por `id` (§3) mantiene el orden total y la paginación estable
(R8). Se ancla en un test para que quede dicho, no descubierto.

Postgres además exige que la expresión sea **IMMUTABLE**; las cinco funciones lo son en
`pg_proc`. Trampa evitada y digna de mención: `to_char(int, text)` es **STABLE** (depende de
`lc_numeric`), así que la vía «prefijar la longitud del número» que evitaría el truncamiento de
18 dígitos **no es aplicable** en una columna generada.

### 2.3 El índice, y riesgo 2 — las dos direcciones

```sql
CREATE INDEX "orden_prioridad_clave_remision_idx"
  ON "orden" ("prioridad" DESC, "clave_remision" ASC, "id" ASC)
  WHERE "deleted_at" IS NULL;
```

El `ORDER BY` que arma el repositorio es `prioridad DESC, <campo> <dir>, id ASC`. Con
`prioridad` **fija en DESC**, los dos sentidos del campo no son el mismo recorrido:

| Sentido pedido | `ORDER BY` efectivo | ¿Sirve este índice? |
| --- | --- | --- |
| `num_remision` **asc** | `prioridad DESC, clave_remision ASC, id ASC` | **Sí**, recorrido hacia delante, sin nodo de ordenación |
| `num_remision` **desc** | `prioridad DESC, clave_remision DESC, id ASC` | **No.** El recorrido inverso daría `prioridad ASC, clave DESC, id DESC`, que no es lo pedido |

**Se crea UN solo índice y se declara que el sentido descendente ordena.** Justificación con el
volumen real: 2.136 órdenes vivas. Ordenar 2.136 filas de ~30 bytes de clave son unas decenas de
KB, muy por debajo del `work_mem` por defecto (4 MB), o sea un quicksort en memoria sin volcado a
disco — coste de microsegundos, irrelevante frente al `findMany` con `include` que lo alimenta.
Añadir el gemelo `DESC` hoy sería pagar un segundo índice en el camino de **escritura** de
`orden` —una tabla que se escribe por lotes en la carga masiva y que ya arrastra doce índices—
para ahorrar un sort que no se nota.

**El umbral para revisarlo, escrito para que no haya que adivinarlo:** si `orden` supera las
~200.000 filas vivas, o si el sort del sentido descendente aparece en los planes lentos, la
reparación es una migración de una línea:

```sql
CREATE INDEX "orden_prioridad_clave_remision_desc_idx"
  ON "orden" ("prioridad" DESC, "clave_remision" DESC, "id" ASC)
  WHERE "deleted_at" IS NULL;
```

Dos límites más, dichos aquí para que no se descubran como sorpresa:

- **Parcial (`WHERE deleted_at IS NULL`)**, igual que `orden_tienda_id_num_remision_key`
  (feature 294) y `zona_es_gam_unico`. **Decidido el 2026-09-14, sin cambio:** con el filtro
  «Eliminadas» puesto, el listado ordena por remisión exactamente igual —R3 y R4 no dependen del
  borrado— pero **sin índice**, porque el predicado no lo cubre. Con 2.136 filas vivas el sort es
  el mismo de microsegundos del párrafo anterior. Se declara aquí para que no se descubra como
  sorpresa; no es una pregunta abierta.
- Con un filtro **selectivo** (un estado, una zona), el planner preferirá el índice de ese filtro
  y ordenará después. Es correcto y esperado: el índice de arriba es para la pantalla sin filtrar,
  que es el caso de más filas.

### 2.4 Coste de aplicar la migración

`ADD COLUMN … GENERATED … STORED` **reescribe la tabla entera** y toma un `ACCESS EXCLUSIVE`
(ni lecturas ni escrituras sobre `orden`); `CREATE INDEX` toma además un `SHARE`. Con 2.136
órdenes vivas es instantáneo. Sin `CREATE INDEX CONCURRENTLY`: Prisma corre cada migración dentro
de una transacción y `CONCURRENTLY` no puede. Sin tablas nuevas ⇒ **sin RLS nueva**: la columna
hereda permisos y políticas de `orden`.

**Orden de despliegue: migración primero, código después.** El código viejo funciona contra la
columna nueva (no la mira). Al revés —código primero— el `orderBy` apuntaría a una columna
inexistente y el listado entero respondería error. **Orden de reversión: el inverso**, código
primero.

### 2.5 `schema.prisma`

```prisma
claveRemision String? @default(dbgenerated()) @map("clave_remision")
…
@@index([prioridad(sort: Desc), claveRemision, id], map: "orden_prioridad_clave_remision_idx")
```

Se declara por los mismos dos motivos que `busquedaTexto`: (a) para poder usarla en `orderBy`
desde Prisma y (b) para que `schema.prisma` no diverja del SQL aplicado —si faltara, la siguiente
migración que alguien generase propondría un `DROP COLUMN` fantasma—. `@default(dbgenerated())`
**no es decorativo**: sin él, Prisma lee la expresión `GENERATED` como un default de columna y
cada `migrate dev` futuro propone un `ALTER COLUMN … DROP DEFAULT` imposible de aplicar (medido
en la ficha 169, T1.5).

**Lo que Prisma NO puede expresar, y por tanto vigila una guardia estática** (§6): el predicado
parcial del índice y la `COLLATE "C"`. Es el mismo hueco documentado en el `model Orden` para la
feature 294: `migrate diff --from-config-datasource` no lo ve (no propone recrear), pero
`--from-empty --to-schema` —lo que hace `db push`— lo escribiría **sin** el `WHERE` y **sin** la
collation, y entonces el orden dependería del locale sin que nada fallara.

### 2.6 Que la clave no viaje (R16)

Se añade al `omit` global del cliente:

```ts
export const PRISMA_OMIT = {
  orden: { busquedaTexto: true, claveRemision: true },
} as const;   // lib/db/prisma-client.ts:45
```

Motivo: ~25 bytes por fila × hasta 5.000 filas por descarga (feature 151), y sobre todo que un
DTO futuro que haga `...orden` no pueda filtrarla. **A medir, no a suponer** (task T2.4): el
`omit` afecta a la SELECCIÓN y el comentario vigente del archivo afirma que no afecta al `where`;
hay que **comprobar contra Postgres real** que tampoco impide el `orderBy`. Si lo impidiera, el
plan B es dejarla fuera del `omit` y cubrir R16 con una aserción explícita sobre el DTO y sobre
las columnas de la descarga. La decisión se escribe con su medida, no con una corazonada.

---

## 3. Repositorio

Cambio **de una línea y su tipo** en `lib/repositories/OrdenRepository.ts:870`:

```ts
const SORT_COLUMN: Record<string, "createdAt" | "numGuia" | "claveRemision"> = {
  created_at: "createdAt",
  num_guia: "numGuia",
  num_remision: "claveRemision",   // ← la clave natural, no la columna cruda
};
```

**Por qué la clave pública `num_remision` apunta ahora a `clave_remision`:** `sortBy` nunca fue
un nombre de columna, es una clave pública que este mapa traduce (comentario de `lib/types/orden.ts:14`).
Eso es justo lo que permite cambiar la columna real **sin tocar el contrato** (R18) ni a ningún
cliente. Ordenar por la columna cruda era el defecto; ya no es una opción alcanzable desde fuera.

El resto del `orderBy` no se toca: `[{prioridad:"desc"}, {claveRemision:<dir>}]` cerrado con
`ordenTotal(…, DESEMPATE_UNICO)` (R7, R8). `listarCompleto` hereda `sortBy`/`sortDir` por el
`omit({page,pageSize})` del schema, así que R13 sale sin contrato nuevo.

---

## 4. UI

### 4.1 El módulo de declaraciones se renombra

`app/(app)/ordenes/_components/ordenamiento-creacion.ts` →
`app/(app)/ordenes/_components/ordenamiento-ordenes.ts`.

El nombre actual pasaría a mentir el día que el módulo declare también la remisión, y un archivo
cuyo nombre miente es la forma barata de que el siguiente agente añada un tercer módulo paralelo.
No se llama `ordenamiento-listado.ts` para no colisionar de un vistazo con
`lib/types/ordenamiento-listado.ts`, que es **otra cosa** (el contrato compartido). Sigue siendo un
módulo de **datos**: no renderiza y no guarda estado.

Lo que declara:

```ts
export const CAMPO_ORDEN_INICIAL: SortField = "created_at";
export const DIRECCION_ORDEN_INICIAL: DireccionOrden = "desc";

/** Los DOS campos que este control ordena. `num_guia` está en la lista blanca del
 *  servidor y NO se ofrece: nadie lo ha pedido. */
export const OPCIONES_CAMPO_ORDEN: readonly SegmentedOption<SortField>[] = [
  { valor: "created_at",   etiqueta: "Fecha de creación",   Icono: CalendarDays },
  { valor: "num_remision", etiqueta: "Número de remisión",  Icono: Hash },
];
export const ETIQUETA_CAMPO_ORDEN = "Ordenar por";

/** Las direcciones, con el texto que corresponde AL CAMPO. */
export const OPCIONES_DIRECCION: Record<SortField, readonly SegmentedOption<DireccionOrden>[]>;
export const ETIQUETA_DIRECCION: Record<SortField, string>;

export function notaPrioridad(campo: SortField): string;
export function ordenamientoDe(campo: SortField, dir: DireccionOrden): OrdenamientoListado<SortField>;

/** R20 — §4.5. Funciones PURAS sobre el `num_remision` que el DTO ya trae. */
export function serieDeRemision(numRemision: string): string;
export function notaAgrupacionPorSerie(
  campo: SortField,
  remisionesVisibles: readonly string[],
): string | undefined;
export const NOTA_AGRUPACION_SERIE: string;
```

`CAMPO_ORDEN_INICIAL` y `DIRECCION_ORDEN_INICIAL` siguen siendo **literales y no derivados** del
schema, por el mismo motivo que la ficha 356 lo dejó escrito: el test que los compara contra
`listarOrdenesSchema.parse({})` mide dos fuentes independientes. Derivarlos lo dejaría comparándose
consigo mismo, siempre verde (memoria del repo: «Aserción contra su propia fuente»).

### 4.2 Los textos de la dirección cambian con el campo

| Campo | `desc` | `asc` |
| --- | --- | --- |
| `created_at` | «Más recientes» *(intacto)* | «Más antiguas» *(intacto)* |
| `num_remision` | «Más altas» | «Más bajas» |

**Deliberadamente NO se reutiliza el vocabulario temporal para la remisión.** «Más recientes»
sugeriría que un número mayor es más nuevo, y con cuatro series conviviendo eso es falso: `NA-1863`
no es posterior a `73636`. Se describe el **número**, que es lo que el control ordena de verdad.

### 4.3 La nota de prioridad se generaliza (R14)

Hoy es una constante cuyo texto termina en «…el resto sigue el orden por fecha de creación».
Pasa a ser `notaPrioridad(campo)`, y `OrdenesModule.tsx:539-542` le pasa `orden.sortBy`. La
constante desaparece; el consumidor es uno solo, así que no queda ningún llamador huérfano.

### 4.4 El aviso de agrupación por serie (R20) — decidido el 2026-09-14

El orden ascendente deja `72912…, BS-…, NA-…, SC-…`. Es correcto y no es evidente: quien pidió
«ordenar por remisión» ve un bloque de números sueltos y después tres bloques con letra. Es
**exactamente el mismo fenómeno** que obligó a escribir `NOTA_PRIORIDAD` en la ficha 356 —un orden
correcto que se lee como un fallo— y se resuelve con el **mismo criterio**, citado aquí porque es
el precedente: *el aviso no es permanente, solo se pinta cuando el fenómeno se puede observar*.

| Situación | ¿Se pinta? |
| --- | --- |
| Orden por remisión, página con **≥ 2** series distintas | **Sí** |
| Orden por remisión, página con **1** sola serie | No — no hay agrupación que explicar |
| Orden por fecha de creación | No — la agrupación no existe en ese orden |

Es la misma forma que la nota de prioridad, y por el mismo motivo: con una sola serie en pantalla
el aviso anunciaría una regla invisible, que es ruido y además obliga a preguntar «¿qué es una
serie?». Se pinta junto a la nota de prioridad (mismo hueco de `OrdenesModule`), y las dos pueden
coexistir: dicen cosas distintas.

**De dónde sale la serie de cada fila — y de dónde NO.** Se deriva en el cliente del
`numRemision` que `OrdenListItemDTO` **ya trae** (su prefijo no numérico), con una función pura:

```ts
/** La serie de una remisión: su prefijo sin dígitos finales. `NA-107` → "NA-", `72912` → "". */
export function serieDeRemision(numRemision: string): string;
```

**No se expone `clave_remision` para esto, y es la tentación obvia:** la clave ya lleva la serie
calculada por Postgres, así que «basta con mandarla al cliente». No. R16 dice que esa columna no
sale en ningún DTO, y R20 **no es motivo para romperlo**: sacarla convertiría una decisión de
presentación en un contrato nuevo de datos, y el `omit` global de §2.6 —que existe para que un
DTO futuro no pueda filtrarla por accidente— dejaría de tener sentido el mismo día. Con el
`numRemision` que ya viaja alcanza de sobra para contar cuántas series distintas hay en 25 filas.

**Coste de la duplicación de la regla, dicho en voz alta:** el prefijo se calcula en dos sitios
—la expresión SQL de §2.1 y `serieDeRemision`—, y podrían desincronizarse. Se acepta porque las
dos hacen cosas **distintas**: el SQL produce una clave de **orden** y esta produce una etiqueta
de **agrupación para contar**; no se comparan entre sí en ningún punto, y un desacuerdo no
desordena nada — como mucho pinta o no pinta una línea. No merece un viaje de datos nuevo.

La nota **no enumera las series** («primero las numéricas, luego BS-, NA-, SC-»): esa lista
depende de qué haya cargado cada tienda y caducaría sola. Dice el criterio, no el censo.

### 4.5 El montaje

`OrdenesListado.tsx` gana un segundo estado y un segundo `SegmentedToggle` **al lado** del
existente, en el mismo extremo izquierdo de la barra:

```ts
const [sortBy, setSortBy]   = useState<SortField>(CAMPO_ORDEN_INICIAL);
const [sortDir, setSortDir] = useState<DireccionOrden>(DIRECCION_ORDEN_INICIAL);
const orden = useMemo(() => ordenamientoDe(sortBy, sortDir), [sortBy, sortDir]);
```

Cambiar de campo **no toca `sortDir`** (R10). Dos conmutadores y no un desplegable de cuatro
opciones combinadas, por lo mismo que dice la 356: el conmutador enseña la opción que no está
puesta; un desplegable esconde la mitad del control tras un clic. Y son dos grupos con nombre
accesible propio («Ordenar por» / «Más altas–Más bajas») porque son dos decisiones distintas.

`limpiarFiltros()` sigue **sin tocar el orden**, por la razón ya escrita en la 356: el orden no
esconde filas.

### 4.6 `OrdenesModule.tsx`: cero cambios en el transporte

`claveDeOrden({sortBy, sortDir})` ya serializa **los dos**, así que la caché SWR se separa sola
(R12) y el reset a página 1 ya cuelga de esa clave (R11). Esto **no se da por hecho: se
comprueba** con un test (T4.4).

Lo único que cambia son las **dos notas**, en el mismo punto donde hoy se decide la de prioridad
(`OrdenesModule.tsx:539-542`), y con la misma forma —se calculan sobre `items`, las filas que la
página está enseñando, no sobre el conjunto—:

```ts
const notaPrioridadVigente = orden !== undefined && items.some((row) => row.prioridad === true)
  ? notaPrioridad(orden.sortBy)                                         // R14, §4.3
  : undefined;
const notaSeries = orden !== undefined
  ? notaAgrupacionPorSerie(orden.sortBy, items.map((row) => row.numRemision))  // R20, §4.4
  : undefined;
```

---

## 5. Alternativas descartadas

### 5.1 Ordenar en el cliente con un comparador natural en TypeScript — DESCARTADA

Coste cero en base de datos y ni una migración. Descartada porque el listado **pagina en el
servidor**: ordenaría las 25 filas de la página, no las 2.136 del conjunto, y el resultado
**parecería correcto** —el usuario vería `72912` arriba y creería que es la remisión más baja de
todas—. Es el fallo mudo que `lib/types/ordenamiento-listado.ts:9-13` documenta como razón de ser
del contrato entero. Además, la descarga (R13) no pasa por el cliente y saldría en otro orden.

### 5.2 Calcular la expresión en el `ORDER BY` de la consulta, sin columna nueva — DESCARTADA

Un `ORDER BY lpad(substring(num_remision …) …)` no necesita migración ni reescribe la tabla.
Descartada por tres razones: (a) `OrdenRepository.list` usa el `orderBy` **tipado** de Prisma;
expresarlo obligaría a pasar todo el listado a `$queryRaw`, reescribiendo el `where` dinámico, el
`count` y los `include` —un radio de explosión enorme para una feature de ordenar—; (b) sin valor
materializado el único índice posible es uno de expresión, que duplicaría la expresión en dos
sitios que se pueden desincronizar en silencio; (c) el humano ya firmó la columna generada.

### 5.3 Columna normal escrita por la aplicación (en el service, o con trigger + backfill) — DESCARTADA

Permitiría reglas más ricas (p. ej. mirar la tienda para decidir la serie). Descartada porque una
columna que escribe el código tiene **tantos puntos de olvido como escrituras tenga** `num_remision`,
y ninguno rompe el build cuando se olvida: la orden nacería con la clave vacía y ordenaría mal, en
silencio. Este repo ya pagó esa familia de fallo dos veces («la guardia mide por método, no por
escritura»; «el composition root que no inyecta»). `GENERATED ALWAYS` lo hace **imposible por
construcción** (R17): Postgres rechaza cualquier `INSERT`/`UPDATE` sobre la columna, y además no
hay backfill que pueda quedarse a medias.

### 5.4 Cast a `bigint` / `to_number` para el número — DESCARTADA (es el riesgo 1)

Es la forma «obvia» y es la que rompe producción: `'NA-'::bigint` lanza
`invalid input syntax for type bigint`, y como la expresión se evalúa en el `INSERT`, **una sola
remisión rara bloquearía la creación de órdenes y el lote entero de una carga masiva**. Un
`CASE WHEN … ~ '^[0-9]+$' THEN …::bigint ELSE 0 END` lo evitaría, pero `to_char` —necesario para
volver a texto ordenable— es **STABLE** y Postgres rechaza la columna. El relleno de texto
(`lpad`) da el mismo orden sin ninguna de las dos trampas.

### 5.5 Dos índices, uno por sentido — DESCARTADA POR AHORA, con umbral

Ver §2.3: se paga un segundo índice en el camino de escritura de una tabla que se carga por lotes,
para ahorrar un sort de 2.136 filas en memoria. Se declara el umbral (~200.000 filas vivas) y el
SQL exacto de la reparación para que no haya que redescubrirlo.

---

## 6. Guardias y cobertura

Tres cosas que ningún test funcional ve y que se anclan con guardias estáticas, calcadas de las
que ya protegen `busqueda_texto` (`tests/unit/guards/busqueda-texto-solo-lectura.test.ts`) y el
único parcial de remisión (`tests/unit/db/orden-num-remision-parcial.test.ts`):

1. Que el índice siga siendo **parcial** y con `COLLATE "C"` en la migración, y que ninguna
   migración posterior lo recree sin el `WHERE` (censo del árbol de `db/migrations/`).
2. Que la expresión no gane nunca un **cast a número** ni un rango de caracteres (`[0-9]`, `\d`,
   `[[:alnum:]]`) — los dos modos de romper R5 y R6.
3. Que `clave_remision` no aparezca en ningún `data:` de `lib/` (R17) ni en ninguna lista de
   columnas de descarga (R16).

El resto vive contra Postgres real, y eso no es negociable: en este repo está medido cuatro veces
que una mutación del `ORDER BY` pasa **verde** con dobles («Probar el WHERE donde vive»). El
archivo modelo es `tests/integration/db/orden-listado-orden-total.test.ts`.

---

## 7. Lo que esta feature NO toca

`prioridad DESC` delante (feature 101/R6) · el desempate por `id` (ficha 352) · `SORT_FIELDS` ·
`listarOrdenesSchema` y sus defaults · `findRecepcionSateliteByZona` y los demás `orderBy` por rol ·
el histórico · la API por clave · la unicidad parcial de `num_remision` · `busqueda_texto`.
