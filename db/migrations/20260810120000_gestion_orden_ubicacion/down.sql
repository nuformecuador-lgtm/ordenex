-- DOWN (T A.3, feature 193): revierte EXACTAMENTE migration.sql de esta carpeta, en orden
-- inverso.
--
-- A diferencia de los downs que RECREAN un enum para quitarle valores (45, 158, 173), aqui el
-- tipo NACE en esta migracion: no hay valores previos que preservar y `DROP TYPE` es la
-- reversion exacta. Se suelta DESPUES de las columnas porque la columna depende del tipo.
--
-- PERDIDA DE DATOS, declarada sin rodeos: soltar estas columnas BORRA la ubicacion de todas
-- las gestiones registradas desde que la migracion se aplico. No es recuperable. Es el
-- comportamiento correcto para un down —revertir la feature es quitar lo que la feature
-- anadio—, pero conviene saberlo antes de correrlo en una base con trafico real: no hay
-- reverso posible salvo un backup.
--
-- NO se tocan RLS ni policies (la migracion tampoco las toco).

-- 3) inverso de (3)
ALTER TABLE "gestion_orden" DROP COLUMN IF EXISTS "ubicacion_ausencia";

-- 2) inverso de (2)
ALTER TABLE "gestion_orden" DROP COLUMN IF EXISTS "ubicacion_lng";
ALTER TABLE "gestion_orden" DROP COLUMN IF EXISTS "ubicacion_lat";

-- 1) inverso de (1). Va el ULTIMO: mientras exista la columna, el tipo sigue en uso.
DROP TYPE IF EXISTS "gestion_ubicacion_ausencia";
