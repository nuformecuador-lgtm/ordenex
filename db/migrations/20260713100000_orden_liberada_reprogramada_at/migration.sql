-- Feature 46: reprogramacion — bloqueo y liberacion programada.
-- Marca de auditoria + fuente del aviso derivado de la liberacion (R13/R15/R18). NO es
-- el mecanismo de idempotencia (eso lo da la transicion de estatus fuera de `reprogramada`).
-- Migracion ADITIVA: una sola columna nullable en `orden` (no hay tabla nueva -> no hay
-- RLS nueva; la RLS de `orden` no cambia). Indice PARCIAL para la ruta del aviso
-- ("liberadas hoy" de la bodega): Prisma no expresa indice parcial -> va a mano aqui
-- (mismo patron que wallet_movimiento / cierre_bodega).

-- 1) columna de marca de liberacion (NULL = nunca liberada por reprogramacion).
ALTER TABLE "orden" ADD COLUMN "liberada_reprogramada_at" TIMESTAMP(3);

-- 2) indice parcial: la bodega consulta solo las liberadas (columna NOT NULL), nunca el
-- universo de ordenes. WHERE ... IS NOT NULL mantiene el indice pequeno.
CREATE INDEX "orden_liberada_reprogramada_at_idx"
  ON "orden" ("liberada_reprogramada_at")
  WHERE "liberada_reprogramada_at" IS NOT NULL;
