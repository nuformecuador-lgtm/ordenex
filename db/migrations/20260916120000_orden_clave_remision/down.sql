-- DOWN de la ficha 423 (R19) — revierte el UP en ORDEN INVERSO: indice -> columna.
--
-- EL ORDEN NO ES ESTETICA. Al reves, `DROP COLUMN` arrastraria el indice por dependencia y la
-- primera sentencia estaria mintiendo sobre lo que hace (habria soltado algo que ya no existia).
-- `IF EXISTS` en las dos para que `db:rollback` pueda re-ejecutarse sin fallar.
--
-- ⚠️ CERO `INSERT`/`UPDATE`/`DELETE`, y es LA propiedad que R19 exige: `clave_remision` es una
-- columna GENERADA y DERIVADA — `num_remision`, que es el dato de negocio que la tienda escribio,
-- no se toca ni en una fila. Revertir deja `orden` exactamente como estaba antes del UP: sin la
-- columna, sin el indice, y con las mismas 2.136 remisiones intactas. `SELECT count(*) FROM orden`
-- da el mismo numero antes y despues.
--
-- ORDEN DE REVERSION DE LA FEATURE (design §2.4): CODIGO PRIMERO, MIGRACION DESPUES. Este DOWN
-- solo revierte la base; si el codigo nuevo sigue desplegado, `SORT_COLUMN` seguira traduciendo
-- `num_remision` -> `claveRemision` y TODO el listado de `/ordenes` respondera error (la columna
-- ya no existe), no solo el orden por remision.
--
-- Nada de RLS que reponer: el UP no creo tablas ni toco politicas — la columna heredaba las de
-- `orden` y desaparece con ella.

DROP INDEX IF EXISTS "orden_prioridad_clave_remision_idx";

ALTER TABLE "orden" DROP COLUMN IF EXISTS "clave_remision";
