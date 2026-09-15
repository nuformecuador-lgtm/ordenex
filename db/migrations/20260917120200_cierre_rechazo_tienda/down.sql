-- DOWN (FICHA 425): revierte EXACTAMENTE lo que `migration.sql` hace, y no puede perder ningun dato
-- ajeno — la tabla NACE en esta migracion y ninguna tabla previa gano una columna.
--
-- `DROP TABLE` arrastra el UNIQUE `cierre_rechazo_tienda_gestion_id_key`, los indices por
-- `cierre_id` y `orden_id`, las 3 FKs y la configuracion de RLS. No hay enum que retipar ni valor
-- que devolver: por eso este DOWN no toca ni recrea nada mas.
--
-- Revertirla NO deja apuntes de dinero que compensar: los rechazos vinculados nunca recibieron
-- `cierre_id`, asi que ningun feed de wallet los emitio (design §9).
DROP TABLE IF EXISTS "cierre_rechazo_tienda";
