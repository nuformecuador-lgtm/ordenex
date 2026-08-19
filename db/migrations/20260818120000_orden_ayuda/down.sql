-- Revierte EXACTAMENTE `migration.sql`: retira la columna que aquel ALTER agrego.
--
-- La columna nacio con DEFAULT false y sin backfill, asi que no hay dato previo que restaurar:
-- lo que se pierde al bajar son las solicitudes de ayuda VIVAS (`ayuda = true`), que es una
-- perdida inherente a retirar la feature, no un descuido de este archivo.
ALTER TABLE "orden" DROP COLUMN "ayuda";
