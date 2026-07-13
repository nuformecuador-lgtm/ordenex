-- Ajuste de tarifas: se ELIMINAN `nombre` y `zona_id`, y la tarifa pasa a estar
-- atada a una TIENDA (usuario con rol adminTienda) con un estado activo/inactivo.
-- La invariante "la tienda debe ser adminTienda" y la baja a `inactivo` cuando el
-- usuario cambia de rol se aplican en el service (patron `fulfillment`, feature
-- 27); la DB solo modela columnas + FK + el enum de estado.

-- Quita las columnas de la feature 18 (`nombre`) y 24 (`zona_id`) que dejan de aplicar.
ALTER TABLE "tarifas" DROP CONSTRAINT IF EXISTS "tarifas_zona_id_fkey";
DROP INDEX IF EXISTS "tarifas_zona_id_idx";
ALTER TABLE "tarifas" DROP COLUMN "zona_id";
ALTER TABLE "tarifas" DROP COLUMN "nombre";

-- Estado de la tarifa (patron enum standalone `estado_usuario`/`rol_value`).
CREATE TYPE "estado_tarifa" AS ENUM ('activo', 'inactivo');

-- tienda_id: FK a `usuario` (la tienda duena; el service exige rol adminTienda).
-- NOT NULL: la tabla se migro vacia (misma premisa que `zona_id` en el rename).
-- FK RESTRICT (patron usuario/zona): no permite referenciar/borrar tiendas en uso.
ALTER TABLE "tarifas" ADD COLUMN "tienda_id" TEXT NOT NULL;
ALTER TABLE "tarifas" ADD COLUMN "status" "estado_tarifa" NOT NULL DEFAULT 'activo';
CREATE INDEX "tarifas_tienda_id_idx" ON "tarifas"("tienda_id");
ALTER TABLE "tarifas" ADD CONSTRAINT "tarifas_tienda_id_fkey"
  FOREIGN KEY ("tienda_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
