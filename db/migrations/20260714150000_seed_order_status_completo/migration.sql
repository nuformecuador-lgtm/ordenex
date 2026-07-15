-- Completa el catalogo `order_status`. Los 13 estados del ciclo de vida se definieron
-- en su momento en el enum `order_status_value` (20260710150000 + ALTER ADD VALUE
-- posteriores), pero solo 6 se insertaron como FILA en la tabla; los otros 7
-- (entregada, devuelta, devuelta_origen, reprogramada, en_fulfillment,
-- en_ruta_bodega_principal, en_bodega) nunca se sembraron -> rompian flujos como
-- "Generar guia" (GuiaAsignacionService exige `en_bodega`/`en_espera_aceptacion`).
-- El enum fue eliminado en 20260714123909; `order_status.value` es texto libre.
-- Idempotente: ON CONFLICT ("value") DO NOTHING (indice unico order_status_value_key).
INSERT INTO "order_status" ("id", "value") VALUES
  (gen_random_uuid()::text, 'entregada'),
  (gen_random_uuid()::text, 'devuelta'),
  (gen_random_uuid()::text, 'devuelta_origen'),
  (gen_random_uuid()::text, 'reprogramada'),
  (gen_random_uuid()::text, 'en_fulfillment'),
  (gen_random_uuid()::text, 'en_ruta_bodega_principal'),
  (gen_random_uuid()::text, 'en_bodega'),
  (gen_random_uuid()::text, 'en_preparacion'),
  (gen_random_uuid()::text, 'en_espera_aceptacion'),
  (gen_random_uuid()::text, 'en_ruta_bodega_satelite'),
  (gen_random_uuid()::text, 'en_reparto'),
  (gen_random_uuid()::text, 'rechazada'),
  (gen_random_uuid()::text, 'en_bodega_satelite')
ON CONFLICT ("value") DO NOTHING;
