-- DOWN (ficha 374) — revierte EXACTAMENTE `migration.sql` y nada mas.
--
-- PERDIDA DE DATO DECLARADA: se va la marca `activo` de todo nodo retirado. Nace en el `up` y no
-- hay copia en ninguna otra tabla; revertir es soltarla. Lo que NO pasa: NINGUNA fila de
-- `provincia`, `canton`, `distrito` ni `zona_distrito` se borra ni se modifica (R2). Solo se
-- sueltan tres columnas y tres indices.
--
-- Los indices se sueltan ANTES que las columnas por claridad de lectura, aunque no dependan de
-- ellas: ninguno de los tres es un indice sobre `activo` (no existe, y R4 lo prohibe).
--
-- `IF EXISTS` en las seis sentencias: correr el down dos veces es un no-op, no un error.
--
-- NINGUN `down.sql` ANTERIOR SE TOCA: son fotos historicas de lo que habia cuando se escribieron.
DROP INDEX IF EXISTS "distrito_canton_id_nombre_key";
DROP INDEX IF EXISTS "canton_provincia_id_nombre_key";
DROP INDEX IF EXISTS "provincia_nombre_key";

ALTER TABLE "distrito"  DROP COLUMN IF EXISTS "activo";
ALTER TABLE "canton"    DROP COLUMN IF EXISTS "activo";
ALTER TABLE "provincia" DROP COLUMN IF EXISTS "activo";
