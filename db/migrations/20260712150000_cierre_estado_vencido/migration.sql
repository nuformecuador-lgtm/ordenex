-- Feature 41 (R2/R12/R23): añade el estado `vencido` al enum `cierre_estado` y el
-- índice compuesto (mensajero_id, estado) para la ruta caliente del bloqueo derivado
-- del mensajero. Migración ADITIVA: no altera columnas ni policies RLS existentes (R3).

-- 1) Enum: cuarto valor `vencido` (R2). Patrón "enum-existente" (features 17/30/36):
-- ALTER TYPE ... ADD VALUE no puede correr en la misma transacción que USE el valor;
-- aquí NADIE lo usa en esta migración (solo se añade), así que es seguro. El
-- IF NOT EXISTS lo hace idempotente si se reintenta.
ALTER TYPE "cierre_estado" ADD VALUE IF NOT EXISTS 'vencido';

-- 2) Índice compuesto (mensajero_id, estado) para el bloqueo derivado del mensajero
-- (R12/R23): "¿este mensajero tiene un cierre solicitado|vencido?" en la ruta caliente
-- de asignación (features 17/30/34).
CREATE INDEX "cierre_dia_mensajero_id_estado_idx" ON "cierre_dia"("mensajero_id","estado");
