# Feature 124 — analitica: job de agregacion diaria · bitacora de implementacion

> Worktree: `C:\Users\Cristian\Documents\trabajo\arc\ordenex-wt-124`, rama
> `feature/124-analitica-job-agregacion-diaria`, sobre `6ed14603` (spec + puerta T0 cerrada).
> Base de datos usada en todo momento: **`localhost:5432/ordenex`**. Produccion no se toco
> ni para leer, en ningun paso.
>
> **PUERTA T0 CERRADA** con D1=A2, D2=B2, D3+D8=(i) 00:30 CR con R35 estricto, D4=C1, D5=(i),
> D6=E1, D7=excluir borradas, D9=transaccion unica sin lotes. Ninguna se reabrio.

---

## 0. Baseline de la rama (T0.4 / T0.5), medido ANTES de tocar codigo

Medido en este worktree, no citado de ninguna bitacora anterior (los baselines caducan con
cualquier PR ajeno).

| medicion | comando | resultado |
|---|---|---|
| cliente Prisma | `pnpm db:generate` | OK, Prisma Client v7.8.0 regenerado desde el schema limpio |
| typecheck | `pnpm run typecheck` | **0 errores** |
| lint | `pnpm run lint` | **0 errores, 18 warnings** (`no-unused-vars`, todas en `tests/`) |
| suite | `pnpm test` | **726 archivos, 8794 tests** |

Rojos del baseline, nombrados uno a uno:

1. `tests/components/descarga/WalletPropsDescarga.test.tsx` — **reproduce en aislado**. Tarda
   ~28 s contra un timeout de 20 s. Es **deuda de `dev`**, no de esta feature.
2. `tests/components/.../filter-component` y `.../no-embalaje` — **flakes por saturacion**:
   pasan al correrlos solos. No cuentan como rojos.

Criterio de aceptacion de la feature: **delta 0** contra este baseline, no verde absoluto.
Cualquier caida nueva se comprueba **aislada** antes de atribuirsela a la feature.

**Trampa del entorno vigilada:** si la suite reporta «unhandled errors» de workers omite
archivos enteros y parece casi verde. El total de archivos se compara contra **726** antes de
creerse ningun conteo.

### Estado de la base local al empezar (T0.5)

- `SELECT count(*) FROM analytics_daily` = **0**. La tabla sigue vacia desde la 123 (su R44),
  como exige el punto de partida de esta feature.
- `current_database()` = `ordenex`, `inet_server_port()` = `5432`. Confirmado que **no** es
  produccion.
- Migraciones **en disco sin aplicar: ninguna** (104 carpetas en disco, todas aplicadas). La
  base esta al dia con `dev`. **No hizo falta sanear nada.**
- Anomalia **preexistente y ajena**, anotada por honestidad: `_prisma_migrations` conserva una
  fila `20260714123909_reconcile_fks_drop_order_status_value` con `rolled_back_at` de
  2026-07-14 y `applied_steps_count = 0`, cuya carpeta ya no existe en disco. Es historia de
  la base compartida, anterior a esta feature; no se toco.

---

## 1. Supuestos tomados (sin reabrir T0)

Se registran aqui, como exige el arnes, las decisiones de implementacion que el spec no fijaba
y que se resolvieron eligiendo en vez de parando:

- **Nombres del contrato del repositorio**, fijados para que el guardia de frontera (R42) pueda
  localizar **por nombre** las lecturas legitimas en vez de conformarse con «esta en el mismo
  archivo»: `escribirFecha` (upsert), `sumarMedidasEscritasDeFecha` (**la unica lectura del
  rollup permitida en todo el arbol**) y `retirarFilasRancias` (el barrido de R29).
- **`lib/repositories/AnaliticaRollupRepository.ts` es el unico archivo que puede acceder a la
  tabla.** Ni el servicio, ni el handler, ni los scripts la nombran. Es lo que vuelve
  verificable la frontera en vez de declarativa.
- **La allowlist del guardia de frontera falla si una de sus rutas no existe en el arbol.** Una
  allowlist que enumera rutas inexistentes es un comodin silencioso: el dia que alguien cree ese
  archivo entra por la puerta de atras. La asercion lleva mutacion en las dos direcciones
  (borrar una entrada real -> rojo; anadir una inventada -> rojo).

---

*(secciones 2-7 se completan al cerrar las olas de implementacion)*

---

## 2. Archivos entregados

### Produccion (nuevos)

| archivo | que es |
|---|---|
| `lib/analytics/rollup-dia.ts` | fecha objetivo D-1 (D3) + `validarFechaInvocacionManual` (R39). Puro, reloj inyectado |
| `lib/config/analitica-rollup.ts` | la **unica** constante de aviso de volumen (R47) + `TIMEOUT_TX_ROLLUP_MS` |
| `lib/interfaces/repositories/IAnaliticaRollupRepository.ts` | Q1-Q6 + `escribirFecha` |
| `lib/interfaces/services/IAnaliticaRollupService.ts` | `agregarFecha(fecha) -> ResumenCorrida` |
| `lib/repositories/AnaliticaRollupRepository.ts` | **el unico archivo del arbol que accede a la tabla** |
| `lib/services/AnaliticaRollupService.ts` | merge de cubos, invariantes, reconciliacion (R33/R34). Sin Prisma |
| `lib/services/jobs/analitica-rollup-diario-encolado.ts` | `dedupeKey` por fecha OBJETIVO (R36) |
| `lib/services/jobs/analitica-rollup-diario-handler.ts` | handler delgado + `RecurrenciaSpec` 00:30 CR (D3/D4) |
| `scripts/seed-jobs-analitica-rollup-diario.ts` | siembra de la primera ocurrencia |
| `scripts/rollup-analitica-manual.ts` | invocacion manual acotada a hoy/ayer (R39) |
| `db/migrations/20260801100000_job_tipo_analitica_rollup_diario/` | `ALTER TYPE`, **sola en su carpeta** (55P04), con `down.sql` |

### Produccion (modificados)

| archivo | cambio |
|---|---|
| `app/api/cron/procesar-jobs/route.ts` | registro en `buildHandlers` **y** `buildRecurrencias` (D4/R36) |
| `db/schema.prisma` | valor nuevo en `enum JobTipo`. Nada mas |

### Tests

| archivo | que cubre | nuevo/mod |
|---|---|---|
| `tests/unit/analytics/rollup-dia.test.ts` | R5-R9, R39 | nuevo |
| `tests/unit/analytics/rollup-service.test.ts` | R10-R21, R22-R26, R32-R34, R38, R46 | nuevo |
| `tests/unit/analytics/rollup-guards.test.ts` | R4, R6, R26, R37, R47 | nuevo |
| `tests/unit/services/analitica-rollup-handler.test.ts` | R35, R36, R38 | nuevo |
| `tests/unit/api/procesar-jobs-registro.test.ts` | R36 (registro en ambos mapas) | mod |
| `tests/integration/db/analytics-daily-job.test.ts` | R1, R18, R20, R27-R31, R34, R45, R46, R49 | nuevo |
| `tests/integration/db/job-tipo-analitica-rollup-migration.test.ts` | R36 (migracion del enum) | nuevo |
| `tests/integration/db/analytics-daily-migration.test.ts` | **R40/R41** re-alcanzado | mod, ajeno (123) |
| `tests/integration/db/analytics-daily-guards.test.ts` | **R42/R43** re-alcanzados | mod, ajeno (123) |

---

## 3. Desviaciones del spec halladas al implementar

Se registran como informacion, no como fracaso. Ninguna reabre T0.

### 3.1 `ON CONFLICT ON CONSTRAINT "analytics_daily_grano_key"` NO es ejecutable — `design.md §5` esta mal

`design.md §5` paso 2 prescribe literalmente
`ON CONFLICT ON CONSTRAINT "analytics_daily_grano_key" DO UPDATE`. **Eso falla en Postgres.**
La 123 creo el unico del grano con `CREATE UNIQUE INDEX` —hacia falta para poder escribir
`NULLS NOT DISTINCT`, que la sintaxis de `ALTER TABLE ... ADD CONSTRAINT UNIQUE` no admitia en
su forma— y **un indice suelto no tiene fila en `pg_constraint`**. Comprobado contra la base
local:

```
no existe la restriccion «analytics_daily_grano_key» para la tabla «analytics_daily»
```

**Resolucion:** el repositorio usa **inferencia por lista de columnas** con las seis del grano,
que resuelve al mismo indice. Verificado en el Postgres 17 local que dos upserts con
`mensajero_id` y `causa_devolucion` **nulos** dejan **una** sola fila, que es exactamente lo
que R28 exige y lo que `NULLS NOT DISTINCT` existe para garantizar. Queda documentado en el
codigo como desviacion declarada.
**Accion para el leader:** `design.md §5` deberia corregirse. No se toco desde la
implementacion.

### 3.2 Exclusion silenciosa: ordenes sin ninguna transicion de historial anterior al corte

Q1-Q5 hacen `JOIN` contra la CTE del estatus congelado. Una orden **sin ninguna fila** en
`orden_historial_estado` anterior al corte no tiene coordenada `estatus_id`, y no hay de donde
sacarla sin leer `orden.estatus_id`, que **R24 prohibe expresamente**. Para que la
reconciliacion de R34 no aborte el dia entero por ese motivo, **Q6 aplica el mismo `EXISTS`**.

Consecuencia: si existiera una orden asi, **se excluye en silencio** en vez de romper. En la
practica el conjunto es vacio (el choke point `appendCambioEstado` escribe la fila de creacion
desde la feature 49). Se declara porque es una exclusion silenciosa y no una propiedad obvia,
y se caracteriza por test en la suite de integracion.

### 3.3 `TIMEOUT_TX_ROLLUP_MS`, una constante que el spec no previo

El default de la transaccion interactiva de Prisma es **5 s**, dimensionado para la mutacion de
un request, no para una agregacion diaria: con volumen real la corrida reventaria. Se anadio
`TIMEOUT_TX_ROLLUP_MS` en el mismo `lib/config/analitica-rollup.ts`. **No es una cifra de
volumen** —no es un tope de filas ni un umbral de aviso— asi que no contradice D9 ni el guardia
de constante unica de R47, pero se declara aqui para que nadie la confunda con una.

---

## 4. Mutaciones ejecutadas

> El estandar de esta casa: *un test que no se pone rojo cuando mutas lo que dice medir es una
> asercion vacia, no cobertura*. Cada fila de abajo se **ejecuto**: se aplico la sonda, se
> corrio el test, se observo el rojo y se revirtio, verificando el arbol con `git status`.

### 4.1 Servicio y repositorio (T1-T3)

| # | mutacion | R | test que se puso rojo | salida |
|---|---|---|---|---|
| M1 | `h."created_at" < corte` -> `<=` | R24 | «compara `created_at <` contra el corte, nunca `<=`» | `1 failed \| 78 passed` |
| M2 | cota inferior con `startOfDayCR` | R5/R6 | 4 casos (ventana exacta, reuso de `fecha-cr`, cota != medianoche UTC, no importa `startOfDayCR`) | `4 failed \| 75 passed` |
| M3 | quitar `, h."id" DESC` | R12 | «desempata por `id DESC`» | `1 failed \| 78 passed` |
| M4 | `created_at DESC` -> `ASC` | R12 | «toma la ULTIMA transicion del dia, no la primera» | `2 failed \| 77 passed` |
| M5 | `o."deleted_at" IS NULL` -> `TRUE` | R10/R13 (D7) | «las cinco consultas filtran `deleted_at IS NULL`» | `1 failed \| 78 passed` |
| M6 | `g."anulada_at" IS NULL` -> `TRUE` | R13/R14 | «las medidas de gestion filtran `anulada_at IS NULL`» | `1 failed \| 78 passed` |
| M7 | `o."zona_id"` -> `u."zona_id"` | R22 | «zona y tienda vienen de la ORDEN» | `1 failed \| 78 passed` |
| M8 | reconciliacion desactivada | R33/R34 | los 3 casos de R33/R34 | `3 failed \| 76 passed` |
| M9 | quitar `asegurarPrimerIntentoCoherente` | R18 | los 2 de R18 | `2 failed \| 77 passed` |
| M10 | agregador envuelto en `try {} catch {}` | R38 | 11 casos (etapas + reconciliacion) | `11 failed \| 68 passed` |
| M11 | `BigInt` crudo en el resumen | R32 | «`JSON.stringify` del resumen no lanza» | `2 failed \| 77 passed` |
| M12 | escribir siempre una fila «vacia» | R46 | los 2 de R46 + el de rancias | `3 failed \| 76 passed` |

**La reconciliacion de D5 aborta de verdad, no lo parece.** Ademas de M8, el caso de datos lo
fuerza: el doble del repositorio devuelve dos grupos finos (2 y 5) mas un tercero con la suma
(7), y el doble **simula la transaccion** (upsert por grano, barrido por `updated_at`,
reconciliacion y ROLLBACK). El test comprueba las dos cosas:
`ReconciliacionError(medida="ordenesCreadas", escrito 14, esperado 7)` **y** que la fecha quedo
sin escribir (`repo.filasDe(FECHA) === []`).

**Limitacion declarada, no escondida.** Las mutaciones de SQL (M1, M3-M7) se observan en rojo
por **guardias de texto sobre el fuente del repositorio**, no por comportamiento: las consultas
viven en SQL y desde un test unitario no hay forma honesta de ejercerlas. Su medicion real es
la suite de integracion con datos sembrados (§4.3). Si el reviewer aplica el criterio de R44
(«un mapeo a un test de regex se rechaza»), **estos R se mapean a la suite de integracion**, y
los guardias de texto cuentan como red complementaria, no como la medicion.

### 4.2 Guardias heredados de la 123 (T5.1-T5.3), mutados en las DOS direcciones

| # | sonda | esperado | observado | reversion |
|---|---|---|---|---|
| T5.1(a) | migracion temporal con `CREATE INDEX` sobre la tabla **+ declarada** en el datamodel | VERDE | **VERDE** (`1 passed`) | carpeta borrada, md5 del schema identico, `git diff -- db/` vacio |
| T5.1(a') | el conjunto de referencia **viejo** sobre ese mismo arbol | ROJO sin drift (**el defecto que se arregla**) | **CONFIRMADO**: referencia vieja = 9 objetos, `toBe(9)` true, derivados 10, sobran `["analytics_daily_tmp_sonda_idx"]`, iguales? **false** | script en scratchpad |
| T5.1(b) | la misma migracion **sin** declararla | ROJO | **ROJO**: `Faltan en el datamodel: ["analytics_daily_tmp_sonda_idx"]` | idem |
| T5.2(a) | `prisma.analyticsDaily.findMany` en un archivo cualquiera de `lib/` | ROJO | **ROJO** | archivo borrado |
| T5.2(b) | `prisma.analyticsDaily.upsert` fuera del allowlist | ROJO | **ROJO** | archivo borrado |
| T5.2(c) | los modulos del escritor tal cual | VERDE | **VERDE** (`10 passed`) | — |
| T5.2(d) | se retira del arbol una ruta **real** del allowlist | ROJO | **ROJO**: `Rutas: lib/config/analitica-rollup.ts` | restaurado |
| T5.2(e) | se anade al allowlist una ruta **inventada** | ROJO | **ROJO**: `Rutas: lib/services/EsteArchivoNoExiste.ts` | linea retirada |
| T5.3 | 3 cadenas malas + 3 buenas + escritor legitimo + `groupBy` con `_sum` sobre rango | 3 rojas, resto verde | **9/9**: las tres malas siguen cazadas | sin sonda persistente |

**Un bug real en el guardia, encontrado y corregido — estaba mintiendo, no aflojado.**
`cuerpoDeMetodo` fallaba ante la firma `): Promise<{ entregas: number }> {`. Su heuristica era
«si tras cerrar el primer bloque de llaves viene otro `{`, el primero era el tipo»; detras de
`Promise<{...}>` no viene `{` sino `>`, asi que devolvia **el tipo como si fuera el cuerpo del
metodo**. Consecuencia: cualquier lectura escrita en el cuerpo real de
`sumarMedidasEscritasDeFecha` se clasificaba como **fuera** del metodo permitido. Reescrito
contando profundidad de `<>` (consumiendo `=>` como unidad) y probando declaraciones sucesivas.

**El choque del tripwire consigo mismo, resuelto sin aflojarlo.** El helper de reconciliacion
de R34 hacia `filas.reduce((a, f) => a + f.ordenesEstadoStock, 0)`: legitimo (suma los cubos de
**una** fecha; R43 prohibe sumar **entre** fechas) pero **textualmente identico** a la tercera
cadena mala del archivo. No existe refinamiento que ponga una en verde y deje la otra en rojo.
No se toco el analizador ni se metio una excepcion: se comprobo que basta con que el codigo
**declare la fecha en el ambito** para que el guardia lo acepte, y **se fijo ese contrato como
test** en las dos direcciones. (El helper acabo retirado por muerto, pero el contrato queda
escrito para cuando reaparezca.)

**Frontera, hallazgo propio del implementer.** Cuatro modulos del escritor llevaban un
comentario que declaraba *«este modulo NO toca `prisma.analyticsDaily`»*... **escribiendo el
token prohibido dentro del comentario**, lo que ponia el guardia rojo con razon. Se decidio
**reescribir los cuatro comentarios y NO aflojar el guardia**: hacer que ignore las lineas de
comentario le abre una rendija permanente, y el coste de evitarla eran cuatro frases.

### 4.3 Job, enganche y migracion (T4)

| # | sonda | esperado | observado | reversion |
|---|---|---|---|---|
| J1 | quitar el tipo de `buildRecurrencias` | rojo en el test de registro | **ROJO**: `expected [ 'liberar_reprogramadas' ] to deeply equal [ 'analitica_rollup_diario', ... ]`; `2 failed \| 4 passed` | si |
| J2 | `dedupeKey` con la fecha de la **corrida** en vez de la **objetivo** | dos filas en `jobs` | **ROJO**: `expected 57 to be 56` en «dos siembras del mismo objetivo dejan UNA fila» | si |
| J3 | invocacion manual con `hoy - 10 dias` | rechazo y **cero** escrituras | **CONFIRMADO** contando filas: `0` antes -> `RECHAZADO: ... el job diario NUNCA recomputa fechas pasadas (R35). ... es el backfill de la feature 125.`, `exit=1` -> `0` despues | n/a |
| J4 | renombrar la carpeta para que no quede ultima | rojo en el test que reproduce `db-rollback.ts` | **ROJO**: `expected '20260731160000_orden_busqueda_trgm' to be '20260730100000_job_tipo_analitica_rol...'` | si |
| J5 | handler envuelto en `try {} catch {}` | rojo | **ROJO**: `promise resolved "undefined" instead of rejecting` x2 | si |
| J6 | `segCicloAcum: 123n` en el registro logueado | `JSON.stringify` lanza | **ROJO**: `TypeError: Do not know how to serialize a BigInt` x4 | si |

**La mutacion de R36 que el spec propone NO discrimina por si sola, y se dice.** `requirements.md`
R36 propone «usar la fecha de la corrida en vez de la fecha objetivo como `dedupe_key`». Corrida
y fecha objetivo van en **biyeccion** (una corrida por dia), asi que ese cambio es un
desplazamiento constante: dos siembras seguidas **siguen colisionando** y el test seguiria
verde. Lo que si discrimina —y es el fallo real que R36 quiere prevenir— es la **divergencia
entre productores**: la siembra y el reencolado de la recurrencia son dos caminos hacia el
mismo trabajo, y si uno usa la corrida y el otro el objetivo, las claves no colisionan y quedan
**dos** filas. El test integra ambos productores para la misma corrida; de ahi sale el
`57 to be 56`. Queda escrito y comentado en el archivo.

---

## 5. Round-trip de la migracion del enum (T8.2)

Evidencia completa en `progress/roundtrip_124_job_tipo.md`. Host confirmado
`localhost:5432/ordenex` en **cada** paso.

| paso | observado |
|---|---|
| UP | aplicada; `_prisma_migrations.finished_at = 2026-08-01 20:37:56`; el enum pasa de **6 a 7** valores, el nuevo al final |
| antes del DOWN | la carpeta `20260801100000_job_tipo_analitica_rollup_diario` es la **ultima por nombre** segun el criterio EXACTO de `scripts/db-rollback.ts` (`localeCompare`, ultimo elemento), reproducido en codigo y **no** con `ls \| tail` |
| DOWN (`pnpm db:rollback`) | la fila de `_prisma_migrations` desaparece; el enum vuelve a **6** valores en el mismo orden; `jobs` de ese tipo = 0 (el `DELETE FROM "jobs"` del `down.sql` es lo que evita que el `ALTER TABLE ... USING` aborte) |
| UP otra vez | aplicada con `finished_at = 2026-08-01 20:42:26` — fecha nueva, o sea aplicacion real, no no-op |

**Seed (T4.5):** 1.a ejecucion -> `fila sembrada (run_after=2026-08-02T06:30:00.000Z,
dedupe_key=analitica_rollup_diario:2026-08-01)`; 2.a -> `la fila ya existia (idempotente, sin
cambios)`; conteo en `jobs` = **1** tras las dos. La recurrencia queda a las **06:30 UTC =
00:30 CR** del dia siguiente, con la clave del dia que esa corrida agregara (D3/D4).

---

## 6. Medicion de volumen (T8.3 / D9 / R47) — el primer dato que existe en el repo

Hasta hoy **no habia ni una cifra de volumen medida** de esta tabla: es la consecuencia directa
de D5 de la 123, y es la razon por la que D9 prohibio inventar topes. Primera corrida real
contra `localhost:5432/ordenex` con los datos ya presentes:

| corrida | fecha CR | filas escritas | filas retiradas | ms |
|---|---|---|---|---|
| manual, 1.a | 2026-07-31 | **22** | 0 | **936** |
| manual, 2.a (idempotente) | 2026-07-31 | 22 | **0** | 873 |
| sondeo previo, 1.a | 2026-07-27 | 21 | 0 | 65-140 |
| sondeo previo, 2.a (idempotente) | 2026-07-27 | 21 | **0** | — |
| sondeo previo, 3.a (sin datos de origen) | 2026-07-27 | 0 | **21** | — |

La tercera corrida del sondeo es **R29 demostrado contra Postgres real**: al desaparecer los
cubos, las 21 filas rancias se retiran.

**Estos son los numeros que la 125 necesita para fijar umbrales con medicion real en vez de
adivinarlos** (D9). Orden de magnitud actual: ~20 filas y ~1 s por fecha. **No se extrapola a
produccion desde aqui** y no se convierte en ningun tope: la base local no tiene el volumen de
produccion, y la consigna de D9 es medir primero y decidir despues.

**Estado de la tabla al cerrar este paso:** las 22 filas de la corrida manual se **borraron**
(`DELETE FROM analytics_daily`, host verificado `ordenex:5432`, 22 -> 0), para devolver la base
compartida al estado en que se encontro.

### 4.4 Guardias estaticos nuevos (T5.4) — `tests/unit/analytics/rollup-guards.test.ts`

21 casos en 5 bloques: cimientos (existencia del allowlist + despojador de comentarios), R4,
R26, R6 y R47.

| # | sonda | guardia | observado | reversion |
|---|---|---|---|---|
| G1 | `UPDATE "orden" SET "updated_at" = now()` en el repositorio | R4 (solo-lectura del dominio) | **ROJO** x2: `R4: el job es de SOLO LECTURA sobre el dominio y sobre el dinero. Infracciones: ...AnaliticaRollupRepository.ts: UPDATE orden` | backup restaurado, `grep SONDA_T54` vacio |
| G2 | `{ zona_id: "3f2504e0-4f89-11d3-..." }` en `rollup-dia.ts` | R26 (sin literales de coordenada) | **ROJO**: `uuid literal` + `asignacion literal a una clave de coordenada: zona_id:` | `md5sum -c` OK |
| G3 | `startOfDayCR` **y** `18 * 60 * 60 * 1000` en el handler (a proposito, en el archivo con la excepcion) | R6 | **ROJO** x2: `...handler.ts: startOfDayCR` y `desplazamiento de 18 h escrito a mano` | `md5sum -c` OK |
| G4 | archivo nuevo con la cifra del umbral, **extraida por `sed`** del config, nunca tecleada | R47(b) constante unica | **ROJO**: `Copias: lib/analytics/sonda-t54-volumen.ts (1x)` | `rm` |

**La excepcion del offset de CR esta acotada con cinco condiciones simultaneas, no regalada.** El
handler necesita las 06:30 UTC de la recurrencia y `fecha-cr.ts` no exporta un helper de
«proximo instante a tal hora de pared CR». Se admite **un** desplazamiento de 6 h y solo si:
(1) esta en `analitica-rollup-diario-handler.ts`; (2) aparece **una** sola vez; (3) el
multiplicador es **exactamente 6** —un 18 o un 12 es rojo, que es lo que impide que quepa la
ventana 18:00-18:00 de `RankingService` (ficha 166), y **la sonda G3 lo demuestra en rojo**—;
(4) esta ligado a una constante `CR_OFFSET*`, no incrustado; (5) el handler sigue sin poder
nombrar `startOfDayCR`.

**Los guardias corren sobre el fuente DESPOJADO de comentarios, y no era opcional.** Los modulos
del escritor **documentan en prosa justo lo que tienen prohibido** (`rollup-dia.ts` dedica un
parrafo a `startOfDayCR`; el repositorio escribe «ni un UPDATE sobre `orden`»). Sobre el texto
crudo los cuatro guardias salian rojos **por la documentacion que los respeta**, y la salida
rapida a ese rojo habria sido borrar los comentarios. El despojador lleva su propio caso de
discriminacion (comentarios fuera; cadenas, SQL, regex y `//` dentro de string intactos) mas una
red por modulo: el fuente despojado debe ser **mas corto** que el original y seguir conteniendo
`export`, lo que caza un despojador desincronizado que se comiera medio archivo y dejara los
guardias verdes **por amputacion**.

**Hallazgo vivo que hereda la 125 (guardias):** la cifra del umbral (`20000`) **ya estaba duplicada en el
arbol antes de esta feature**, en `lib/clients/google-route-optimization.ts:94` y
`lib/config/route-optimization.ts:59`, las dos como **milisegundos de timeout**, no como
volumen. Un `.toEqual([])` global habria salido rojo por codigo ajeno y legitimo. Se resolvio
con un allowlist por **clase de uso, no por ruta**: entrada `{ruta, ocurrencias}` exacta **y**
la linea de cada ocurrencia debe casar `/timeout/i`. Una segunda ocurrencia en esos mismos
archivos sigue siendo roja, y una entrada que deje de contener la cifra tambien (mismo criterio
anti-comodin que T5.2). **Cuando la 125 sustituya el umbral por un numero medido, este allowlist
hay que actualizarlo**; esta escrito en el test.

---

## 7. Trazabilidad (T7.1 / T7.2)

> Criterio de la particion, aplicado uno a uno y **verificado abriendo cada test**, no
> reconstruido de memoria:
>
> - **A — medido por asercion que discrimina sobre comportamiento EJECUTADO.** Postgres real con
>   datos sembrados, dobles en memoria o funcion pura corrida. Es la tinta buena.
> - **B — propiedad DEL CODIGO medida por escaneo del arbol, verificado que dispara.** El
>   requisito habla del codigo (que nadie lea la tabla, que nadie escriba un literal, que el
>   datamodel no derive), asi que el escaneo **es** la observacion, no un proxy. Los ocho llevan su
>   sonda de discriminacion en §4.2 / §4.4 y el reviewer remuto seis.
> - **C — SOLO regex sobre el texto de un artefacto, siendo el requisito de comportamiento.** Es
>   cobertura por proxy y se nombra uno por uno.
> - **D — sin verificacion.**
>
> **Cuenta: A = 36, B = 8, C = 4, D = 1. Total 49.** Los cuatro grupos son disjuntos y su union
> es exactamente R1–R49.

### 7.1 Mapa `R<n> → test` de las 49

| R | clase | test que lo mide |
|---|---|---|
| R1 | A | `tests/integration/db/analytics-daily-job.test.ts:89` («la pareja de medianoche…»): la corrida escribe filas reales en `analytics_daily` derivadas de `orden`/`gestion_orden`/`orden_historial_estado`. Toda la suite T6 lo reejerce |
| R2 | **C** | `tests/unit/analytics/analytics-daily-contrato.test.ts:130` (el grano es exactamente esa union) y `:224` (las medidas son exactamente diez), mas `tests/integration/db/analytics-daily-migration.test.ts` — **todo regex sobre `schema.prisma` / `migration.sql`**. Aceptable: la 124 no toca el DDL de la tabla. Se declara igual |
| R3 | B | `tests/integration/db/analytics-daily-guards.test.ts:274` («NADIE lee el rollup todavia, salvo la reconciliacion del propio job») y `:257` (un solo archivo puede acceder). Sondas T5.2(a) y la 11 del reviewer: el allowlist **no** da derecho de acceso |
| R4 | B | `tests/unit/analytics/rollup-guards.test.ts:311`, `:331`, `:350` (las trece tablas de R4 nombradas) y `:367` (`$executeRawUnsafe` prohibido). Sonda G1 / sonda 15 del reviewer. **El mas debil del grupo:** es una propiedad de RUNTIME medida por analisis estatico; ningun caso corre el job y comprueba que ninguna tabla de dominio cambio |
| R5 | A | `tests/unit/analytics/rollup-dia.test.ts:31-58` (funcion pura, reloj congelado: D−1 en los cuatro bordes) y `:84` (la ventana es `[D T06:00Z, D+1 T06:00Z)`) |
| R6 | B | `tests/unit/analytics/rollup-guards.test.ts:558`, `:577` (offset de CR acotado a 6 h en un solo archivo), `:615` (`toLocale*` sin `timeZone`), `:632` (contracara en verde); mas `rollup-dia.test.ts:123`. Sonda G3 |
| R7 | A | `tests/integration/db/analytics-daily-job.test.ts:89` con datos reales (23:59:59 CR cae en D, 00:00:00 CR en D+1); `rollup-dia.test.ts:95` en la funcion pura |
| R8 | A | `tests/unit/services/analitica-rollup-handler.test.ts:95` («el reloj esta INYECTADO: mover `now` mueve la fecha objetivo») y todo `rollup-dia.test.ts`, que controla la fecha desde fuera |
| R9 | A | `tests/unit/analytics/rollup-dia.test.ts:66`: misma fecha y misma ventana con `TZ` en UTC, CR, Tokio y Kiritimati |
| R10 | A | `analytics-daily-job.test.ts:350` (la orden BORRADA queda fuera, con control vivo al lado) y `rollup-service.test.ts:236` (una fila por grupo, sin doble conteo) |
| R11 | A | `analytics-daily-job.test.ts:458`: la entregada hace TRES dias no esta en el stock de hoy; la que cerro hoy SI (universo B2) |
| R12 | A | `analytics-daily-job.test.ts:397` (dos cambios el mismo dia: 1 al estatus de CIERRE) y `:424` (dos transiciones con el MISMO `created_at` se desempatan de forma determinista) |
| R13 | A | `analytics-daily-job.test.ts:508` (gestion anulada), `:350` (gestion de orden borrada) y `rollup-service.test.ts:317` |
| R14 | A | `analytics-daily-job.test.ts:508` |
| R15 | A | `analytics-daily-job.test.ts:542` (la causa solo en las filas de `devuelta`, y sin causa tipificada queda NULL) y `rollup-service.test.ts:317`, `:338` |
| R16 | A | `rollup-service.test.ts:351` (materializa `incidentes` y no inventa `sin_gestionar`) y `analytics-daily-job.test.ts:542` |
| R17 | A | `analytics-daily-job.test.ts:602` (primer intento vs entrega tras una devolucion previa, con datos) y `rollup-service.test.ts:461` (UNA sola consulta al historial para todo el lote, ids deduplicados) |
| R18 | A | `rollup-service.test.ts:489` (error propio ANTES de tocar la base, sin llamar a `escribirFecha`) y `analytics-daily-job.test.ts:980` (**el CHECK real de Postgres**, con el `conname` capturado del error) |
| R19 | A | `analytics-daily-job.test.ts:666` (creada hace CINCO dias, entregada hoy → el ciclo va en la fila de hoy) y `:711` (entra a terminal, se revierte y vuelve el mismo dia → `n = 1`) |
| R20 | A | `analytics-daily-job.test.ts:990` (`seg_ciclo_n = 0` con `acum > 0` lo rechaza la base). `rollup-service.test.ts:562` es la red en memoria, mas debil |
| R21 | **C** | `rollup-service.test.ts:998`, un `not.toMatch(/AVG\(|::float|::numeric|porcentaje|promedio/i)` **sobre el fuente del repositorio**. Respaldo indirecto real: la reconciliacion de R34 exige enteros y `analytics-daily-contrato.test.ts:182` prohibe columna para las metricas de unidad `porcentaje` |
| R22 | A | `analytics-daily-job.test.ts:227`: orden de la zona A gestionada por un mensajero de la zona B → escribe zona A |
| R23 | A | `analytics-daily-job.test.ts:271`: la orden desasignada despues de gestionar produce DOS filas, una por familia de medida |
| R24 | A | `analytics-daily-job.test.ts:145` (la transicion del corte, 00:00:00 CR del dia siguiente, NO entra: cota estricta) y `:424` (desempate). Los guards de texto de `rollup-service.test.ts:907-926` son red complementaria — **y M-3 del acta demuestra que no discriminan por sitio**: la medicion es el caso de datos |
| R25 | A | `analytics-daily-job.test.ts:207`: `GROUP BY mensajero_id` crudo devuelve exactamente `[{ mensajero_id: null, n: 1 }]` |
| R26 | B | `tests/unit/analytics/rollup-guards.test.ts:455` (ningun literal de coordenada en el escritor) con su caso de discriminacion en `:430`; mas `rollup-service.test.ts:992`. Sonda G2 |
| R27 | A | `analytics-daily-job.test.ts:775` (dos corridas contra Postgres: mismo conjunto, `created_at` intacto, solo `updated_at` avanza) y `rollup-service.test.ts:701`. **Reejercido por el reviewer con huella md5 identica en la segunda corrida real** |
| R28 | A | `analytics-daily-job.test.ts:775`, ultimas aserciones: el cubo con `mensajero_id` y `causa_devolucion` NULL **no se duplica** en la segunda corrida (es lo que `NULLS NOT DISTINCT` existe para garantizar). Sonda 4 del reviewer: reducir el `ON CONFLICT` a 4 columnas pone la escritura roja |
| R29 | A | `analytics-daily-job.test.ts:801`: se anula la unica gestion del cubo, se recomputa y `filasRetiradas = 1`, la fila rancia ya no esta. Mas la 3.ª corrida real de §6 (21 filas retiradas) |
| R30 | A | `analytics-daily-job.test.ts:861`: fallo forzado a mitad de la escritura contra Postgres → la fecha queda EXACTAMENTE como estaba (el barrido de rancias, que corre antes del fallo, tambien revierte) |
| R31 | **C** | Medio requisito medido, medio no. «No duplicar filas» lo miden R27/R28 (`analytics-daily-job.test.ts:775`) y el `ON CONFLICT` lo fija `rollup-service.test.ts:1004`, una regex. **El SOLAPAMIENTO no lo mide nada**: no hay ni un caso con dos corridas concurrentes sobre la misma fecha, y el argumento de `design.md §5` de que el barrido no puede borrar las filas de la corrida rival es prosa razonada, no medicion. Es M-6 del acta |
| R32 | A | `analitica-rollup-handler.test.ts:142` (un `BigInt` crudo en el registro hace LANZAR al handler) y `rollup-service.test.ts:585` (`JSON.stringify` del resumen con un acumulado mayor que `MAX_SAFE_INTEGER`) |
| R33 | A | `rollup-service.test.ts:617`: se inyecta la fila de totalizacion disfrazada de coordenada real → `ReconciliacionError(ordenesCreadas, escrito 14, esperado 7)` **y** `repo.filasDe(FECHA) === []` |
| R34 | A | `rollup-service.test.ts:617`, `:661` (doble conteo por JOIN), `:685` (las SIETE medidas) y `analytics-daily-job.test.ts:885` (la reconciliacion recibe las sumas REALMENTE persistidas). Sonda 2 del reviewer: **aborta de verdad contra Postgres**, `count(*) = 0` despues |
| R35 | A | `analytics-daily-job.test.ts:170`: se agregan D−1 y D+1, se corre D y se compara fila a fila (incluido `updated_at`) antes y despues. Mas `rollup-service.test.ts:741` |
| R36 | A | `tests/integration/db/job-tipo-analitica-rollup-migration.test.ts:189` (dos siembras del mismo objetivo dejan UNA fila en `jobs`, contra Postgres) y `:240`; `tests/unit/api/procesar-jobs-registro.test.ts:64` (esta en AMBOS mapas); `analitica-rollup-handler.test.ts:211-280` |
| R37 | A | `analitica-rollup-handler.test.ts:160` (el registro NO lleva ids, destinatarios ni telefonos) y `rollup-service.test.ts:882` (el mensaje de error es exactamente `rollup analitica <fecha>: fallo en la etapa gestiones`) |
| R38 | A | `rollup-service.test.ts:844-887`: **seis etapas** parametrizadas mas la de `escritura`; `analitica-rollup-handler.test.ts:177`, `:194` |
| R39 | A | `rollup-dia.test.ts:133-175` (hoy y ayer si; anteayer, futura y basura no) y `analitica-rollup-handler.test.ts:282`. Comprobado ademas contra la base con la sonda J3: rechazo real y **cero** escrituras |
| R40 | B | `tests/integration/db/analytics-daily-migration.test.ts:723` (descubrimiento por contenido), `:735` (Prisma deriva exactamente la union neta) y `:763` (el efecto NETO descuenta bajas y renombres). Mutacion doble T5.1(a)/(b), reejercida por el reviewer (sondas 12 y 13) |
| R41 | B | `analytics-daily-migration.test.ts:744-748`, la red anti-vacio NO NUMERICA dentro del caso `:735`: no hay cifra esperada, el numero se deriva del conjunto de referencia. Sonda 14 del reviewer (extractor vaciado → «el guardia no mide nada») |
| R42 | B | `analytics-daily-guards.test.ts:243`, `:257`, `:303` (no hay un SEGUNDO escritor), `:340` (toda ruta del allowlist existe), `:365` (el escritor legitimo, verde) y `:385` (el localizador de cuerpos de metodo discrimina). Mutado en las dos direcciones (T5.2 a–e) y remutado por el reviewer (sondas 6, 7, 9, 10, 11) |
| R43 | B | `analytics-daily-guards.test.ts:548-686` (tres cadenas malas rojas, cuatro buenas verdes, escritor legitimo verde, `groupBy` con `_sum` sobre rango rojo) y `:688` (barrido de `lib/` y `app/`). Sonda 8 del reviewer |
| R44 | **D → cerrado por esta seccion** | Su clausula de aceptacion (`requirements.md:460`) es que **este mapa exista y nombre, por cada uno de los once de la 123, el test de esta feature que lo mide**. Es §7.2. Hasta escribirla, era el unico de los 49 sin verificacion |
| R45 | A | `analytics-daily-job.test.ts:319`: se siembra una transicion a `en_fulfillment` (huerfano del catalogo) y la corrida escribe su cubo sin fallar. **Verificado contra la base que el caso no es imaginario**: 37 referencias en `orden_historial_estado`, 0 en `orden` (§8.2) |
| R46 | A | `analytics-daily-job.test.ts:78` (dia sin ordenes: CERO filas, sin fallar) y `rollup-service.test.ts:759`, `:769` (ni fila «todo a cero» ni cubo con todas las medidas a cero) |
| R47 | A / B | **(a) el resumen**: `rollup-service.test.ts:789` (las tres cifras y la fecha, `Object.keys` cerrado), `:804` (filas retiradas cuando un cubo desaparece) y `analitica-rollup-handler.test.ts:116` — comportamiento ejecutado. **(b) constante unica**: `rollup-guards.test.ts:699`, `:710`, `:740`, `:794`, `:809` — escaneo del arbol (clase B), con sonda G4. Mas la medicion real de §6 |
| R48 | **C** | `rollup-service.test.ts:929` (`>= desde` / `< hasta`, nunca `<= hasta`) y `:940`, `:945` (el universo B2 y `ESTADOS_TERMINALES` importado) — **`toMatch` / `not.toMatch` sobre el fuente del repositorio**. Respaldo parcial y real: `analytics-daily-job.test.ts:170` (D−1 y D+1 intactas) y `:458` (la entregada hace tres dias no esta en el stock) |
| R49 | A | `analytics-daily-job.test.ts:1054` (a: mismo `estatus_id` tras un cambio posterior), `:1077` (b: coordenadas NUEVAS tras reasignar mensajero / cambiar zona / cambiar tienda) y `:1118` (c: recomputar tras borrar retira las contribuciones del pasado) |

**Los cuatro de la clase C, dichos sin adorno.** R2 y R21 son aceptables por contexto (la 124 no
toca el DDL; la reconciliacion respalda a R21). **R31 y R48 son los que dejan deuda de verdad**:
en R31 el solapamiento concurrente **no lo mide nada**, y en R48 lo que hay es una regex sobre el
SQL con dos casos de datos que la rozan. Los dos van al acta como M-6 y quedan aqui escritos para
que la 125 no los herede como «medido».

### 7.2 La deuda de la 123 (R44): **11 medidos, 1 texto**

> Los once que la 123 dejo verificados **solo por una regex sobre el texto del SQL** y que esta
> feature convierte en aserciones sobre **datos agregados reales**. Ninguna fila de abajo apunta a
> un test de regex: todas son casos con datos sembrados contra el Postgres **local**
> (`localhost:5432/ordenex`). La numeracion `R<n>` de la columna izquierda es **la de la 123**.

| R de la 123 | que pedia | test de la 124 que lo mide **con datos** |
|---|---|---|
| **R11** | `mensajero_id` NULL significa *sin asignar*, nunca *todos* | `tests/integration/db/analytics-daily-job.test.ts:207` — «la orden sin mensajero escribe el cubo con mensajero_id NULL, nunca un centinela». El `GROUP BY` crudo devuelve `[{ mensajero_id: null, n: 1 }]` |
| **R12** | `causa_devolucion` nullable = *sin causa tipificada* | `analytics-daily-job.test.ts:542` — «la causa solo se informa en las filas de `devuelta`, y sin causa queda NULL». Entregar y devolver produce DOS filas y la causa viaja solo en una |
| **R13** | ninguna fila de totalizacion | `tests/unit/analytics/rollup-service.test.ts:617` (+ `:661`, `:685`) — la fila de totalizacion inyectada rompe la reconciliacion: `escrito 14, esperado 7`, y `filasDe(FECHA) === []`. **Verificado abortando de verdad contra Postgres** (sonda 2 del reviewer: `escrito 88, esperado 44`, `count(*) = 0` despues) |
| **R24** | `primer_intento_ok <= entregas` | `analytics-daily-job.test.ts:602` — primer intento vs entrega tras una devolucion previa: `[entregas, pio] = [1,1]` y `[1,0]` en cubos distintos. Mas `:980`, el CHECK `analytics_daily_pio_lte_entregas` ejercido contra el motor con el `conname` **capturado del error**, no inferido |
| **R28** | stock al corte, **NO** aditivo por fecha | `analytics-daily-job.test.ts:458` — la entregada hace TRES dias no esta en el stock de hoy; la que cerro hoy SI. El tripwire que prohibe sumar la columna entre fechas sigue vivo en `analytics-daily-guards.test.ts:688` |
| **R31** | zona y tienda vienen de la **ORDEN** | `analytics-daily-job.test.ts:227` — orden de la zona A gestionada por un mensajero de la zona B: la fila escribe `zonaA`. **Alcance exacto de lo que NO se reproduce: R49(b)** (`:1077`) — la zona y la tienda **no se congelan** (D1→A2), asi que un recomputo posterior a un cambio escribe las nuevas |
| **R32** | `mensajero_id` segun la familia de medida | `analytics-daily-job.test.ts:271` — la orden desasignada despues de gestionar produce DOS filas: la de medidas de orden con `mensajero = null` y la de gestion con `mensajero1`. **Igual que R31, remite a R49(b)**: `mensajero_id` tampoco se congela |
| **R33** | `estatus_id` es el estado **al corte** del dia | `analytics-daily-job.test.ts:145` — la transicion del corte (00:00:00 CR del dia siguiente) NO entra en el cierre de D: la fila sale `pendiente` y no `sin_gestionar`. Mas `:397` (dos cambios el mismo dia → el de CIERRE) y `:424` (desempate determinista). **Se puede medir precisamente porque D1 cerro en A2**: `estatus_id` es la unica coordenada congelada, derivada de una tabla append-only |
| **R34** | el ciclo se atribuye a la fecha del **evento terminal** | `analytics-daily-job.test.ts:666` — creada hace CINCO dias y entregada hoy: `seg_ciclo_n = 1` en la fila de hoy y nada en la de su creacion. Mas `:711` (entra a terminal, se revierte y vuelve el mismo dia → sigue `n = 1`) |
| **R35** | inmutabilidad hacia atras | `analytics-daily-job.test.ts:170` — se agregan D−1 y D+1, se corre D y las filas vecinas quedan **identicas fila a fila, `updated_at` incluido**. **Con la rebaja fijada en R49**: la inmutabilidad es estructural solo en la dimension `estatus` |
| **R36** | tolerar la fila **huerfana** del catalogo | `analytics-daily-job.test.ts:319` — el estatus `en_fulfillment` no descarta la orden ni hace fallar la corrida: `filasEscritas = 1` y la fila sale con ese estatus. Comprobado contra la base que el caso ocurre de verdad (37 referencias en `orden_historial_estado`) |

**Y el duodecimo, declarado TEXTO:**

| R de la 123 | que pedia | por que se declara texto |
|---|---|---|
| **R15** | que el `apply` falle si el motor no soporta `NULLS NOT DISTINCT` (sin fallback ni `IF NOT EXISTS`) | **No es falsable desde esta feature.** Es una propiedad del **despliegue** —del motor contra el que se aplica la migracion—, no del job: ningun test de la 124 puede provocar que Postgres deje de soportar la clausula. Su unico juez sigue siendo `tests/integration/db/analytics-daily-migration.test.ts:181`, una regex sobre `migration.sql`. Lo que **si** se mide es su CONSECUENCIA: que los cubos con NULL no se dupliquen (R28 de la 123, arriba) |

**Cuenta final: 11 medidos, 1 texto.** Coincide con la de `requirements.md` R44 y con la que el
reviewer comprobo uno a uno.

---

## 8. Cierre del flanco: los tres rojos deterministas que la 124 dejo en tests AJENOS

La implementacion no cambio; esto es solo el frente que quedaba abierto en suites de otras
features. Nada de lo de abajo afloja una asercion.

### 8.1 Las dos listas CERRADAS de la cola de jobs (rojos 1 y 2)

`tests/integration/api/procesar-jobs-geocodificacion.test.ts` y
`tests/integration/api/procesar-jobs-webhook-estado.test.ts` enumeran con `toEqual` sobre un
array fijo el conjunto **exacto** de handlers y de recurrencias. Ese `toEqual` es lo unico que
mide que un refactor no **pierda** un handler, asi que se **actualizo la lista**, no se
convirtio en `toContain` / `arrayContaining`.

| archivo | cambio |
|---|---|
| `procesar-jobs-geocodificacion.test.ts` | `analitica_rollup_diario` al frente de la lista ordenada de handlers (7); recurrencias: `size` cerrado 1 -> **2** + `has("analitica_rollup_diario")` |
| `procesar-jobs-webhook-estado.test.ts` | idem en handlers; la lista de recurrencias pasa a `["liberar_reprogramadas", "analitica_rollup_diario"]` (orden de INSERCION, que es lo que devuelve `Map.keys()`) |

**Mutaciones, ejecutadas y revertidas** (sonda aplicada, test corrido, rojo observado,
`grep SONDA_MUT_124` vacio y `git diff` de `route.ts` sin residuo):

| # | sonda en `app/api/cron/procesar-jobs/route.ts` | observado |
|---|---|---|
| C1 | se retira `handlers.set("whatsapp_template_sync", ...)` | **ROJO en los dos archivos**: `expected [ 'analitica_rollup_diario', …(5) ] to deeply equal [ 'analitica_rollup_diario', …(6) ]`, diff `- "whatsapp_template_sync"`; `2 failed \| 7 passed` |
| C2 | se retira `recurrencias.set("liberar_reprogramadas", ...)` | **ROJO en los dos**: `expected false to be true` (geocodificacion) y `expected [ 'analitica_rollup_diario' ] to deeply equal [ 'liberar_reprogramadas', …(1) ]` (webhook); `2 failed \| 7 passed` |

O sea: las listas siguen discriminando la **perdida** de un tipo, que es para lo que existen.

### 8.2 El censo de `order_status` y la fila huerfana (rojo 3)

`tests/unit/guards/censo-order-status-rename.test.ts` cazaba `en_fulfillment` en dos archivos
nuevos de esta feature. **Primero se verifico el hecho contra `localhost:5432/ordenex`** (sonda
`pg` en la raiz del worktree, borrada despues; `current_database()=ordenex`,
`inet_server_port()=5432`), porque allowlistear un caso imaginario seria peor que el rojo:

```
order_status: 22 filas, entre ellas `en_fulfillment` (id 211ca0cb-…67eae)
referencias: orden.estatus_id = 0
             orden_historial_estado.estatus_origen_id  = 37
             orden_historial_estado.estatus_destino_id = 37
             analytics_daily.estatus_id = 0
```

**La fila existe y no es inerte: 37 filas de historial la referencian.** Por eso el `DELETE`
condicional de la migracion de la 155 quedo NO-OP, y por eso el estatus congelado que calcula
el rollup **puede** salir con ese id en un `GROUP BY` real. El caso de R45 esta probando algo
que pasa de verdad.

Resolucion, mas estrecha que allowlistear los dos archivos:

1. **`tests/integration/db/_semilla-rollup.ts`: se reescribio el comentario.** Ahi el literal
   estaba **solo en prosa** (un doc-comment del campo `estatus`), o sea que era evitable sin
   perder nada. Es el mismo criterio que ya se aplico en §4.2 con los cuatro comentarios del
   escritor: si el literal se puede quitar reescribiendo una frase, se reescribe la frase y no
   se toca el guardia. **Una entrada menos en la allowlist.**
2. **`tests/integration/db/analytics-daily-job.test.ts`: entrada nueva en la allowlist, con su
   justificacion al lado** (estilo de las entradas existentes: por que conserva el literal y
   cuando se retira). Ahi el literal es **dato de entrada** —siembra la transicion hacia la
   fila huerfana— y no hay forma de probar la tolerancia sin nombrarla; construirlo por
   concatenacion seria evadir el censo, no cumplirlo, como ya dice la entrada de
   `definiciones-catalogo.guardia.test.ts`.

**Mutaciones sobre la allowlist:**

| # | sonda | esperado | observado |
|---|---|---|---|
| A1 | otro value retirado (`devuelta_origen`) dentro de `analytics-daily-job.test.ts` | rojo | **VERDE — la entrada exime el ARCHIVO ENTERO, no el token.** Ver 8.3 |
| A2 | `en_fulfillment` en `_semilla-rollup.ts` (el archivo NO allowlisteado) | rojo | **ROJO**: `+ "tests\integration\db\_semilla-rollup.ts -> en_fulfillment"` |

A2 confirma que la entrada nueva es estrecha: cubre un archivo, no la carpeta.

### 8.3 Dos cosas que huelen, dejadas como estan (guardia ajeno, no se rediseña)

1. **La allowlist indexa por `path.basename`, no por ruta.** `ALLOWLIST.has(path.basename(file))`
   deja pasar **cualquier** archivo futuro llamado `analytics-daily-job.test.ts` en cualquier
   carpeta del arbol. Es la 12.ª entrada que hereda ese ensanchamiento, no un defecto que
   introduzca esta feature.
2. **La exencion es por archivo, no por token** (mutacion A1): una vez dentro de la allowlist,
   ese archivo puede escribir los **siete** values retirados sin que el censo diga nada. La
   entrada nueva no abre mas que las once anteriores, pero abre eso.

Las dos se **reportan** y no se tocan: arreglarlas es cambiar el mecanismo de un guardia de la
135/153/155 y afecta a las once entradas existentes, no a esta.

### 8.4 Verificacion final del flanco

| medicion | comando | resultado |
|---|---|---|
| typecheck | `pnpm run typecheck` | **0 errores** |
| lint | `pnpm run lint` | **0 errores, 18 warnings** — delta 0 contra el baseline |
| suite | `pnpm test` | **732 archivos, 8967 tests**; `1 failed \| 8966 passed` |

El total de archivos se comparo contra el numero de referencia (**732**) antes de creerse el
conteo: no hubo «unhandled errors» de workers ni archivos omitidos.

**El unico rojo es `tests/components/descarga/WalletPropsDescarga.test.tsx`** («por encima del
tope rechaza… y NO produce archivo», timeout a los 20 s tras 23,1 s), que es **deuda heredada de
`dev`** y ya estaba en el baseline de §0. No aparecio ningun flake en esta corrida.
