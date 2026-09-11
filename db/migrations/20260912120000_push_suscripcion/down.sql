-- DOWN (ficha 410, T1.2) -- revierte EXACTAMENTE `migration.sql`, en orden inverso.
--
--   1. `DROP TABLE push_envio_dia`   -- arrastra su indice unico, su FK y su configuracion de RLS.
--   2. `DROP TABLE push_suscripcion` -- arrastra sus dos indices, su FK y su configuracion de RLS.
--
-- NO HAY `DROP TYPE`, y no es un olvido: esta migracion NO creo ningun enum. `notificacion_evento`
-- es de la 146 y se queda donde estaba; la columna `push_envio_dia.evento` solo lo USABA. Por eso
-- aqui no aplica nada de la leccion de los enums recreados con lista -- eso es del `down.sql` de la
-- migracion SIGUIENTE, que si amplia `job_tipo`.
--
-- QUE SE PIERDE AL REVERTIR, dicho en voz alta: TODAS las suscripciones. Los dispositivos dejan de
-- recibir push y hay que volver a activarlo uno a uno desde el control -- el navegador no puede
-- «reenviar» la suya solo. Y se pierde el cupo del dia en curso, asi que el primer push posterior a
-- un rollback+reaplicacion puede repetir uno que ya habia salido hoy. Las dos perdidas son
-- aceptables y ninguna toca un aviso: `notificacion` NO se toca aqui ni una vez. Es exactamente el
-- motivo de que estos dos `DROP TABLE` sean seguros -- lo que se va es el TRANSPORTE, no el hecho,
-- y el hecho sigue viendose en la campana.
--
-- AQUI NO HAY NI UN `UPDATE` NI UN `INSERT` PARA «REPARAR» NADA.
DROP TABLE IF EXISTS "push_envio_dia";

DROP TABLE IF EXISTS "push_suscripcion";
