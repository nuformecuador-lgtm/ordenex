-- Feature 56: ingreso de la BODEGA por rechazos (`cobroRechazado`), SNAPSHOT money-critical.
-- ESPEJO de la feature 39 (pago al mensajero): mismo patron de 3 columnas, pero para el
-- ingreso que las gestiones `rechazada` atribuyen a la bodega responsable del mensajero.
-- Migracion ADITIVA (3 ADD COLUMN, sin tablas nuevas, sin tocar RLS ni enums):
-- (1) gestion_orden.ingreso_bodega_rechazo DECIMAL(12,2) NULL: ingreso snapshoteado por
--     gestion. NULLABLE = gestion aun no cerrada / cierre pre-migracion (R21). Se puebla al
--     solicitar el cierre (patron pago_mensajero de la 39).
-- (2) cierre_dia.total_ingreso_bodega_rechazos DECIMAL(12,2) NOT NULL DEFAULT 0: total
--     snapshot del cierre del dia (money-critical). DEFAULT 0 -> cierres previos = 0.00 (R21).
-- (3) cierre_bodega.total_ingreso_bodega_rechazos DECIMAL(12,2) NOT NULL DEFAULT 0: total
--     agregado snapshot del cierre de bodega. DEFAULT 0 -> cierres previos = 0.00 (R21).
-- "gestion_orden"/"cierre_dia"/"cierre_bodega" ya tienen RLS de migraciones previas; NO
-- se tocan. No hay enums nuevos. Concepto INDEPENDIENTE del pago al mensajero (39) y del
-- dinero recibido (37/40): no altera ninguna columna preexistente (R20).

-- 1) ingreso snapshoteado por gestion (NULL mientras la gestion no se cierra).
ALTER TABLE "gestion_orden"
  ADD COLUMN "ingreso_bodega_rechazo" DECIMAL(12,2);

-- 2) total snapshot de ingreso de bodega por rechazos del cierre del dia (money-critical).
ALTER TABLE "cierre_dia"
  ADD COLUMN "total_ingreso_bodega_rechazos" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- 3) total agregado snapshot de ingreso de bodega por rechazos del cierre de bodega.
ALTER TABLE "cierre_bodega"
  ADD COLUMN "total_ingreso_bodega_rechazos" DECIMAL(12,2) NOT NULL DEFAULT 0;
