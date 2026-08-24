-- DOWN — suelta `distrito.zona_especial`.
--
-- PERDIDA DE DATO DECLARADA: se va la marca de todo distrito que la tuviera en `true`. La columna
-- nace en el `up` y no hay copia en ninguna otra tabla, asi que revertir es soltarla; no existe un
-- estado anterior al que devolverla.
--
-- No hay FK, indice ni constraint que retirar antes: el `up` solo agrega la columna (ver alli por
-- que NO se creo indice). `IF EXISTS` para que el rollback sea IDEMPOTENTE.
ALTER TABLE "distrito" DROP COLUMN IF EXISTS "zona_especial";
