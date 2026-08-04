# 128 — analitica: cache + invalidacion por tag · requirements

> Zona: backend. `depends_on: 127`. Rama `feature/128-analitica-cache-invalidacion`.
>
> **Lo que esta feature compra:** dejar de pagar un `GROUP BY` sobre `analytics_daily` en cada
> request del tablero, **sin** servir cifras rancias.
>
> **La doctrina que la gobierna (heredada, no inventada aqui).** `specs/124/design.md §13`, aviso
> dirigido a la 128, y `specs/124/requirements.md` R49 + D7: el rollup de un dia pasado es
> reproducible **solo** en la dimension `estatus_id`. `zona_id`, `tienda_id` y `mensajero_id` se
> leen de la orden en el corte y cambian despues; y por D7 una orden borrada (`deleted_at`)
> **desaparece** de un dia en que existio y conto — eso no es una coordenada que cambia, es la
> pertenencia al conjunto de filas. **Consecuencia directa para esta feature: la cache de un dia
> pasado es valida porque NADIE recomputa, no porque el dato sea reproducible.** Por eso el
> backfill de la 125 es un **invalidador de primera clase** (R12/R13/R14) y no una nota al pie: en
> cuanto alguien recomputa un rango, la cifra cacheada queda vieja y **nada falla** — el numero
> simplemente se queda quieto.

**Como se leen las mutaciones.** Un requisito no esta cubierto porque exista un test verde: esta
cubierto porque **romper la implementacion de esa forma concreta pone rojo el test nombrado**. Cada
`R<n>` lleva su mutacion escrita. Sin mutacion, el requisito no vale.

---

## T0 — PUERTA CERRADA (D1–D5)

> Las cinco las respondio el **humano** el 2026-08-03, despues de verificar por su cuenta los tres
> hallazgos de inventario que las motivaban. Se conservan aqui con su respuesta y su propagacion,
> con el mismo criterio que la 124: *un gate aprobado en la bitacora no es lo mismo que las
> preguntas del spec respondidas por escrito*. Las opciones descartadas y su coste siguen en
> `design.md §10`. **No queda ninguna pregunta abierta.**

### D1 (humano) — **(a): `unstable_cache({ tags })` + `revalidateTag`. NO se toca `next.config.ts`.**

**El nombre de la ficha —«`cacheTag` por dominio»— describe una API que hoy es INUTILIZABLE en este
repo, y queda escrito aqui para que nadie lo lea despues como un incumplimiento.** `cacheTag()`
lanza en ejecucion *«`cacheTag()` is only available with the `cacheComponents` config»*
(`node_modules/next/dist/server/use-cache/cache-tag.js:15`), y `next.config.ts` de este repo **no**
activa `cacheComponents`: su bloque `experimental` contiene unicamente
`serverActions.bodySizeLimit`. Activarla es una bandera **global** que cambia el modelo de
renderizado de toda la aplicacion —rutas, layouts y Server Components ajenos a analitica— y
**ningun gate de este repo corre `next build`** (`pnpm build` encadena `migrate deploy` contra una
base real, asi que no se ejecuta): esa regresion no la veria nadie hasta produccion. Cambia el
**mecanismo**, no el objetivo: sigue habiendo un tag por dominio y sigue habiendo invalidacion
explicita por tag.

Propagado a **R2, R9, R17, R21**, a `design.md §3` y a la alternativa 1 de `design.md §10`.

### D2 (humano) — **(a): el dominio financiera NO se cachea, y R15 lo prohibe CON GUARDIA.**

El guardia **sobrevive al merge** (no mide diff contra `dev`) y su cabecera declara **por que**: los
tres ledgers que alimentan la analitica financiera —`wallet_movimiento`,
`wallet_tienda_movimiento`, `pago_mensajero_movimiento`— los escriben, ademas de la aprobacion de
cierres, al menos `WalletEgresoService`, `LiquidacionService`, `GeneracionGastosFijosService` (cron
diario) y el flujo de indemnizaciones de incidentes. Cachear dinero con **solo** la aprobacion de
cierres como invalidador —que es lo que la ficha de la 128 pedia— seria servir cifras rancias **en
silencio**.

**Enganchar esos escritores es OTRA FEATURE, no un apendice de esta**: nombre y descripcion
propuestos en `design.md §14`.

Propagado a **R15**, a `design.md §7` y a la alternativa 7 de `design.md §10`.

### D3 (humano, con el dato del inventario) — **(a): UN tag por dominio.**

**El limite que lo decide, con su ruta, porque es el tipo de dato que el siguiente redescubre a base
de golpes:** Next admite **128 tags como maximo por entrada** y **256 caracteres por tag**
(`node_modules/next/dist/lib/constants.js:280-281`), y el filtro de la 135 permite rangos de hasta
`RANGO_TOPE_DIAS = 366` dias. **Un tag por fecha es imposible** en cualquier consulta de mas de
cuatro meses y —lo decisivo— **fallaria en silencio**: no hay excepcion, se pierden tags y la
invalidacion deja de alcanzar entradas que cree alcanzar. La granularidad intermedia viable (por
mes, ≤13 tags) se descarta por simplicidad: invalidar de mas cuesta **recomputo**, no correccion.

Propagado a **R10, R14, R20** y a `design.md §6`.

### D4 (humano) — **TTL = 3600 s. Red de seguridad, NO mecanismo.**

Quien hace el trabajo es la invalidacion explicita (R10/R12/R14); el TTL solo acota el daño de un
invalidador que no llegue. Vive en **UNA sola constante** marcada *«provisional y no medida»*, mismo
criterio que el umbral de volumen de la 124 (R47) y que `UMBRAL_AVISO_DESCUADRE_CONCILIACION` de la
127.

**⚠ Colision del literal, COMPROBADA ANTES DE FIJARLO** (leccion de la 125: un guardia que recorre
el arbol buscando numeros sueltos se pone rojo por un literal ajeno). El valor `3600` **ya aparece
cuatro veces** en `lib/`, ninguna relacionada con esta feature:

| ruta | que es |
|---|---|
| `lib/auth/google-sa-token.ts:42` | `ASSERTION_TTL_S` (vida del JWT de assertion de Google) |
| `lib/auth/google-adc-token.ts:28` | `IMPERSONATION_LIFETIME_S` |
| `lib/config/etiquetas.ts:52` | comentario del default del TTL de URL firmada |
| `lib/config/etiquetas.ts:69` | `readPositiveInt("ETIQUETAS_SIGNED_URL_TTL_SECONDS", 3600)` |

Por eso el guardia de R17 **NO censa el numero desnudo en todo el arbol**: censa por **ambito** (los
archivos de la feature + `lib/analytics/` + `lib/cache/`) y, si alguna vez se ampliara a todo el
arbol, con **allowlist contada por ruta y por numero de ocurrencias** — el patron ya escrito en
`tests/unit/analytics/rollup-guards.test.ts:681` (`AJENAS_A_R47`). Un guardia que nace rojo por
literales ajenos se desarma a la primera y deja de proteger nada.

Propagado a **R17**.

### D5 (humano) — **(a): variable de entorno, ENCENDIDA por defecto.**

Si la cache sirve algo raro en produccion, apagarla **no debe requerir un PR**. Patron de lectura de
entorno con default ya existente en el repo: `lib/config/etiquetas.ts:7-12` y `lib/config/gestion.ts`.

Propagado a **R16**.

---

## A. Correccion: la cache no puede cambiar el resultado

**R1.** Para toda consulta valida, el resultado servido **desde cache** DEBE ser identico —misma
serie, mismos puntos, mismos tipos de dato— al servido con la cache deshabilitada.
*Test: `tests/unit/analytics/cache-equivalencia.test.ts` › «la serie servida desde cache es igual,
campo a campo, a la servida sin cache».*
*Mutacion: que el decorador devuelva el valor deserializado sin rehidratar tipos → `segCicloAcum`
vuelve como `string`, `tiempo_ciclo` sale absurdo y la igualdad falla → rojo.*

**R2.** MIENTRAS la cache este habilitada, CUANDO llegue una segunda consulta equivalente a una
anterior no invalidada, el sistema NO DEBE volver a ejecutar la agregacion sobre `analytics_daily`.
*Test: `tests/unit/analytics/cache-decorador.test.ts` › «una segunda consulta equivalente no vuelve
a llamar al repositorio interno».*
*Mutacion: que el decorador delegue siempre → el contador de llamadas del repositorio interno pasa
de 1 a 2 → rojo. (Sin este requisito, todos los de invalidacion serian vacuos: no se puede
demostrar que algo se invalida si nunca se cachea.)*

---

## B. El dia en curso: no es cacheable como un dia cerrado

**R3.** El sistema NO DEBE servir desde cache ninguna lectura de las tablas vivas (`orden`,
`gestion_orden`, `orden_historial_estado`): el punto del dia en curso —el que la 126 marca
`parcial: true` con su `corteAt`— DEBE calcularse en cada consulta.
*Test: `tests/unit/analytics/cache-dia-en-curso.test.ts` › «el punto parcial de hoy refleja una
gestion posterior aunque la parte cerrada del rango venga de cache».*
*Mutacion: decorar tambien `IAnaliticaOperativaVivaRepository` en el composition root de
`lib/actions/analitica-operativa.ts` → la segunda consulta devuelve el `valor` y el `corteAt`
viejos → rojo.*

**R4.** El sistema NO DEBE cachear `etiquetasDeEstatus`: su valor es un `ReadonlyMap`, que no
sobrevive a una serializacion JSON.
*Test: `tests/unit/analytics/cache-decorador.test.ts` › «etiquetasDeEstatus se delega siempre y su
Map llega intacto».*
*Mutacion: envolverlo con la cache → el `Map` vuelve como `{}`, la dimension se etiqueta con ids
crudos en vez de con el `value` del estatus → rojo.*

---

## C. La clave de cache (correccion y aislamiento entre roles)

**R5.** La clave DEBE derivarse del rango **resuelto** (`rango.desdeFecha`, `rango.hastaFecha`) y
NUNCA del preset (`dia`/`semana`/`mes`).
*Test: `tests/unit/analytics/cache-clave.test.ts` › «el mismo preset en dos dias distintos no
comparte entrada».*
*Mutacion: usar `rango.preset` en la clave → una consulta `rango: "dia"` hecha hoy devuelve los
cubos de ayer → rojo.*

**R6.** *(requisito de PRIMERA CLASE, con guardia — es seguridad, no rendimiento)* La clave DEBE
incluir el **alcance resuelto** (`alcance.tipo` y su id). Dos consultas que difieran solo en el
alcance NO DEBEN compartir entrada. **Una clave que no distingue el alcance filtra datos entre
roles.**
*Tests: (1) `tests/unit/analytics/cache-alcance.test.ts` › «dos actores con alcance distinto y
filtro identico no comparten entrada de cache»; (2) guardia que SOBREVIVE al merge,
`tests/unit/analytics/cache-clave-alcance.guardia.test.ts` › «la clave de cache nombra las cuatro
variantes de `AlcanceDatos`», por lectura estatica de `lib/analytics/cache-clave.ts` contra el
dominio cerrado de `AlcanceDatos` (`lib/analytics/alcance.ts:65-69`): si mañana se añade una quinta
variante de alcance y la clave no la contempla, el guardia se pone rojo ANTES de que la fuga
exista.*
*Mutacion: quitar `alcance` de la clave → un `adminSatelite` de la zona Z y un `admin` global cuyo
filtro recortado coincide textualmente reciben la MISMA entrada; con un repositorio interno que
devuelve filas distintas por alcance, el segundo actor ve las filas del primero → rojo por los dos
tests. Segunda mutacion: contemplar solo `zona` y `tienda` en la clave → el guardia rojo por
exhaustividad. Es la frontera multi-tenant de la 122 (`whereRollup`) saltada por la puerta de la
cache.*

**R7.** La clave DEBE incluir el filtro **ya recortado** (`zona_id`, `tienda_id`, `mensajero_id`),
normalizado de forma **insensible al orden** de los ids y **sensible a su contenido**.
*Test: `tests/unit/analytics/cache-clave.test.ts` › «[a,b] y [b,a] comparten entrada; [a] y [a,b]
no».*
*Mutacion (a): omitir los ids del filtro en la clave → dos consultas con filtros distintos comparten
resultado → rojo. Mutacion (b): `JSON.stringify(filtro)` sin ordenar → `[a,b]` y `[b,a]` fallan el
hit y el contador del repositorio interno pasa de 1 a 2 → rojo.*

**R8.** La clave DEBE incluir el `metricaId` y los **granos** pedidos.
*Test: `tests/unit/analytics/cache-clave.test.ts` › «la misma metrica con y sin desagregacion no
comparte entrada».*
*Mutacion: omitir los granos → `ordenes_por_estado` desagregada por `estatus` recibe los cubos ya
agregados de una consulta previa sin grano y el embudo se colapsa en un total → rojo.*

---

## D. El viaje por JSON

**R9.** El valor cacheado DEBE atravesar un codec explicito antes de guardarse y despues de leerse:
`segCicloAcum` se codifica como `string` decimal al escribir y se **rehidrata a `bigint`** al leer, y
los `null` con significado de dominio (`mensajeroId = null` = cubo sin asignar;
`causaDevolucion = null` = devolucion sin causa tipificada) DEBEN volver como `null`, nunca como
`undefined` ni como un centinela.

**El codec no es una precaucion: sin el, la escritura en cache LANZA.** `unstable_cache` serializa
el valor con `JSON.stringify` (`node_modules/next/dist/server/web/spec-extension/unstable-cache.js:23`)
y `CuboRollup.segCicloAcum` es **`bigint`**
(`lib/interfaces/repositories/IAnaliticaOperativaRollupRepository.ts:64`). `JSON.stringify` sobre un
`BigInt` **lanza `TypeError: Do not know how to serialize a BigInt`** — no devuelve `null`, no lo
omite, no degrada: **lanza**. Guardar el cubo tal cual rompe la consulta entera, no la cache.
*Test: `tests/unit/analytics/cache-codec.test.ts` › «el cubo sobrevive al viaje por JSON: bigint,
null de mensajero y null de causa» y › «sin codec, `JSON.stringify` del cubo lanza TypeError».*
*Mutacion (a) —la nombrada—: **quitar el codec** y pasar el cubo directo al puerto → la escritura
lanza `TypeError` y la consulta falla → rojo. Mutacion (b): codificar pero no rehidratar →
`segCicloAcum` vuelve como `string`, `tiempo_ciclo` concatena en vez de sumar → rojo. Mutacion (c):
normalizar `null` a `"sin_asignar"` dentro del codec → el cubo sin asignar se etiqueta dos veces y
R8 de la 126 se rompe → rojo.*

---

## E. Los invalidadores

**R10.** CUANDO el job diario de la 124 complete con exito `agregarFecha`, el sistema DEBE invalidar
el dominio `operativa`, de modo que la siguiente consulta que cubra esa fecha devuelva las filas
recien escritas y no las anteriores.
*Test: `tests/unit/analytics/cache-invalidacion-job.test.ts` › «tras la corrida del job diario, la
consulta cacheada devuelve las filas nuevas». **La asercion es sobre el DATO servido, no sobre que
se haya llamado a nadie**: se consulta (V1), se cambian las filas del origen, se vuelve a consultar
(sigue V1 — prueba que la cache cachea), corre el handler real, se consulta (V2).*
*Mutacion (a): borrar la invalidacion del handler → la ultima consulta sigue devolviendo V1 → rojo.
Mutacion (b): invalidar el tag equivocado (`analitica:financiera`) → idem → rojo.*

**R11.** SI la invalidacion falla, ENTONCES el job NO DEBE reportar exito: el error DEBE propagarse
para que `JobQueueService` lo cuente como fallo y aplique su backoff.
*Test: `tests/unit/analytics/cache-invalidacion-job.test.ts` › «un invalidador que lanza hace fallar
la corrida del job».*
*Mutacion: envolver la invalidacion en un `try/catch` que la ignore → el handler resuelve y el test
que espera un rechazo se pone rojo. Una invalidacion que falla en silencio deja la cifra congelada
para siempre y sin senal: es el modo de fallo mas caro de esta feature.*

**R12.** CUANDO el backfill de la 125 termine una corrida **que haya escrito** (`--confirmar`, con
al menos una fecha procesada), el sistema DEBE encolar la invalidacion del dominio `operativa`
—incluso si hubo fechas fallidas, porque las procesadas ya reescribieron el rollup.
*Test: `tests/unit/scripts/backfill-analitica-invalidacion.test.ts` › «una corrida con escritura
encola exactamente un job de invalidacion» y › «una corrida con fechas fallidas y alguna procesada
tambien lo encola».*
*Mutacion: no encolar → el doble de `IJobRepository.enqueue` recibe cero llamadas → rojo; y el test
de extremo a extremo de R14 sirve la cifra vieja.*

**R13.** MIENTRAS el backfill corra **sin escribir** (plan sin `--confirmar`, o con cero fechas
procesadas), el sistema NO DEBE encolar invalidacion.
*Test: `tests/unit/scripts/backfill-analitica-invalidacion.test.ts` › «el plan sin --confirmar no
encola nada».*
*Mutacion: encolar siempre → el doble de `enqueue` recibe una llamada donde no debia → rojo.*

**R14.** CUANDO el drenador procese un job `analitica_invalidacion_cache`, el sistema DEBE invalidar
el dominio `operativa`, de modo que la siguiente consulta refleje el rango recomputado.
*Test: `tests/unit/analytics/cache-invalidacion-backfill.test.ts` › «tras drenar el job encolado por
el backfill, la consulta cacheada devuelve las cifras recomputadas» (misma forma de cinco pasos que
R10) y `tests/unit/services/jobs-registro.test.ts` › «el tipo analitica_invalidacion_cache tiene
handler registrado».*
*Mutacion (a): no registrar el handler en `buildHandlers` → el job queda `pending` para siempre, el
test de registro se pone rojo y el de extremo a extremo devuelve la cifra vieja. Mutacion (b):
registrar el tipo tambien en `buildRecurrencias` → se re-agendaria un job que es puntual, y el test
de recurrencias (que enumera los tipos recurrentes) se pone rojo.*

**R15.** *(D2 = (a))* El sistema NO DEBE cachear ninguna lectura del dominio `financiera` mientras no
exista invalidacion para los **tres** ledgers que la alimentan.
*Test: `tests/unit/analytics/cache-financiera.guardia.test.ts` › «ningun archivo envuelve el
servicio o los repositorios financieros con la cache». **Este guardia SOBREVIVE al merge**: no mide
el diff contra `dev`, censa contenido, asi que sigue vigente para siempre. Su cabecera enumera los
cinco escritores de ledger y dice que engancharlos es otra feature.*
*Mutacion: decorar `AnaliticaFinancieraService` o cualquiera de sus cuatro repositorios → guardia
rojo, con un mensaje de fallo que enumera los escritores que habria que invalidar primero.*
**Razon verificada, no cautela:** `wallet_movimiento`, `wallet_tienda_movimiento` y
`pago_mensajero_movimiento` los escriben —ademas de la aprobacion de cierres— al menos
`WalletEgresoService`, `LiquidacionService`, `GeneracionGastosFijosService` (cron diario) y el flujo
de indemnizaciones de incidentes. Cachear con solo la aprobacion de cierres como invalidador
serviria dinero rancio **en silencio**.

---

## F. Configuracion

**R16.** *(D5 = (a))* La cache DEBE poder desactivarse por **variable de entorno**, y DEBE estar
**encendida por defecto** (ausencia de la variable = habilitada). MIENTRAS este deshabilitada, TODA
consulta DEBE ir a la base y el sistema NO DEBE leer ni escribir ninguna entrada.
*Test: `tests/unit/analytics/cache-config.test.ts` › «con la cache deshabilitada, dos consultas
identicas llaman dos veces al repositorio» y › «sin la variable definida, la cache esta
habilitada».*
*Mutacion (a): ignorar la bandera → el contador se queda en 1 → rojo. Mutacion (b): invertir el
default (apagada si la variable falta) → el segundo test rojo, y la feature no serviria para nada en
produccion sin un deploy que la encienda.*
*Patron de lectura del entorno: `lib/config/etiquetas.ts:7-12` (`readPositiveInt` con fallback); no
se inventa uno nuevo.*

**R17.** *(D4 = 3600 s)* El TTL maximo de una entrada —**red de seguridad** ante un invalidador que
no llegue, NO el mecanismo— DEBE ser de **3600 segundos** y vivir en **una sola constante** de
`lib/config/analitica-cache.ts`, con un comentario que declare que es **provisional y no esta
medida**. NO DEBE escribirse ninguna entrada con `revalidate: false`.
*Tests: `tests/unit/analytics/cache-config.guardia.test.ts` › «el TTL vive en una sola constante
dentro del ambito de la analitica» y › «ninguna entrada se escribe con revalidate false».*
*Mutacion (a): duplicar la cifra en el adaptador o en el decorador → censo rojo. Mutacion (b): poner
`revalidate: false` → el test del contrato de opciones rojo: sin TTL, un invalidador que no llegue
congela la cifra para siempre.*
**⚠ El censo es POR AMBITO, no global** (archivos de la feature + `lib/analytics/` + `lib/cache/`).
Comprobado antes de fijar el valor: `3600` ya aparece cuatro veces en `lib/` por motivos ajenos
(`lib/auth/google-sa-token.ts:42`, `lib/auth/google-adc-token.ts:28`, `lib/config/etiquetas.ts:52`
y `:69`). Un censo global naceria rojo por literales ajenos y se desarmaria a la primera; si algun
dia se ampliara, se hace con allowlist contada por ruta, patron de
`tests/unit/analytics/rollup-guards.test.ts:681`. Criterio general calcado de R47 de la 124 y de
`lib/config/analitica-financiera.ts`.

---

## G. Frontera: no romper a las features vivas

**R18.** La 128 NO DEBE cambiar la firma ni el tipo de retorno de `consultarAnaliticaOperativa` ni
de `consultarMetricaFinanciera`: la 131 y la 132 las consumen.
*Test: `tests/unit/analytics/cache-frontera.guardia.test.ts` › «las dos Server Actions conservan su
aridad y su tipo de retorno».*
*Mutacion: anadir un parametro obligatorio a cualquiera de las dos → guardia rojo (y typecheck
rojo en los consumidores).*

**R19.** La 128 NO DEBE modificar mas archivos existentes que los declarados en `design.md §1`. En
particular NO DEBE tocar `lib/analytics/metrics.ts` ni la logica de calculo de la 124, 125, 126 o
127.
*Test: `tests/unit/analytics/cache-frontera.guardia.test.ts` › «el diff de la rama contra `dev` no
toca ningun archivo fuera de la lista declarada». **Guardia branch-scoped**: su cabecera declara que
caduca en el merge y que sobrevive.*
*Mutacion: editar `lib/services/AnaliticaOperativaService.ts` o `lib/analytics/metrics.ts` →
guardia rojo.*

**R20.** Los tags DEBEN derivarse de `tagDeDominio()` del catalogo (135, `lib/analytics/metrics.ts`,
`ANALITICA_TAGS`). NINGUN archivo de la 128 DEBE contener el literal `"analitica:operativa"` ni
`"analitica:financiera"`.
*Tests: `tests/unit/analytics/cache-tags.test.ts` › «los tags salen del catalogo» y
`tests/unit/analytics/cache-tags.guardia.test.ts` › «ningun archivo escribe el literal del tag».
**El guardia del literal vive en su propio archivo y SOBREVIVE al merge**: no puede colgar del
guardia de frontera de R19, que se retira en el mismo PR.*
*Mutacion: escribir el literal en el adaptador o en el handler → guardia rojo. (Un tag escrito a
mano en dos sitios es como la invalidacion deja de coincidir con la lectura, en silencio.)*

**R21.** `next/cache` DEBE importarse desde **un solo archivo** del arbol de analitica
(`lib/cache/next-analitica-cache.ts`). Ningun servicio, repositorio, modulo de `lib/analytics/` ni
handler de job DEBE importarlo.
*Test: `tests/unit/analytics/cache-aislamiento.guardia.test.ts` › «solo el adaptador importa
next/cache».*
*Mutacion: importar `next/cache` en `AnaliticaOperativaService` → guardia rojo. Y no es solo
higiene: `unstable_cache` lanza `Invariant: incrementalCache missing` fuera de un request de Next
(verificado, `unstable-cache.js:62`), asi que un import mal colocado tumbaria la suite unitaria del
servicio, que hoy corre sin runtime de Next y sin `DATABASE_URL`.*

**R22.** El decorador de cache NO DEBE acceder a `analytics_daily` por su cuenta: delega en el
repositorio de la 126, que sigue siendo el unico lector de la tabla.
*Test: `tests/integration/db/analytics-daily-guards.test.ts` (guardia R42 de la 124, sin modificar)
se mantiene verde, mas `tests/unit/analytics/cache-decorador.test.ts` › «el decorador no conoce
Prisma».*
*Mutacion: que el decorador consulte Prisma para el fallo de cache → el guardia de frontera de la
124 se pone rojo por lectura ajena.*

---

## H. Observabilidad y datos

**R23.** Toda invalidacion DEBE dejar registro de **quien la disparo** (job diario, backfill,
manual) y de **que tags** invalido, sin PII y sin ids de dominio.
*Test: `tests/unit/analytics/cache-registro.test.ts` › «la invalidacion registra origen y tags, y
nada mas».*
*Mutacion: emitir el registro sin el origen → rojo. Es la unica senal que distingue «la cifra no
cambio porque no hubo movimiento» de «la cifra no cambio porque la invalidacion no llego».*

**R24.** La migracion que anade el valor `analitica_invalidacion_cache` al enum `job_tipo` DEBE ir
sola en su carpeta, con su `down.sql`, y `pnpm run db:rollback` DEBE revertirla.
*Test: `tests/integration/db/job-tipo-analitica-invalidacion-migration.test.ts` › «la migracion
anade solo el valor del enum y su down.sql lo retira recreando el tipo con los 7 valores previos en
orden».*
*Mutacion (a): meter el `ALTER TYPE` junto a otro DDL → Postgres falla con 55P04 al usar el valor
en la misma transaccion → rojo. Mutacion (b): omitir el `DELETE FROM "jobs"` previo en el `down.sql`
→ el `ALTER TABLE ... USING` falla y el rollback aborta → rojo. (Patron identico al de
`20260801100000_job_tipo_analitica_rollup_diario`.)*

---

## Fuera de alcance (declarado)

- **Cachear el dominio financiera**: R15 lo prohibe (D2). Es **otra feature**, propuesta en
  `design.md §14`.
- **Cachear a nivel de pagina o de Server Component** (`"use cache"` / `cacheComponents`): requiere
  activar una bandera global de `next.config.ts` que afecta a toda la app. **Descartado en D1**, con
  su motivo y su ruta.
- **Granularidad de tag por fecha**: imposible con la API disponible (128 tags/entrada vs. rangos de
  366 dias). **Descartado en D3**, con la ruta del limite.
- **Retencion y purga de `analytics_daily`**: follow-up abierto desde la 123.
- **Cualquier cambio de las cifras**: R1 es explicito — esta feature no mueve un solo numero.

---

## Preguntas abiertas

**Ninguna.** La puerta T0 se cerro el 2026-08-03 con las cinco decisiones D1–D5, que estan arriba
con su respuesta, su razonamiento y los requisitos a los que se propagan.
