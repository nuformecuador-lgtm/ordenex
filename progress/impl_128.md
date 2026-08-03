# 128 — analitica: cache + invalidacion por tag · bitacora de implementacion

> Rama `feature/128-analitica-cache-invalidacion`, worktree `C:/w128`. Base `999b7536`.
> Todo lo de este documento esta medido o verificado en ESTE worktree. Nada viene de otra sesion
> ni de un baseline citado de la bitacora.

---

## 1. Baseline medido al empezar (T0.1) vs. final

| medicion | baseline (antes de tocar nada) | final |
|---|---|---|
| `pnpm typecheck` | limpio | limpio |
| `pnpm lint` | **0 errores**, 30 warnings | **0 errores**, 30 warnings |
| `pnpm test` — **archivos** | **844** (2 failed / 842 passed) | **864** (1 failed / 863 passed) — **+20 archivos, todos mios** |
| `pnpm test` — tests | **10 550** (2 failed / 10 548 passed) | **10 651** (1 failed / 10 650 passed) — **+101 tests** |

**Los rojos, con nombre y comprobados EN AISLADO** (ninguno es de esta feature):

| corrida | rojo | en aislado |
|---|---|---|
| baseline | `tests/unit/components/filter-component.test.tsx` › «una racha de clics colapsa en UNA sola emision…» | **verde** en la corrida final |
| baseline | `tests/unit/guards/no-embalaje.test.ts` › «no queda ninguna referencia a 'embalaje' fuera del whitelist» | **verde** (`pnpm exec vitest run tests/unit/guards/no-embalaje.test.ts` → 1 passed) |
| final | `tests/unit/guards/no-embalaje.test.ts` (el mismo) | **verde** en aislado |

Los dos son **flakes por saturacion**, no regresiones: cambian de archivo entre corridas y pasan
aislados. **Delta de rojos reales = 0.**

Ninguna corrida —ni la inicial ni la final— reporto *unhandled errors* de workers, asi que
**ninguna estaba degradada**: el total de ARCHIVOS es comparable entre las dos, que es la
comprobacion que importa (una corrida degradada omite archivos enteros y parece casi verde).

---

## 2. Archivos creados y modificados

### Nuevos (14)

| archivo | que es |
|---|---|
| `lib/interfaces/external/IAnaliticaCache.ts` | El puerto. `envolver` + `invalidar`. Sin Next y sin Prisma. |
| `lib/cache/next-analitica-cache.ts` | **UNICO** archivo que importa `next/cache` (R21). |
| `lib/cache/cache-nula.ts` | Pass-through del puerto (bandera apagada, R16). |
| `lib/cache/registro-invalidacion.ts` | **DESVIACION declarada** (§6.1). Decorador del puerto que emite el registro de R23. |
| `lib/analytics/cache-clave.ts` | `claveDeConsulta` (R5–R8). Modulo puro. |
| `lib/cache/cache-codec.ts` | **DESVIACION declarada** (§6.8). Codec de cubos (R9). |
| `lib/analytics/cache-tags.ts` | Tags derivados de `tagDeDominio()` (R20). Puro. |
| `lib/config/analitica-cache.ts` | Bandera (R16) y **la unica** constante de TTL (R17). |
| `lib/repositories/CachedAnaliticaOperativaRollupRepository.ts` | El decorador + `decorarRollupConCache` (R2/R3/R4/R16/R22). |
| `lib/services/jobs/analitica-invalidacion-encolado.ts` | `dedupeKey` y payload del job. Puro. |
| `lib/services/jobs/analitica-invalidacion-cache-handler.ts` | Handler del job (R14). |
| `db/migrations/20260803140000_job_tipo_analitica_invalidacion_cache/migration.sql` | `ALTER TYPE`, sola en su carpeta (R24). |
| `db/migrations/20260803140000_job_tipo_analitica_invalidacion_cache/down.sql` | Recreacion del enum con los 7 valores previos (R24). |
| `progress/impl_128.md` | esta bitacora. |

Mas 15 archivos de test (todos nuevos, ninguno de otra feature modificado):
`tests/unit/analytics/_cache-falsa.ts`, `cache-tags.test.ts`, `cache-tags.guardia.test.ts`,
`cache-clave.test.ts`, `cache-clave-alcance.guardia.test.ts`, `cache-codec.test.ts`,
`cache-decorador.test.ts`, `cache-alcance.test.ts`, `cache-equivalencia.test.ts`,
`cache-config.test.ts`, `cache-config.guardia.test.ts`, `cache-dia-en-curso.test.ts`,
`cache-aislamiento.guardia.test.ts`, `cache-financiera.guardia.test.ts`,
`cache-invalidacion-job.test.ts`, `cache-invalidacion-backfill.test.ts`,
`cache-registro.test.ts`, `cache-frontera.guardia.test.ts`,
`tests/unit/scripts/backfill-analitica-invalidacion.test.ts`,
`tests/unit/services/jobs-registro.test.ts`,
`tests/integration/db/job-tipo-analitica-invalidacion-migration.test.ts`.

### Existentes modificados (6 de codigo + 4 de test)

| archivo | de quien | que se cambia |
|---|---|---|
| `lib/actions/analitica-operativa.ts` | 126 | **solo** `construirServicio`: envuelve el repositorio de rollup. El vivo pasa DESNUDO (R3). Cero cambios de firma (R18). |
| `lib/services/jobs/analitica-rollup-diario-handler.ts` | 124 | 4.º parametro `invalidador` con default + una llamada DESPUES de `agregarFecha` (R10/R11). No se toca `AnaliticaRollupService`. |
| `scripts/backfill-analitica.ts` | 125 | `crearJobs?` en `EntornoCli` y encolado del job al cerrar una corrida con escritura (R12/R13). |
| `app/api/cron/procesar-jobs/route.ts` | 90 | registra el tipo nuevo en `buildHandlers` y **no** en `buildRecurrencias` (R14); pasa el invalidador real al handler del rollup. |
| `db/schema.prisma` | — | **DESVIACION declarada** (§6.2): el valor nuevo del enum `job_tipo`. |
| `feature_list.json` | leader | no lo he tocado yo; entra en el diff porque el alta de la 128 se commiteo en esta rama. |

Y **cuatro tests ajenos**, una linea cada uno, por el motivo de §6.9:
`tests/unit/api/procesar-jobs-registro.test.ts`,
`tests/integration/api/procesar-jobs-geocodificacion.test.ts`,
`tests/integration/api/procesar-jobs-webhook-estado.test.ts` (conjunto EXACTO de handlers) y
`tests/integration/db/job-tipo-analitica-rollup-migration.test.ts` (§6.9).

**Lo que NO se toco, y se declara:** `lib/analytics/metrics.ts`, `next.config.ts`,
`AnaliticaOperativaService`, `AnaliticaFinancieraService`, `AnaliticaRollupService`,
`AnaliticaBackfillService`, `lib/analytics/consulta.ts`, `lib/analytics/alcance*`, los cuatro
repositorios financieros y los dos operativos, y **ningun test de otra feature**.

---

## 3. Mapa `R<n> → test nombrado` (el caso que MUERE, no un hermano)

| R | test que muere | caso |
|---|---|---|
| R1 | `tests/unit/analytics/cache-equivalencia.test.ts` | «`tiempo_ciclo`: sin cache, primera consulta con cache y HIT de cache coinciden» |
| R2 | `tests/unit/analytics/cache-decorador.test.ts` | «la segunda consulta se sirve de cache» |
| R3 | `tests/unit/analytics/cache-dia-en-curso.test.ts` | «`AnaliticaOperativaVivaRepository` se pasa DESNUDO» (+ el de comportamiento) |
| R4 | `tests/unit/analytics/cache-decorador.test.ts` | «dos llamadas van las dos al repositorio interno y el `Map` conserva sus entradas» |
| R5 | `tests/unit/analytics/cache-clave.test.ts` | «el mismo preset en dos dias distintos no comparte entrada» |
| R6 | `tests/unit/analytics/cache-alcance.test.ts` | «el segundo actor NO recibe las filas del primero» |
| R6 | `tests/unit/analytics/cache-clave-alcance.guardia.test.ts` | «`lib/analytics/cache-clave.ts` tiene un `case` por cada variante declarada» |
| R7 | `tests/unit/analytics/cache-clave.test.ts` | «[a,b] y [b,a] comparten entrada; [a] y [a,b] no» |
| R8 | `tests/unit/analytics/cache-clave.test.ts` | «la misma metrica con y sin desagregacion no comparte entrada» |
| R9 | `tests/unit/analytics/cache-codec.test.ts` | «el decorador SI mete el codec: sin el, la consulta entera falla» y «los `null` NO se convierten en `undefined` ni en un centinela» |
| R10 | `tests/unit/analytics/cache-invalidacion-job.test.ts` | «los cinco pasos, con el handler de produccion en el paso 4» |
| R11 | `tests/unit/analytics/cache-invalidacion-job.test.ts` | «el error se propaga para que `JobQueueService` lo cuente como fallo y aplique backoff» |
| R12 | `tests/unit/scripts/backfill-analitica-invalidacion.test.ts` | «un solo `enqueue`, del tipo `analitica_invalidacion_cache`» y «una corrida con fechas fallidas y alguna procesada tambien lo encola» |
| R13 | `tests/unit/scripts/backfill-analitica-invalidacion.test.ts` | «cero llamadas a `enqueue`» |
| R14 | `tests/unit/services/jobs-registro.test.ts` | «`buildHandlers` lo incluye» y «`buildRecurrencias` no lo lleva» |
| R14 | `tests/unit/analytics/cache-invalidacion-backfill.test.ts` | «los cinco pasos, con el drenador real en el paso 4» |
| R15 | `tests/unit/analytics/cache-financiera.guardia.test.ts` | «el dominio `financiera` no se cachea» |
| R16 | `tests/unit/analytics/cache-config.test.ts` | «dos consultas identicas llaman DOS veces al repositorio» y «un entorno vacio cachea» |
| R17 | `tests/unit/analytics/cache-config.guardia.test.ts` | «ningun archivo del ambito escribe el numero» y «no hay `revalidate: false`» |
| R18 | `tests/unit/analytics/cache-frontera.guardia.test.ts` | «ningun parametro nuevo OBLIGATORIO» |
| R19 | `tests/unit/analytics/cache-frontera.guardia.test.ts` | «`lib/analytics/metrics.ts` NO aparece en el diff» |
| R20 | `tests/unit/analytics/cache-tags.guardia.test.ts` | «solo el catalogo de la 135 (y su test) contienen las cadenas de `ANALITICA_TAGS`» |
| R21 | `tests/unit/analytics/cache-aislamiento.guardia.test.ts` | «ningun servicio, repositorio, modulo de analitica, script ni handler de job lo importa» |
| R22 | `tests/unit/analytics/cache-decorador.test.ts` (+ `tests/integration/db/analytics-daily-guards.test.ts`, R42 de la 124, **sin modificar**) | «no importa `@prisma/client` ni nombra la tabla del rollup» |
| R23 | `tests/unit/analytics/cache-registro.test.ts` | «un registro por invalidacion, con el origen que la disparo» |
| R24 | `tests/integration/db/job-tipo-analitica-invalidacion-migration.test.ts` | «va SOLA en su carpeta» y «borra antes las filas de `jobs` de ese tipo» |

**24/24 requisitos con test nombrado.**

---

## 4. Mutaciones aplicadas y muertas

Arnes: aplicar la mutacion, **confirmar que aterrizo en disco**, correr SOLO el test nombrado,
comprobar el rojo, revertir. Ninguna se dio por buena sin leer el archivo mutado.

| # | mutacion | test | resultado |
|---|---|---|---|
| R1 | el decorador devuelve el valor sin rehidratar tipos | `cache-equivalencia` | **MUERTA** |
| R2 | la clave lleva un sufijo aleatorio (el decorador delega siempre) | `cache-decorador` | **MUERTA** |
| R3 | decorar tambien el repositorio VIVO en el composition root | `cache-dia-en-curso` | **MUERTA** |
| R4 | envolver `etiquetasDeEstatus` con la cache | `cache-decorador` | **MUERTA** |
| R5 | usar `rango.preset` en la clave | `cache-clave` | **MUERTA** |
| R6a | quitar el alcance de la clave | `cache-alcance` | **MUERTA** |
| R6b | contemplar solo `zona`/`tienda` (borrar dos `case`, poner `default`) | `cache-clave-alcance.guardia` | **MUERTA** |
| R7a | omitir los ids de zona del filtro en la clave | `cache-clave` | **MUERTA** |
| R7b | `JSON.stringify(ids)` sin ordenar | `cache-clave` | **MUERTA** |
| R8 | omitir los granos de la clave | `cache-clave` | **MUERTA** |
| R9a | quitar el codec y pasar el cubo directo al puerto | `cache-codec` | **MUERTA** (`TypeError` de `BigInt`) |
| R9b | codificar pero no rehidratar | `cache-codec` | **MUERTA** |
| R9c | normalizar `null` a `"sin_asignar"` en el codec | `cache-codec` | **MUERTA** |
| R10a | borrar la invalidacion del handler diario | `cache-invalidacion-job` | **MUERTA** |
| R10b | invalidar un tag equivocado | `cache-invalidacion-job` | **MUERTA** |
| R11 | envolver la invalidacion en un `try/catch` que la ignora | `cache-invalidacion-job` | **MUERTA** |
| R12 | no encolar nunca | `backfill-analitica-invalidacion` | **MUERTA** |
| R13 | encolar siempre (tambien en el plan sin `--confirmar`) | `backfill-analitica-invalidacion` | **MUERTA** |
| R14a | no registrar el handler en `buildHandlers` | `jobs-registro` | **MUERTA** |
| R14b | registrar el tipo tambien en `buildRecurrencias` | `jobs-registro` | **MUERTA** |
| R15 | nombrar `IAnaliticaCache` en el borde financiero | `cache-financiera.guardia` | **MUERTA** |
| R16a | ignorar la bandera | `cache-config` | **MUERTA** |
| R16b | invertir el default (apagada si la variable falta) | `cache-config` | **MUERTA** |
| R17a | duplicar el `3600` en el adaptador | `cache-config.guardia` | **MUERTA** |
| R17b | `revalidate: false` | `cache-config.guardia` | **MUERTA** |
| R18 | quitar el default de `deps` (parametro obligatorio) | `cache-frontera.guardia` | **MUERTA** |
| R19 | editar `lib/analytics/metrics.ts` | `cache-frontera.guardia` | **MUERTA** |
| R20 | escribir el literal del tag en `cache-tags.ts` | `cache-tags.guardia` | **MUERTA** |
| R21 | `import { revalidateTag } from "next/cache"` en `AnaliticaOperativaService` | `cache-aislamiento.guardia` | **MUERTA** |
| R22 | el decorador importa `PrismaClient` y toca `analyticsDaily.groupBy` | `cache-decorador` **y** `analytics-daily-guards` (R42 de la 124) | **MUERTA en los dos** |
| R23 | emitir el registro sin el `origen` | `cache-registro` | **MUERTA** |
| R24a | meter un `ALTER TABLE` junto al `ALTER TYPE` | `job-tipo-analitica-invalidacion-migration` | **MUERTA** |
| R24b | omitir el `DELETE FROM "jobs"` del `down.sql` | `job-tipo-analitica-invalidacion-migration` | **MUERTA** |

**33 mutaciones aplicadas, 33 muertas.**

### 4.1 Dos mutaciones que al principio SOBREVIVIERON, y que obligaron a arreglar el test

Se dejan escritas porque son el tipo de falso verde que el spec avisa:

1. **R1** — con **un cubo por fecha**, el acumulador del servicio no llega a sumar nada, y
   `BigInt(0) + "7200"` **no lanza** en JavaScript: **concatena** (`"07200"`), y
   `Number("07200") / 4` vuelve a dar exactamente 1800. El test pasaba con el `bigint` sin
   rehidratar. **Arreglado el TEST, no el conteo**: `cache-equivalencia.test.ts` usa ahora **dos
   cubos en la misma fecha**, de modo que la concatenacion es visible (14 400 360 en vez de
   1800). Documentado en el propio archivo para que nadie lo «simplifique».
2. **R9** — `cache-codec.test.ts` probaba que el codec FUNCIONA sin probar que el decorador lo
   USA: quitarlo del decorador no mataba el archivo que el spec nombra para R9. Se anadio el
   caso «el decorador SI mete el codec», que es el que muere.

---

## 5. Estado del `down.sql` — **reversibilidad NO demostrada por ejecucion**

- `db/migrations/20260803140000_job_tipo_analitica_invalidacion_cache/` trae su `down.sql`.
- Verificado **por texto y por unicidad de sentencia** (`job-tipo-analitica-invalidacion-migration.test.ts`):
  el `up` tiene **una sola sentencia** (Postgres 55P04) y no lleva `CREATE TABLE`/`ALTER TABLE`/
  `INSERT`/`CREATE INDEX`; el `down` borra las filas de `jobs` de ese tipo **antes** del
  `ALTER TYPE ... RENAME`, recrea el enum con los **7 valores previos en su orden exacto**,
  reapunta la columna con `USING ("tipo"::text::"job_tipo")` y tira el tipo viejo.
- **NO se ha ejecutado `pnpm run db:rollback` ni se ha aplicado la migracion.** La base
  `localhost:5432/ordenex` la comparten varios worktrees y su historial local ya esta
  desalineado con el remoto. Aplicar/revertir es decision del leader (`tasks.md > T6.1`).
- **Consecuencia declarada, sin maquillaje:** la mitad «contra Postgres» del test de R24 —la que
  consulta `pg_enum`— **no existe todavia**. Esta escrita literalmente al final del archivo de
  test, lista para pegar en cuanto la migracion se aplique. Ponerla antes dejaria un rojo
  permanente que no dice nada sobre la correccion de esta migracion.

---

## 6. Desviaciones de `design.md`, con su motivo

### 6.1 Un archivo nuevo mas: `lib/cache/registro-invalidacion.ts`

`design.md §1` lista 11 nuevos y no incluye este. R23 exige que **toda** invalidacion deje
registro de quien la disparo. El adaptador de Next **no es testeable en unitario** (§11), asi que
meter el registro dentro de el habria dejado R23 cubierto por un formateador de cadenas. Como
**decorador del puerto**, el registro se ejerce con codigo de produccion real y su mutacion
—emitirlo sin el origen— mata un test de verdad. Se cablea en `crearAnaliticaCacheDeNext()`.

### 6.2 Un archivo existente mas: `db/schema.prisma`

`design.md §9` hablaba solo de los dos `.sql`. El valor nuevo del enum tiene que estar tambien en
el datamodel o Prisma y la base divergen (y el propio test de R24 lo comprueba). Mismo alcance
exacto que hizo la 124 con `analitica_rollup_diario`: un valor de enum, cero tablas.

### 6.3 `revalidateTag` tiene DOS parametros obligatorios en Next 16.2.10

**Hecho de inventario que `design.md §3` no recogia, verificado leyendo `C:/w128`:**
`node_modules/next/dist/server/web/spec-extension/revalidate.d.ts:9` declara
`revalidateTag(tag: string, profile: string | CacheLifeConfig)`. La llamada de un solo argumento
**no compila**, y en ejecucion emite «"revalidateTag" without the second argument is now
deprecated, add second argument of "max" or use "updateTag"» (`revalidate.js:41-44`). Se pasa
`"max"`, que es el sustituto que indica ese mismo aviso. `updateTag` **no sirve**: lanza fuera de
una Server Action (`revalidate.js:49-57`) y esta invalidacion la disparan handlers de job desde
un route handler de cron.

### 6.4 `crearJobs` entra en `EntornoCli` como **opcional**

`design.md §1` decia «entra por `EntornoCli`». Se hace opcional para no modificar
`tests/unit/scripts/backfill-analitica-cli.test.ts` (feature 125) — R19 y el criterio de no tocar
codigo ajeno. El riesgo del opcional —que una corrida real se olvide de la cola y no invalide en
silencio— se cierra por dos vias: `main()` lo cablea, y una corrida **con escritura** sin cola
configurada **avisa por `errores`** («NO se ha encolado la invalidacion…»), con su test.

### 6.5 El `invalidador` del handler diario tiene default `cacheNula()`

`tasks.md > T5.1` lo pedia asi («solo el cableado del nuevo parametro con default») para que
`tests/unit/services/analitica-rollup-handler.test.ts` siguiera verde sin tocarlo. Un default
no-op es un footgun: si el cron se olvidara de pasar el puerto real, **nada fallaria**. Cerrado
con una asercion estatica sobre `app/api/cron/procesar-jobs/route.ts` en
`cache-invalidacion-job.test.ts` › «`buildHandlers` construye el handler del rollup con
`crearAnaliticaCacheDeNext()`».

### 6.6 El `dedupeKey` del job de invalidacion NO deduplica entre corridas

Lleva el epoch, como decia `design.md §7.1`, y aqui se escribe **por que**: dos backfills del
mismo rango son dos recomputos **distintos** y el segundo tiene que invalidar igual que el
primero. Si la clave los fundiera, el `ON CONFLICT DO NOTHING` descartaria el segundo encolado en
silencio y la cache serviria las cifras del primer recomputo.

### 6.8 El codec NO cabe en `lib/analytics/`

`design.md §5` lo ponia dentro de `lib/analytics/cache-clave.ts`. **No cabe ahi, y el guardia
tenia razon.** `tests/unit/analytics/modulo-puro.guardia.test.ts` (122/135) prohibe que cualquier
archivo de `lib/analytics/` importe un especificador con el segmento `repositories`, y juzga la
**ruta**, no si el import es de tipo. El codec necesita `CuboRollup`, que vive en
`lib/interfaces/repositories/`. Se movio **el codigo** a `lib/cache/cache-codec.ts`; la
alternativa —relajar el guardia para hacerle sitio a un archivo nuevo— es exactamente lo que no
se hace. `claveDeConsulta` se queda en `lib/analytics/cache-clave.ts` y sigue siendo puro.

### 6.9 Cuatro tests ajenos, una linea cada uno

- `procesar-jobs-registro.test.ts` (90/124), `procesar-jobs-geocodificacion.test.ts` (91) y
  `procesar-jobs-webhook-estado.test.ts` (99) afirman el **conjunto EXACTO** de handlers
  registrados, y su propio comentario dice: «anadir o quitar un tipo sin actualizar este test
  falla ruidosamente». Anadir el tipo a la lista **ES la actualizacion que ese guardia pide**, no
  una relajacion: ni una expectativa mas cambia en los tres.
- `job-tipo-analitica-rollup-migration.test.ts` (124) exigia que el enum del datamodel tuviera
  **exactamente siete** valores con el de la 124 al final. Es una propiedad **temporal** —la
  misma clase que ese archivo ya habia retirado por su cuenta con «la carpeta es la ULTIMA por
  nombre»—: cualquier feature que anada un valor de enum la rompe sin decir nada sobre la
  correccion de la 124. Se acota a `slice(0, 7)`, conservando intacto lo que si es suyo: los seis
  valores previos en su orden exacto y el suyo justo despues, que es lo que su `down.sql` recrea.

Los cinco archivos estan en la lista del guardia de frontera con su justificacion escrita.

### 6.7 Lo que NO se encontro

No aparecio una **cuarta divergencia** en `lib/analytics/metrics.ts` que declarar (las tres
conocidas siguen aplazadas a la ficha 175). El archivo no se toco.

---

## 7. Los guardias y su ciclo de vida

**Cuatro que SOBREVIVEN al merge** (censan contenido, no diff):

| guardia | R | vigila |
|---|---|---|
| `cache-aislamiento.guardia.test.ts` | R21 | solo el adaptador importa `next/cache` |
| `cache-financiera.guardia.test.ts` | R15 (D2) | nadie cachea dinero; su mensaje enumera los cinco escritores de ledger y nombra la ficha que lo sustituye |
| `cache-clave-alcance.guardia.test.ts` | R6 | la clave cubre las cuatro variantes de `AlcanceDatos`, leidas del propio tipo |
| `cache-tags.guardia.test.ts` | R20 | nadie escribe el literal del tag |

**Uno branch-scoped que CADUCA y se retira en el mismo PR (T8.5)**:
`cache-frontera.guardia.test.ts`. Su cabecera lo dice literalmente. **Comprobado: ninguno de los
cuatro anteriores depende de el** — cada uno vive en su archivo y no importa nada de aquel.

`cache-config.guardia.test.ts` (R17) tambien sobrevive: censa contenido por ambito.

---

## 8. T7.2 — peticion al leader

`design.md §14` propone dar de alta la ficha **«analitica: cache financiera + invalidacion por
ledger»** (backend, `medium`, `depends_on: 128`). **La 128 no la implementa** y **yo no edito
`feature_list.json`**. Queda pedido aqui.

---

## 9. Veredicto

Los 24 requisitos implementados y cubiertos por test nombrado, con 33 mutaciones aplicadas y las
33 muertas; **delta de rojos reales = 0** (844→864 archivos y 10 550→10 651 tests, todo el aumento es de esta feature; el unico rojo de la corrida final es un flake que pasa en aislado); la
reversibilidad de la migracion verificada por texto y **no** por ejecucion, por decision explicita
de no tocar la base compartida.
