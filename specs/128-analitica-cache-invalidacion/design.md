# 128 — analitica: cache + invalidacion por tag · design

Todo hecho de inventario de este documento esta **verificado leyendo el arbol de `C:/w128`**; cada
uno lleva su ruta y, cuando importa, su linea. Nada viene de otra sesion.

---

## 1. Frontera: los archivos que toca la 128

**Nuevos (11):**

| archivo | que es |
|---|---|
| `lib/interfaces/external/IAnaliticaCache.ts` | El puerto. `envolver<T>(clave, tags, fn)` + `invalidar(origen, tags)`. Sin Next, sin Prisma. |
| `lib/cache/next-analitica-cache.ts` | **UNICO** archivo de la feature que importa `next/cache` (R21). Adaptador `unstable_cache` + `revalidateTag`. |
| `lib/cache/cache-nula.ts` | Implementacion pass-through del puerto (bandera apagada, R16, y tests). |
| `lib/analytics/cache-clave.ts` | Modulo puro: `claveDeConsulta(consulta, granos)` (R5-R8) y el codec de cubos (R9). |
| `lib/analytics/cache-tags.ts` | Modulo puro: tags derivados de `tagDeDominio()` del catalogo (R20). |
| `lib/config/analitica-cache.ts` | La bandera y **la unica** constante de TTL (R16/R17). |
| `lib/repositories/CachedAnaliticaOperativaRollupRepository.ts` | El decorador (R2/R3/R4/R22). |
| `lib/services/jobs/analitica-invalidacion-encolado.ts` | `dedupeKey` del job de invalidacion. Modulo puro. |
| `lib/services/jobs/analitica-invalidacion-cache-handler.ts` | Handler del job (R14). |
| `db/migrations/<ts>_job_tipo_analitica_invalidacion_cache/migration.sql` | `ALTER TYPE`, sola en su carpeta (R24). |
| `db/migrations/<ts>_job_tipo_analitica_invalidacion_cache/down.sql` | Recreacion del enum (R24). |

**Existentes que se modifican (4), cada uno con su justificacion — R19 no admite mas:**

| archivo | de quien es | que se cambia y por que |
|---|---|---|
| `lib/actions/analitica-operativa.ts` | 126 | **Solo el composition root** `construirServicio`: envuelve `AnaliticaOperativaRollupRepository` con el decorador. Cero cambios en `consultarAnaliticaOperativa` (R18). Es el unico sitio del arbol donde se cablea ese repositorio, asi que no hay alternativa menos invasiva. |
| `lib/services/jobs/analitica-rollup-diario-handler.ts` | 124 | Se anade un parametro `invalidador: IAnaliticaCache` al handler y una llamada **despues** de que `agregarFecha` resuelva (R10/R11). No se toca `AnaliticaRollupService` ni el calculo. |
| `scripts/backfill-analitica.ts` | 125 | Al terminar una corrida **con escritura**, encola el job de invalidacion (R12/R13). Entra por `EntornoCli` (que ya existe y ya es inyectable), no como import duro. |
| `app/api/cron/procesar-jobs/route.ts` | 90 | Registra el nuevo tipo en `buildHandlers` y **no** en `buildRecurrencias` (R14). |

**Lo que NO se toca, y se declara:** `lib/analytics/metrics.ts` (tiene tres divergencias ya
aplazadas a la ficha 175; **no encontre una cuarta**), `lib/services/AnaliticaOperativaService.ts`,
`lib/services/AnaliticaFinancieraService.ts`, `lib/services/AnaliticaRollupService.ts`,
`lib/services/AnaliticaBackfillService.ts`, `lib/analytics/consulta.ts`, `lib/analytics/alcance*`,
los cuatro repositorios financieros y los dos repositorios operativos existentes.

**El guardia que lo hace cumplir (R19)** es `tests/unit/analytics/cache-frontera.guardia.test.ts`,
**branch-scoped**: mide el diff de la rama contra `origin/dev`. Su cabecera dice, textualmente, lo
que la leccion del repo obliga a decir:

> Este guardia **caduca al mergear**: una vez en `dev`, «el diff contra `dev`» pasa a juzgar toda
> rama posterior y se convierte en un impuesto sobre features ajenas. **Se retira en el mismo PR que
> lo introduce (T8.5), con este comentario como constancia.**

**Lo que SOBREVIVE al merge son cuatro guardias de contenido**, que no miden diff y valen para
siempre. Ninguno cuelga del branch-scoped, precisamente porque aquel se retira:

| guardia | requisito | vigila |
|---|---|---|
| `tests/unit/analytics/cache-aislamiento.guardia.test.ts` | R21 | solo el adaptador importa `next/cache` |
| `tests/unit/analytics/cache-financiera.guardia.test.ts` | R15 (D2) | nadie cachea dinero |
| `tests/unit/analytics/cache-clave-alcance.guardia.test.ts` | R6 | la clave cubre las cuatro variantes de `AlcanceDatos` |
| `tests/unit/analytics/cache-tags.guardia.test.ts` | R20 (D3) | nadie escribe el literal del tag a mano |

Decidir la retirada del branch-scoped aqui, y no «cuando duela», es lo unico que evita el rojo sin
infraccion.

---

## 2. La doctrina: por que el backfill es un invalidador

`specs/124/design.md §13` (aviso dirigido a la 128) y `§6` rebajan por escrito el «regalo» que la
123 prometia:

| coordenada | ¿reproducible en un recomputo? |
|---|---|
| `estatus_id` | si (congelada desde `orden_historial_estado`) |
| `zona_id`, `tienda_id`, `mensajero_id` | **no**: se leen de la orden en la corrida |
| pertenencia al conjunto (`deleted_at`, D7) | **no**: una orden borrada hoy desaparece de un dia en que existio y conto |

Es decir: **la cache de un dia pasado es valida porque nadie recomputa**, no porque el dato sea
reproducible. El job diario (124) nunca toca el pasado; **la 125 si**. Por eso el backfill entra en
esta feature con el mismo rango que el job diario (R12/R13/R14) y no como una nota. El modo de fallo
que esto evita es el peor de todos: **nada se rompe, la cifra se queda vieja y no hay senal** — por
eso ademas existe R23 (registro con origen).

---

## 3. Que API de Next hay de verdad en este repo (verificado)

`package.json:48` → `"next": "16.2.10"`.

| API | ¿disponible? | evidencia |
|---|---|---|
| `cacheTag()` / `"use cache"` | **NO** sin bandera global | `node_modules/next/dist/server/use-cache/cache-tag.js:15` lanza «`cacheTag()` is only available with the `cacheComponents` config»; `next.config.ts` de este repo **no** activa `cacheComponents` (solo tiene `serverActions.bodySizeLimit`). |
| `unstable_cache(cb, keyParts, { tags, revalidate })` | **SI** | exportado en `node_modules/next/cache.d.ts:1`; firma con `tags?: string[]` en `unstable-cache.d.ts:7-13`. |
| `revalidateTag()` | **SI** | `node_modules/next/cache.d.ts:3-8`. |
| limites de tags | 128 tags/entrada, 256 chars/tag | `node_modules/next/dist/lib/constants.js:280-281`. |

Dos restricciones duras mas, tambien verificadas:

1. `unstable_cache` **lanza fuera de un request de Next** (`Invariant: incrementalCache missing`,
   `unstable-cache.js:59-67`), y `revalidateTag` lanza `Invariant: static generation store missing`
   (`revalidate.js:104-107`). **Consecuencia: el script CLI del backfill no puede invalidar** — ver §7.
2. `unstable_cache` **serializa el valor con `JSON.stringify`** (`unstable-cache.js:23`) y lo
   recupera con `JSON.parse` (`:168`, `:247`). Y `CuboRollup.segCicloAcum` es **`bigint`**
   (`lib/interfaces/repositories/IAnaliticaOperativaRollupRepository.ts:64`). Guardar el cubo tal
   cual **lanza `TypeError`**. De ahi R9 y el codec de §5.

**El nombre de la ficha («`cacheTag` por dominio») describe una API que hoy es INUTILIZABLE en este
repo.** No es un incumplimiento de la ficha: es un hecho del arbol, con su ruta arriba. **D1 = (a)**
(humano, 2026-08-03): se implementa con `unstable_cache({ tags })` + `revalidateTag` y **no se toca
`next.config.ts`**. El objetivo de la ficha —un tag por dominio, invalidacion explicita por tag— se
cumple entero; lo unico que cambia es el nombre de la funcion que lo ejecuta.

---

## 4. Donde se cachea: un decorador del repositorio, no la Server Action

```
consultarAnaliticaOperativa            (126, sin cambios de firma)
  └─ AnaliticaOperativaService         (126, sin cambios)
       ├─ IAnaliticaOperativaRollupRepository ← CachedAnaliticaOperativaRollupRepository (128)
       │       └─ AnaliticaOperativaRollupRepository (126)  →  GROUP BY analytics_daily
       └─ IAnaliticaOperativaVivaRepository   ← SIN DECORAR (128 no lo toca)  →  dia en curso
```

El decorador implementa la interfaz completa y **solo intercepta `agregarCubos`** (R2); delega
`etiquetasDeEstatus` tal cual (R4: un `ReadonlyMap` no sobrevive a `JSON.parse`).

Cuatro razones por las que el punto de corte es este y no la Server Action:

1. **El dia en curso queda fuera por construccion (R3), no por politica.** El intradia se sirve
   desde `IAnaliticaOperativaVivaRepository`, que nadie decora. No hay una regla que alguien pueda
   olvidar: no hay camino.
2. **La seudonimizacion queda fuera de la cache.** Ocurre en el servicio, **encima** del
   repositorio (`AnaliticaOperativaService.seudonimizarPuntos`). Cachear en la accion obligaria a
   meter `politicaIdentidad` en la clave y una omision filtraria ids reales de mensajero. Aqui el
   riesgo no existe: lo cacheado son cubos con ids crudos, y la etiqueta ordinal se recalcula.
3. **Se cachea exactamente lo que cuesta**: el `GROUP BY` con `_sum` de diez medidas sobre
   `analytics_daily`, que es lo que la ficha quiere evitar por request.
4. **Sigue habiendo un solo lector de la tabla** (R22): el decorador no conoce Prisma, asi que el
   guardia R42 de la 124 (`analytics-daily-guards.test.ts`) se mantiene verde sin tocarlo.

---

## 5. La clave y el codec

```ts
// lib/analytics/cache-clave.ts  (modulo puro, sin Next y sin Prisma)
export function claveDeConsulta(c: ConsultaAnalitica, granos: readonly DimensionAnalitica[]): string
```

Componentes, en orden fijo y separados por `\u001f`:

| componente | de donde sale | requisito |
|---|---|---|
| `metricaId` | `c.metrica.id` | R8 |
| granos | ordenados por el orden canonico de `DIMENSIONES` | R8 |
| `desdeFecha`/`hastaFecha` | `c.rango` — **resueltos**, nunca el preset | R5 |
| alcance | `c.alcance.tipo` + su id | R6 |
| filtro recortado | `zona_id`, `tienda_id`, `mensajero_id`, cada lista **ordenada y deduplicada** | R7 |

**Por que el alcance va en la clave aunque hoy el filtro ya lo contenga.** `recortarFiltro`
(`lib/analytics/consulta.ts:144`) escribe el recorte dentro del filtro, asi que hoy dos consultas
con el mismo filtro dan las mismas filas. Pero el `where` real se compone de **tres** piezas con
`AND` (`AnaliticaOperativaRollupRepository.whereDeConsulta:159-170`), y el propio archivo de la 126
dice por que no se apoya en esa coincidencia: *«apoyarse en esa coincidencia es apoyarse en una
feature ajena para sostener la frontera multi-tenant»*. La cache hereda ese criterio. El test de R6
lo verifica con un repositorio interno que devuelve filas distintas por alcance: si la clave lo
ignora, un rol ve las filas de otro.

**Codec (R9).** `codificarCubos` / `decodificarCubos`: `segCicloAcum` viaja como `string` decimal y
vuelve con `BigInt(...)`; `mensajeroId: null` y `causaDevolucion: null` viajan como `null` explicito
(nunca `undefined`, que `JSON.stringify` **borra**). El codec es puro y su test es un round-trip.

---

## 6. Tags

```ts
// lib/analytics/cache-tags.ts
import { tagDeDominio } from "@/lib/analytics/metrics";   // 135/R12, ya existe: ANALITICA_TAGS
export const TAG_OPERATIVA = tagDeDominio("operativa");   // ningun literal escrito aqui (R20)
```

**Granularidad elegida (D3 = (a), humano): por dominio, un unico tag `analitica:operativa`.**
Consecuencia asumida: el
job diario vacia toda la cache operativa una vez al dia (00:30 CR) y el backfill la vacia una vez
por corrida. Eso cuesta **recomputo**, no correccion, y a cambio la invalidacion es imposible de
desalinear con la lectura.

**Por que no un tag por fecha (descartado con dato, no por gusto):** Next limita a **128 tags por
entrada** y **256 caracteres por tag** — `node_modules/next/dist/lib/constants.js:280-281`, y la
ruta se escribe a proposito porque es el tipo de dato que el siguiente redescubre a base de
golpes—, y el filtro de la 135 permite rangos de hasta `RANGO_TOPE_DIAS = 366` dias. Un tag por
fecha del rango revienta el limite en cualquier consulta de mas de cuatro meses, y lo hace **en
silencio**: no hay excepcion, se pierden tags y la invalidacion deja de alcanzar entradas que cree
alcanzar. La granularidad intermedia viable era **por mes** (≤13 tags para el rango maximo); **D3 =
(a)** la descarta por simplicidad, asumiendo que invalidar de mas cuesta recomputo y no correccion.

---

## 7. Los tres invalidadores y su enganche

| invalidador | ¿existe? | ¿corre en un contexto de request de Next? | como se engancha |
|---|---|---|---|
| Job diario (124) | si: `lib/services/jobs/analitica-rollup-diario-handler.ts`, registrado en `app/api/cron/procesar-jobs/route.ts:97-100` | **si** (route handler de cron) | llamada directa al puerto tras `agregarFecha` (R10/R11) |
| Backfill (125) | si: `scripts/backfill-analitica.ts` + `AnaliticaBackfillService` | **NO** — es un proceso `tsx` fuera de Next | **encola un job**; el drenador invalida (R12/R13/R14) |
| Aprobacion de cierres | si: `aprobarCierre` (`lib/actions/cierres-admin.ts:185`) y `aprobarCierreBodega` (`lib/actions/cierre-bodega.ts:216`) | si (Server Actions) | **no se engancha en esta feature** (D2 = (a)): al no cachearse financiera, no hay nada que invalidar. Engancharla sin los otros cuatro escritores seria peor que no cachear. Ver §14. |

### 7.1 El invalidador que no se puede enganchar limpiamente: el backfill

`revalidateTag` **lanza** fuera de un request de Next (`revalidate.js:104-107`), y el backfill es un
CLI. La via elegida reusa maquinaria que ya existe y esta probada en este repo:

1. El script, al cerrar una corrida con escritura, llama a `IJobRepository.enqueue`
   (`ON CONFLICT (dedupe_key) DO NOTHING`, ya implementado) con tipo
   `analitica_invalidacion_cache` y `dedupeKey = analitica_invalidacion_cache:<desde>..<hasta>:<epoch>`.
2. `app/api/cron/procesar-jobs` corre `* * * * *` (verificado en el comentario de cabecera del
   route y en la ficha de la 124), asi que la invalidacion llega **en menos de un minuto**, dentro
   de un request, con reintentos, backoff y dead-letter gratis.
3. Coste: un valor nuevo en el enum `job_tipo` → una migracion **sola en su carpeta** (55P04) con su
   `down.sql`, calcada de `20260801100000_job_tipo_analitica_rollup_diario` (R24).

**El tipo NO se registra en `buildRecurrencias`**: es puntual, disparado por un evento, como
`geocodificacion` o `webhook_estado`. Registrarlo alli lo re-agendaria para siempre.

---

## 8. Contratos de entrada/salida

```ts
// lib/interfaces/external/IAnaliticaCache.ts
export type OrigenInvalidacion = "job_rollup_diario" | "backfill" | "manual";

export interface IAnaliticaCache {
  /** Devuelve el valor cacheado o ejecuta `producir` y lo guarda. `T` debe ser JSON-safe. */
  envolver<T>(clave: string, tags: readonly string[], producir: () => Promise<T>): Promise<T>;
  /** Invalida los tags. Si falla, LANZA (R11): nunca se traga el error. */
  invalidar(origen: OrigenInvalidacion, tags: readonly string[]): Promise<void>;
}
```

```ts
// lib/config/analitica-cache.ts
/**
 * D4 (humano, 2026-08-03) — RED DE SEGURIDAD, NO MECANISMO: quien invalida es R10/R12/R14.
 * PROVISIONAL Y NO MEDIDA: no hay medicion de trafico ni del coste del GROUP BY en este repo.
 * Vive SOLO aqui (R17).
 */
export const ANALITICA_CACHE_TTL_SEGUNDOS = 3600;

/** D5 — kill-switch por entorno, ENCENDIDA por defecto: apagarla no debe requerir un PR. */
export function analiticaCacheHabilitada(env = process.env): boolean; // R16
// ANALITICA_CACHE_DISABLED = "1" | "true"  -> apagada;  ausente -> ENCENDIDA
```

- El decorador implementa `IAnaliticaOperativaRollupRepository` **sin cambiar la interfaz**.
- **Ningun DTO de salida cambia** (R1): la 131 y la 132 ven exactamente los mismos tipos.
- Payload del job: `{ desde: "YYYY-MM-DD", hasta: "YYYY-MM-DD" }` — solo para el registro de R23;
  la invalidacion es por dominio.

## 9. Modelo de datos, RLS y migraciones

**No hay tabla nueva y no hay RLS nueva.** Lo unico que toca la base es el valor de enum
`analitica_invalidacion_cache` en `job_tipo` (la tabla `jobs` ya existe, feature 90). `migration.sql`
= `ALTER TYPE "job_tipo" ADD VALUE IF NOT EXISTS 'analitica_invalidacion_cache';` sola en su carpeta.
`down.sql` = `DELETE FROM "jobs" WHERE "tipo" = ...` + recreacion del tipo con los **7** valores
previos en su orden exacto, patron literal de
`db/migrations/20260801100000_job_tipo_analitica_rollup_diario/down.sql`.

---

## 10. Alternativas descartadas

1. **Activar `cacheComponents: true` y usar `"use cache"` + `cacheTag`** — que es lo que el nombre
   de la ficha pide. **Descartada:** es una bandera **global** de `next.config.ts` que cambia el
   modelo de renderizado de **toda** la app (rutas, layouts, Server Components ajenos a analitica),
   y ningun gate de este repo corre `next build` (`pnpm build` encadena `migrate deploy` contra una
   base real, asi que no se corre). Se estaria cambiando el runtime de la aplicacion entera para
   cachear un `GROUP BY`, sin cobertura que detecte la regresion. **Cerrada en D1 = (a).**
2. **Cachear en la Server Action** (`consultarAnaliticaOperativa`). **Descartada:** obligaria a
   meter `politicaIdentidad` en la clave —una omision filtraria ids reales de mensajero— y a fabricar
   una politica explicita para el dia en curso, que en la version elegida sale gratis por
   construccion (§4). Ademas cachearia la seudonimizacion ordinal, que es dependiente del conjunto.
3. **Un tag por fecha del rango.** **Descartada con dato:** 128 tags maximo por entrada vs. rangos de
   hasta 366 dias (§6). Silencioso, que es lo peor. **Cerrada en D3 = (a)**, que descarta tambien la
   variante por mes.
4. **Epoch en base: una fila `analitica_cache_epoch` que el backfill incrementa y que la clave lee.**
   No necesita contexto de Next y funciona desde el CLI. **Descartada:** anade **una consulta por
   request** para decidir si se puede evitar otra, y una tabla nueva con su RLS y su migracion, para
   resolver un caso —el backfill— que ocurre a lo sumo unas veces al ano. La cola de jobs ya existe
   y ya esta probada.
5. **Que el backfill llame por HTTP al route handler de cron con `CRON_SECRET`.** **Descartada:**
   exige una URL base configurada, falla en local y convierte un script de mantenimiento en un
   cliente HTTP de su propia aplicacion.
6. **Solo TTL, sin invalidacion.** **Descartada:** es exactamente «servir cifras rancias», que es lo
   que la ficha prohibe. El TTL se queda, pero como **red de seguridad** (R17), no como mecanismo.
7. **Cachear tambien el dominio financiera con la aprobacion de cierres como unico invalidador.**
   **Descartada (R15):** los tres ledgers los escriben ademas `WalletEgresoService`,
   `LiquidacionService`, `GeneracionGastosFijosService` (cron diario) y el flujo de indemnizaciones
   de incidentes — verificado recorriendo los consumidores de `WalletMovimientoRepository`,
   `WalletTiendaMovimientoRepository` y `PagoMensajeroMovimientoRepository`. Serviria dinero rancio
   en silencio. **Cerrada en D2 = (a)**: no se cachea financiera, R15 lo prohibe con guardia, y
   engancharlos es **otra feature** (§14).

---

## 11. Verificacion: como se demuestra que la invalidacion funciona

**Un test que espia `revalidateTag` no prueba nada**: prueba que alguien escribio la llamada. La
prueba de esta feature es el **patron de cinco pasos**, y su asercion es siempre sobre el **dato
servido**:

```
1. consultar            -> V1     (repositorio interno llamado 1 vez)
2. cambiar el origen    -> las filas del repositorio interno pasan a valer V2
3. consultar            -> V1     ← si esto fallara, la cache no cachea y el resto seria vacuo
4. correr el INVALIDADOR REAL (el handler de produccion, con el mismo puerto de cache inyectado)
5. consultar            -> V2     ← si esto devuelve V1, la invalidacion NO llego
```

El puerto se instancia con una **cache falsa con semantica de tags real** (entradas indexadas por
tag; `invalidar(tags)` borra las que los llevan), no con un mock que registre llamadas. Con esa
pieza, los pasos 3 y 5 son afirmaciones sobre cifras.

- **R10** usa `crearAnaliticaRollupDiarioHandler` real en el paso 4.
- **R14** usa el drenado real del job encolado por el backfill en el paso 4.
- **Mutaciones que ponen rojo el paso 5:** borrar la invalidacion; invalidar el tag equivocado; no
  registrar el handler; tragarse el error de invalidacion (R11 lo caza antes).

**Limite declarado, sin maquillaje:** `lib/cache/next-analitica-cache.ts` **no es testeable en
unitario** — `unstable_cache` y `revalidateTag` lanzan fuera de un request de Next, y ningun gate de
este repo corre `next build` ni levanta el servidor. Es la pulgada no cubierta de la feature, y por
eso se disena para que sea lo mas fina posible: dos funciones, sin logica, sin ramas, cubierta solo
por el guardia estatico de R21. Todo lo demas —clave, codec, decorador, handlers, script— corre sin
Next y sin `DATABASE_URL`.

Mapa completo `R<n> → test` en `requirements.md`; el implementer lo replica en
`progress/impl_128-analitica-cache-invalidacion.md`.

---

## 12. Impacto declarado sobre las features vivas

- **131 (tablero operativo) y 132 (tablero financiero):** **impacto cero de contrato**. R18 congela
  la aridad y el tipo de retorno de `consultarAnaliticaOperativa` y `consultarMetricaFinanciera`, y
  R1 congela los valores. Lo unico que cambia es **de donde salen los cubos** dentro del composition
  root. Lo que la 131 debe saber: el punto `parcial: true` del dia en curso **sigue siendo siempre
  fresco** (R3), y un punto de dia cerrado puede venir de cache.
- **124 / 125:** se les cuelga la invalidacion (§1) y nada mas. Su calculo, su idempotencia y sus
  guardias quedan intactos.
- **126 / 127:** solo el composition root de la accion operativa. La financiera no se toca (R15).
- **135 (`lib/analytics/metrics.ts`):** **no se toca**. Se **consume** `tagDeDominio()` /
  `ANALITICA_TAGS`, que aquella feature dejo escritos explicitamente «consumidas por la 128».
  **No encontre una cuarta divergencia** que declarar.

## 13. Riesgos abiertos

- **El adaptador de Next es la pulgada no cubierta** (§11). Riesgo mitigado por tamano, no eliminado.
- **El TTL (3600 s, D4) sigue siendo un numero sin medicion detras.** Vive en una sola constante con
  el comentario «provisional y no medida», criterio de R47 de la 124. Lo que lo hace tolerable es que
  es una **red de seguridad**: el trabajo lo hace la invalidacion explicita.
- **Invalidacion por dominio (D3) = cache fria cada mañana** tras el job de las 00:30 CR. Asumido:
  cuesta recomputo, no correccion. Si algun dia se midiera que duele, la salida documentada es la
  variante por mes descartada en §6.
- **La analitica financiera se queda sin cache** (D2) y por tanto sigue pagando su consulta por
  request. Es deliberado: §14.
- **`./init.sh` viene rojo de `dev`** por deuda heredada. El criterio de esta feature es **delta 0**
  medido en la rama antes de tocar nada; nunca el baseline de la bitacora.

---

## 14. Ficha propuesta: la invalidacion financiera (D2)

D2 deja fuera el dinero **a proposito**, y esto es lo que hay que dar de alta para cerrarlo. No es un
apendice de la 128: tiene cinco puntos de enganche, cada uno con su test de cinco pasos, y toca
codigo de dinero.

- **Nombre:** `analitica: cache financiera + invalidacion por ledger`
- **Zona:** `backend`. **Complexity:** `medium`. **`depends_on`: 128.**
- **Descripcion:** «Backend. Extiende la cache por tag de la 128 al dominio financiera: envuelve las
  lecturas de `AnaliticaFinancieraService` con el tag `analitica:financiera` (ya declarado en
  `ANALITICA_TAGS`, feature 135) e invalida desde **todos** los escritores de los tres ledgers, no
  solo desde la aprobacion de cierres: `WalletEgresoService`, `LiquidacionService`,
  `GeneracionGastosFijosService` (cron de gastos fijos), el flujo de indemnizaciones de incidentes y
  `aprobarCierre` / `aprobarCierreBodega`. Retira el guardia R15 de la 128 en el mismo PR que lo
  sustituye por la invalidacion real. Cada escritor necesita su test de cinco pasos —consultar,
  mover dinero, comprobar que todavia sirve el valor viejo, invalidar, comprobar que sirve el
  nuevo—: un escritor sin invalidar sirve dinero rancio en silencio, que es exactamente por lo que la
  128 no lo hizo.»
- **Riesgo que la justifica:** hoy el tablero financiero paga su consulta por request. La alternativa
  barata —cachear con un solo invalidador— es la que se rechazo, y el guardia R15 impide que alguien
  la reintroduzca sin pasar por esta ficha.
