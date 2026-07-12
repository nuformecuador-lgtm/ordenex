-- Feature 39: pago al mensajero por zona en el cierre (SNAPSHOT, money-critical).
-- Migracion ADITIVA (3 ADD COLUMN, sin tablas nuevas, sin tocar RLS ni enums):
-- (1) gestion_orden.pago_mensajero DECIMAL(12,2) NULL: pago snapshoteado por gestion.
--     NULLABLE = gestion aun no cerrada (se puebla al solicitar el cierre, patron cierre_id).
-- (2) cierre_dia.total_pago_mensajero DECIMAL(12,2) NOT NULL DEFAULT 0: total snapshot del
--     cierre del dia (patron 37, money-critical). DEFAULT 0 -> cierres previos = 0.00 (R22).
-- (3) cierre_bodega.total_pago_mensajero DECIMAL(12,2) NOT NULL DEFAULT 0: total agregado
--     snapshot del cierre de bodega (patron 40). DEFAULT 0 -> cierres previos = 0.00 (R22).
-- "gestion_orden"/"cierre_dia"/"cierre_bodega" ya tienen RLS de migraciones previas; NO
-- se tocan. No hay enums nuevos.

-- 1) pago snapshoteado por gestion (NULL mientras la gestion no se cierra).
ALTER TABLE "gestion_orden"
  ADD COLUMN "pago_mensajero" DECIMAL(12,2);

-- 2) total snapshot a pagar al mensajero del cierre del dia (money-critical, patron 37).
ALTER TABLE "cierre_dia"
  ADD COLUMN "total_pago_mensajero" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- 3) total agregado snapshot a pagar a mensajeros del cierre de bodega (patron 40).
ALTER TABLE "cierre_bodega"
  ADD COLUMN "total_pago_mensajero" DECIMAL(12,2) NOT NULL DEFAULT 0;
