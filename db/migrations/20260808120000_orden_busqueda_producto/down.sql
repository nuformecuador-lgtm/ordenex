-- DOWN: devuelve `orden.busqueda_texto` a su forma de CINCO segmentos (sin `producto`),
-- es decir, exactamente la expresion de `20260731160000_orden_busqueda_trgm`.
--
-- No basta con borrar la columna: dejarla borrada rompe el codigo, que filtra sobre ella.
-- Revertir aqui significa RESTAURAR la definicion anterior, y por eso este DOWN vuelve a
-- crear los dos objetos en lugar de solo destruirlos.
--
-- Orden inverso al UP en cada paso: primero el indice, luego la columna; y al reconstruir,
-- primero la columna, luego el indice. `IF EXISTS` / `IF NOT EXISTS` en las cuatro
-- sentencias para que `db:rollback` pueda re-ejecutarse sin fallar.
DROP INDEX IF EXISTS "orden_busqueda_texto_trgm_idx";

ALTER TABLE "orden" DROP COLUMN IF EXISTS "busqueda_texto";

ALTER TABLE "orden"
  ADD COLUMN IF NOT EXISTS "busqueda_texto" text
  GENERATED ALWAYS AS (
    btrim(regexp_replace(
      lower(translate(
        coalesce("num_guia"::text, '')                                    || ' ' ||
        coalesce("num_remision", '')                                      || ' ' ||
        coalesce("telefono_dest", '')                                     || ' ' ||
        regexp_replace(coalesce("telefono_dest", ''), '[^0-9]', '', 'g')  || ' ' ||
        coalesce("destinatario", ''),
        'áàäâãéèëêíìïîóòöôõúùüûñçÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ',
        'aaaaaeeeeiiiiooooouuuuncAAAAAEEEEIIIIOOOOOUUUUNC'
      )),
      '[ \t\n\r\f\v]+', ' ', 'g'))
  ) STORED;

CREATE INDEX IF NOT EXISTS "orden_busqueda_texto_trgm_idx"
  ON "orden" USING gin ("busqueda_texto" extensions.gin_trgm_ops);

-- NO se toca `pg_trgm` ni el esquema `extensions`: no son de esta migracion (los dejo
-- puesta la 20260731160000) y el esquema es infraestructura compartida de Supabase.
--
-- ORDEN DE REVERSION: CODIGO PRIMERO, MIGRACION DESPUES. Si se revierte solo la base, el
-- codigo desplegado sigue prometiendo en su placeholder que se puede buscar por producto
-- y dejaria de encontrarlo, en silencio y sin ningun error.
