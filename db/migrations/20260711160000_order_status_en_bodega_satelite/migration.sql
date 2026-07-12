-- Feature 33/R2: nuevo estado de catalogo en_bodega_satelite (13mo valor, patron
-- feature 15/17/28/30). La orden ruteada a la satelite (feature 30,
-- en_ruta_bodega_satelite) es RECIBIDA por el adminSatelite al escanear su QR y
-- pasa a en_bodega_satelite (un solo estado; el nombre de zona se deriva de
-- orden.zonaId para el display, R9/R20). "orden"/"order_status" ya tienen RLS
-- habilitada desde 20260709130100_ordenes; se conserva sin cambios, sin agregar
-- policies (acceso solo por service role, patron feature 6/15/17/30): esta
-- feature NO agrega tablas ni columnas, no hay superficie RLS nueva.

-- NOTA para el runner de migraciones: "ALTER TYPE ... ADD VALUE" no puede
-- ejecutarse dentro de una transaccion en versiones antiguas de Postgres; el
-- "IF NOT EXISTS" lo hace idempotente si se reintenta o si el runner separa esta
-- sentencia de una transaccion implicita.
ALTER TYPE "order_status_value" ADD VALUE IF NOT EXISTS 'en_bodega_satelite';
INSERT INTO "order_status" ("id","value")
  VALUES (gen_random_uuid()::text,'en_bodega_satelite')
  ON CONFLICT ("value") DO NOTHING;
