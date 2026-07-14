-- Revierte el seed de geografia. Borra distritos/cantones/provincias SOLO si no tienen
-- dependencias (ordenes/zona_distrito). Orden inverso por FKs. Best-effort: si hay datos
-- dependientes, esas filas quedan (DELETE ... WHERE NOT EXISTS).
DELETE FROM "distrito" d WHERE NOT EXISTS (SELECT 1 FROM "orden" o WHERE o."distrito_id" = d."id") AND NOT EXISTS (SELECT 1 FROM "zona_distrito" zd WHERE zd."distrito_id" = d."id");
DELETE FROM "canton" c WHERE NOT EXISTS (SELECT 1 FROM "distrito" d WHERE d."canton_id" = c."id") AND NOT EXISTS (SELECT 1 FROM "orden" o WHERE o."canton_id" = c."id");
DELETE FROM "provincia" p WHERE NOT EXISTS (SELECT 1 FROM "canton" c WHERE c."provincia_id" = p."id") AND NOT EXISTS (SELECT 1 FROM "orden" o WHERE o."provincia_id" = p."id");
