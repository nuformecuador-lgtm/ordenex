-- Feature 169 (design §2.1 y §2.3) — buscador de texto del listado de ordenes.
--
-- UNA columna generada que concatena los CUATRO campos buscables ya normalizados
-- (num_guia, num_remision, telefono_dest, destinatario) + UN indice GIN de trigramas
-- sobre ella. Un solo indice y un solo `LIKE '%x%'` en vez de cuatro indices y un
-- BitmapOr de cuatro recorridos con su recheck cada uno.
--
-- ATENCION AL APLICAR EN PRODUCCION: `ADD COLUMN ... GENERATED ... STORED` REESCRIBE LA
-- TABLA ENTERA y toma un ACCESS EXCLUSIVE mientras dura (ni lecturas ni escrituras sobre
-- `orden`); `CREATE INDEX` toma ademas un SHARE (bloquea escrituras). Con miles de filas
-- es instantaneo; por encima de 200 000 filas hace falta ventana de mantenimiento con la
-- ingesta de ordenes parada. No se usa CREATE INDEX CONCURRENTLY porque Prisma ejecuta
-- cada migracion dentro de una transaccion y CONCURRENTLY no puede correr en una.
--
-- Sin tablas nuevas => sin RLS nueva: la columna hereda exactamente los permisos y las
-- politicas de `orden`.

-- 1) La extension, en el esquema `extensions`. Supabase instala ahi sus extensiones y ese
--    esquema NO esta en el `search_path` de todos los roles; un Postgres local recien
--    creado ni siquiera tiene el esquema. Se cubren los dos casos sin adivinar.
--    RIESGO ASUMIDO: si alguna base ya tuviera `pg_trgm` en OTRO esquema,
--    `CREATE EXTENSION IF NOT EXISTS` no la mueve y `extensions.gin_trgm_ops` no existira
--    => esta migracion FALLA EN VOZ ALTA. Es lo correcto: el modo de fallo alternativo (no
--    cualificar el opclass) seria un indice creado en una base y ausente en otra, con la
--    busqueda lenta solo en produccion y sin ninguna señal. Reparacion, si se da el caso:
--    `ALTER EXTENSION pg_trgm SET SCHEMA extensions;` ANTES de aplicar.
CREATE SCHEMA IF NOT EXISTS extensions;

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

-- 2) La columna generada. Cada pieza esta elegida, no es adorno:
--    · STORED  -> Postgres solo implementa STORED, y un indice necesita el valor materializado.
--    · num_guia::text -> unica forma de que la guia participe de la coincidencia parcial;
--      el cast entero->texto se resuelve por I/O (int4out/textin), ambas IMMUTABLE.
--    · `||` y no concat()/concat_ws() -> esas son STABLE y Postgres RECHAZARIA la columna.
--    · quinto segmento = telefono en forma SOLO DIGITOS -> "88880000" encuentra un telefono
--      guardado como "8888-0000" sin una segunda consulta.
--    · translate() ANTES de lower() -> lower() depende de la collation (en LC_CTYPE=C,
--      lower('Á') = 'Á'); plegando primero, a lower() solo se le pide bajar ASCII. Por eso
--      el mapa lleva las 24 minusculas acentuadas Y sus 24 mayusculas.
--    · NO se usa unaccent(): es STABLE (resuelve su diccionario por search_path) y Postgres
--      exige IMMUTABLE en una columna generada. El mapa explicito ademas es ESPEJABLE en
--      TypeScript, y esa paridad es lo que hace que la busqueda no falle en silencio.
--      Los dos strings de abajo son copia LITERAL de ACENTOS_FROM / ACENTOS_TO
--      (lib/utils/busqueda-orden.ts) y un test lo comprueba caracter a caracter.
--    · btrim + colapso de espacios -> espeja el normalizador de Node; sin el, un
--      destinatario con doble espacio seria inencontrable (R8).
--      La clase se escribe EXPLICITA — `[ \t\n\r\f\v]` — y NO como `\s`, que es una
--      DESVIACION DELIBERADA del design §2.1 por la misma razon por la que ese documento
--      descarta `unaccent`: el `\s` de Postgres es `[[:space:]]`, que depende del ctype de
--      la base. Verificado empiricamente: en el Postgres 18 local (msvc) `\s` SI colapsa el
--      NBSP (U+00A0); en un build glibc (Supabase) NO. Con `\s`, la columna se calcularia
--      distinto en local y en produccion y la paridad con Node seria indemostrable. La
--      clase explicita da el mismo resultado en cualquier build y en cualquier locale.
--    · NULLable a proposito aunque la expresion nunca produzca NULL (todo va con coalesce):
--      en Prisma se declara `String?`, y declararla NOT NULL en SQL seria drift.
ALTER TABLE "orden"
  ADD COLUMN "busqueda_texto" text
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

-- 3) El indice. GIN y no GiST: GIN es netamente mas rapido en LECTURA para trigramas y
--    esto es un buscador (se lee mucho mas de lo que se escribe). El opclass va CUALIFICADO
--    POR ESQUEMA para que nada dependa del `search_path` del rol que ejecuta la migracion
--    ni del que ejecuta las consultas.
CREATE INDEX "orden_busqueda_texto_trgm_idx"
  ON "orden" USING gin ("busqueda_texto" extensions.gin_trgm_ops);
