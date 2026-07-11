-- Feature 30/R2: nuevo estado de catalogo en_ruta_bodega_satelite (10mo valor,
-- patron feature 15/17/28). La orden no-GAM se rutea a la bodega satelite de su
-- zona (un solo estado; el nombre de zona se deriva de orden.zonaId para el
-- display, R15/R20). "orden"/"order_status" ya tienen RLS habilitada desde
-- 20260709130100_ordenes; se conserva sin cambios, sin agregar policies (acceso
-- solo por service role, patron feature 6/15/17): esta feature NO agrega tablas
-- ni columnas, no hay superficie RLS nueva.

-- NOTA para el runner de migraciones: "ALTER TYPE ... ADD VALUE" no puede
-- ejecutarse dentro de una transaccion en versiones antiguas de Postgres; el
-- "IF NOT EXISTS" lo hace idempotente si se reintenta o si el runner separa esta
-- sentencia de una transaccion implicita.
ALTER TYPE "order_status_value" ADD VALUE IF NOT EXISTS 'en_ruta_bodega_satelite';
INSERT INTO "order_status" ("id","value")
  VALUES (gen_random_uuid()::text,'en_ruta_bodega_satelite')
  ON CONFLICT ("value") DO NOTHING;
