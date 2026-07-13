-- Feature 24 (limpieza): la relacion zona<->distrito quedo definida por la tabla
-- puente N:M `zona_distrito` (migracion 20260711210000_zona_distrito_nm). La columna
-- escalar `distrito.zona_id` (agregada en 20260711120000_zonas_catalogo_global_pagos,
-- ANTES de la redefinicion a N:M) quedo huerfana: nadie la escribe (la UI/ZonaForm
-- asigna via zona_distrito) y ya nadie la lee (la carga masiva y el catalogo geo
-- derivan la zona de la N:M). Se elimina para dejar UNA sola fuente de verdad y evitar
-- que vuelva a confundir. Destructivo: se pierde el contenido (siempre estuvo en NULL).

-- DropForeignKey
ALTER TABLE "distrito" DROP CONSTRAINT IF EXISTS "distrito_zona_id_fkey";

-- DropIndex
DROP INDEX IF EXISTS "distrito_zona_id_idx";

-- DropColumn
ALTER TABLE "distrito" DROP COLUMN IF EXISTS "zona_id";
