-- DOWN: revierte exactamente migration.sql de esta carpeta.

-- Revierte CreateIndex del unico (zona_id, vehiculo_id) NULLS NOT DISTINCT.
DROP INDEX IF EXISTS "tarifa_zona_mensajero_zona_id_vehiculo_id_key";
