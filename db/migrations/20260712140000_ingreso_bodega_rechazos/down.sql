-- DOWN: revierte exactamente migration.sql de esta carpeta, en orden inverso.
-- Solo suelta las 3 columnas agregadas por el UP. NO toca RLS, enums ni columnas
-- preexistentes de gestion_orden/cierre_dia/cierre_bodega. Aditiva y reversible (R21).

-- 3) total agregado del cierre de bodega.
ALTER TABLE "cierre_bodega" DROP COLUMN IF EXISTS "total_ingreso_bodega_rechazos";

-- 2) total del cierre del dia.
ALTER TABLE "cierre_dia" DROP COLUMN IF EXISTS "total_ingreso_bodega_rechazos";

-- 1) ingreso snapshoteado por gestion.
ALTER TABLE "gestion_orden" DROP COLUMN IF EXISTS "ingreso_bodega_rechazo";
