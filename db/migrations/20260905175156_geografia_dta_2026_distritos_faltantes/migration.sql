-- GEOGRAFIA — los TRES distritos que le faltaban a Costa Rica en esta base.
--
-- QUE ESTABA MAL. La geografia se sembro el 2026-07-13 desde la DTA 2022/2023 del IGN
-- (`20260713005000_seed_geografia_cr`, 491 distritos). La Division Territorial Administrativa
-- VIGENTE del Instituto Geografico Nacional —edicion 2026— tiene 494. Las 7 provincias y los 84
-- cantones estaban completos; lo que faltaba eran exactamente estos tres distritos:
--
--   | distrito | canton       | provincia  | codigo DTA | norma                                    |
--   |----------|--------------|------------|-----------|------------------------------------------|
--   | Cabagra  | Buenos Aires | Puntarenas | 60310     | decreto 10709, 30/05/2025                |
--   | Pijije   | Bagaces      | Guanacaste | 50405     | decreto 10688, 30/05/2025                |
--   | Duacari  | Guacimo      | Limon      | 70605     | decreto ejecutivo 12091-G, 27/11/1980    |
--
-- Los dos primeros son creaciones RECIENTES (mayo 2025), posteriores a la edicion que se uso para
-- sembrar. El tercero NO: Duacari existe desde 1980 y se perdio por un defecto de la TABLA de
-- detalle del PDF del IGN, que lo omite aunque su propia portada declare 494. Esa era la
-- "discrepancia de 1 distrito (491 vs 492)" abierta en `public/geografia-cr-completa-NOTAS.md`,
-- que esta migracion cierra.
--
-- Totales despues de esto: San Jose 123, Alajuela 116, Cartago 53, Heredia 48, Guanacaste 62,
-- Puntarenas 62, Limon 30 = 494.
--
-- IDEMPOTENTE via `WHERE NOT EXISTS` (mismo patron que la migracion que sembro la geografia):
-- `provincia`/`canton`/`distrito` NO tienen ningun indice unico sobre el nombre, asi que un
-- `ON CONFLICT` no tendria sobre que inferir y correr esto dos veces duplicaria las filas.
--
-- EL CANTON SE RESUELVE POR EL PAR (canton, provincia), NUNCA SOLO POR NOMBRE. "Buenos Aires" es
-- a la vez un canton de Puntarenas y un DISTRITO de Palmares (Alajuela); y hay nombres de canton
-- repetidos entre provincias en toda la DTA. Un `WHERE c."nombre" = 'Buenos Aires'` a secas es
-- ambiguo y un dia mete el distrito en el canton equivocado sin romper nada visible.

-- 1) Los tres distritos. `zona_especial` no se escribe: toma su DEFAULT (false), que es lo que
--    recibe cualquier distrito del que nadie ha decidido lo contrario.
INSERT INTO "distrito" ("id", "canton_id", "nombre")
SELECT gen_random_uuid()::text, c."id", 'Cabagra'
FROM "canton" c
  JOIN "provincia" p ON p."id" = c."provincia_id"
WHERE p."nombre" = 'Puntarenas'
  AND c."nombre" = 'Buenos Aires'
  AND NOT EXISTS (
    SELECT 1 FROM "distrito" d WHERE d."canton_id" = c."id" AND d."nombre" = 'Cabagra'
  );

INSERT INTO "distrito" ("id", "canton_id", "nombre")
SELECT gen_random_uuid()::text, c."id", 'Pijije'
FROM "canton" c
  JOIN "provincia" p ON p."id" = c."provincia_id"
WHERE p."nombre" = 'Guanacaste'
  AND c."nombre" = 'Bagaces'
  AND NOT EXISTS (
    SELECT 1 FROM "distrito" d WHERE d."canton_id" = c."id" AND d."nombre" = 'Pijije'
  );

INSERT INTO "distrito" ("id", "canton_id", "nombre")
SELECT gen_random_uuid()::text, c."id", 'Duacarí'
FROM "canton" c
  JOIN "provincia" p ON p."id" = c."provincia_id"
WHERE p."nombre" = 'Limón'
  AND c."nombre" = 'Guácimo'
  AND NOT EXISTS (
    SELECT 1 FROM "distrito" d WHERE d."canton_id" = c."id" AND d."nombre" = 'Duacarí'
  );

-- 2) La zona (`zona_distrito`) SE DERIVA DE LOS HERMANOS. NO se escribe el nombre de la zona.
--
-- POR QUE NO UN LITERAL. Los nombres de zona NO son estables entre entornos: en produccion el
-- maestro las renombro a mano ("FGAM Zona Sur", "FGAM Guanacaste (Tempisque)"), mientras que una
-- base sembrada por `20260713010000_seed_zonas_pago_distrito` las llama "ZONA SUR" y "GUANACASTE".
-- Un `WHERE z."nombre" = 'ZONA SUR'` insertaria CERO filas en produccion —y al reves en local—
-- SIN fallar y sin decir nada: el distrito quedaria creado pero inservible. Ese fallo mudo es
-- exactamente el que ya advierte el encabezado de la migracion de zonas.
--
-- LA REGLA: el distrito nuevo hereda la zona de sus hermanos del mismo canton, y SOLO si todos
-- los hermanos que tienen zona convergen en EXACTAMENTE UNA. Con 0 zonas distintas, o con mas de
-- una, no se inserta ninguna fila.
--
-- POR QUE "EXACTAMENTE UNA" Y NO "LA PRIMERA". `zonaUnicaDeDistrito`
-- (`lib/repositories/_shared/zona-colapso.ts`) colapsa >1 zona a `null`: un distrito con dos
-- zonas es tan inservible como uno sin ninguna, pero PARECE configurado. Heredar dos seria peor
-- que no heredar nada. El `HAVING COUNT(DISTINCT ...) = 1` del LATERAL es esa regla: un agregado
-- sin `GROUP BY` devuelve siempre una fila, salvo que el `HAVING` la descarte — y entonces el
-- `CROSS JOIN LATERAL` deja fuera al distrito y no se inserta nada.
--
-- QUE SE ESPERA HOY, con la geografia y las zonas de este repo:
--   Cabagra -> los 9 hermanos de Buenos Aires convergen en una sola zona  -> la hereda
--   Pijije  -> hereda la zona de Bagaces si sus 4 hermanos convergen en una
--   Duacari -> los 4 hermanos de Guacimo estan TODOS sin zona -> nace SIN zona, y eso es
--              CORRECTO: Guacimo no tiene cobertura comercial y asi lo decidio el maestro.
--
-- `hermano."id" <> nuevo."id"` excluye al propio distrito: en una segunda corrida ya seria su
-- propio hermano y la regla dejaria de medir lo que dice medir.
INSERT INTO "zona_distrito" ("id", "zona_id", "distrito_id")
SELECT gen_random_uuid()::text, herencia."zona_id", nuevo."id"
FROM "distrito" nuevo
  JOIN "canton" c ON c."id" = nuevo."canton_id"
  JOIN "provincia" p ON p."id" = c."provincia_id"
  CROSS JOIN LATERAL (
    SELECT MIN(zd."zona_id") AS "zona_id"
    FROM "distrito" hermano
      JOIN "zona_distrito" zd ON zd."distrito_id" = hermano."id"
    WHERE hermano."canton_id" = nuevo."canton_id"
      AND hermano."id" <> nuevo."id"
    HAVING COUNT(DISTINCT zd."zona_id") = 1
  ) herencia
WHERE (p."nombre", c."nombre", nuevo."nombre") IN (
  ('Puntarenas', 'Buenos Aires', 'Cabagra'),
  ('Guanacaste', 'Bagaces', 'Pijije'),
  ('Limón', 'Guácimo', 'Duacarí')
)
ON CONFLICT ("zona_id", "distrito_id") DO NOTHING;
