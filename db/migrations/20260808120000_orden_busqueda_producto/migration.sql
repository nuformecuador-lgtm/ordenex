-- Amplia el buscador de ordenes al campo PRODUCTO: `orden.busqueda_texto` pasa de
-- concatenar cinco segmentos (guia, remision, telefono tal cual, telefono solo-digitos,
-- destinatario) a SEIS, con `producto` al final.
--
-- POR QUE DROP + ADD Y NO UN ALTER DE LA EXPRESION: `ALTER TABLE ... ALTER COLUMN ...
-- SET EXPRESSION AS (...)` solo existe desde PostgreSQL 17. Esta migracion tiene que
-- aplicarse igual en el Postgres local y en el de Supabase, cuya version no se controla
-- desde aqui, asi que se usa la unica forma portable: recrear la columna. El coste es el
-- mismo en cualquiera de las dos vias — SET EXPRESSION tambien reescribe la tabla entera.
--
-- ATENCION AL APLICAR EN PRODUCCION: identico al UP original. `DROP COLUMN` + `ADD COLUMN
-- ... GENERATED ... STORED` REESCRIBE LA TABLA ENTERA con un ACCESS EXCLUSIVE (ni lecturas
-- ni escrituras sobre `orden`), y `CREATE INDEX` toma ademas un SHARE. Con miles de filas
-- es instantaneo; por encima de 200 000 filas hace falta ventana de mantenimiento con la
-- ingesta parada. Sin CREATE INDEX CONCURRENTLY: Prisma corre cada migracion dentro de una
-- transaccion y CONCURRENTLY no puede correr en una.
--
-- MIENTRAS DURA: la columna deja de existir unos instantes. Por eso el orden de despliegue
-- es MIGRACION PRIMERO, codigo despues — al reves que el rollback. El codigo viejo sigue
-- funcionando contra la columna nueva (busca sobre mas texto, nunca sobre menos).
--
-- No se crea la extension ni el esquema `extensions`: ya los dejo puestos
-- `20260731160000_orden_busqueda_trgm` y siguen siendo suyos. Sin tablas nuevas => sin RLS
-- nueva: la columna hereda los permisos y las politicas de `orden`.

-- 1) Fuera el indice ANTES que la columna. Al reves, el `DROP COLUMN` lo arrastraria por
--    dependencia y la primera sentencia estaria mintiendo sobre lo que hace.
DROP INDEX IF EXISTS "orden_busqueda_texto_trgm_idx";

ALTER TABLE "orden" DROP COLUMN IF EXISTS "busqueda_texto";

-- 2) La columna, ahora con el sexto segmento. Cada decision de la expresion es la misma
--    que en la migracion original y sigue vigente por las mismas razones:
--    · STORED  -> Postgres solo implementa STORED, y un indice necesita el valor materializado.
--    · num_guia::text -> unica forma de que la guia participe de la coincidencia parcial;
--      el cast entero->texto se resuelve por I/O (int4out/textin), ambas IMMUTABLE.
--    · `||` y no concat()/concat_ws() -> esas son STABLE y Postgres RECHAZARIA la columna.
--    · cuarto segmento = telefono en forma SOLO DIGITOS -> "88880000" encuentra un telefono
--      guardado como "8888-0000" sin una segunda consulta.
--    · translate() ANTES de lower() -> lower() depende de la collation (en LC_CTYPE=C,
--      lower('Á') = 'Á'); plegando primero, a lower() solo se le pide bajar ASCII. Por eso
--      el mapa lleva las 24 minusculas acentuadas Y sus 24 mayusculas. Los dos strings son
--      copia LITERAL de ACENTOS_FROM / ACENTOS_TO (lib/utils/busqueda-orden.ts) y un test
--      lo comprueba caracter a caracter.
--    · NO se usa unaccent(): es STABLE (resuelve su diccionario por search_path) y Postgres
--      exige IMMUTABLE en una columna generada.
--    · btrim + colapso de espacios con la clase EXPLICITA `[ \t\n\r\f\v]` y NO `\s`: el
--      `\s` de Postgres es `[[:space:]]`, que depende del ctype de la base (verificado: en
--      el build msvc local colapsa el NBSP, en un build glibc como el de Supabase no). Con
--      `\s` la columna se calcularia distinto en local y en produccion y la paridad con
--      el normalizador de Node seria indemostrable.
--    · `coalesce("producto", '')` aunque `producto` sea NOT NULL: el coalesce no cuesta
--      nada, deja los seis segmentos escritos con la MISMA forma, y sobrevive a que una
--      migracion futura relaje la columna a NULLable sin acordarse de esta expresion.
--    · NULLable a proposito aunque la expresion nunca produzca NULL: en Prisma se declara
--      `String?`, y declararla NOT NULL en SQL seria drift.
ALTER TABLE "orden"
  ADD COLUMN "busqueda_texto" text
  GENERATED ALWAYS AS (
    btrim(regexp_replace(
      lower(translate(
        coalesce("num_guia"::text, '')                                    || ' ' ||
        coalesce("num_remision", '')                                      || ' ' ||
        coalesce("telefono_dest", '')                                     || ' ' ||
        regexp_replace(coalesce("telefono_dest", ''), '[^0-9]', '', 'g')  || ' ' ||
        coalesce("destinatario", '')                                      || ' ' ||
        coalesce("producto", ''),
        'áàäâãéèëêíìïîóòöôõúùüûñçÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ',
        'aaaaaeeeeiiiiooooouuuuncAAAAAEEEEIIIIOOOOOUUUUNC'
      )),
      '[ \t\n\r\f\v]+', ' ', 'g'))
  ) STORED;

-- 3) El indice, con el MISMO nombre y el MISMO opclass que antes: schema.prisma sigue
--    declarandolo tal cual y cualquier desviacion aqui seria drift. GIN y no GiST (esto es
--    un buscador: se lee mucho mas de lo que se escribe) y el opclass CUALIFICADO POR
--    ESQUEMA para que no dependa del `search_path` del rol que ejecuta.
CREATE INDEX "orden_busqueda_texto_trgm_idx"
  ON "orden" USING gin ("busqueda_texto" extensions.gin_trgm_ops);
