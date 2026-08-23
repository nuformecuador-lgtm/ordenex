-- DOWN de `20260822140000_ruta_secuencia_fuente`. Revierte EXACTAMENTE lo que hace su
-- `migration.sql`: una sola columna aditiva y nullable, sin default, sin CHECK y sin backfill.
-- No hay indice, ni constraint, ni enum, ni RLS que deshacer.
--
-- Que se pierde al bajar: la marca de procedencia del orden de las rutas ya calculadas. No es
-- reconstruible —ver el `migration.sql`— pero tampoco es dato de negocio: sin ella la pantalla
-- vuelve a no decir nada del orden (R45) y la siguiente sincronizacion la repone.
ALTER TABLE "ruta_optimizada" DROP COLUMN "secuencia_fuente";
