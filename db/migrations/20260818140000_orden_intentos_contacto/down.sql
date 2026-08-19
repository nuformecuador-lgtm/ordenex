-- Revierte EXACTAMENTE `migration.sql`: retira la columna que aquel ALTER agrego.
--
-- El contador es CUMULATIVO y no tiene copia en ningun otro sitio: bajar esta migracion PIERDE
-- los intentos de contacto registrados. Es la consecuencia de retirar la feature, y queda
-- escrita aqui para que quien la ejecute lo sepa antes y no despues.
ALTER TABLE "orden" DROP COLUMN "intentos_contacto";
