# 179 — analitica: cache financiera + invalidacion por ledger · design

Todo hecho de inventario de este documento esta **verificado leyendo el arbol de `C:/w179`**
(rama `feature/179-analitica-cache-financiera`, nacida de `origin/dev`); cada uno lleva su ruta y,
cuando importa, su linea. Nada viene de la ficha ni de otra sesion sin comprobar.

> **Puerta T0 CERRADA el 2026-08-10** con las decisiones **D1–D4** (`requirements.md` § «Decisiones
> D1–D4»), todas con la recomendacion de esta spec: invalidacion por tag de dominio (D1); el
> backfill de tesoreria por el job que la 128 ya tiene, sin migracion (D2); `conciliacion_cierres`
> nunca se cachea, con politica exhaustiva y guardia (D3); y un fallo de invalidacion posterior al
> commit no se propaga (D4). **Este documento ya esta escrito para esas respuestas: no queda nada
> condicionado.**

---

## 1. El inventario que corrige a la ficha

### 1.1 Las tres puertas del dinero, y solo tres

```
wallet_movimiento          ← tx.walletMovimiento.createMany        WalletMovimientoRepository.ts:76
wallet_tienda_movimiento   ← tx.walletTiendaMovimiento.createMany  WalletTiendaMovimientoRepository.ts:84
pago_mensajero_movimiento  ← tx.pagoMensajeroMovimiento.createMany PagoMensajeroMovimientoRepository.ts:126
```

No hay **ninguna** otra escritura de esas tres tablas en `lib/`, `app/` ni `scripts/` (censado con
`walletMovimiento.(create|update|delete|upsert)` y sus dos hermanas). Los tres metodos son
`crearMovimientos(tx, movs)` y los tres son idempotentes por indice unico parcial. **Eso es lo que
hace posible el censo de R17**: hay una sola frontera que vigilar y es estrecha.

### 1.2 Los llamadores: OCHO puntos, no cinco

La tabla completa con rutas y lineas esta en `requirements.md §0.a`. Los tres hallazgos que
contradicen a la ficha:

1. **`WalletService.registrarMovimientoManual` (`lib/services/WalletService.ts:177`) escribe la
   caja y no estaba en la lista.** Entra por `lib/actions/wallet.ts:150`. Sus movimientos entran en
   `egresos`, `dinero_en_caja` y `ganancia_ordenex`.
2. **El cron de gastos fijos SI corre dentro de un request**: es un route handler
   (`app/api/cron/generar-gastos-fijos/route.ts:80`). La preocupacion «el cron escribe fuera de una
   peticion» no aplica ahi.
3. **Quien SI escribe fuera de todo request es `scripts/backfill-caja-tesoreria.ts`**
   (→ `CajaBackfillTesoreriaService.ts:92` → `WalletMovimientoRepository`). Es el octavo escritor y
   el unico que no puede llamar a `revalidateTag`. **Q2.**

`CajaPagoTiendaFeedService` (`:40`, `:65`) no es un escritor autonomo: solo lo instancian
`lib/actions/liquidacion.ts:90` (dentro de `LiquidacionService`, cubierto por R11) y el script del
punto 3 (Q2). Aparece en el censo y su entrada en el registro apunta a esos dos.

### 1.3 El valor a cachear ya es JSON-safe, y por eso hay que vigilarlo

`ResultadoFinanciero` (`lib/types/analitica-financiera.ts:272`) es una union de dos interfaces
cuyos campos son `string`, `boolean`, un unico `number` (`FilaConciliacion.cantidad`, un conteo) y
arrays de objetos planos. Todo importe es `string` escala 2 porque el servicio lo produce con
`.toFixed(2)`. **No hay `bigint`, ni `Date`, ni `Map`, ni `Prisma.Decimal` en el DTO.**

La 128 necesitaba un codec (su R9) porque `CuboRollup.segCicloAcum` es `bigint` y
`JSON.stringify` **lanza**. Aqui pasa lo contrario y es peor: **nada lanza**. Si mañana alguien
anade `corteAt: Date` al DTO, el viaje por JSON lo convierte en `string` y la pantalla sigue
pintando. Por eso **R3 sustituye al codec por dos pruebas**: un round-trip real de las ocho
metricas y un guardia estatico sobre el tipo.

---

## 2. Frontera de archivos

**Un archivo fuera de esta lista es un hallazgo bloqueante** (R25, guardia branch-scoped).

### Nuevos

| archivo | que es |
|---|---|
| `lib/services/CachedAnaliticaFinancieraService.ts` | El decorador de lectura. Implementa `IAnaliticaFinancieraService`, cachea solo `status: "ok"` (R2/R4). |
| `lib/analytics/cache-clave-financiera.ts` | Modulo puro: `claveFinanciera(consulta)`, compone `claveDeConsulta` con el prefijo de dominio (R5). |
| `lib/analytics/cache-politica-financiera.ts` | **D3/R28** — la politica de cache **por metrica**, exhaustiva, con la causa de exclusion como dominio cerrado. Modulo de datos, puro. |
| `lib/analytics/invalidacion-financiera.ts` | La UNICA funcion que los escritores en request llaman: `invalidarAnaliticaFinanciera(cache, origen)`. Sin Next, sin Prisma. Su cabecera declara la desviacion de R11 de la 128 (D4). |
| `lib/analytics/escritores-ledger.ts` | **El registro declarado** del censo de R17/R18: escritor → invalidador → test. Modulo de datos, puro. |
| `tests/unit/analytics/ledger-escritores.guardia.test.ts` | El censo (R17/R18/R19). **Sobrevive al merge.** |
| `tests/unit/analytics/cache-financiera-politica.guardia.test.ts` | El cuadre politica ↔ catalogo, por exceso y por defecto (R28/D3). **Sobrevive al merge.** |
| `tests/unit/analytics/cache-financiera-json.guardia.test.ts` | El guardia de JSON-safety (R3). **Sobrevive al merge.** |
| `tests/unit/analytics/cache-financiera-frontera.guardia.test.ts` | Frontera de archivos (R25). **Branch-scoped: se retira en este mismo PR.** |
| los diez `tests/unit/analytics/cache-financiera-*.test.ts` de R1–R5, R8, R9–R15, R16, R20, R22, R24 | ver `requirements.md` |

### Existentes que se modifican — cada uno con su justificacion

| archivo | de quien es | que se cambia y por que |
|---|---|---|
| `lib/actions/analitica-financiera.ts` | 127 | **Solo `construirServicio` (`:65-74`)**: envuelve el servicio con el decorador y le pasa el puerto de cache. `consultarMetricaFinanciera` no cambia (R20). Es el unico sitio del arbol donde se cablea ese servicio. |
| `lib/analytics/cache-tags.ts` | 128 | Se anade `TAG_FINANCIERA`/`TAGS_FINANCIERA` derivados de `tagDeDominio("financiera")`. **Aqui y no en un archivo nuevo**: R20 de la 128 exige que los tags salgan del catalogo y que **una sola lista** la consuman el que escribe y el que invalida. Dos modulos de tags es exactamente como se desalinean. |
| `lib/interfaces/external/IAnaliticaCache.ts` | 128 | Se amplia el dominio CERRADO `OrigenInvalidacion` (`:17`) con un origen por escritor (R24). El tipo sigue cerrado: nada de `string`. |
| `lib/services/WalletEgresoService.ts` | 45 | Recibe `IAnaliticaCache` por constructor; invalida tras cada `crearMovimientos` confirmado (R9). Cero cambios de aritmetica. |
| `lib/services/WalletService.ts` | 42 | Idem, en `registrarMovimientoManual` (R10). |
| `lib/services/LiquidacionService.ts` | 172 | Idem, tras cada `$transaction` que confirma (R11). |
| `lib/services/GeneracionGastosFijosService.ts` | 45/84 | Idem, solo si `egresosGenerados > 0` (R12). |
| `lib/services/IncidenteAdminService.ts` | 158/184 | Idem, solo en la rama `aprobado` que emitio egreso (R13). **En el servicio, no en `IncidenteAdminRepository`**: ver §5.2. |
| `lib/services/CierresAdminService.ts` | 38/158 | Idem, tras `aprobarCierre` (`:421`) confirmado (R14). |
| `lib/services/CierresBodegaAdminService.ts` | 78 | Idem, tras `aprobarCierreBodega` (`:289`) confirmado (R15). |
| `lib/actions/{wallet,wallet-egresos,liquidacion,incidentes,cierres-admin,cierre-bodega}.ts` + `app/api/cron/generar-gastos-fijos/route.ts` | varias | **Solo el composition root** (`buildService`): pasar `crearAnaliticaCacheDeNext()`. Ni una linea de logica. |
| `tests/unit/analytics/cache-tags.guardia.test.ts` | 128 | Se amplia el ambito al literal `analitica:financiera` (R6). |
| `lib/services/jobs/analitica-invalidacion-cache-handler.ts` | 128 | **D2 — la ampliacion de frontera que la decision autoriza, escrita ANTES de tocarla.** Hoy son cuatro lineas que invalidan `TAGS_OPERATIVA` fijo e **ignoran el payload** (`:24-28`). Pasa a leer `dominio` del payload y a invalidar el tag de ESE dominio, **con `operativa` como default explicito**: los jobs que la 128 ya encola no llevan `dominio`, y sin el default dejarian de invalidar. Esa compatibilidad es R27, con su mutacion y su test de la 128 sin modificar. Es el archivo mas barato del arbol para hacer esto: no tiene ramas, no tiene estado y su unica alternativa era una migracion (D2(b), descartada). |
| `lib/services/jobs/analitica-invalidacion-encolado.ts` | 128 | La `dedupeKey` pasa a incluir el dominio: sin eso, una corrida del backfill operativo y una del de tesoreria en el mismo instante se deduplicarian entre si y una de las dos invalidaciones **desapareceria en silencio** (`ON CONFLICT (dedupe_key) DO NOTHING`). |
| `scripts/backfill-caja-tesoreria.ts` | 173 | **D2/R26** — al cerrar una corrida en modo `aplicar` con al menos una fila insertada, encola el job. Entra por las deps que el script ya inyecta, no como import duro; el script **no** importa `next/cache` (R21). |
| `tests/unit/analytics/cache-config.guardia.test.ts` | 128 | Se amplia el ambito del censo del TTL a los archivos nuevos (R23). |

### Se BORRA

| archivo | por que |
|---|---|
| `tests/unit/analytics/cache-financiera.guardia.test.ts` | El guardia R15/D2 de la 128. **Se retira en este mismo PR y en ningun otro**: ver §7. |

### Lo que NO se toca, y se declara

`lib/services/AnaliticaFinancieraService.ts` (ni una suma), los cuatro repositorios financieros,
`lib/analytics/metrics.ts` (se **consume** `tagDeDominio`), `lib/analytics/cache-clave.ts` (se
**compone**, no se edita), `lib/repositories/CachedAnaliticaOperativaRollupRepository.ts`,
`lib/cache/next-analitica-cache.ts`, `lib/cache/cache-codec.ts`, `lib/config/analitica-cache.ts`,
los tres repositorios de ledger, `next.config.ts`, **el esquema de Prisma y `db/migrations/`** (D2 =
(a) no necesita DDL: el valor `analitica_invalidacion_cache` del enum `job_tipo` ya existe desde la
128), `app/api/cron/procesar-jobs/route.ts` (el tipo ya esta registrado en `buildHandlers` y **no**
en `buildRecurrencias`; sigue igual) y `CajaBackfillTesoreriaService` (el que encola es el script,
no el servicio: el servicio no conoce jobs).

---

## 3. Donde se cachea: un decorador del SERVICIO

```
consultarMetricaFinanciera                      (127, sin cambios de firma — R20)
  └─ IAnaliticaFinancieraService
       ├─ CachedAnaliticaFinancieraService      (179)  ← el punto de corte
       │     └─ AnaliticaFinancieraService      (127, sin cambios)
       │           └─ los CUATRO repositorios   (127/180/187, sin cambios)
       └─ (bandera apagada) el servicio DESNUDO (R22)
```

El decorador implementa `consultar(consulta)` completo:

0. Consulta la **politica de la metrica** (§4bis). Si no es `cacheable` —hoy solo
   `conciliacion_cierres`, por `alerta_por_consulta`— **delega sin tocar la cache** (R28/D3).
1. Si la bandera esta apagada, delega (R22).
2. Calcula `claveFinanciera(consulta)` (§4).
3. `cache.envolver(clave, TAGS_FINANCIERA, () => interno.consultar(consulta))`, guardando **solo**
   el `datos` de un `status: "ok"` (R4).
4. Devuelve el DTO tal cual, sin codec (§1.3) y sin tocar un solo campo (R1).

**Por que el servicio y no otra capa:**

- **Se cachea exactamente lo que cuesta.** Una metrica financiera son entre dos y tres consultas de
  agregacion sobre los ledgers, algunas dentro de una lectura consistente
  (`AnaliticaFinancieraService.ts:329`, `:401`, `:563`). Es el trabajo caro entero, en una entrada.
- **La entrada de la clave ya esta preparada y recortada.** El decorador recibe la misma
  `ConsultaAnalitica` que el servicio, con alcance resuelto y filtro recortado por la 122. No puede
  cachear algo que el permiso no concedio: `prepararConsultaAnalitica` ya decidio.
- **No hay seudonimizacion que cachear.** A diferencia de la operativa, el dominio financiero no
  publica ids de persona (`FilaFinanciera.cubo` es tienda o metodo, nunca mensajero), asi que no
  existe el riesgo que en la 128 obligo a bajar el corte al repositorio.
- **No hay «dia en curso» que proteger por construccion, y hay que saberlo.** En la operativa el
  intradia se sirve de otro repositorio que nadie decora (R3 de la 128). **Aqui todo es vivo**: no
  hay tabla de rollup, la financiera lee los ledgers directamente. Por eso la correccion de esta
  feature descansa ENTERA sobre la invalidacion, y por eso el censo (R17) es el corazon del diseño y
  no un adorno.

---

## 4. La clave

```ts
// lib/analytics/cache-clave-financiera.ts  (puro: sin Next, sin Prisma, sin process.env)
import { claveDeConsulta } from "@/lib/analytics/cache-clave";   // 128, NO se edita
export function claveFinanciera(c: ConsultaAnalitica): string;   // `fin\u001f` + claveDeConsulta(c, [])
```

Se **reusa** `claveDeConsulta` (128) en vez de escribir una segunda: ya incluye metrica, rango
resuelto, alcance con su id y filtro normalizado, que es exactamente lo que R5 pide, y ya tiene sus
tests y su guardia de exhaustividad de `AlcanceDatos`
(`tests/unit/analytics/cache-clave-alcance.guardia.test.ts`). Una segunda definicion de la clave
seria una segunda definicion de «que consultas son la misma», y esas divergen sin que nada falle.

`granos = []` porque el dominio financiero no tiene desagregacion pedida por el consumidor: el
grano de cada vista lo fija el catalogo.

**El prefijo de dominio no es cosmetico.** Hoy los ids de metrica no se repiten entre dominios, asi
que una colision seria imposible; pero apoyarse en eso es apoyarse en una propiedad del catalogo
(feature 135) para sostener la separacion entre una entrada que guarda `CuboRollup[]` y otra que
guarda un `ResultadoFinanciero`. Si algun dia coincidieran, el fallo seria un DTO con la forma
equivocada servido desde cache. El prefijo cuesta seis caracteres.

---

## 4bis. La politica por metrica (D3): excluir no puede parecerse a olvidar

```ts
// lib/analytics/cache-politica-financiera.ts  (modulo de datos, puro)
export type CausaNoCacheable = "alerta_por_consulta";           // dominio CERRADO
export type PoliticaCache = { cacheable: true } | { cacheable: false; causa: CausaNoCacheable };
export const POLITICA_CACHE_FINANCIERA: Readonly<Record<string, PoliticaCache>>;
```

**La pregunta que esto responde es la del coordinador: si mañana alguien anade una metrica
financiera y no la cachea, ¿el censo lo distingue de la exclusion deliberada de hoy?**

- Con una **lista de exclusiones**, **no**: la metrica nueva **se cachearia por defecto** y nadie se
  entera. Si fuera —como esta— una cuya razon de ser es la alerta, cachearla la apaga en silencio.
- Con un **allowlist** a secas, **tampoco**: la metrica nueva **no se cachearia** y nadie se entera
  tampoco; «excluida a proposito» y «se me olvido meterla» serian el mismo estado del archivo.
- Con la **politica exhaustiva**, las dos omisiones son imposibles: **la ausencia de decision es
  roja** (R28, cuadre por defecto) y la exclusion deliberada es **un valor escrito con su causa**.

Las claves son `string` y el cuadre lo hace un **test contra el catalogo, por exceso y por
defecto** — no un `Record<MetricaFinancieraId, …>`, que dejaria la comprobacion en manos del
compilador. Es literalmente el criterio que la 127 dejo escrito para el despacho de metricas
(`lib/services/AnaliticaFinancieraService.ts:70-75`): *«con el mapa abierto, las dos direcciones se
miden de verdad en vez de depender de que alguien lea el error del compilador»*. Se reusa el
precedente en vez de inventar otro.

`causa` es un dominio **cerrado** y no texto libre: con texto libre, la proxima exclusion diria «no
procede» y dejaria de poder distinguirse de esta.

**Limite honesto de este mecanismo, declarado.** El guardia obliga a **declarar** una politica; no
puede juzgar si la politica declarada es la **correcta**. Alguien puede declarar `cacheable: true`
para una metrica futura que emita alertas y el guardia lo aceptara. Lo que si esta cubierto es el
caso concreto de hoy: el segundo test de R28 mide que `conciliacion_cierres` **consulta la base y
emite en cada consulta**, asi que un «ya que estamos, cacheemos tambien esta» se pone rojo sobre el
comportamiento, no sobre la declaracion. Para las metricas futuras, lo que queda es que **la
decision sea consciente y este escrita**, que es todo lo que un guardia estatico puede comprar.

---

## 5. Los invalidadores

### 5.1 Un solo punto de llamada

```ts
// lib/analytics/invalidacion-financiera.ts
export async function invalidarAnaliticaFinanciera(
  cache: IAnaliticaCache,
  origen: OrigenInvalidacion,
): Promise<void>;   // llama a cache.invalidar(origen, TAGS_FINANCIERA)
```

Los siete escritores llaman a **esta** funcion y a ninguna otra. Ninguno conoce el tag, ninguno
importa `next/cache` (R21), ninguno decide granularidad. Un escritor no puede invalidar «casi
bien».

### 5.2 Donde se engancha cada uno, y por que ahi

| escritor | punto de enganche | por que ahi |
|---|---|---|
| `WalletEgresoService` (R9) | el propio servicio, tras `crearMovimientos` | es quien posee el cliente de escritura (`:36`); cada llamada es su propia transaccion implicita |
| `WalletService.registrarMovimientoManual` (R10) | el propio servicio | idem |
| `LiquidacionService` (R11) | el servicio, **tras** cada `$transaction` que resuelve | las escrituras viven dentro de `tx` (`:225`, `:322`, `:549`, `:565`); invalidar dentro violaria R8 |
| `GeneracionGastosFijosService` (R12) | el servicio, tras `ejecutarGeneracion`, si `egresosGenerados > 0` | el route handler ya corre en un request |
| indemnizacion de incidente (R13) | **`IncidenteAdminService`**, tras `resolver` → `"updated"` con egreso | la escritura esta en `IncidenteAdminRepository.ts:327`, dentro de su `$transaction`; un repositorio no debe conocer la cache (arquitectura: acceso a datos y nada mas) **y** invalidar ahi seria antes del commit (R8) |
| `aprobarCierre` (R14) | `CierresAdminService.aprobarCierre` (`:421`) | mismo motivo: la escritura esta en `CierresAdminRepository.ts:665-725`, dentro de su tx |
| `aprobarCierreBodega` (R15) | `CierresBodegaAdminService.aprobarCierreBodega` (`:289`) | idem, y es un servicio DISTINTO del anterior: por eso son dos requisitos y dos tests |
| backfill de tesoreria (R26/R27) | **el script ENCOLA; el handler del job invalida** (§5.4) | unico escritor fuera de un request de Next: `revalidateTag` lanza ahi |

**La regla, en una frase:** invalida **la pieza que posee la transaccion**, justo despues de que
confirme. Ni el repositorio (demasiado abajo: dentro de la tx) ni la Server Action (demasiado
arriba: un servicio llamado desde otro sitio se escaparia).

### 5.3 El registro de origen (R24)

`OrigenInvalidacion` (`lib/interfaces/external/IAnaliticaCache.ts:17`) pasa de tres a diez valores,
uno por escritor. Sigue siendo un dominio cerrado: es la unica senal que distingue «la cifra no
cambio porque no hubo movimiento» de «la cifra no cambio porque el invalidador de los cierres de
bodega no llego». Con un origen unico para los ocho, esa senal no existe.

### 5.4 El octavo escritor: el backfill de tesoreria, por la cola de jobs (D2)

`revalidateTag` **lanza** fuera de un request (`revalidate.js:104-107`) y
`scripts/backfill-caja-tesoreria.ts` es un proceso `tsx`. El camino esta calcado del que la 128 ya
tiene probado para su propio backfill (`design.md §7.1` de la 128):

1. El script, al cerrar una corrida en modo `aplicar` **con al menos una fila insertada**, encola un
   job `analitica_invalidacion_cache` con payload `{ dominio: "financiera" }` (R26).
2. `app/api/cron/procesar-jobs` corre `* * * * *`: la invalidacion llega en menos de un minuto,
   dentro de un request, con reintentos, backoff y dead-letter gratis.
3. El handler lee `dominio` del payload e invalida el tag de ESE dominio, **con `operativa` como
   default explicito** (R27).

**Dos detalles que no son adorno:**

- **El default no es cortesia: es compatibilidad medida.** Los jobs que la 128 encola desde
  `scripts/backfill-analitica.ts` llevan payload `{ desde, hasta }` y **no** llevan `dominio`. Sin
  el default, esos jobs dejarian de invalidar la cache operativa y **nada fallaria**: la cifra
  recomputada se quedaria invisible hasta el TTL. Por eso R27 lo exige con el test de la 128, sin
  modificar, como testigo.
- **La `dedupeKey` incorpora el dominio.** `enqueue` hace `ON CONFLICT (dedupe_key) DO NOTHING`: si
  la clave no distinguiera el dominio, una corrida del backfill operativo y otra del de tesoreria en
  la misma ventana se deduplicarian **entre si** y una de las dos invalidaciones desapareceria sin
  senal. Es el mismo modo de fallo silencioso que esta feature persigue, escondido en una clave.

**Aqui R11 de la 128 SI aplica tal cual:** el llamador vuelve a ser un job idempotente con backoff,
asi que una invalidacion fallida DEBE hacer fallar el job. La desviacion de D4 vale **solo** para
los siete escritores en request. Las dos reglas conviven porque la diferencia esta escrita, en R16 y
aqui.

---

## 6. El censo (R17/R18): por que un censo y no una lista

La ficha traia cinco nombres. El arbol tiene ocho puntos de escritura. **La lista ya estaba
desactualizada antes de que nadie escribiera codigo** — no por descuido: porque una lista de rutas
en prosa no la actualiza nadie cuando aparece un servicio nuevo.

`tests/unit/analytics/ledger-escritores.guardia.test.ts` compara, en cada corrida:

```
CENSO (leido del arbol)                        REGISTRO (declarado en lib/analytics/escritores-ledger.ts)
─────────────────────────────────────────      ──────────────────────────────────────────────────────────
eje 1: archivos con escritura cruda de las      ⊆ {los tres repositorios de ledger}
       tres tablas
eje 2: archivos que llaman a                    ==  las claves del registro
       .crearMovimientos(                           (cuadre en LAS DOS direcciones)
                                                cada entrada nombra un test que EXISTE (R18)
```

Un servicio nuevo que mueva dinero aparece en el eje 2 el dia que se escribe y pone el guardia rojo
con un mensaje que dice que hacer. **No hace falta que nadie se acuerde de esta feature.** Un
escritor retirado tambien lo pone rojo, por el lado contrario, para que el registro no acumule
entradas muertas.

El mensaje de fallo enumera los escritores y el motivo, con el mismo criterio que la cabecera del
guardia de D2 que sustituye: un guardia que solo dice «rojo» se desarma a la primera.

---

## 7. Plan de retirada del guardia R15 (**D2 de la 128**) — la parte que no admite dos PR

> ⚠ Desambiguacion, porque las dos specs usan la misma etiqueta: **«D2» a secas en esta seccion es
> la decision D2 **de la 128** (no cachear dinero). La D2 **de esta feature** es la del backfill por
> job (§5.4) y no tiene nada que ver con el guardia.

**Que hay hoy, con su ruta y su linea.** `tests/unit/analytics/cache-financiera.guardia.test.ts`.
Censa `lib/`, `app/` y `scripts/` (`:36`, `AMBITO`) buscando archivos que a la vez nombren una de
las cinco piezas financieras (`:40-46`, `PIEZAS_FINANCIERAS`) y una de las seis formas de meter algo
en la cache (`:49-56`, `DECORA_CON_CACHE`: `IAnaliticaCache`, `NextAnaliticaCache`,
`crearAnaliticaCacheDeNext`, `decorarRollupConCache`, `.envolver(`, `unstable_cache`). La asercion
es `toEqual([])` en `:94-103`, y su mensaje de fallo enumera los cinco escritores y dice
textualmente que **el PR que los engancha es el que retira este guardia**.

**Que pasa si no se retira.** `lib/services/CachedAnaliticaFinancieraService.ts` nombra
`AnaliticaFinancieraService` y llama a `.envolver(` → infractor → rojo. Es decir: **el guardia no se
puede ignorar**; o se retira en esta tanda o la feature no compila el gate.

**Que pasa si se retira sin lo demas.** Nada, y eso es el problema: el arbol se queda sin ninguna
proteccion y cualquiera puede cachear dinero con un solo invalidador. Por eso **R19 lo prohibe con
un test que mira las dos cosas a la vez**: `cache-financiera.guardia.test.ts` NO debe existir y
`ledger-escritores.guardia.test.ts` SI. Las dos mutaciones posibles (retirar sin sustituir; dejar
los dos) ponen rojo.

**Que NO cambia con las respuestas de T0.** Ni D2 ni D3 ni D4 de esta feature mueven este plan, y
conviene decirlo porque una de ellas lo roza: **el trabajo del backfill (§5.4) NO dispara el guardia
de D2 de la 128** —el handler y el script nombran tags y jobs, no `AnaliticaFinancieraService` ni
sus repositorios—, asi que tecnicamente podria aterrizar por separado. **No se hace.** Encolar
invalidaciones para una cache que no existe es codigo muerto, y partir la tanda multiplica la
posibilidad de que la mitad que retira el guardia llegue sin la mitad que invalida. D3 tampoco lo
cambia: excluir `conciliacion_cierres` no reduce el numero de escritores que hay que enganchar,
porque las otras siete metricas leen los tres ledgers igual.

**Orden exacto dentro del PR** (ver `tasks.md`): el borrado del guardia de D2 (128) es **la ultima
task antes del gate completo**, y su criterio de «hecho» exige que las **ocho** tasks de escritor
—las siete en request mas el backfill por job— ya esten verdes. No es ceremonia: es lo unico que
impide que una tanda a medias quede mergeada con el agujero abierto.

**Constancia.** La cabecera del censo nuevo cita a D2 de la 128 y a este documento, para que el
siguiente que lo lea sepa que no es un guardia mas: es el heredero de una decision.

---

## 8. Contratos de entrada/salida

```ts
// lib/services/CachedAnaliticaFinancieraService.ts
export class CachedAnaliticaFinancieraService implements IAnaliticaFinancieraService {
  constructor(interno: IAnaliticaFinancieraService, cache: IAnaliticaCache);
  consultar(consulta: ConsultaAnalitica): Promise<ResultadoConsultaFinanciera>;
}
export function decorarFinancieraConCache(
  interno: IAnaliticaFinancieraService,
  cache: IAnaliticaCache,
  env?: Readonly<Record<string, string | undefined>>,   // R22, patron de `decorarRollupConCache`
): IAnaliticaFinancieraService;
```

- **Ningun DTO cambia** (R1/R20): `RespuestaFinanciera`, `ResultadoFinanciero`, `VistaFinanciera`,
  `ImporteAnalitico` quedan **byte a byte** como estan. La 132/133/134 no se enteran.
- **`IAnaliticaCache` no cambia de forma** (`envolver` / `invalidar`); solo se amplia el dominio
  cerrado `OrigenInvalidacion`.
- Los escritores reciben `IAnaliticaCache` como **ultimo parametro de constructor con default**
  (`cacheNula()`), para no romper sus suites unitarias existentes ni sus composition roots que no
  invalidan. Patron ya usado en el repo (`analitica-rollup-diario-handler.ts:25`).

- El **payload** del job de invalidacion pasa a ser `{ desde?, hasta?, dominio?: "operativa" |
  "financiera" }`, con `dominio` **opcional** y default `operativa` (R27). Opcional y no requerido
  a proposito: los jobs que la 128 ya encola no lo llevan y tienen que seguir funcionando.

## 9. Modelo de datos, RLS y migraciones

**Ninguna migracion, ninguna tabla, ninguna RLS. Esta feature no toca el esquema** — y eso es
consecuencia directa de **D2 = (a)**: el valor `analitica_invalidacion_cache` del enum `job_tipo` ya
existe desde la 128 (`db/migrations/…_job_tipo_analitica_invalidacion_cache/`), asi que reusarlo con
un campo mas en el payload JSON no necesita DDL. La alternativa D2(b) —un tipo de job propio— habria
costado un `ALTER TYPE` solo en su carpeta (55P04) con su `down.sql` recreando el tipo con los
valores previos en orden; se descarto porque es cambio de esquema por comodidad de frontera.

---

## 10. Alternativas descartadas

1. **Decorar los CUATRO repositorios financieros en vez del servicio.** Es lo que hizo la 128 con el
   rollup, asi que era el candidato natural. **Descartada con dato:** tres de los cuatro exponen
   `enLecturaConsistente<T>(fn: (repo) => Promise<T>): Promise<T>`
   (`IIngresosAnaliticaRepository.ts:153`, `ICuentasPorPagarAnaliticaRepository.ts:156`), un metodo
   que recibe una **funcion arbitraria** y abre una transaccion. Eso no se puede cachear: la clave
   tendria que derivarse del cuerpo del callback. Ademas serian mas de diez metodos decorados y la
   feature 187 (lectura consistente) dejaria de significar lo que significa —dos consultas bajo un
   mismo snapshot— si una de las dos viniera de cache y la otra de la base. **El punto de corte del
   servicio preserva la invariante R12 de la 180 (Σ filas == total) porque cachea las dos cifras
   juntas o ninguna.**
2. **Cachear en la Server Action `consultarMetricaFinanciera`.** **Descartada:** la accion maneja
   tambien `validation_error` y `forbidden`, y una clave mal construida cachearia una respuesta de
   permiso. El servicio recibe una consulta **ya autorizada y recortada**: ahi no existe la
   posibilidad de cachear un 403.
3. **Invalidar dentro de `crearMovimientos`, en los tres repositorios.** Es tentador: tres lineas y
   ningun escritor puede escaparse. **Descartada por correccion, no por gusto:** ese metodo corre
   **dentro** de la transaccion del llamador (`LiquidacionService.ts:225`, `CierresAdminRepository.
   ts:665`, `IncidenteAdminRepository.ts:327`). Invalidar antes del commit abre una ventana en la
   que una lectura concurrente repuebla la cache con el estado ANTERIOR y esa entrada vive el TTL
   entero — R8. Ademas mete un puerto de infraestructura en la capa de acceso a datos. **Lo que esa
   alternativa buscaba —que nadie se escape— lo da el censo de R17 sin pagar la ventana.**
4. **Una lista de escritores en prosa, como pedia la ficha.** **Descartada con evidencia:** la lista
   de la ficha ya se habia quedado corta (§1.2) antes de escribir una linea de codigo. Un censo del
   arbol se actualiza solo; una lista la actualiza quien se acuerde.
5. **Solo TTL, sin invalidacion** (bajar el TTL a 60 s y no tocar ningun escritor). **Descartada:**
   es «servir dinero rancio, pero menos rato», que es exactamente lo que D2 rechazo; y multiplica
   por sesenta el recomputo sin garantizar nada. El TTL se queda como red de seguridad (R23), no
   como mecanismo.
6. **Un tag por ledger o por metrica** (invalidacion fina). **Descartada como recomendacion** por el
   mismo dato que D3 de la 128 y por uno propio: un cierre aprobado toca los tres ledgers y seis de
   las ocho metricas, asi que el mapa ledger→metrica seria una tabla escrita a mano cuyo error **no
   falla, sirve la cifra vieja**. **Cerrada en D1 = (a)** (humano, 2026-08-10).
8. **Una lista de exclusiones de cache** en vez de una politica exhaustiva por metrica.
   **Descartada:** haria que una metrica financiera futura se cachease **por defecto**, y si esa
   metrica valiera por su alerta —como `conciliacion_cierres`— cachearla la apagaria en silencio.
   El allowlist simetrico tiene el defecto contrario. La politica exhaustiva es la unica de las tres
   en la que **no decidir es rojo** (§4bis, D3).
9. **Propagar el fallo de invalidacion al usuario, como R11 de la 128.** **Descartada en D4 = (a)**
   con su motivo escrito: alli el llamador era un job idempotente con backoff; aqui es una accion de
   usuario sobre dinero **ya confirmado**, y fallar no reintenta nada, solo miente sobre lo que
   ocurrio. La desviacion se declara en R16 y en la cabecera del modulo de invalidacion, para que no
   quede como una contradiccion silenciosa entre dos specs.
10. **Encolar un job de reintento por cada invalidacion fallida** (D4(b)). **Descartada por ahora:**
   añade un job por cada escritura de dinero —el volumen mas alto del sistema— para cubrir un fallo
   que no se ha observado nunca. Si el registro de R24 llegara a mostrar invalidaciones fallidas en
   produccion, esta es la salida documentada.
7. **Activar `cacheComponents` y usar `"use cache"` / `cacheTag`.** **Descartada, heredada:** D1 de
   la 128, con su ruta (`cache-tag.js:15`) y su motivo (bandera global, ningun gate corre
   `next build`).

---

## 11. Verificacion: como se demuestra que la invalidacion funciona

**Un test que espia `revalidateTag` no prueba nada**: prueba que alguien escribio la llamada. La
prueba de esta feature es el **patron de cinco pasos** de la 128 (`design.md §11`), y su asercion es
siempre sobre el **dato servido**:

```
1. consultar                       -> V1     (repositorios financieros llamados 1 vez)
2. mover dinero por el ESCRITOR REAL de produccion
3. consultar                       -> V1     ← si esto fallara, la cache no cachea y el resto es vacuo
4. (el paso 2 ya invalido, si el escritor esta bien enganchado)
5. consultar                       -> V2     ← si devuelve V1, la invalidacion de ESE escritor no llego
```

El puerto se instancia con una **cache falsa con semantica de tags real** (entradas indexadas por
tag; `invalidar(tags)` borra las que los llevan), no con un mock que cuente llamadas. Con esa pieza,
los pasos 3 y 5 son afirmaciones sobre cifras de dinero.

Los siete escritores en request corren **sin runtime de Next y sin `DATABASE_URL`**: sus
repositorios entran por interfaz y el puerto de cache tambien. El octavo (§5.4) se prueba con el
**drenado real del job** encolado por el script, misma forma de cinco pasos, mismo criterio que R14
de la 128. La unica pulgada no cubierta sigue siendo
`lib/cache/next-analitica-cache.ts` (limite ya declarado por la 128, §11), que esta feature **no
toca**.

Mapa completo `R<n> → test` en `requirements.md`; el implementer lo replica en
`progress/impl_179-analitica-cache-financiera.md`.

---

## 12. Impacto sobre las features vivas

- **127 / 180 / 183 / 187 (`AnaliticaFinancieraService`):** impacto **cero de contrato y cero de
  calculo**. No se toca el archivo. Lo unico que cambia es que su resultado puede venir de una
  entrada previa. La lectura consistente de la 187 sigue intacta porque el corte esta por encima de
  ella (§10, alternativa 1).
- **132 / 133 / 134 (tableros y descarga financiera):** impacto cero (R20). Lo que deben saber: un
  DTO puede tener hasta una hora de antiguedad **solo si un invalidador no llego**; en operacion
  normal, cualquier movimiento de dinero lo tira.
- **128:** se le amplian cinco archivos (tags, puerto de origenes, dos guardias y —por D2— el
  handler y el encolado del job de invalidacion) y **se le retira el guardia de su R15**, que es el
  proposito de esta ficha. Su cache operativa, su clave, su codec y su decorador no se tocan; su job
  gana un campo de payload **opcional con default**, y su propio test de invalidacion por backfill
  queda **sin modificar** como testigo de que sigue funcionando (R27).
- **42 / 44 / 45 / 84 / 158 / 172 / 173 / 184 (los escritores):** ganan un parametro de constructor
  con default y una llamada tras confirmar. **Ni una linea de aritmetica de dinero cambia** (R25).

## 13. Riesgos abiertos

- **La correccion descansa entera sobre la invalidacion.** A diferencia de la operativa, aqui no hay
  rollup ni «dia en curso» protegido por construccion: todo lo que se cachea es vivo (§3). Si un
  escritor no invalida, el tablero miente hasta una hora. Mitigacion: el censo de R17, que es el
  unico mecanismo que no depende de que alguien se acuerde.
- **El TTL (3600 s) sigue sin medicion detras** (D4 de la 128). Aqui su papel es mas importante que
  alla —es la cota del daño de un invalidador que no llegue sobre **dinero**—, y sigue siendo un
  numero elegido por prudencia. Declarado, no resuelto.
- **D4 deja vivo, a proposito, un fallo de invalidacion que no corta la operacion.** El daño se
  acota por TTL (una hora) y queda **con senal** (R16/R24); **no queda eliminado**. La salida
  documentada, si el registro llegara a mostrar fallos reales, es D4(b) (§10, alternativa 10).
- **El octavo escritor (D2) invalida con retraso, no al instante:** el job se drena en menos de un
  minuto. Es una ventana conocida, acotada y con reintentos, frente al agujero de una hora que
  dejaba la alternativa de no engancharlo.
- **El guardia de politica (D3) obliga a declarar, no a acertar.** Puede impedir el olvido; no puede
  juzgar si una metrica futura declarada `cacheable` deberia haberlo sido. Limite declarado en
  §4bis, con lo que si esta cubierto: el comportamiento de `conciliacion_cierres` hoy.
- **`./init.sh` puede venir rojo de `dev` por deuda heredada.** El criterio de esta feature es
  **delta 0** medido en `C:/w179` ANTES de tocar nada; nunca el baseline de la bitacora.
