-- DOWN (R4): elimina la tabla `webhook_suscripcion` por completo. El `DROP TABLE` arrastra
-- su PRIMARY KEY, el indice unico de `owner_usuario_id`, la FK al usuario y la RLS, dejando
-- el esquema EXACTAMENTE como estaba antes de esta migracion. `IF EXISTS` lo hace
-- re-ejecutable. El valor `webhook_estado` del enum lo revierte el down de la migracion
-- anterior (20260721120000_job_tipo_webhook_estado), que corre despues en el rollback.
DROP TABLE IF EXISTS "webhook_suscripcion";
