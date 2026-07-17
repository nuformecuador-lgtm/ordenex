-- DOWN (R24): revierte exactamente migration.sql. `DROP TABLE` arrastra la PK, los dos
-- indices unicos (`api_key_key_hash_key`, `api_key_usuario_id_key`), el indice
-- `api_key_created_by_id_idx`, las dos FKs y la configuracion de RLS.
DROP TABLE IF EXISTS "api_key";

-- Elimina el rol sembrado por esta migracion. Si algun usuario dedicado todavia lo
-- referencia, el DELETE falla RUIDOSAMENTE por la FK usuario_rol_id_fkey y el rollback
-- aborta: correcto, primero se borran las cuentas dedicadas.
-- El valor 'apiKey' del enum lo retira el down.sql de 20260716140000_rol_api_key
-- (recreando el tipo: Postgres no tiene DROP VALUE).
DELETE FROM "rol" WHERE "value" = 'apiKey'::rol_value;
