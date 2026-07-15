-- DOWN: revierte exactamente migration.sql de esta carpeta, en orden inverso.
--
-- migration.sql hizo dos cosas INDEPENDIENTES entre si:
--   (a) recableo de 5 FKs: ON DELETE RESTRICT -> ON DELETE SET NULL (reconciliacion
--       con schema.prisma);
--   (b) DROP del enum `order_status_value`, que para entonces ya era HUERFANO: ninguna
--       columna lo usaba (el ciclo de vida vive como FILA en la tabla `order_status`).
--       Por eso el DROP no arrastro datos y por eso recrearlo aca es solo el tipo:
--       no hay columna a la que volver a colgarlo.
--
-- Este DOWN deshace ambas. IF EXISTS / guarda por to_regtype para reversion segura
-- y reejecutable.

-- 1) FKs recableados por migration.sql: se sueltan las versiones ON DELETE SET NULL.
ALTER TABLE "orden_historial_estado" DROP CONSTRAINT IF EXISTS "orden_historial_estado_gestion_orden_id_fkey";
ALTER TABLE "orden_historial_estado" DROP CONSTRAINT IF EXISTS "orden_historial_estado_estatus_origen_id_fkey";
ALTER TABLE "tarifa_zona_mensajero" DROP CONSTRAINT IF EXISTS "tarifa_zona_mensajero_vehiculo_id_fkey";
ALTER TABLE "usuario" DROP CONSTRAINT IF EXISTS "usuario_zona_id_fkey";
ALTER TABLE "usuario" DROP CONSTRAINT IF EXISTS "usuario_vehiculo_id_fkey";

-- 2) enum huerfano: se recrea con sus 13 valores, en el mismo orden en que llegaron a
-- existir -- los 8 del CREATE original (20260710150000) y los 5 que fueron anexando los
-- ALTER TYPE ... ADD VALUE de 20260711130000, 20260711140000, 20260711150000 (x2) y
-- 20260711160000. NO incluye 'pendiente': ese estado es posterior (20260714140000) y
-- nunca formo parte del enum, solo existe como fila del catalogo.
DO $$
BEGIN
  IF to_regtype('"order_status_value"') IS NULL THEN
    CREATE TYPE "order_status_value" AS ENUM (
      'entregada','devuelta','devuelta_origen','reprogramada',
      'en_fulfillment','en_ruta_bodega_principal','en_bodega','en_preparacion',
      'en_espera_aceptacion','en_ruta_bodega_satelite','en_reparto','rechazada',
      'en_bodega_satelite'
    );
  END IF;
END
$$;

-- 3) FKs restaurados a ON DELETE RESTRICT ON UPDATE CASCADE, tal como los dejaron sus
-- migraciones de origen: 20260710170000 (usuario_vehiculo_id), 20260711120000
-- (usuario_zona_id), 20260711180000 (tarifa_zona_mensajero_vehiculo_id) y 20260713120000
-- (los dos de orden_historial_estado).
ALTER TABLE "usuario" ADD CONSTRAINT "usuario_vehiculo_id_fkey"
  FOREIGN KEY ("vehiculo_id") REFERENCES "vehiculos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "usuario" ADD CONSTRAINT "usuario_zona_id_fkey"
  FOREIGN KEY ("zona_id") REFERENCES "zona"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "tarifa_zona_mensajero" ADD CONSTRAINT "tarifa_zona_mensajero_vehiculo_id_fkey"
  FOREIGN KEY ("vehiculo_id") REFERENCES "vehiculos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "orden_historial_estado" ADD CONSTRAINT "orden_historial_estado_estatus_origen_id_fkey"
  FOREIGN KEY ("estatus_origen_id") REFERENCES "order_status"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "orden_historial_estado" ADD CONSTRAINT "orden_historial_estado_gestion_orden_id_fkey"
  FOREIGN KEY ("gestion_orden_id") REFERENCES "gestion_orden"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
