-- DOWN — borra los tres distritos de la DTA 2026 (Cabagra, Pijije, Duacarí) y sus links de zona.
--
-- PERDIDA DE DATO DECLARADA — Y NO ES LA QUE PARECE. `orden.distrito_id` NO es RESTRICT: la FK
-- real, medida contra la base (`pg_constraint.orden_distrito_id_fkey`, y su origen en
-- `20260709130100_ordenes`), es
--
--     FOREIGN KEY (distrito_id) REFERENCES distrito(id) ON UPDATE CASCADE ON DELETE SET NULL
--
-- Es decir: si ya hay ordenes en alguno de estos tres distritos, este rollback NO falla. Borra el
-- distrito y deja esas ordenes con `distrito_id = NULL`, EN SILENCIO. La columna es el UNICO FK
-- nullable de `orden` justamente para admitir eso, asi que no hay error, no hay aviso y no hay
-- forma de reconstruir a que distrito apuntaba cada orden: el dato se va.
--
-- QUE HACER ANTES DE CORRERLO, entonces. Contar primero, y decidir a la vista del numero:
--
--     SELECT COUNT(*) FROM "orden" o
--       JOIN "distrito" d ON d."id" = o."distrito_id"
--       JOIN "canton" c ON c."id" = d."canton_id"
--       JOIN "provincia" p ON p."id" = c."provincia_id"
--     WHERE (p."nombre", c."nombre", d."nombre") IN (
--       ('Puntarenas','Buenos Aires','Cabagra'),
--       ('Guanacaste','Bagaces','Pijije'),
--       ('Limón','Guácimo','Duacarí'));
--
-- Si devuelve algo distinto de 0, revertir es tirar historial de reparto. En ese caso lo correcto
-- NO es correr este down, sino dejar los distritos y arreglar hacia adelante.
--
-- Los links de `zona_distrito` se borran EXPLICITAMENTE aunque su FK a `distrito` sea
-- ON DELETE CASCADE: asi el down revierte lo que el up escribio aunque se ejecute suelto, sin
-- depender de un efecto colateral del motor.
--
-- IDEMPOTENTE por construccion: un `DELETE` que no encuentra nada afecta 0 filas y no falla, asi
-- que no hace falta ningun `IF EXISTS` (y sobre filas no existiria de todos modos). Correrlo dos
-- veces, o sobre una base donde la migracion nunca se aplico, es un no-op.
--
-- Igual que en el `up`, el distrito se resuelve por la TERNA (provincia, canton, distrito) y
-- nunca por el nombre suelto: "Buenos Aires" es canton en Puntarenas y distrito en Palmares.

-- 1) Los links de zona de los tres distritos.
DELETE FROM "zona_distrito" zd
USING "distrito" d, "canton" c, "provincia" p
WHERE zd."distrito_id" = d."id"
  AND d."canton_id" = c."id"
  AND c."provincia_id" = p."id"
  AND (p."nombre", c."nombre", d."nombre") IN (
    ('Puntarenas', 'Buenos Aires', 'Cabagra'),
    ('Guanacaste', 'Bagaces', 'Pijije'),
    ('Limón', 'Guácimo', 'Duacarí')
  );

-- 2) Los tres distritos.
DELETE FROM "distrito" d
USING "canton" c, "provincia" p
WHERE d."canton_id" = c."id"
  AND c."provincia_id" = p."id"
  AND (p."nombre", c."nombre", d."nombre") IN (
    ('Puntarenas', 'Buenos Aires', 'Cabagra'),
    ('Guanacaste', 'Bagaces', 'Pijije'),
    ('Limón', 'Guácimo', 'Duacarí')
  );
