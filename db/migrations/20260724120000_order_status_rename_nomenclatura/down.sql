-- DOWN (R3): inverso exacto del UP. Restituye los value historicos sobre las mismas filas
-- (mismo id, mismo conteo). Este archivo contiene los value viejos por diseno: es la
-- reversion del rename (excluido del guard de censo R13 junto con db/migrations/**).
UPDATE "order_status" SET "value" = 'en_reparto'               WHERE "value" = 'en_ruta';
UPDATE "order_status" SET "value" = 'en_espera_aceptacion'     WHERE "value" = 'por_recoger';
UPDATE "order_status" SET "value" = 'en_bodega'                WHERE "value" = 'en_bodega_central';
UPDATE "order_status" SET "value" = 'en_ruta_bodega_principal' WHERE "value" = 'en_ruta_bodega_central';
UPDATE "order_status" SET "value" = 'devuelta_origen'          WHERE "value" = 'devolviendo_a_tienda';
UPDATE "order_status" SET "value" = 'recibido_origen'          WHERE "value" = 'devuelta_a_tienda';
