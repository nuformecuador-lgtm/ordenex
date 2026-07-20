-- Feature 90 (design §1.3): infraestructura de la cola de background jobs (patron
-- transactional-outbox + worker sobre Postgres). Migracion ADITIVA (R6): no altera tablas
-- existentes. Orden: enums nativos -> tabla -> indices PARCIALES -> RLS.

-- R2: enums NATIVOS de Postgres, ampliables por `ALTER TYPE ... ADD VALUE` en 91/92.
CREATE TYPE "job_tipo" AS ENUM ('liberar_reprogramadas');
CREATE TYPE "job_estado" AS ENUM ('pending', 'processing', 'done', 'failed');

-- R1: una fila por job. `payload` JSONB con default '{}'; `estado` default 'pending';
-- `intentos` default 0; `run_after` default al momento del insert (encolado inmediato).
-- `locked_at`/`last_error`/`dedupe_key` nullable. `max_intentos` lo rellena el `enqueue`
-- desde config (por-fila con override por tipo, decision del gate F1.4-2).
CREATE TABLE "jobs" (
  "id" TEXT NOT NULL,
  "tipo" "job_tipo" NOT NULL,
  "payload" JSONB NOT NULL DEFAULT '{}',
  "estado" "job_estado" NOT NULL DEFAULT 'pending',
  "intentos" INTEGER NOT NULL DEFAULT 0,
  "max_intentos" INTEGER NOT NULL,
  "run_after" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "locked_at" TIMESTAMP(3),
  "last_error" TEXT,
  "dedupe_key" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

-- R3: indice PARCIAL de seleccion. Sirve la rama `pending` del claim (`run_after <= $now`)
-- sin escanear filas ya procesadas (`done`/`failed`) ni `processing`. Prisma no expresa
-- indices parciales: va a mano.
CREATE INDEX "jobs_run_after_pending_idx" ON "jobs" ("run_after") WHERE "estado" = 'pending';

-- R4: unicidad de `dedupe_key` mediante indice UNICO PARCIAL. Multiples filas con
-- `dedupe_key = NULL` coexisten (jobs sin clave de idempotencia); dos filas con la misma
-- clave NO nula no pueden repetirse (idempotencia por dia CR de la recurrencia, R25). Es
-- tambien el indice del `ON CONFLICT ("dedupe_key") DO NOTHING` del `enqueue`.
CREATE UNIQUE INDEX "jobs_dedupe_key_key" ON "jobs" ("dedupe_key") WHERE "dedupe_key" IS NOT NULL;

-- R5: RLS habilitada SIN policies (solo service role), patron api_key / wallet_movimiento /
-- premio_ranking. La cola no es accesible desde el cliente: solo el drenador server-side.
ALTER TABLE "jobs" ENABLE ROW LEVEL SECURITY;
