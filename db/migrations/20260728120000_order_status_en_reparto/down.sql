-- DOWN (R3): inverso exacto del UP. Restituye el value de la 135 sobre la MISMA fila (mismo
-- id, mismo conteo). Este archivo contiene el value viejo por diseno: es la reversion del
-- rename (excluido del guard de censo R16 junto con db/migrations/**).
UPDATE "order_status" SET "value" = 'en_ruta' WHERE "value" = 'en_reparto';
