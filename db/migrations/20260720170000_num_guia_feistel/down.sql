-- Revierte 20260720170000_num_guia_feistel: `siguiente_num_guia()` vuelve a la
-- permutacion multiplicativa de 20260720160000 y se sueltan las funciones de
-- Feistel.
--
-- NO se tocan las guias ya emitidas: los valores de Feistel siguen siendo
-- validos, unicos y de 8 digitos, asi que conviven con los que genere la
-- formula anterior. Lo unico que se pierde al bajar es la ausencia de delta
-- constante entre guias consecutivas (ver el encabezado de la migracion).
CREATE OR REPLACE FUNCTION siguiente_num_guia() RETURNS integer
LANGUAGE sql VOLATILE AS $fn$
  SELECT (10000000 + ((nextval('orden_num_guia_seq')::bigint * 73939133) % 90000000))::integer;
$fn$;

DROP FUNCTION IF EXISTS num_guia_desde(bigint);
DROP FUNCTION IF EXISTS num_guia_permutar(bigint);
