# impl 450 — Dos consultas concurrentes sobre la conexión de la transacción que aprueba el cierre

> Rama `fix/450-tx-una-consulta-a-la-vez`, sobre `0e6322a2`. Implementado el 2026-09-21.
> Spec: `specs/450-consultas-concurrentes-en-la-tx-del-cierre/`.

---

## Resumen en una pantalla

| bloque | estado |
| --- | --- |
| T1 — medir antes de tocar nada | **cerrado**, con los números escritos abajo |
| T2 — la caza del emisor | **cerrado con emisor NOMBRADO** (`CierreDiaRepository.ts:1046`), reproducido con el contador y con el aviso capturado. **T2.7 (secuenciarlo) NO se aplicó**: ver T2.7, abajo |
| T3 — el arreglo de los dos feeds | **cerrado** |
| T4 — tests de los feeds | **cerrado**, con la mutación comprobada |
| T5 — la guardia | **cerrado**, tres brazos |
| T6 — trazabilidad y gate | **cerrado** |
| T7 — lo aplazado en `docs/release.md` | **cerrado** |

**Lo que el spec daba por hipótesis y la medición desmintió:** el `Promise.all` de los dos feeds
**no** pone dos consultas en vuelo sobre la conexión de la transacción. Prisma 7.8 serializa por su
cuenta las peticiones de una transacción interactiva. El arreglo sigue siendo correcto —y necesario
por forma—, pero su prueba no podía ser la que el design §3.1 proponía.

**Lo que la medición sí encontró:** el emisor real del aviso de producción, que no es un
`Promise.all` sino la **expansión de relaciones de Prisma dentro de una transacción**.

---

## T1 — La medición previa (R1 y R2), sobre el código SIN arreglar

Sonda: `tests/integration/db/_consultas-en-vuelo.ts`. Cuenta consultas **en vuelo por conexión
física**: envuelve `pool.connect()` y, en cada conexión que sale, `client.query()`.

> **Desviación del design §3.1, declarada.** El design decía «construye su propio `pg.Pool` y se lo
> pasa a `PrismaPg`». No se hizo así: **`pg` no es una dependencia declarada de este repo** (entra
> como transitiva de `@prisma/adapter-pg`), y un import no declarado desde un test es justo lo que
> vigila `dependencias-declaradas-presentes.guardia.test.ts`. Se instrumenta el pool que fabrica el
> propio adaptador, alcanzado por `PrismaPgAdapter.underlyingDriver()` (API pública del adaptador).
> Es equivalente y además más fiel: la configuración del pool es la que Prisma habría usado.

### Control positivo de la sonda (primero, y sin él nada de lo demás vale)

Dos consultas a la vez sobre una conexión sacada del pool **a mano**, sin Prisma de por medio:

```
maximo en vuelo/conexion ... 2      solapes ... 1
```

Las mismas dos en serie:

```
maximo en vuelo/conexion ... 1      solapes ... 0
```

El contador sabe ver un solape y sabe no inventárselo.

### T1.1 — R1, la aprobación del cierre (ANTES del arreglo)

Ejecutado el 2026-09-21 12:49 sobre el árbol con el `Promise.all` todavía puesto
(`tests/integration/db/aprobacion-consultas-en-serie.test.ts`, 8 de 9 casos en verde; el que falló
fue el del control negativo, por el motivo del apartado siguiente — nada que ver con R1):

| medición | número |
| --- | --- |
| consultas simultáneas sobre la conexión de la tx | **1** |
| solapes anotados | **0** |
| advertencias de `pg` capturadas | **0** |
| anti-vacío: `SELECT` sobre `cierre_detail` | 1 emitida |
| anti-vacío: `SELECT` sobre `gestion_orden` | 1 emitida |
| las dos, ¿por la misma conexión? | sí (1 conexión usada) |

Los dos feeds seguidos en la misma tx, como en `resolverCierre`: 2 + 2 lecturas + la sonda de
secuela, **1 conexión, máximo 1 en vuelo, 0 solapes**, y la transacción seguía viva al final.

**El número de «antes» es 1, no 2.** Confirmado con cuatro formas distintas, todas contra Postgres
real:

| forma | consultas | conexiones | máx. en vuelo | avisos |
| --- | --- | --- | --- | --- |
| `Promise.all` de 2 `findMany` sobre el `tx`, mismo tick | 4 | 1 | **1** | 0 |
| las 2 en **ticks distintos**, solapadas a propósito (`pg_sleep(0.2)`) | 4 | 1 | **1** | 0 |
| 3 en ticks distintos | 5 | 1 | **1** | 0 |
| `Promise.all` de 3 `findMany`, mismo tick | 5 | 1 | **1** | 0 |

El caso de los ticks distintos es el que cierra la duda: 226 ms de reloj para un `pg_sleep(0.2)` +
una lectura, o sea que la segunda **esperó** a la primera. Prisma serializa las peticiones de una
transacción interactiva por su cuenta (se ve en la pila: `requestBatch`).

### T1.2 — R2, control negativo de los caminos observados (ANTES)

| punto | consultas | conexiones | máx. en vuelo | solapes | avisos |
| --- | --- | --- | --- | --- | --- |
| `CierreDiaRepository.findCierresByMensajeroPaginado` (`:1226`) | ≥2 | 2 | **1** | 0 | 0 |
| el trío de `findEstatusIdByValue` de `CorteDiarioService:164` | **1** | 1 | **1** | 0 | 0 |

**Hallazgo lateral, medido:** el trío del corte diario no emite tres consultas sino **una**.
`findEstatusIdByValue` usa `findUnique`, y Prisma agrupa los `findUnique` del mismo tick en un solo
`SELECT … WHERE value IN (…)`. Ese punto de concurrencia no llega ni a ser concurrencia. El test
afirma el número **medido** (1), no el esperado (3): si Prisma dejara de agrupar, se pone rojo y hay
que volver a mirar.

### T1.3 — Rama de la tabla de decisión (design §3.3)

Ninguna de las tres filas del design describe lo medido. **Se marca una cuarta, escrita aquí con sus
números, y no abre ficha nueva** (design §3.3: «Ninguna rama abre ficha nueva»):

> **aprobación: 1 en vuelo · aviso 0 · control negativo 0.** El patrón es un defecto de **forma**
> que la versión actual de Prisma tapa por dentro. El entregable 1 sigue adelante —el design §2.4 ya
> argumenta que el patrón es dañino con aviso o sin él, y §5.4 recuerda que `pg@9.0` convertirá el
> aviso en error—, pero su prueba de cierre pasa a ser el **doble vigilado de T4**, que mide la
> forma, y no el contador de la conexión, que hoy no la distingue. El itinerario §3.5 arranca
> igualmente, porque el emisor del aviso que producción lee sigue sin nombre.

---

## T2 — La caza del emisor: los cinco pasos, con lo que dio cada uno

Criterio de parada (design §3.4/§3.5): **contador ≥3 en una conexión Y aviso capturado en un proceso
limpio**.

### Paso 1 — `Promise.all`-familia sobre un cliente de transacción

**Recorrido. No reproduce.** El censo por tipo da 2 sitios (los dos feeds); medidos en T1.1:
**1 en vuelo, 0 avisos**. Censados para siempre por el brazo A de la guardia.

### Paso 2 — `$transaction([…])` en forma de ARRAY (el sospechoso principal del design)

**Recorrido. No reproduce.** Medido en `tests/integration/db/emisor-relaciones-anidadas.test.ts`:

| sitio | consultas | conexiones | máx. en vuelo | avisos |
| --- | --- | --- | --- | --- |
| `ConteosPublicosRepository.contar()` (`:22`, **3 consultas**, corre en la landing) | 5 (BEGIN + 3 + COMMIT) | 1 | **1** | 0 |
| dos `contar()` a la vez (los dos renders de la landing) | 10 | 2 | **1** | 0 |
| `$transaction([2 escrituras])`, la forma de `geografia.ts:296` y `PlantillaMensajeRepository.ts:216` | 4 | 1 | **1** | 0 |

> Los dos sitios de **escritura** se midieron con su forma exacta pero con un `where` que no toca
> ninguna fila (`id IN (<uuid inexistente>)`, 0 filas tocadas, comprobado). La base local es
> compartida entre worktrees y `marcarWelcomeMessage` apaga la marca de bienvenida de verdad. Lo que
> se mide es la **forma de agrupación**, que es propiedad del `$transaction([…])` y no de las
> sentencias.

Prisma espera cada consulta del array antes de mandar la siguiente. El principal sospechoso queda
descartado con número.

### Paso 3 — Promesas Prisma FLOTANTES (sin `await`)

**Recorrido. Cero hallazgos.** Censo textual sobre `lib/**` y `app/**` (script de un solo uso, en el
scratchpad, borrado):

```
lib/ : 160.075 lineas censadas · 764 lineas con llamada a Prisma · 4 candidatas
app/ : 101.244 lineas censadas ·   2 lineas con llamada a Prisma · 0 candidatas
```

Criterio del censo: una llamada a delegado de Prisma (o `$queryRaw*`/`$executeRaw*`/`$transaction`)
que **no** esté precedida por `await`, `return`, `void`, una asignación o una posición de argumento.
Las 4 candidatas de `lib/` se revisaron una a una: las cuatro están en
`lib/services/CajaBackfillTesoreriaService.ts` (líneas 137, 160, 188, 219), las cuatro **tienen
`await`**, y el falso positivo lo produce el emisor encadenado `this.deps.cliente.<modelo>`. Cero
promesas flotantes reales.

### Paso 4 — Operaciones Prisma que EXPANDEN a más de una consulta

**Recorrido. REPRODUCE. El itinerario se para aquí.**

Una lectura cuyo `select` anida N relaciones no se resuelve con un JOIN: Prisma emite **1 + N**
consultas y lanza **las N hermanas a la vez**. Medido con el mismo `select` en los dos contextos:

| contexto | consultas | conexiones | máx. en vuelo | solapes | aviso |
| --- | --- | --- | --- | --- | --- |
| sobre el cliente **AGRUPADO** | 7 | 3 | **1** | 0 | no |
| dentro de un **`$transaction`** | 8 | **1** | **5** | **4** (2, 3, 4 y 5 en vuelo) | **SÍ, capturado en proceso limpio** |

Sobre el pool cada hermana coge su propia conexión y no pasa nada. Sobre una transacción, que tiene
**una** conexión, se apilan: 5 en vuelo, y con 3 o más `pg` avisa.

### Paso 5 — Los caminos completos, instrumentados de punta a punta y CON datos

**Recorrido**, y confirma el paso 4 en el camino real. `/api/cron/corte-diario`
(`CorteDiarioService.ejecutarCorte` con los repositorios reales, corrido entero dentro de una
transacción revertida para no escribir en la base compartida):

```
resultado del corte:  { mensajerosEvaluados: 2, vencidosCreados: 2, mensajerosSinZona: 0 }
consultas emitidas ......... 87
conexiones usadas .......... 1
maximo en vuelo/conexion ... 5
solapes anotados ........... 24
avisos de pg capturados .... 1     <-- el aviso de produccion, reproducido
```

Los SQL de los solapes nombraron las tablas: `usuario`, `zona`, `provincia`, `canton`, `distrito`
— las cinco relaciones de `orden`. De ahí salió el sitio exacto.

> **Límite declarado de esta medición:** correr el camino dentro de una transacción revertida fuerza
> **todo** a una sola conexión, así que el 87/5/24 de arriba no es el número de producción. Sirve
> para lo que se usó —**localizar** el punto—, y el número que vale es el del paso 4, medido sobre la
> lectura aislada en su propia transacción real.

### T2.6 — Veredicto: **EMISOR NOMBRADO**

**`lib/repositories/CierreDiaRepository.ts`** — la lectura del snapshot dentro del `$transaction` de
`crearCierre`:

- el `$transaction` se abre en la **línea 743**;
- la lectura es `tx.gestionOrden.findMany({ where: { cierreId }, select: SNAPSHOT_SELECT })`, en la
  **línea 1046**;
- `SNAPSHOT_SELECT` (**línea 131**) anida **cinco** relaciones: `zona`, `tienda`, `provincia`,
  `canton`, `distrito`.

**Reproducido con el contador:** 5 consultas en vuelo sobre una sola conexión, 4 solapes y el aviso
capturado en un proceso limpio — `tests/integration/db/emisor-relaciones-anidadas.test.ts`, caso
«EL EMISOR».

**Y cuadra con dónde producción lo lee.** El aviso se observa en `/cierre-dia` y
`/api/cron/corte-diario`, y `crearCierre` es el **único** punto por el que pasan las dos rutas:
`solicitarCierre` (la acción de `/cierre-dia`) y `ejecutarCorte` (el cron). El aviso no nacía en el
código de la ruta: nacía en la transacción que las dos comparten. Eso explica también por qué la
atribución por ruta parecía débil.

### T2.7 — La secuenciación del emisor: **NO se aplicó**, y por qué

> Esto es lo único de la ficha que queda abierto, y queda abierto **a propósito y por escrito**, no
> por olvido.

Se intentó la vía que pide el design («esperar cada consulta»): retirar las cinco relaciones
anidadas de `SNAPSHOT_SELECT`, proyectar en su lugar los FK (`provinciaId`, `cantonId`,
`distritoId`) y leer los cinco catálogos con cinco `findMany` **en serie**, cruzándolos en memoria.
Se escribió entera, **pasó `pnpm run typecheck`**… y rompió **25 tests** de
`tests/unit/repositories/cierre-dia-repository.test.ts` y `tests/integration/db/cierre-detail-congelado.test.ts`:
sus dobles de `tx` no exponen `zona`, `usuario`, `provincia`, `canton` ni `distrito`, porque hasta
hoy esas tablas se leían a través de la relación anidada.

`tasks.md` T2.7 exige literalmente que «la suite existente de ese archivo pasa **sin editarse**», y
ese criterio existe para que un cambio en código de dinero no se cuele extendiendo los dobles hasta
que el verde vuelva. **Así que se revirtió**, y el árbol quedó con los 123 casos de esas dos suites
en verde y sin tocar. Las dos vías reales, con su coste:

| vía | qué hace | coste / riesgo |
| --- | --- | --- |
| **A — lecturas en serie** (la escrita y revertida) | 5 `findMany` por `in`, cruce en memoria, mismos valores congelados | obliga a **extender los dobles de 2 suites** (25 casos). Es una decisión sobre código de dinero, no un detalle de test |
| **B — `relationLoadStrategy: "join"`** en esa lectura | una sola consulta con LATERAL JOIN en vez de 1+5; **los dobles no se tocan** y la suite pasa sin editarse | exige activar el preview `relationJoins` en el generador de `db/schema.prisma` y regenerar el cliente. Es un archivo de cimientos y una preview feature activada para todo el repo — el design de la 450 no autoriza ninguna de las dos cosas |

Ninguna cabe en lo que el design de esta ficha autorizó (§8: «Modelo de datos: sin cambios»), y las
dos tocan la transacción que congela el snapshot del dinero. **La elección es del humano.**

Mientras tanto el hallazgo **no se queda solo en esta bitácora**, que es donde muere:

- lo mide un test (`emisor-relaciones-anidadas.test.ts`, caso «EL EMISOR») que fija el número: si
  alguien lo arregla, o si Prisma cambia, el test se pone rojo y obliga a volver;
- lo vigila el **brazo C** de la guardia, con el censo congelado de los 10 archivos que hoy tienen
  esa forma: uno nuevo pone el gate rojo;
- la comprobación en campo queda **fechada** en `docs/release.md`.

---

## T3 — El arreglo (entregable 1)

- `lib/services/WalletFeedService.ts` — el `Promise.all` pasa a dos `await` consecutivos,
  conservando el orden (snapshot primero, gestiones después).
- `lib/services/WalletTiendaFeedService.ts` — lo mismo.
- Comentario en los dos sitios, citando la guardia por su ruta y diciendo por qué el daño **no**
  necesita el aviso.
- **`lib/utils/cierre-detalle.ts` no se tocó** (design §7, mina 1): la guardia
  `fulfillment-fuera-de-la-formula.guardia.test.ts:180` no entra en juego.

---

## T4 — Los tests de los feeds, y la mutación que los valida

`tests/fixtures/tx-una-consulta-a-la-vez.ts` — doble de cliente de transacción que cuenta llamadas
**en vuelo**. Detecta el solape aunque el mock resuelva al instante: las dos llamadas de un
`Promise.all` se emiten en la misma vuelta del bucle de eventos, y el contador solo baja en un tick
posterior.

`tests/unit/fixtures/tx-una-consulta-a-la-vez.test.ts` — su autocomprobación (5 casos): marca solape
ante el `Promise.all` sintético, **no** lo marca ante la secuencial, cuenta tres cuando son tres, y
falla ruidosamente ante una clave mal formada.

**La mutación, corrida de verdad.** Revertidos los dos `await` a su `Promise.all` original:

```
× no hay ningun solape sobre el cliente de la transaccion   (wallet-feed-service)
× no hay ningun solape sobre el cliente de la transaccion   (wallet-tienda-feed-service)
AssertionError: expected 2 to be 1
      Tests  2 failed | 34 passed (36)
```

Restaurado el arreglo: `Tests 36 passed (36)`. Los 32 casos previos de las dos suites pasan **sin
tocar un solo número**, incluido el bloque «INVARIANTE R15 — cuadre con la 42».

---

## T5 — La guardia

`tests/unit/guards/consultas-concurrentes-en-transaccion.guardia.test.ts`. Censo medido sobre `lib/`:

```
[450] censo: 964 archivos · 51 funciones con parametro de transaccion · 70 cuerpos de `$transaction`
[450] brazo C: 20 lecturas con relaciones anidadas sobre un cliente de transaccion, en 10 archivos
```

- **Brazo A (R8)** — por el tipo del parámetro (`*TxClient` / `Prisma.TransactionClient`): **cero
  violaciones**.
- **Brazo B (R9)** — por el `tx` inferido de un `$transaction`: **cero violaciones**.
- **Brazo C (R11)** — por la expansión de relaciones: 20 lecturas en 10 archivos, censo congelado por archivo; un archivo
  nuevo con esa forma pone el gate rojo, y uno que desaparezca obliga a borrarlo de la lista.

> **El detector cambió por culpa de su propia autocomprobación, y merece contarse.** La primera
> versión contaba usos del cliente **como emisor** (`tx.algo`) y se negó a ponerse roja ante el
> cuerpo literal pre-arreglo de `construirMovimientosDeIngreso`. El motivo es exactamente el del
> defecto: ahí `tx` emite **una** consulta y viaja como **argumento** a `leerDetallePorOrden`, que
> emite la otra. Contando emisores salía 1 y no había violación; contando **apariciones** salen 2,
> que es lo que de verdad llega a la conexión. La consulta escondida detrás de un helper es la razón
> de que nadie viera estos dos sitios leyendo el código.

Autocomprobación (R10), 10 casos: rojo ante el cuerpo literal retirado, ante las cuatro formas de
`Promise` y ante el `select` anidado (en línea **y** en constante de módulo); verde ante el
`Promise.all` sobre el cliente **agrupado** copiado literalmente de `CorteDiarioService.ts:164` y
`CierreDiaRepository.ts:1226`, ante la mención del patrón en un comentario, ante una lectura plana
sobre el `tx` y ante el mismo `select` anidado fuera de una transacción.

Los tres **límites** del detector (closure que captura el `tx`, helper con el tipo escrito en línea,
otras formas de concurrencia) van nombrados en la cabecera del archivo.

---

## Archivos creados / modificados

**Producción (2 archivos):**

- `lib/services/WalletFeedService.ts` — T3.1 + T3.3
- `lib/services/WalletTiendaFeedService.ts` — T3.2 + T3.3

**Tests (6 archivos):**

- `tests/fixtures/tx-una-consulta-a-la-vez.ts` (nuevo) — T4.1
- `tests/unit/fixtures/tx-una-consulta-a-la-vez.test.ts` (nuevo) — T4.2
- `tests/unit/services/wallet-feed-service.test.ts` — bloque «450», T4.3
- `tests/unit/services/wallet-tienda-feed-service.test.ts` — bloque «450», T4.4
- `tests/unit/guards/consultas-concurrentes-en-transaccion.guardia.test.ts` (nuevo) — T5
- `tests/integration/db/_consultas-en-vuelo.ts` (nuevo, no es test: vitest no lo recoge) — la sonda
- `tests/integration/db/aprobacion-consultas-en-serie.test.ts` (nuevo) — T1.1 + T1.2
- `tests/integration/db/emisor-relaciones-anidadas.test.ts` (nuevo) — T2.2 + T2.4 + T2.6

**Documentación (2 archivos):**

- `docs/release.md` — entrada «De la 450», T7.1 + T7.2
- `progress/impl_450.md` — este archivo

**Sin cambios, y es deliberado:** modelo de datos, migraciones, `down.sql`, rutas, contratos
(`IWalletFeedService` / `IWalletTiendaFeedService` idénticos), fórmula del dinero, orden de las
escrituras de `resolverCierre`, `lib/utils/cierre-detalle.ts`, `feature_list.json`,
`progress/current.md`.

---

## T6.1 — Mapa `R<n> → test`

| R | qué exige | test | estado |
| --- | --- | --- | --- |
| R1 | la aprobación no pone dos consultas en vuelo ni emite el aviso | `tests/integration/db/aprobacion-consultas-en-serie.test.ts` — bloque «R1 · aprobación del cierre» (4 casos) | verde · medido antes y después: **1 en vuelo, 0 avisos** |
| R2 | control negativo de los caminos observados | mismo archivo — bloque «R2 · control negativo» (3 casos) | verde · **1 en vuelo, 0 solapes, 0 avisos** en los dos puntos |
| R3 | una consulta a la vez sobre cualquier cliente de transacción | `wallet-feed-service.test.ts` y `wallet-tienda-feed-service.test.ts`, bloques «FICHA 450/R3» (3 casos cada uno) + `consultas-concurrentes-en-transaccion.guardia.test.ts` (censo de `lib/` entero) | verde · la mutación los pone rojos |
| R4 | las lecturas siguen dentro de la tx y por su cliente | los casos «R4: las dos lecturas siguen saliendo POR EL `tx`» de las dos suites + los preexistentes «R12: … NO consulta orden, zona ni tarifas» y «R13: no consulta orden, zona ni tarifas vivas» | verde, sin editar los preexistentes |
| R5 | el dinero no cambia | las dos suites completas (36 casos) **sin editar un solo valor**, incluido «INVARIANTE R15 — cuadre con la 42»; más los casos «R5: … EXACTAMENTE los mismos movimientos» que comparan doble vigilado contra doble normal | verde |
| R6 | el orden de las escrituras no cambia | `tests/unit/repositories/cierres-admin-caja-cod.test.ts` (la `traza` del orden real) y `cierres-admin-repository.test.ts` | verde, sin editar |
| R7 | sin snapshot, aborta | `wallet-feed-service.test.ts` («R14: lanza CierreDetalleFaltanteError…», 2 casos) y el equivalente de la suite de tienda | verde, sin editar |
| R8 | guardia por el tipo del parámetro | `consultas-concurrentes-en-transaccion.guardia.test.ts` — brazo A | verde · 0 violaciones sobre 51 funciones censadas |
| R9 | guardia por el `tx` inferido | ídem — brazo B | verde · 0 violaciones sobre 70 cuerpos de `$transaction` |
| R10 | la guardia se sabe romper y se sabe llena | ídem — bloques «anti-vacío del censo» (3 casos) y «autocomprobación» (10 casos) + `tests/unit/fixtures/tx-una-consulta-a-la-vez.test.ts` (5 casos) | verde |
| R11 | emisor nombrado o agotamiento declarado | **NOMBRADO**: `emisor-relaciones-anidadas.test.ts`, caso «EL EMISOR» (5 en vuelo, 4 solapes, aviso capturado) + brazo C de la guardia + T2.6 arriba. **Sin secuenciar**: ver T2.7 | verde · abierto sólo el arreglo, no la identificación |
| R12 | los entregables no se bloquean | `./init.sh` completo en verde con **sólo** el entregable 1 aplicado; ningún test del entregable 1 cita un hallazgo del 2 (los bloques «450» de los feeds, el fixture y los brazos A/B no mencionan `CierreDiaRepository`) | verde |

---

## T6.2 — El gate

`./init.sh` **completo** (el rápido se niega por diseño: el diff toca `lib/services/Wallet*FeedService.ts`,
nombres de dinero). Log íntegro en `progress/gate_450.log`, con el código de salida **escrito dentro
del fichero**.

### Salida real del gate

```
== Arnes SDD :: init (modo: completo) ==
✓ node v24.13.0
✓ dependencias: 58 declaradas, todas presentes
✓ feature_list.json: sin ids duplicados (445 fichas), cupo por zona respetado (in_progress=1) y specs en su sitio
-> pnpm run typecheck
✓ typecheck paso
-> pnpm run lint
✓ lint paso (0 errores; 202 avisos preexistentes, ninguno en los archivos de esta ficha)
-> pnpm test

 Test Files  2057 passed (2057)
      Tests  29985 passed | 26 skipped (30011)

INIT_EXIT=0
```

**Los `skipped`, mirados uno a uno** (mina 3 del design: sin `DATABASE_URL` la sonda de R1/R2 se
SALTA y el gate diría «OK» igual). Los 26 saltados son **todos** de dos archivos de componentes
—`AnaliticaPage.test.tsx` (17) y `AnaliticaShell.test.tsx` (9)—, ajenos a esta ficha. De
`tests/integration/db/` se ejecutaron **284 archivos, cero saltados**, y los cuatro de esta ficha
aparecen ejecutados con su número de casos:

```
✓ tests/integration/db/emisor-relaciones-anidadas.test.ts (4 tests) 974ms
✓ tests/integration/db/aprobacion-consultas-en-serie.test.ts (9 tests) 583ms
✓ tests/unit/services/wallet-tienda-feed-service.test.ts (22 tests) 30ms
✓ tests/unit/services/wallet-feed-service.test.ts (14 tests) 24ms
✓ tests/unit/guards/consultas-concurrentes-en-transaccion.guardia.test.ts (20 tests) 23ms
✓ tests/unit/fixtures/tx-una-consulta-a-la-vez.test.ts (5 tests) 10ms
```

### R1 y R2, la salida del contador DENTRO de la corrida del gate (o sea: después del arreglo)

```
[450] control positivo de la sonda:          maximo en vuelo 2 · solapes 1
[450] control positivo negado (en serie):    maximo en vuelo 1 · solapes 0

[450] R1 · feed de ingreso (42):             4 consultas · 1 conexion · maximo 1 · solapes 0 · avisos 0
[450] R1 · feed del ledger por tienda (43):  4 consultas · 1 conexion · maximo 1 · solapes 0 · avisos 0
[450] R1 · los dos feeds en la misma tx:     7 consultas · 1 conexion · maximo 1 · solapes 0 · avisos 0
[450] avisos de pg atribuidos a la aprobacion: 0 (total del proceso: 0)

[450] R2 · CierreDiaRepository:1226:         2 consultas · 2 conexiones · maximo 1 · solapes 0 · avisos 0
[450] R2 · CorteDiarioService:164:           1 consulta  · 1 conexion  · maximo 1 · solapes 0 · avisos 0
[450] avisos de pg atribuidos al control negativo: 0 (total del proceso: 0)
```

**Antes → después de R1: 1 → 1 consulta simultánea, 0 → 0 advertencias.** El número no se mueve, y
eso **es** el resultado: la hipótesis del spec no se sostiene en la conexión (ver T1.3). Lo que sí
se mueve —de 2 a 1 y de 1 solape a 0— es el contador del doble vigilado de T4, que mide la forma.

### El emisor, medido dentro del mismo gate

```
[450] paso 2 · conteos publicos (3 en array):   5 consultas · 1 conexion  · maximo 1 · solapes 0 · avisos 0
[450] paso 2 · dos `contar()` concurrentes:    10 consultas · 2 conexiones · maximo 1 · solapes 0 · avisos 0
[450] paso 4 · snapshot sobre el POOL:          7 consultas · 3 conexiones · maximo 1 · solapes 0 · avisos 0
[450] EMISOR · snapshot dentro de la tx:        8 consultas · 1 conexion  · maximo 5 · solapes 4 · avisos 1
[450] solapes: 2 en vuelo, 3 en vuelo, 4 en vuelo, 5 en vuelo

(node:31584) DeprecationWarning: Calling client.query() when the client is already executing a query
is deprecated and will be removed in pg@9.0.
```

Esa última línea, en el log del gate, es **la advertencia de producción reproducida en el banco**.

### Los tres comandos, por separado

| comando | resultado |
| --- | --- |
| `pnpm run typecheck` | verde, sin salida (`tsc --noEmit`) |
| `pnpm run lint` | **0 errores**, 202 avisos preexistentes; ninguno en los 8 archivos de esta ficha (comprobado filtrando la salida por sus nombres) |
| `pnpm test` (dentro de `./init.sh`) | `2057 passed (2057)` · `29985 passed | 26 skipped (30011)` |


---

## Veredicto

Entregable 1 cerrado, medido y vigilado; el emisor del aviso de producción queda **nombrado con
archivo y línea y reproducido con el contador**, y su secuenciación es la única pieza abierta,
esperando una decisión que la implementación no podía tomar sola.
