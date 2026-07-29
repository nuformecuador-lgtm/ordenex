-- Feature 144 (design.md §1.2) — INDICES para los filtros de ordenes.
--
-- `orden` es la tabla mas grande del sistema y esta feature pone `zona_id`,
-- `provincia_id`, `canton_id` y `distrito_id` en el WHERE de una ruta caliente
-- (`findMany` + `count` por cada cambio de filtro). Ninguna de las cuatro columnas
-- tenia indice. `created_at` YA esta indexado (indice preexistente) y `tienda_id`
-- y `estatus_id` tambien: esta migracion no los duplica.
--
-- Solo indices: sin tablas nuevas, sin columnas nuevas, sin RLS nueva.
CREATE INDEX "orden_zona_id_idx"      ON "orden"("zona_id");
CREATE INDEX "orden_provincia_id_idx" ON "orden"("provincia_id");
CREATE INDEX "orden_canton_id_idx"    ON "orden"("canton_id");
CREATE INDEX "orden_distrito_id_idx"  ON "orden"("distrito_id");
