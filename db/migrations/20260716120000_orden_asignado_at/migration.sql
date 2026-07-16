-- Feature 76 (R23/R24, design §4.0): columna `orden.asignado_at` — instante de la ultima
-- (re)asignacion de mensajero. Fuente del DENOMINADOR del ranking diario ("asignadas HOY").
-- Migracion ADITIVA: una sola columna NULLABLE en `orden` (no hay tabla nueva -> no hay RLS
-- nueva; la RLS de `orden` no cambia). Las ordenes HISTORICAS quedan en NULL (no cuentan
-- hasta su proxima (re)asignacion). Cada writer de `mensajero_asignado_id` estampa
-- `asignado_at = now` en la misma escritura (choke-point §4.1).

-- 1) columna de marca de asignacion (NULL = nunca asignada / historicas).
ALTER TABLE "orden" ADD COLUMN "asignado_at" TIMESTAMP(3);

-- 2) indice compuesto para el denominador del ranking: asignadas HOY por mensajero
-- (WHERE mensajero_asignado_id = X AND asignado_at IN [desde, hasta)). Mismo nombre que
-- genera Prisma para @@index([mensajeroAsignadoId, asignadoAt]).
CREATE INDEX "orden_mensajero_asignado_id_asignado_at_idx"
  ON "orden" ("mensajero_asignado_id", "asignado_at");
