-- Revierte 20260720160000_num_guia_no_secuencial.
--
-- Elimina la funcion; los call sites vuelven a `nextval('orden_num_guia_seq')`
-- directo (numeracion ascendente). NO se toca la secuencia ni las guias ya
-- emitidas: los valores permutados siguen siendo validos y unicos, asi que un
-- rollback convive con ellos sin conflicto — la serie simplemente pasa a
-- continuar de forma ascendente desde donde este el contador.
DROP FUNCTION IF EXISTS siguiente_num_guia();
