-- DOWN: revierte exactamente migration.sql de esta carpeta, en orden inverso.
-- No toca objetos preexistentes (orden/order_status/usuario/gestion_orden intactos).

-- 2) tabla orden_historial_estado (DROP TABLE arrastra sus 5 FKs y sus 2 indices).
DROP TABLE IF EXISTS "orden_historial_estado";

-- 1) enum nativo de tipo de origen.
DROP TYPE IF EXISTS "orden_historial_origen_tipo";
