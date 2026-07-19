# Feature 90 — Infraestructura de cola de background jobs (design)

> El CÓMO técnico. Todos los nombres/rutas citados se verificaron contra el código real
> (`liberar-reprogramadas/route.ts`, `lib/config/cron.ts`, `ApiKeyRepository.ts`,
> `LiberacionReprogramadaService.ts`, `OrdenRepository.ts`, `db/migrations/*/`, `schema.prisma`,
> `lib/utils/fecha-cr.ts`, `vercel.json`, `corte-diario-route.test.ts`).

## Visión general

Cola *transactional-outbox + worker* en Postgres. Un único disparador temporal (Vercel Cron
cada minuto → `GET /api/cron/procesar-jobs`) reclama un lote de jobs vencidos con
`FOR UPDATE SKIP LOCKED`, los ejecuta vía handlers registrados por tipo, y aplica
complete / backoff / dead-letter. El cron diario `liberar-reprogramadas` (feature 46) deja de
ser una entrada de `vercel.json` y pasa a ser un **job recurrente** de esta cola, con la lógica
de liberación **reusada tal cual** desde `LiberacionReprogramadaService`.

Capas (patrón `docs/architecture.md`, espejando `liberar-reprogramadas`):

```
app/api/cron/procesar-jobs/route.ts     Controller: HTTP + auth Bearer, sin lógica ni queries
  → IJobQueueService.drenar(limit)
lib/services/JobQueueService.ts          Service: orquesta claim → handler → complete/fail/re-agenda
  → IJobRepository (claimBatch/complete/fail/enqueue)
  → Map<JobTipo, JobHandler>             handlers por tipo (liberar_reprogramadas envuelve el service 46)
lib/repositories/JobRepository.ts        Repository: solo Prisma ($queryRaw para el claim atómico)
  → Postgres tabla jobs
```

---

## 1. Modelo de datos

### 1.1 Enums nativos Postgres (schema.prisma)

Patrón verificado: `GestionResultado`/`OrdenHistorialOrigenTipo` son enums nativos con `@@map`.

```prisma
enum JobTipo {
  liberar_reprogramadas // feature 90; 91/92 añaden valores con ALTER TYPE ADD VALUE
  @@map("job_tipo")
}

enum JobEstado {
  pending
  processing
  done
  failed
  @@map("job_estado")
}
```

### 1.2 Modelo `Job` → tabla `jobs`

Convenciones verificadas: `id String @id @default(uuid())`, campos `@map("snake_case")`,
auditoría `createdAt/updatedAt`, JSONB con `@db.JsonB`.

```prisma
model Job {
  id          String    @id @default(uuid())
  tipo        JobTipo
  payload     Json      @default("{}") @db.JsonB
  estado      JobEstado @default(pending)
  intentos    Int       @default(0)
  maxIntentos Int       @map("max_intentos")
  runAfter    DateTime  @default(now()) @map("run_after")
  lockedAt    DateTime? @map("locked_at")
  lastError   String?   @map("last_error")
  dedupeKey   String?   @unique @map("dedupe_key")
  createdAt   DateTime  @default(now()) @map("created_at")
  updatedAt   DateTime  @updatedAt @map("updated_at")

  @@map("jobs")
}
```

> Nota: `@unique` en `dedupeKey` cubre el modelado Prisma, pero el índice REAL es **único
> parcial** (`WHERE dedupe_key IS NOT NULL`), que se añade **a mano** en `migration.sql` (Prisma
> no genera índices parciales). Igual con el índice parcial de selección. `db:migrate:create`
> genera el andamiaje; la parte parcial + RLS se edita a mano (patrón documentado en la memoria
> del repo y en migraciones previas).

### 1.3 Migración `db/migrations/<ts>_jobs_cola/`

`migration.sql` (UP), aditiva, en orden:

1. `CREATE TYPE "job_tipo" AS ENUM ('liberar_reprogramadas');`
2. `CREATE TYPE "job_estado" AS ENUM ('pending','processing','done','failed');`
3. `CREATE TABLE "jobs" (...)` con `payload` `JSONB NOT NULL DEFAULT '{}'`, `estado` default
   `'pending'`, `intentos`/`max_intentos` `INTEGER`, `run_after` `TIMESTAMP(3) NOT NULL DEFAULT
   CURRENT_TIMESTAMP`, `locked_at`/`last_error`/`dedupe_key` nullable, `created_at`/`updated_at`
   con default `CURRENT_TIMESTAMP`, PK `jobs_pkey`.
4. **Índice parcial de selección (R3):**
   `CREATE INDEX "jobs_run_after_pending_idx" ON "jobs" ("run_after") WHERE "estado" = 'pending';`
5. **Índice único parcial de dedupe (R4):**
   `CREATE UNIQUE INDEX "jobs_dedupe_key_key" ON "jobs" ("dedupe_key") WHERE "dedupe_key" IS NOT NULL;`
6. **RLS (R5)** (patrón `api_key`): `ALTER TABLE "jobs" ENABLE ROW LEVEL SECURITY;` sin policies.

`down.sql` (DOWN, R6), revierte exacto:
`DROP TABLE IF EXISTS "jobs";` (arrastra índices, PK y RLS) →
`DROP TYPE IF EXISTS "job_estado";` → `DROP TYPE IF EXISTS "job_tipo";`

---

## 2. Config — `lib/config/jobs.ts` (clon de `lib/config/cron.ts`)

Función `loadJobsConfig()` que lee `process.env` con defaults:

| Env | Default | Uso |
|-----|---------|-----|
| `JOBS_BATCH_SIZE` | 10 | tamaño del lote en `claimBatch`/`drenar` |
| `JOBS_MAX_ATTEMPTS` | 5 | `max_intentos` por defecto al encolar |
| `JOBS_BACKOFF_BASE_MS` | 60000 (1 min) | base del backoff exponencial |
| `JOBS_BACKOFF_CAP_MS` | 3600000 (1 h) | tope del backoff |
| `JOBS_VISIBILITY_TIMEOUT_MS` | 3600000 (1 h) | umbral de rescate de `processing` colgados |

El secreto de autorización **reutiliza `CRON_SECRET`** vía `loadCronConfig()` ya existente
(no se añade un env de secreto nuevo). Defaults numéricos parseados con validación; valor
inválido/ausente → default (nada se hardcodea en el código de negocio, R21).

---

## 3. Repository — `IJobRepository` + `JobRepository`

Interfaz en `lib/interfaces/repositories/IJobRepository.ts`; impl en
`lib/repositories/JobRepository.ts`. Constructor recibe `Pick<PrismaClient, "job" |
"$transaction" | "$queryRaw" | "$executeRaw">` (estilo `ApiKeyRepository`). Devuelve DTOs
planos (`JobDTO`), no entidades Prisma. Sin lógica de negocio.

Métodos:

- `enqueue(tipo, payload, opts?, tx?)` — INSERT con
  `ON CONFLICT ("dedupe_key") DO NOTHING` (R7/R8). `opts` = `{ runAfter?, maxIntentos?,
  dedupeKey? }`. Si se pasa `tx`, se usa ese cliente (R9, soporte outbox para 91/92). Devuelve
  el `JobDTO` insertado o `null` si el conflicto lo omitió.
- `claimBatch(limit, opts?)` — **claim atómico (R10-R13)** vía `$queryRaw`. Ver §3.1.
- `complete(id)` — `UPDATE jobs SET estado='done', updated_at=now() WHERE id=$1` (R14).
- `fail(id, error, runAfter | null)` — si `runAfter` no es null → `estado='pending',
  run_after=$runAfter, last_error=$error`; si es null → `estado='failed', last_error=$error`
  (dead-letter). El **cálculo** de backoff/decisión terminal vive en el SERVICE (lógica de
  negocio), no aquí; el repo solo persiste (R15/R16).

### 3.1 `claimBatch` — sentencia atómica (NUEVO en el repo)

`FOR UPDATE SKIP LOCKED` **no existe hoy** en el repo. El patrón vecino
`$queryRaw + RETURNING dentro de $transaction` SÍ existe (`OrdenRepository.recibirLoteEnSatelite`
~L1216 y `asignarSateliteLote` ~L1272). `SKIP LOCKED` es el estándar de facto para colas en
Postgres: cada worker salta las filas ya bloqueadas por otro, sin espera ni deadlock, logrando
entrega exclusiva sin doble-procesamiento (R11).

CTE en una sola sentencia (parametrizada; `now` y `visibilityCutoff` derivados en el service e
inyectados para testeo determinista):

```sql
WITH candidatos AS (
  SELECT "id" FROM "jobs"
  WHERE (
    ("estado" = 'pending'    AND "run_after" <= $now)                 -- R7/R12: pendiente vencido, no futuro
    OR
    ("estado" = 'processing' AND "locked_at" < $visibilityCutoff)     -- R13: rescate por visibility timeout
  )
  ORDER BY "run_after" ASC
  FOR UPDATE SKIP LOCKED                                              -- R10/R11: exclusión mutua sin espera
  LIMIT $limit
)
UPDATE "jobs" AS j
SET "estado" = 'processing',
    "locked_at" = $now,
    "intentos" = j."intentos" + 1,
    "updated_at" = $now
FROM candidatos c
WHERE j."id" = c."id"
RETURNING j.*;
```

`$visibilityCutoff = now - JOBS_VISIBILITY_TIMEOUT_MS`. El índice parcial de R3 sirve la rama
`pending`; la rama `processing` es de bajo cardinal (jobs colgados), aceptable sin índice
dedicado en v1.

---

## 4. Service — `IJobQueueService` + `JobQueueService`

Interfaz en `lib/interfaces/services/IJobQueueService.ts`; impl en
`lib/services/JobQueueService.ts`. DI por constructor de INTERFACES (no `prisma`), patrón
`CorteDiarioService`/`LiberacionReprogramadaService`:

```ts
type JobHandler = (job: JobDTO) => Promise<void>;

new JobQueueService(
  repo: IJobRepository,
  handlers: Map<JobTipo, JobHandler>,
  config: JobsRuntimeConfig,            // batch/backoff/cap/maxAttempts (de loadJobsConfig)
  now: () => Date = () => new Date(),   // reloj inyectable (tests)
  logger: JobsLogger = defaultLogger,   // warn sin PII, patrón LiberacionLogger
)
```

`drenar(limit)`:

1. `claimBatch(limit, { now, visibilityCutoff })`.
2. Por cada job reclamado:
   - Busca el handler por `job.tipo`. Sin handler → `fail` como error controlado
     (config/registro incompleto), cuenta como fallido.
   - Ejecuta el handler:
     - **Éxito** → `complete(job.id)`; si el tipo es RECURRENTE, re-agenda la próxima
       ocurrencia (R23, ver §5).
     - **Fallo** → calcula: si `job.intentos >= config.maxAttemptsDe(job)` → `fail(id, msg,
       null)` (dead-letter, R16) y **además**, si es recurrente, re-agenda la próxima
       ocurrencia (R24 — un fallo terminal NO puede detener el job diario para siempre).
       Si aún quedan intentos → `fail(id, msg, now + backoff)` con
       `backoff = min(cap, base * 2^(intentos-1))` (R15).
3. Devuelve conteos agregados sin PII (contrato tentativo:
   `{ procesados, ok, fallidos, reintentados, muertos }`; ver pregunta abierta 5).

**Recurrencia (R23/R24/R25):** la re-agenda es un `enqueue` del mismo `tipo` con
`dedupeKey` de la próxima fecha CR y `runAfter` de la próxima corrida CR. `enqueue` hace
`ON CONFLICT DO NOTHING`, así que reintentos o corridas solapadas **no duplican** la próxima
ocurrencia (idempotencia por día CR, R25). Qué tipos son recurrentes y cómo calculan su
próxima ocurrencia se resuelve con una pequeña tabla/registro de "recurrencia por tipo"
(solo `liberar_reprogramadas` en v1), evitando `if` por nombre disperso.

---

## 5. Handler `liberar_reprogramadas` (reuso, R22)

Handler delgado (nuevo archivo, p. ej. `lib/services/jobs/liberar-reprogramadas-handler.ts` —
ruta a confirmar en tasks) que:

- Construye/recibe `ILiberacionReprogramadaService` con el mismo `buildService()` que la ruta
  actual (`LiberacionReprogramadaRepository` + `ZonaRepository` + `OrdenRepository`).
- Ejecuta `service.ejecutarLiberacion(startOfDayCR(now()))` — **sin reescribir** la lógica de
  clasificación de bodega/idempotencia por día (R22). `ejecutarLiberacion` ya es idempotente
  por día CR (la transición saca la orden de `reprogramada`), lo que hace seguro cualquier
  re-claim por visibility timeout o reintento.
- Metadatos de recurrencia: próxima corrida CR (00:00 vs 01:00 CR → **pregunta abierta 1**) y
  `dedupeKey = "liberar_reprogramadas:" + fechaCalendarioCR(proximaCorrida)`, usando
  `lib/utils/fecha-cr.ts` (`startOfDayCR`, `fechaCalendarioCR`).

**Seed inicial (R26):** siembra idempotente de la PRIMERA fila `liberar_reprogramadas` (por su
`dedupeKey` de la primera fecha CR objetivo) vía `enqueue` `ON CONFLICT DO NOTHING`. Se
entrega como script en `scripts/` (patrón de seeds existentes) o como migración de datos
idempotente — a decidir en tasks; en ambos casos re-ejecutable sin duplicar.

---

## 6. Controller — `app/api/cron/procesar-jobs/route.ts` (clon de `liberar-reprogramadas`)

Copia estructural exacta del molde verificado:

- `interface ProcesarJobsDeps { getSecret?; service?: IJobQueueService; now?: () => Date }`.
- `buildService()` con `getPrismaClient()` → `JobRepository` + `Map` de handlers +
  `loadJobsConfig()`.
- `bearerToken(req)` idéntico.
- `handleProcesarJobs(req, deps = {})`: **autoriza ANTES de efectos** (R17) —
  `expected = (deps.getSecret ?? (() => loadCronConfig().CORTE_DIARIO_SECRET))()`; si `expected`
  null / `provided` null / no coincide → `401` sin construir service. Con token válido →
  `withErrorHandler(() => service.drenar(config.batchSize))`; `isAppErrorShape` →
  `appErrorToResponse` (R19); si no, `200` con conteos sin PII (R18). Importa de `@/lib/errors`.
- `GET(req)` delgado → `handleProcesarJobs(req)`.

`vercel.json` (R20): añade `{ "path": "/api/cron/procesar-jobs", "schedule": "* * * * *" }` y
**elimina** el bloque `{ "path": "/api/cron/liberar-reprogramadas", "schedule": "0 6 * * *" }`.
Se conservan `corte-diario` y `generar-gastos-fijos` (fuera de alcance).

## 7. Ruta `liberar-reprogramadas` repurposed (R27)

`app/api/cron/liberar-reprogramadas/route.ts` **no cambia su código** (queda como disparo
manual on-demand con la misma auth `Bearer`/`CRON_SECRET` y respuesta de conteos). Su único
cambio de comportamiento operativo es dejar de tener `schedule` en `vercel.json`. Sus tests
existentes siguen válidos.

---

## Alternativas descartadas

- **A. Redis / worker persistente (BullMQ, etc.).** DESCARTADA (decisión humana). Requiere un
  proceso worker siempre vivo e infraestructura externa que Vercel serverless no ofrece.
  Postgres + Vercel Cron reutiliza la DB y el patrón de cron/secreto que el repo YA tiene, sin
  añadir un servicio nuevo que operar, monitorear y pagar.
- **B. Claim con `SELECT ... FOR UPDATE` SIN `SKIP LOCKED`.** DESCARTADA. Sin `SKIP LOCKED`, dos
  ejecuciones del cron que se solapen (una corrida lenta que pasa del minuto) bloquean la misma
  fila y la segunda espera al lock en vez de tomar OTRO trabajo → serialización y posible
  timeout. `SKIP LOCKED` da entrega exclusiva y paralelizable sin espera (R10/R11).
- **C. `estado='claimed'` con `UPDATE ... WHERE estado='pending'` optimista (sin `SKIP LOCKED`,
  reintento en app).** DESCARTADA. Funciona pero degrada bajo contención (muchos updates que
  no afectan filas, reintentos en app), y ya introducimos `FOR UPDATE SKIP LOCKED` que es el
  estándar y resuelve el caso de forma atómica en una sola sentencia.
- **D. Reescribir la liberación como lógica nativa del job (no reusar el service 46).**
  DESCARTADA. Duplicaría reglas de clasificación de bodega e idempotencia por día ya probadas
  en `LiberacionReprogramadaService`, con riesgo de divergencia. El handler debe ser un wrapper
  delgado (R22).
- **E. Un cron por tipo de job (mantener `liberar-reprogramadas` como cron y añadir crons por
  feature).** DESCARTADA. No escala a 91/92 y multiplica entradas de `vercel.json` y secretos.
  Un único drenador genérico (`procesar-jobs`) con handlers por tipo centraliza backoff,
  dead-letter y visibility timeout una sola vez.
- **F. `NOW()` de Postgres dentro del SQL del claim en vez de `$now` inyectado.** DESCARTADA
  para la parte testeable: inyectar `now`/`visibilityCutoff` como parámetros permite tests de
  integración deterministas de R12/R13 sin depender del reloj del servidor de DB.
