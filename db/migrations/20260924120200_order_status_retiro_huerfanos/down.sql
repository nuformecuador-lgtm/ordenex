-- DOWN de M3 (ficha 455, design §3.1; R17): repone las dos filas del catalogo SI FALTAN, con un id
-- nuevo. Si el up las borro, nadie las referenciaba: un id nuevo no rompe ninguna FK. Si el up las
-- conservo (estaban referenciadas), este down no hace nada. Idempotente. UN SOLO BLOQUE `DO`.
--
-- Declarado: en una base que NUNCA tuvo esas filas (una base recien creada desde cero, donde la 155 ya
-- las habia borrado), este down las crea. Es inocuo (quedan huerfanas e inalcanzables, como en una
-- base con historial) y es lo que prescribe el design §3.1.

DO $$
DECLARE
  v_valor text;
BEGIN
  FOREACH v_valor IN ARRAY ARRAY['en_fulfillment', 'pendiente'] LOOP
    INSERT INTO "order_status" ("id", "value")
    SELECT gen_random_uuid()::text, v_valor
     WHERE NOT EXISTS (SELECT 1 FROM "order_status" WHERE "value" = v_valor);
  END LOOP;
END $$;
