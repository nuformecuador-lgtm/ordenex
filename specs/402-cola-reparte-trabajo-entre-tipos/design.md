# Feature 402 — La cola reparte el trabajo entre tipos (design)

> El CÓMO técnico. Verificado contra el código real: `lib/repositories/JobRepository.ts`
> (`claimBatch`, L95-124), `lib/interfaces/repositories/IJobRepository.ts`,
> `lib/services/JobQueueService.ts`, `lib/interfaces/services/IJobQueueService.ts`,
> `lib/config/jobs.ts`, `app/api/cron/procesar-jobs/route.ts`,
> `tests/unit/services/job-queue-service.test.ts`,
> `tests/integration/repositories/job-find-by-dedupe-keys.test.ts`,
> `tests/integration/db/_postgres-real.ts`, `tests/integration/db/jobs-cola-migration.test.ts`,
> `db/schema.prisma` (enum `JobTipo`, 9 valores hoy), y `specs/90-jobs-cola-infra/`.

## Visión general

El defecto vive en UNA sola sentencia: el `$queryRaw` de `JobRepository.claimBatch` selecciona
candidatos con `ORDER BY "run_after" ASC LIMIT $limit`, una noción de antigüedad **global**,
sin partición por `tipo`. Cuando un tipo acumula más candidatos vencidos que `limit`, esa
antigüedad global lo pone siempre delante y los demás tipos —aunque tengan candidatos
vencidos hace rato— nunca aparecen en el `RETURNING`.

El arreglo cambia **solo la regla de selección** dentro de esa misma sentencia: en vez de
ordenar por antigüedad global, se calcula un **turno por tipo** (antigüedad *dentro* del
tipo) y se compone el lote tomando primero el turno 1 de cada tipo presente, luego el turno
2, etc. Nada más cambia: ni la firma de `claimBatch`, ni el DTO de salida, ni el contrato de
`IJobRepository`, ni las capas de `JobQueueService`/`procesar-jobs`.

```
app/api/cron/procesar-jobs/route.ts     Controller — SIN CAMBIOS
  → IJobQueueService.drenar(limit)
lib/services/JobQueueService.ts          Service — SOLO añade el log de diagnóstico (R8)
  → IJobRepository.claimBatch            SIN CAMBIO DE FIRMA
lib/repositories/JobRepository.ts        Repository — ÚNICO cambio de lógica: la SENTENCIA
                                          del claim reparte por tipo antes de aplicar LIMIT
  → Postgres tabla jobs                  SIN CAMBIO DE ESQUEMA (ninguna migración)
```

---

## Garantías conservadas (feature 90 / cabecera de `claimBatch`)

Explícitamente, este diseño **conserva**:

1. **Atomicidad de una sola sentencia.** El reparto se calcula dentro del MISMO `$queryRaw`
   que hoy ejecuta el claim; no se añade una segunda consulta ni una transacción explícita
   (R7). Sigue siendo un round-trip por corrida.
2. **`FOR UPDATE SKIP LOCKED` y exclusión mutua (R10/R11 de la 90).** Dos workers concurrentes
   siguen sin poder recibir la misma fila; el `SKIP LOCKED` se mantiene idéntico en su
   semántica, solo cambia CUÁLES filas se intentan bloquear primero (R5/R6 de esta ficha).
   **Pero `SKIP LOCKED` solo cubre uno de los dos modos de competencia** —el del lock todavía
   abierto—. El otro, el del competidor que ya commiteó (que es el NORMAL, porque el claim
   corre en autocommit), lo sostiene el predicado repetido en la CTE `bloqueados`: §1,
   "Por qué el predicado de candidato se REPITE". Sin él, la reescritura ROMPE este punto, y
   está medido que lo rompe.
3. **Rescate de `processing` colgados por `visibilityCutoff` (R13 de la 90).** Un candidato
   rescatado compite por su turno igual que un `pending` vencido (R6); no se le da trato
   especial ni se le excluye del reparto.
4. **Incremento de `intentos` al reclamar.** El `UPDATE` final sigue siendo el mismo:
   `intentos = j.intentos + 1`, `locked_at = $now`, `updated_at = $now`, `estado = 'processing'`.
5. **`now` / `visibilityCutoff` inyectados (no `NOW()` de Postgres).** `ClaimOpts` no cambia;
   los tests siguen siendo deterministas sin depender del reloj del servidor.

Lo único que deja de ser cierto: la ORDER BY global de antigüedad ya no es la única señal de
prioridad. Eso es exactamente lo que esta ficha corrige.

---

## 1. La sentencia — antes y después

### Antes (defecto medido)

```sql
WITH candidatos AS (
  SELECT "id" FROM "jobs"
  WHERE (
    ("estado" = 'pending'    AND "run_after" <= $now)
    OR
    ("estado" = 'processing' AND "locked_at" < $visibilityCutoff)
  )
  ORDER BY "run_after" ASC
  FOR UPDATE SKIP LOCKED
  LIMIT $limit
)
UPDATE "jobs" AS j
SET "estado" = 'processing', "locked_at" = $now,
    "intentos" = j."intentos" + 1, "updated_at" = $now
FROM candidatos c
WHERE j."id" = c."id"
RETURNING j.*;
```

### Después (reparto por turnos)

Postgres **no permite** combinar una función de ventana con `FOR UPDATE` en la misma
`SELECT` ("FOR UPDATE is not allowed with window functions"). Por eso el turno se calcula en
una CTE previa SIN bloqueo, se recorta a `$limit` filas en una segunda CTE, y el bloqueo se
aplica al final sobre ESE conjunto ya fijado (patrón estándar: "rankear en una CTE, bloquear
en la siguiente"):

```sql
WITH candidatos AS (
  SELECT "id", "tipo", "run_after",
         ROW_NUMBER() OVER (PARTITION BY "tipo" ORDER BY "run_after" ASC) AS "turno"
  FROM "jobs"
  WHERE (
    ("estado" = 'pending'    AND "run_after" <= $now)
    OR
    ("estado" = 'processing' AND "locked_at" < $visibilityCutoff)
  )
),
priorizados AS (
  SELECT "id" FROM candidatos
  ORDER BY "turno" ASC, "run_after" ASC   -- R1: turno 1 de TODOS los tipos antes que el turno 2 de ninguno
  LIMIT $limit
),
bloqueados AS (
  SELECT j."id" FROM "jobs" j
  JOIN priorizados p ON p."id" = j."id"
  WHERE (                                  -- ⚠ OBLIGATORIO, no es redundante: ver más abajo
    (j."estado" = 'pending'    AND j."run_after" <= $now)
    OR
    (j."estado" = 'processing' AND j."locked_at" < $visibilityCutoff)
  )
  ORDER BY j."run_after" ASC
  FOR UPDATE OF j SKIP LOCKED              -- R5/R10/R11: misma exclusión mutua de siempre
)
UPDATE "jobs" AS j
SET "estado" = 'processing',
    "locked_at" = $now,
    "intentos" = j."intentos" + 1,
    "updated_at" = $now
FROM bloqueados b
WHERE j."id" = b."id"
RETURNING j.*;
```

`FOR UPDATE OF j` (en vez de `FOR UPDATE` a secas) es deliberado: al haber un `JOIN` contra la
CTE `priorizados`, hay que decir explícitamente que la fila a bloquear es la de `jobs`, no un
intento de bloquear la CTE.

`WHERE`, las dos ramas del `OR` (R7/R12 y R13 de la 90) y el `UPDATE` final **no cambian una
sola palabra** respecto al SQL actual; el único añadido es la partición por `tipo` antes del
`LIMIT`.

### ⚠ Por qué el predicado de candidato se REPITE en `bloqueados`

**Esto no es código de más, y no se puede quitar: sin él la sentencia entrega la misma fila a
dos workers.** La primera versión de este design lo omitía —`JOIN` por id como única
condición— y el reviewer de la ficha lo MIDIÓ contra Postgres real, con la sentencia exacta de
producción (`FOR UPDATE OF j SKIP LOCKED` incluido) y la ventana ensanchada con 300.000
candidatos:

```
[SKIP LOCKED real, 300000 candidatos, commit del competidor a los 150 ms]
  bloqueados SIN el predicado repetido -> A tardó 259 ms, reclamó 5  <-- LA MISMA FILA QUE B, DOS VECES
  bloqueados CON el predicado repetido -> A tardó 172 ms, reclamó 4  (sin repetidas)
```

**El mecanismo.** En `READ COMMITTED` toda la sentencia usa el snapshot que tomó al empezar.
Si otro worker reclama esas filas y **commitea** mientras esta sentencia sigue viva, al llegar
al bloqueo Postgres encuentra una versión más nueva y aplica *EvalPlanQual*: **re-evalúa las
condiciones de la consulta sobre la fila NUEVA** y la descarta si ya no las cumple. Con el
`JOIN` por id como única condición, una fila recién reclamada por otro **la sigue cumpliendo**
(su id no ha cambiado) y se entrega por segunda vez. Con el predicado repetido, esa fila ya es
`processing` con `locked_at` reciente —o `pending` con un `run_after` futuro, si el competidor
la re-agendó con backoff— y se cae, que es exactamente lo que hacía el `FOR UPDATE` de la
feature 90 al vivir **dentro** del `WHERE`.

**Y el modo COMMITEADO es el normal, no el raro:** `JobQueueService.drenar` llama a
`claimBatch` en **autocommit**, así que los locks de un worker duran **una sentencia**
(milisegundos), no lo que dura el procesado del lote. El caso "el competidor todavía tiene el
lock abierto" —el que cubre `SKIP LOCKED`— es el menos frecuente de los dos.

**La exposición CRECE con la saturación.** La sentencia nueva ya no puede cortar el escaneo en
`limit` filas (§2): el `ROW_NUMBER()` obliga a ver todos los candidatos, así que la duración
del statement —y con ella la ventana snapshot→bloqueo— sube con el tamaño del conjunto
candidato. Medido: 20k candidatos → 30 ms; 60k → 97 ms; 150k → 252 ms; 300k → 436 ms. Es decir,
la carrera es **más probable justo bajo la saturación que esta ficha existe para atender**.

**Consecuencia para quien lea esto mañana:** las tres CTEs no se pueden colapsar en una
(Postgres prohíbe `FOR UPDATE` con funciones de ventana) **y el predicado de `bloqueados` no se
puede borrar por "duplicado"**. Las dos cosas están cubiertas por tests de comportamiento en
`tests/integration/db/job-repository-claim-concurrente.int.test.ts` ("modo 2"): mutar
`locked_at < cutoff` o `run_after <= now` a `IS NOT NULL` dentro de ese `WHERE` los pone rojos.

### Efecto declarado: bajo solape de dos claims, el segundo lote puede venir incompleto

`priorizados` fija los `limit` ids **antes** de bloquear, así que si otro worker tiene algunas
de esas filas bloqueadas, el segundo claim se lleva **solo el resto** (puede ser ninguna),
aunque queden más candidatos por debajo. Antes el `SKIP LOCKED` vivía dentro del `LIMIT` y el
segundo worker se llevaba las siguientes N libres.

**No es una regresión operativa, y este es el porqué medido:**

1. `claimBatch` corre en **autocommit** (`JobQueueService.drenar` no abre transacción): los
   locks duran **un statement**, no el procesado del lote.
2. Si la corrida N+1 arranca después de que la N commiteara su claim, las filas de la N ya son
   `processing` con `locked_at` reciente: **ni siquiera entran en `candidatos`**, y el segundo
   lote se llena entero.
3. El caso "una corrida tarda más de un minuto y se solapa con la siguiente" **no degrada
   nada**: lo que se solapa es el *procesado* de la N con el *claim* de la N+1, y el claim de
   la N commiteó hace rato. Haría falta que dos `claimBatch` se solaparan, o sea que el claim
   solo tardase más de 60 s.
4. **Coste máximo si ocurriese:** un lote más corto. Ninguna fila se pierde ni se retrasa más
   allá de la corrida siguiente (60 s), y no hay livelock posible porque los locks son
   transitorios.

Queda escrito aquí —y no solo en la bitácora— porque la propiedad "cada worker se lleva N
libres" **dejó de ser cierta**: el día que se añada un segundo worker, un disparo manual o se
baje la frecuencia del cron, hay que releer este párrafo. El comportamiento está fijado en un
test con nombre propio (`bajo solape, el segundo lote viene INCOMPLETO`).

### Por qué esta regla resuelve los tres escenarios del brief

- **Un solo tipo activo (R2).** Si `candidatos` solo tiene un `tipo`, `turno` es 1..N para ese
  único tipo y `ORDER BY turno, run_after LIMIT $limit` selecciona exactamente los `limit` más
  antiguos de ese tipo — idéntico al comportamiento actual. El reparto por tipo nunca reduce
  el lote cuando no hay competencia entre tipos.
- **Pico legítimo del tipo mayoritario con minoritarios activos (R3).** Ejemplo con las
  proporciones del incidente (82 `webhook_estado`, 14 `whatsapp_bienvenida`, 6
  `geocodificacion`, 2 `optimizacion_ruta`, `limit=10`): turno 1 de los 4 tipos (4 filas),
  turno 2 de los 4 tipos (4 filas más, van 8), turno 3 solo lo alcanzan `webhook_estado` y
  `whatsapp_bienvenida` (`geocodificacion` y `optimizacion_ruta` ya se agotaron en turno 2) —
  2 filas más completan el `limit=10`. Los 4 tipos aparecen en la PRIMERA corrida tras el
  arreglo (antes: cero apariciones de los 3 minoritarios). El tipo mayoritario sigue
  recibiendo la mayor parte del lote (8 de 10 en este ejemplo) porque los turnos que los
  minoritarios no pueden llenar los ocupa él, sin tope artificial.
- **Reproducción exacta del incidente.** Con esta regla, `geocodificacion` (6 vencidos) entra
  en la corrida INMEDIATA siguiente (1 minuto después de vencer), no 30 minutos después.

---

## 2. Coste

**Sigue siendo UNA sola sentencia / UN solo round-trip por corrida** (R7): no se agrega
ninguna consulta ni transacción nueva. El coste adicional vive DENTRO de esa sentencia:

- La CTE `candidatos` ya no puede aprovechar el patrón "índice parcial de R3 (`run_after`)
  + `ORDER BY run_after LIMIT n`" para cortar el escaneo apenas encuentra `n` filas: para
  calcular `ROW_NUMBER() OVER (PARTITION BY tipo ...)` Postgres necesita ver TODO el conjunto
  candidato (todos los `pending` vencidos + `processing` colgados de TODOS los tipos) y
  ordenarlo, no solo los primeros `limit`.
- **Magnitud medida:** en el incidente que origina esta ficha, el conjunto candidato total
  era 104 filas (82+14+6+2). Particionar y ordenar 104 filas es un costo de microsegundos;
  no justifica un índice nuevo hoy.
- **Cuándo dejaría de ser trivial:** si un tipo saturado llega a acumular varios miles de
  filas vencidas de forma sostenida (saturación no mitigada por la feature 403), el `candidatos`
  escanea todas esas filas en cada corrida (cada minuto). Se decide DELIBERADAMENTE no
  añadir aquí un índice compuesto `(tipo, run_after) WHERE estado = 'pending'` — sería
  especular sobre un volumen no medido y violaría el arreglo mínimo. Si telemetría futura
  muestra ese crecimiento, la mitigación es ese índice (una migración aditiva, sin tocar esta
  sentencia).
- El `bloqueados`/`UPDATE` final opera sobre a lo sumo `limit` filas, igual que hoy.

---

## 3. Diagnóstico (R8)

`JobQueueService.drenar` ya recibe el array `jobs` devuelto por `claimBatch` (sin consulta
adicional: el desglose por tipo se calcula agrupando ESE array, que ya está en memoria).
Cambio propuesto, todo dentro de `lib/services/JobQueueService.ts`:

```ts
export interface JobsLogger {
  warn(message: string): void;
  /** NUEVO, OPCIONAL — ver "por qué opcional" abajo. */
  info?(message: string): void;
}
```

En `drenar(limit)`, tras reclamar `jobs`, si `jobs.length > 0`:

```ts
const porTipo = jobs.reduce<Record<string, number>>((acc, j) => {
  acc[j.tipo] = (acc[j.tipo] ?? 0) + 1;
  return acc;
}, {});
this.logger.info?.(`[procesar-jobs] reclamados por tipo: ${JSON.stringify(porTipo)}`);
```

Sin `payload`, sin `id`, sin datos de dominio — solo `tipo` (un valor de enum) y un conteo,
igual de "sin PII" que el `warn` existente (R18/R19 de la 90).

### Por qué `info` es OPCIONAL y no un método requerido

Al menos 10 archivos de test instancian `JobQueueService` con un logger fake que **solo**
implementa `warn` (p. ej. `{ warn: () => {} }` en
`tests/integration/api/procesar-jobs-webhook-estado.test.ts`,
`tests/integration/api/procesar-jobs-geocodificacion.test.ts`,
`tests/unit/services/job-queue-service.test.ts`, entre otros de features 91/99/109/124).
Si `info` fuera un método requerido de la interfaz, el typecheck de TODOS esos archivos se
rompería sin que ninguno de ellos tenga relación con esta ficha. Se llama con
`this.logger.info?.(...)` (optional chaining) precisamente para que un fake que no lo
implementa siga siendo válido en tiempo de compilación y en runtime.

### Por qué NO se extiende `DrenarResult` en su lugar

Alternativa considerada: añadir un campo `porTipo` al contrato de conteos de `drenar` (el que
hoy responde `{ procesados, ok, fallidos, reintentados, muertos }`). **Descartada**: ese
contrato quedó FIJADO por una decisión humana explícita en el gate F1.4 de la feature 90
(`specs/90-jobs-cola-infra/requirements.md`, "Decisiones del gate F1.4", punto 5), y varios
tests de features posteriores (90, 92, 99, 109, 124, 128) comparan ese objeto con `toEqual`
estricto — un `toEqual` sobre un literal frozen es a menudo el contrato en sí (ver
convención del repo sobre "literal: contrato o polizón"). Tocarlo obligaría a actualizar
todos esos tests para un beneficio (verlo también en el JSON de respuesta del cron, que hoy
nadie persiste) que el log ya cubre sin ese radio de impacto.

---

## 4. Sin cambios de esquema

No hay migración nueva: `tipo` ya es una columna indexada indirectamente por el índice
parcial de R3 (que sigue existiendo, solo que esta sentencia ya no puede explotarlo para
cortar temprano — ver "Coste"). No se toca `db/schema.prisma`, ni `IJobRepository`
(la firma de `claimBatch` es idéntica), ni `ClaimOpts`, ni `JobDTO`.

---

## Alternativas descartadas

- **A. Cupo fijo por tipo calculado con una consulta previa** (`SELECT COUNT(DISTINCT tipo)`
  para dimensionar `ceil(limit / tipos_distintos)`, y una segunda consulta de claim con ese
  cupo por tipo). DESCARTADA: exige DOS consultas por corrida (viola R7), y la redistribución
  del cupo sobrante de un tipo con pocos candidatos hacia el tipo mayoritario (R3) necesitaría
  lógica adicional en la aplicación entre ambas consultas — más caro y más complejo que el
  `ROW_NUMBER()` particionado, que resuelve reparto Y redistribución en una sola sentencia.

- **B. Prioridad configurable por tipo (columna de peso, tabla de configuración o env por
  tipo).** DESCARTADA explícitamente por el alcance de esta ficha: una regla FIJA (turnos)
  resuelve el caso medido sin superficie nueva (tabla, UI o env) que alguien tenga que
  mantener, y sin el riesgo de que una prioridad mal configurada vuelva a producir el mismo
  efecto (un tipo con prioridad alta ahogando a los demás, ahora "a propósito").

- **C. Lista de tipos hard-codeada con cupos fijos** (p. ej. reservar `LIMIT 3` para cada tipo
  conocido hoy). DESCARTADA: el enum `job_tipo` ya sumó 8 valores desde la feature 90 (91, 92,
  99, 109×2, 124×2 y el original); una regla que enumera tipos por nombre viola "sin hardcode
  de contexto" (`docs/architecture.md`, principio 4) y exige tocar `JobRepository` cada vez que
  se agregue un tipo — lo que R9 prohíbe explícitamente.

- **D. Round-robin a nivel de CRON** (alternar qué tipo se procesa según el minuto/segundo de
  la corrida, con un puntero persistido de "a quién le tocó la última vez"). DESCARTADA:
  degradaría la latencia de TODOS los tipos —incluidos los de baja carga que hoy nunca compiten
  por turno— para resolver un problema que solo ocurre bajo saturación; además necesita estado
  persistido nuevo (una fila o config de "último tipo servido"), que es más rediseño que
  arreglo.

- **E. Subir `JOBS_BATCH_SIZE`.** DESCARTADA: no resuelve el problema estructural — con
  volumen suficiente de un tipo saturado (el incidente ya tenía 82, más que cualquier lote
  razonable), cualquier tamaño finito de lote puede volver a llenarse solo con ese tipo. El
  `ORDER BY` sin noción de tipo es la causa; agrandar el lote no la toca.

- **F. Calcular el turno con una subconsulta por tipo (`LATERAL` + `LIMIT` por tipo, unidas
  con `UNION ALL`), en vez de `ROW_NUMBER() OVER (PARTITION BY ...)`.** DESCARTADA: requiere
  conocer de antemano la lista de tipos presentes para construir el `UNION ALL` (una consulta
  previa, o generar SQL dinámico desde la app con los valores del enum — de nuevo hardcode o
  una segunda consulta). `ROW_NUMBER()` particionado calcula el turno de TODOS los tipos
  presentes en una sola pasada, sin conocerlos de antemano (R9).

---

## Huecos declarados (no resueltos aquí)

- **Tipos distintos con candidatos > `JOBS_BATCH_SIZE`.** Documentado como pregunta abierta 1
  en requirements.md. Con el reparto por turnos, si ese escenario ocurre, 1+ tipos quedan sin
  turno en ESA corrida puntual. Nota de por qué no es catastrófico: el desempate secundario
  `ORDER BY ..., run_after ASC` hace que, en la corrida SIGUIENTE, los candidatos del tipo
  postergado ya tengan un `run_after` más antiguo que los recién llegados de otros tipos, lo
  que los prioriza en el desempate — un respaldo por envejecimiento, no una garantía dura de
  "todo tipo recibe turno en cada corrida".
- **R8 no puede diagnosticar "tipo con candidatos pero cero reclamados".** Solo reporta los
  tipos que SÍ aparecen en `jobs` (lo que `claimBatch` ya devuelve). Ver pregunta abierta 2.
