-- DOWN: revierte exactamente migration.sql de esta carpeta.
-- Orden inverso de dependencia. NO toca la tabla "Session" (preexistente,
-- no fue creada por esta migracion).

-- Drop de foreign keys explicito no es necesario: DROP TABLE ... CASCADE
-- se encarga, pero mantenemos DROP TABLE simple en orden que respeta FKs.

DROP TABLE IF EXISTS "email_otp_challenge";
DROP TABLE IF EXISTS "login_attempt";
DROP TABLE IF EXISTS "trusted_device";
DROP TABLE IF EXISTS "usuario";
DROP TABLE IF EXISTS "rol";
DROP TABLE IF EXISTS "tipo_identificacion";

DROP TYPE IF EXISTS "estado_usuario";
