-- Revierte 20260709120000_seed_maestro_user.
-- Solo elimina el usuario sembrado. NO borra los catalogos (rol,
-- tipo_identificacion): pudieron existir antes de esta migracion (via
-- scripts/seed-catalogos.ts o migraciones previas) y otros registros dependen
-- de ellos.
DELETE FROM "usuario" WHERE "email" = 'admin@ordenex.test';
