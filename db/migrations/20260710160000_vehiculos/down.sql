-- DOWN: revierte exactamente migration.sql de esta carpeta. No toca objetos
-- preexistentes. La tabla se elimina antes que el tipo del que depende (R4).
-- R5: si en features posteriores existiera un FK vehiculo_id -> vehiculos.id, el
-- DROP TABLE fallaria por la dependencia (rollback no deja estado inconsistente).
DROP TABLE IF EXISTS "vehiculos";
DROP TYPE IF EXISTS "vehiculo_value";
