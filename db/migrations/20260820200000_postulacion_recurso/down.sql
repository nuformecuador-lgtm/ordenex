-- DOWN (feature 253) — revierte EXACTAMENTE migration.sql.
--
-- `DROP TABLE` arrastra la PK (`postulacion_recurso_pkey`), los dos indices
-- (`postulacion_recurso_atendida_at_created_at_idx`, `postulacion_recurso_atendida_por_id_idx`),
-- la FK a `usuario` (`postulacion_recurso_atendida_por_id_fkey`), el CHECK
-- (`postulacion_recurso_atendida_completa`) y la RLS.
--
-- El `DROP TYPE` VA DESPUES y SI corresponde aqui, al reves que en el down de `orden_nota`: alli
-- `rol_value` era un enum PREEXISTENTE que la migracion reutilizaba; este lo CREA ella, y no
-- soltarlo dejaria un tipo huerfano que impediria volver a aplicar el up.
--
-- DESTRUCTIVO Y SIN VUELTA: se lleva las postulaciones escritas, que son datos de personas del
-- publico que no tienen ninguna otra forma de saber que se perdieron. Es correcto para un down
-- —devuelve la base al estado de SU momento— y por eso se dice aqui, en voz alta.
DROP TABLE IF EXISTS "postulacion_recurso";
DROP TYPE IF EXISTS "postulacion_recurso_tipo";
