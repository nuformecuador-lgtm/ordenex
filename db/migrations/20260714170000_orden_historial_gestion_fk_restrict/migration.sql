-- Feature 67 (F1.4-i, APROBADA por el humano) — defensa en profundidad del enlace
-- `orden_historial_estado.gestion_orden_id`: vuelve a `ON DELETE RESTRICT`.
--
-- CONTEXTO (verificado, no inventado): la 20260713120000_orden_historial_estado creo esta FK
-- `ON DELETE RESTRICT` a mano, pero la 20260714123909_reconcile_fks_drop_order_status_value
-- la recableo a `ON DELETE SET NULL` para reconciliar el SQL con `schema.prisma` (la relacion
-- `gestion GestionOrden?` es OPCIONAL y no declaraba `onDelete` -> default `SetNull` de
-- Prisma). Consecuencia: un DELETE sobre una gestion NO fallaba y vaciaba el enlace EN
-- SILENCIO, orfanando filas del historial.
--
-- POR QUE IMPORTA: ese enlace sostiene el derivador de intentos (47/49), que dispara el
-- escalado a `rechazada` -> `cobroRechazado` (56) = DINERO. Un SET NULL silencioso devolveria
-- al conteo el intento de una gestion anulada y resucitaria el bug que la feature 67 mata.
--
-- POR QUE TAMBIEN EN EL MODELO: `schema.prisma` declara ahora `onDelete: Restrict` en la
-- relacion. Un RESTRICT escrito SOLO en SQL reintroduciria el drift que la 20260714123909
-- vino a eliminar y el proximo reconcile lo pisaria en silencio.
--
-- SEGURIDAD DEL CAMBIO: hoy NADA borra gestiones (`gestionOrden.delete|deleteMany` -> 0
-- resultados en el repo) -> RESTRICT no rompe ningun flujo vivo. Migracion NO destructiva:
-- solo recablea la accion referencial; no toca datos, columnas ni policies RLS.

ALTER TABLE "orden_historial_estado" DROP CONSTRAINT IF EXISTS "orden_historial_estado_gestion_orden_id_fkey";

ALTER TABLE "orden_historial_estado" ADD CONSTRAINT "orden_historial_estado_gestion_orden_id_fkey"
  FOREIGN KEY ("gestion_orden_id") REFERENCES "gestion_orden"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
