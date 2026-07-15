-- DOWN (R24): revierte EXACTAMENTE lo que migration.sql crea. `DROP TABLE` arrastra el
-- UNIQUE `cierre_detail_cierre_id_orden_id_key`, el indice `cierre_detail_orden_id_idx`, las
-- 5 FKs y la configuracion de RLS. No hay enum propio que dropear y la migracion es ADITIVA
-- (no altero ninguna tabla existente), asi que no hay nada mas que restaurar.
-- El backfill (R26) no necesita reversa: sus filas mueren con la tabla.
DROP TABLE IF EXISTS "cierre_detail";
