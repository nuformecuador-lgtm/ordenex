-- DOWN de la feature 169 (design §2.4): revierte el UP en ORDEN INVERSO, indice -> columna.
-- Al reves, `DROP COLUMN` arrastraria el indice por dependencia y este archivo estaria
-- mintiendo sobre lo que hace. `IF EXISTS` en las dos sentencias para que `db:rollback`
-- pueda re-ejecutarse sin fallar.
DROP INDEX IF EXISTS "orden_busqueda_texto_trgm_idx";

ALTER TABLE "orden" DROP COLUMN IF EXISTS "busqueda_texto";

-- NO se hace `DROP EXTENSION pg_trgm` NI `DROP SCHEMA extensions`, y es deliberado:
--   · El UP crea la extension con `IF NOT EXISTS`, asi que en una base que YA la tenia el
--     UP no la creo. Un DOWN que la elimine borraria algo que no era suyo y que otra
--     feature podria estar usando.
--   · El esquema `extensions` es infraestructura COMPARTIDA de Supabase: no se toca jamas.
--   · Coste de no hacerlo: tras el rollback queda una extension instalada sin ningun objeto
--     que dependa de ella. Cero en disco, cero en escritura, cero en planificacion.
--
-- ORDEN DE REVERSION DE LA FEATURE (design §2.4): CODIGO PRIMERO, MIGRACION DESPUES. Este
-- DOWN solo revierte la base; si el codigo sigue desplegado, seguira construyendo un
-- `where` sobre `busqueda_texto` y toda consulta con termino fallara.
