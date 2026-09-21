# 450 — Diseño

> Decisiones del humano incorporadas el 2026-09-21 (ver `requirements.md` §Decisiones firmadas):
> alcance completo dentro de esta ficha, prueba de cierre = contador determinista + `./init.sh`
> completo, búsqueda acotada con criterio de parada, entregables independientes.

## 1. Qué se cambia, y en cuántos entregables

**Entregable 1 — el patrón.** Las dos consultas que hoy salen **a la vez** sobre el cliente de la
transacción de aprobación pasan a salir **en serie**, más la guardia que impide que vuelvan. Nada
más: ni modelo de datos, ni rutas, ni contratos, ni fórmula, ni orden de las escrituras.

**Entregable 2 — el emisor.** Nombrar quién encola la **tercera** consulta que sí dispara el aviso
que se ve en producción, y secuenciarlo igual. Tiene itinerario, orden y criterio de parada (§3.5).

Los dos van en esta ficha (decisión 1) y **no se bloquean entre sí** (R12): el entregable 1 es
mergeable por su cuenta.

## 2. El mecanismo, con su fuente

### 2.1 Quién comparte conexión con quién

`@prisma/adapter-pg@7.8.0` (`dist/index.d.ts`) declara dos clientes distintos:

| tipo del adaptador | qué es | consecuencia |
| --- | --- | --- |
| `StdClient = pg.Pool` | el cliente normal (`this.prisma.x.findMany`) | cada consulta toma **su propia** conexión del pool; dos en paralelo van por conexiones distintas |
| `TransactionClient = pg.PoolClient` | el `tx` de un `$transaction` interactivo | **una sola** conexión, dedicada, durante toda la transacción |

Por eso un `Promise.all` sobre `this.prisma` es correcto y un `Promise.all` sobre `tx` no lo es: en
el segundo caso las dos consultas van al **mismo** `pg.Client`.

`lib/db/prisma-client.ts:21` fija `DB_POOL_MAX = 3` por instancia, que es el número que hace que una
conexión envenenada sea 1 de cada 3 (medición de la 440).

### 2.2 Qué hace `pg` cuando llega la segunda consulta

`pg@8.22.0`, `lib/client.js` (leído en el árbol y **confirmado por el humano**):

- **714-717** — `query()` empuja a `_queryQueue` y **avisa solo si la cola ya tenía algo**:
  `if (this._queryQueue.length > 0) queryQueueLengthDeprecationNotice()`.
- **603-624** — `_pulseQueryQueue()` hace `shift()` y activa la consulta **si**
  `readyForQuery === true`.
- **368-391** — al llegar `ReadyForQuery`, primero `readyForQuery = true` (386) y **después** se
  resuelve la consulta anterior (388).
- **34-37** — el texto del aviso es el que se ve en producción, y se construye con `util.deprecate`,
  que **avisa una sola vez por proceso**.

Secuencia, entonces: **la 1.ª** pasa a activa y deja la cola en 0; **la 2.ª** encuentra 0 y **no
avisa**; **la 3.ª** encuentra 1 y **sí avisa**.

Dos consecuencias:

1. **Dos consultas concurrentes sobre una conexión libre no disparan el aviso.** Hacen falta tres en
   vuelo —o que la conexión no estuviera lista al empujar la primera—. Por eso el aviso que se ve en
   producción tiene **otro** emisor, y por eso el entregable 2 existe. R1 y R2 lo miden igualmente
   antes de tocar nada: en este repo un invariante sostenido leyendo el código ya lo desmintió
   Postgres una vez.
2. **El número de producción no cuenta eventos, cuenta procesos.** Con `util.deprecate`, 32
   ocurrencias y 22 usuarios en 7 días significan ≥32 **instancias** que lo tocaron al menos una
   vez. Eso también explica por qué la atribución por ruta es débil: el aviso va al stderr del
   **proceso** y se cuelga de la petición que estuviera activa.

### 2.3 Por qué esto es código de dinero y no una molestia de logs

La transacción en juego es la que escribe la caja principal, el ledger por tienda y el libro del
mensajero. Cuando dos consultas comparten conexión dentro de ella y la primera falla, la segunda
—ya encolada— corre contra una transacción **abortada** y recibe `25P02`; el camino de rollback
queda a medias y la conexión puede volver al pool con la transacción abierta. Es el envenenamiento
que la 440 midió desde el otro extremo: 27 respuestas 500 a un mensajero en una hora.

### 2.4 ⚠️ Que no emita el aviso NO lo vuelve inocuo

Esto hay que leerlo entero antes de concluir «entonces no hacía falta arreglarlo», porque es la
lectura fácil y es la equivocada:

`pg` **serializa** las dos consultas del feed **por esa misma cola** (`client.js:603-624`): la
segunda no corre en paralelo, corre **después** de la primera. Si la primera falla y aborta la
transacción, la segunda **ya está encolada** y se ejecuta igual — y lo que recibe es
`current transaction is aborted, commands ignored until end of transaction block`, el `25P02` de la
440. El daño no lo produce el aviso: lo produce **la consulta encolada que nadie puede cancelar**.

Dicho al revés: el aviso es un síntoma que necesita tres consultas; el defecto necesita **dos**. Por
eso el entregable 1 se sostiene solo, con aviso o sin él, y por eso su prueba de cierre es el
contador de consultas en vuelo y no el aviso (decisión 2).

## 3. Lo PRIMERO: medir, y después cazar

### 3.1 La sonda

`tests/integration/db/aprobacion-consultas-en-serie.test.ts`:

1. **Construye su propio `pg.Pool`** y se lo pasa a `PrismaPg` —el constructor acepta
   `pg.Pool | pg.PoolConfig | string`, §2.1—, envolviendo `pool.connect()` para **contar consultas
   en vuelo por conexión**. Este contador es la **aserción principal**: es determinista, repetible y
   no depende de `util.deprecate`.
2. **Captura `process.on("warning")`** y filtra por el texto exacto. Aserción **secundaria**, e
   informativa: una sola oportunidad por proceso (§2.2).
3. Ejecuta, dentro de `enTransaccionRevertida` (`tests/integration/db/_postgres-real.ts`), los dos
   feeds reales con el `tx` real.
4. **Anti-vacío obligatorio:** con el espía de consultas se comprueba que las **dos** `SELECT`
   (sobre `cierre_detail` y sobre `gestion_orden`) se emitieron de verdad. Sin eso, un test que no
   consulta nada sale verde: el modo de fallo de `if (!fks) return;` que ya se coló aquí.
5. **Sonda de secuela:** tras los feeds, una consulta más por el mismo `tx` para comprobar que la
   transacción sigue viva.

**No hace falta sembrar datos.** Lo que se mide es el comportamiento de la **conexión**, y un
`findMany` con un `cierreId` inexistente emite exactamente la misma consulta. El resultado de
negocio ya lo cubren las suites unitarias (R5). Además así la sonda **no escribe** en la base local,
que es compartida entre worktrees.

### 3.2 El control negativo (R2)

Los caminos donde la advertencia se **observa** tienen concurrencia propia, y está sobre el cliente
**agrupado**, no sobre un `tx`:

- `lib/repositories/CierreDiaRepository.ts:1160` y `:1226` — `Promise.all` sobre `this.prisma`.
- `lib/services/CorteDiarioService.ts:164` — `Promise.all` de tres lecturas sobre `this.prisma`.

La sonda ejercita `findCierresByMensajeroPaginado` (el de la 1226, que lanza sus dos consultas **sin
depender de que haya datos**) y el trío de `findEstatusIdByValue` de la 164, y cuenta. Mismo
anti-vacío. **Si aquí sale ≥2 en una misma conexión, entra en esta ficha** (decisión 1).

### 3.3 Tabla de decisión de la medición previa

| medición sobre el código actual | lectura | qué se hace |
| --- | --- | --- |
| aprobación: 2 en vuelo · aviso ≥1 · control negativo 0 | los feeds son además el emisor | entregable 1 cierra los dos frentes; el itinerario §3.5 se para en el paso 1 |
| aprobación: 2 en vuelo · aviso 0 · control negativo 0 | **la esperada** según §2.2 | entregable 1 sigue adelante (§2.4) y arranca el itinerario §3.5 |
| control negativo ≥2 en una conexión | hay emisor en el camino observado | se nombra, se secuencia **dentro de esta ficha** y el itinerario se para ahí |

La rama y sus números se escriben en `progress/impl_450.md`. Ninguna rama abre ficha nueva.

### 3.4 Qué estamos buscando, exactamente

Un punto del árbol capaz de poner **tres o más consultas en vuelo sobre una misma conexión**, o dos
sobre una conexión **que aún no estaba lista**. No «algo raro»: eso, con contador.

### 3.5 Itinerario de la caza, en orden, con criterio de parada

Se recorre **en este orden** y se **para en el primer paso que reproduzca** el aviso (contador ≥3 en
una conexión **y** aviso capturado en un proceso limpio). Cada paso tiene su tarea y su resultado
escrito; un paso sin resultado escrito no cuenta como recorrido.

| # | camino | por qué está aquí | cómo se agota |
| --- | --- | --- | --- |
| 1 | `Promise.all`-familia sobre un cliente de transacción | es el patrón conocido; el censo por tipo da **2 sitios** (los dos feeds) | ya medido en §3.1; el brazo A de la guardia lo deja censado para siempre |
| 2 | `$transaction([…])` en **forma de array** | agrupa N consultas en **una** conexión; si el motor no las espera una a una, la 3.ª avisa. Hoy hay **tres** sitios: `lib/repositories/ConteosPublicosRepository.ts:22` (**3 consultas**, y corre en la **landing**, dos veces por render: `app/_landing/LandingHero.tsx:42` y `LandingBanda.tsx:56`), `lib/actions/geografia.ts:296` (2) y `lib/repositories/PlantillaMensajeRepository.ts:216` (2) | ejercitar los tres con el contador; el de los conteos es el **principal sospechoso**: tres consultas y tráfico de cada arranque en frío |
| 3 | promesas Prisma **flotantes** (sin `await`) dentro de un `$transaction` o en una función que recibe `tx` | una consulta huérfana en vuelo es la tercera que nadie ve | censo textual sobre `lib/**` + revisión de los hallazgos |
| 4 | operaciones Prisma que **expanden a más de una consulta** (relaciones anidadas) lanzadas junto a otra sobre el mismo `tx` | dos llamadas de Prisma pueden ser tres consultas de `pg` | contar consultas por operación con `crearPrismaDeTestConEspia` en los caminos observados |
| 5 | los caminos completos `/cierre-dia` y `/api/cron/corte-diario`, instrumentados de punta a punta con el contador, **con datos** | es la medición directa, y la más cara: por eso va la última | una pasada por cada uno; si ninguna conexión llega a 3, el itinerario queda agotado |

**Si los cinco se agotan sin reproducirlo:** se declara el agotamiento por escrito en
`progress/impl_450.md` —los cinco pasos marcados, con lo que dio cada uno—, la ficha **cierra igual
con el entregable 1**, y la observación de producción queda anotada con fecha en `docs/release.md`
(§6). No se deja la ficha abierta «por si acaso»: eso es exactamente lo que la decisión 3 vino a
impedir.

**Si el paso 2 (o cualquiera) reproduce:** el sitio se secuencia igual que los feeds —esperar cada
consulta— o, si es una forma de agrupación legítima, se deja pero **se convierte en interactiva**
para que las consultas se esperen una a una; y si su forma no la vigilan los brazos A ni B, la
guardia gana un brazo (R11).

## 4. El arreglo (entregable 1)

En los dos archivos, el `Promise.all` se convierte en dos `await` consecutivos, **conservando el
orden actual de lectura** (primero el snapshot, después las gestiones):

- `lib/services/WalletFeedService.ts:39`
- `lib/services/WalletTiendaFeedService.ts:75`

`lib/utils/cierre-detalle.ts` **no se toca** (§7, mina conocida). El orden entre las dos lecturas es
indiferente para el resultado —las dos leen dentro del mismo snapshot transaccional—, así que se
mantiene el escrito para que el diff sea mínimo.

### 4.1 El coste, con su nombre

**Un round-trip extra por feed, dos por aprobación de cierre.** Y conviene decir qué es y qué no:

- Hoy las dos consultas **ya se serializan en el cable** (`client.js:603-624`). No hay paralelismo
  real en Postgres que se pierda.
- Lo que se pierde es el **adelanto del envío**: hoy la segunda se entrega a `pg` antes de que
  vuelva la primera. Secuenciando, entre una y otra se paga una ida y vuelta app→Postgres.
- A cambio desaparece el estado en el que una transacción de dinero queda a medias y devuelve al
  pool una conexión envenenada — con `DB_POOL_MAX = 3`, 1 de cada 3.

Dos round-trips por **aprobación de cierre** (operación manual de administración, no un camino
caliente) contra ese riesgo: no es una decisión ajustada.

## 5. Lo que NO se hace, y por qué

### 5.1 Sacar las lecturas fuera de la transacción — DESCARTADO

Es la vía obvia para que no compartan conexión y es la peor. El feed lee **dentro** del
`$transaction` a propósito: ese es el snapshot con el que se liquida, y en la misma transacción hay
escrituras previas que los feeds posteriores leen (las indemnizaciones que `resolverCierre` acaba de
escribir, los créditos del ledger que la caja COD lee). Leer fuera cambiaría **qué** se liquida, no
cómo. R4 lo prohíbe explícitamente para que no vuelva a proponerse.

### 5.2 Fundir las dos consultas en un `JOIN` — DESCARTADO

Ahorraría un round-trip en vez de gastarlo, pero: (a) cambia la **procedencia** del dato en código
de dinero, que es justo lo que la feature 69 vino a fijar; (b) obliga a tocar
`lib/utils/cierre-detalle.ts`, lectura compartida por los dos feeds y vigilada (§7); (c) el grano
ORDEN×GESTIÓN se resuelve hoy en memoria con un `Map` y un `JOIN` lo movería al SQL. Es un rediseño
donde lo evidenciado pide una secuenciación; en este repo ya se descartaron dos specs por eso.

### 5.3 Un `Proxy` que serialice las consultas del `tx` — DESCARTADO

Un envoltorio global que encolara todo lo que pase por un cliente de transacción arreglaría los dos
sitios y los futuros… **escondiendo** el patrón en vez de eliminarlo: el código seguiría escribiendo
`Promise.all` sobre un `tx` y alguien lo leería como legal. Además mete una capa propia entre el
código de dinero y la base, y deja sin sentido la guardia (R8/R9), que es lo único que impide que
esto vuelva.

### 5.4 Tocar el pool, el pooler o la versión de `pg` — DESCARTADO

La conexión de una transacción es **una** por definición: ningún tamaño de pool cambia eso. Y
silenciar el aviso (`--no-deprecation`) o congelar `pg` apagaría el detector: el propio texto dice
«will be removed in pg@9.0», o sea que el día del salto de versión esto deja de avisar y pasa a
fallar.

### 5.5 Un detector textual de `Promise.all` dentro del `$transaction` — DESCARTADO **como guardia única**

Es lo que ya se probó y **devuelve cero**: el `Promise.all` no está escrito dentro de la
transacción, sino en otro archivo que recibe el `tx` por parámetro. Ese detalle es la razón de que
nadie los viera leyendo el código. Se conserva **solo** como segundo brazo (R9), para la otra puerta
de la misma habitación.

### 5.6 Esperar a producción para dar la ficha por buena — DESCARTADO (decisión 2)

La prueba de cierre es el **contador determinista** + `./init.sh` completo en verde. Si el emisor
del aviso resulta ser otro código —que es justo lo que §2.2 predice—, esperar a que el aviso
desaparezca de los logs es esperar algo **que puede no ocurrir nunca**, y la ficha se quedaría viva
como se quedó media 440. La observación va a `docs/release.md` con fecha (§6).

## 6. La comprobación que se aplaza, y dónde queda escrita

En `docs/release.md`, sección **«Pendiente para la PRÓXIMA release»**, entrada «De la 450», con:

- qué mirar: ocurrencias de `Calling client.query() when the client is already executing a query` en
  los logs de Vercel;
- con qué comparar: **32 ocurrencias, 22 usuarios, última el 2026-09-20**, con la precisión de que
  `util.deprecate` avisa una vez por proceso (o sea: instancias, no eventos);
- **la fecha en que toca mirarla** (7 días después del despliegue del entregable 1);
- cómo se lee el resultado: 0 confirma la atribución en campo; >0 confirma que el emisor es el del
  entregable 2 y, si este quedó agotado sin hallazgo, se reabre el itinerario con esa evidencia
  nueva;
- y que **no bloquea** el `done` de la 450.

## 7. Minas conocidas

1. **`tests/unit/analytics/fulfillment-fuera-de-la-formula.guardia.test.ts:180` lee el fuente de
   `lib/utils/cierre-detalle.ts`** (`codigoSinComentarios`), exige que la palabra *fulfillment* **no**
   aparezca y ancla en `export function tarifaDe` y `TarifaCongeladaRow`. Este diseño **no toca ese
   archivo**, así que la guardia no entra en juego; si alguien decide tocarlo (p. ej. por §5.2),
   entra: no puede aparecer esa palabra ni desaparecer esos dos anclajes.
2. **El gate rápido se va a negar, y debe negarse.** El diff toca `lib/services/Wallet*FeedService.ts`
   — nombres de dinero (`wallet`, `cierre`) —, así que `./init.sh --rapido` falla por diseño
   (`docs/verification.md`). El gate de esta feature es **`./init.sh` completo**.
3. **Sin `DATABASE_URL` la sonda de R1/R2 no se ejecuta: se SALTA.** Va envuelta en
   `HAY_BASE_DE_DATOS`. Hay que mirar los `skipped`, no solo el veredicto.
4. **La base local es compartida entre worktrees.** Por eso la sonda no siembra ni escribe: solo
   lee, y dentro de una transacción que se revierte. El paso 5 del itinerario (§3.5), que sí
   necesita datos, se hace igualmente en transacción revertida o contra datos ya existentes.
5. **El aviso es de un solo disparo por proceso.** Si otra suite del mismo worker ya lo disparó, la
   captura no lo verá: por eso la aserción principal es el contador, y por eso los pasos del
   itinerario que dependan del aviso se corren en **archivo de test propio** (vitest aísla por
   archivo).

## 8. Lo que NO cambia (dicho explícitamente)

- **Modelo de datos:** sin cambios. Ni tablas, ni columnas, ni enums, ni RLS, ni migraciones —y por
  tanto tampoco `down.sql`.
- **Rutas y endpoints:** ninguno nuevo ni modificado.
- **Contratos de entrada/salida:** `IWalletFeedService` e `IWalletTiendaFeedService` quedan
  idénticos, firmas y tipos incluidos. Los dos `*TxClient` siguen siendo
  `Pick<PrismaClient, "gestionOrden" | "cierreDetail">`.
- **Integraciones externas:** ninguna.
- **Fórmula del dinero:** `ingreso-ordenex.ts` y `mapeo-concepto-tienda.ts` intactos.
- **Orden de las escrituras de `resolverCierre`:** intacto (R6), y lo mide
  `tests/unit/repositories/cierres-admin-caja-cod.test.ts` con su `traza` del orden real de las
  llamadas.
- **Si el entregable 2 acaba tocando `ConteosPublicosRepository` o `CierreDiaRepository`:** el
  cambio será de **cómo se esperan** las consultas, nunca de qué consultan ni de qué devuelven, y
  sus suites actuales tienen que pasar sin editarse.
