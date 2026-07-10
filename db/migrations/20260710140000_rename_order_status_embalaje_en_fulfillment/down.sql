-- Reversion (R4): en_fulfillment -> embalaje. Idempotente: 0 filas si no existe 'en_fulfillment'.
UPDATE "order_status" SET "value" = 'embalaje' WHERE "value" = 'en_fulfillment';
