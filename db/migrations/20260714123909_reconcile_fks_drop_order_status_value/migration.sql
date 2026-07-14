-- DropForeignKey
ALTER TABLE "orden_historial_estado" DROP CONSTRAINT IF EXISTS "orden_historial_estado_estatus_origen_id_fkey";

-- DropForeignKey
ALTER TABLE "orden_historial_estado" DROP CONSTRAINT IF EXISTS "orden_historial_estado_gestion_orden_id_fkey";

-- DropForeignKey
ALTER TABLE "tarifa_zona_mensajero" DROP CONSTRAINT IF EXISTS "tarifa_zona_mensajero_vehiculo_id_fkey";

-- DropForeignKey
ALTER TABLE "usuario" DROP CONSTRAINT IF EXISTS "usuario_vehiculo_id_fkey";

-- DropForeignKey
ALTER TABLE "usuario" DROP CONSTRAINT IF EXISTS "usuario_zona_id_fkey";

-- DropEnum
DROP TYPE IF EXISTS "order_status_value";

-- AddForeignKey
ALTER TABLE "usuario" ADD CONSTRAINT "usuario_vehiculo_id_fkey" FOREIGN KEY ("vehiculo_id") REFERENCES "vehiculos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usuario" ADD CONSTRAINT "usuario_zona_id_fkey" FOREIGN KEY ("zona_id") REFERENCES "zona"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tarifa_zona_mensajero" ADD CONSTRAINT "tarifa_zona_mensajero_vehiculo_id_fkey" FOREIGN KEY ("vehiculo_id") REFERENCES "vehiculos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orden_historial_estado" ADD CONSTRAINT "orden_historial_estado_estatus_origen_id_fkey" FOREIGN KEY ("estatus_origen_id") REFERENCES "order_status"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orden_historial_estado" ADD CONSTRAINT "orden_historial_estado_gestion_orden_id_fkey" FOREIGN KEY ("gestion_orden_id") REFERENCES "gestion_orden"("id") ON DELETE SET NULL ON UPDATE CASCADE;
