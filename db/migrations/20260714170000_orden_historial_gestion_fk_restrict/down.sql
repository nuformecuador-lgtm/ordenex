-- DOWN: revierte EXACTAMENTE migration.sql de esta carpeta — restaura
-- `ON DELETE SET NULL` en `orden_historial_estado.gestion_orden_id`, que es el estado que
-- dejo la migracion 20260714123909_reconcile_fks_drop_order_status_value (y el default de
-- Prisma para una relacion opcional sin `onDelete`).
--
-- OJO al revertir: con SET NULL vuelve el riesgo documentado en design.md §8 (un DELETE
-- sobre `gestion_orden` orfana filas del historial en silencio). La feature 67 sigue siendo
-- correcta sin esta FK — el predicado de `contarPorDestinoVigentes` (design §4.2) trata la
-- huerfana como intento NO vigente (R26) y no depende de la accion referencial —, pero se
-- pierde la defensa en profundidad. Si se revierte, revertir tambien el `onDelete: Restrict`
-- de `schema.prisma` para no dejar drift.
--
-- No toca datos, columnas ni policies RLS.

ALTER TABLE "orden_historial_estado" DROP CONSTRAINT IF EXISTS "orden_historial_estado_gestion_orden_id_fkey";

ALTER TABLE "orden_historial_estado" ADD CONSTRAINT "orden_historial_estado_gestion_orden_id_fkey"
  FOREIGN KEY ("gestion_orden_id") REFERENCES "gestion_orden"("id") ON DELETE SET NULL ON UPDATE CASCADE;
