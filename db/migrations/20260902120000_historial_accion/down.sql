-- DOWN (ficha 362) -- revierte EXACTAMENTE `migration.sql`, en el orden inverso al que lo escribio
-- y con las dependencias respetadas.
--
--   1. `DROP TABLE historial_accion` -- arrastra sus TRES indices
--      (`historial_accion_created_at_id_idx`, `historial_accion_actor_usuario_id_created_at_idx`,
--      `historial_accion_entidad_tipo_entidad_id_idx`), su PK, su UNICA FK
--      (`historial_accion_actor_usuario_id_fkey`) y la configuracion de RLS. Va PRIMERO: mientras
--      la tabla exista, los dos tipos tienen columnas que dependen de ellos y los `DROP TYPE`
--      fallarian.
--   2. `DROP TYPE historial_accion_tipo` y `DROP TYPE historial_accion_entidad` -- los dos se
--      CREARON enteros en el up, asi que aqui se sueltan enteros. NO hay ningun
--      `ALTER TYPE ... ADD VALUE` de por medio.
--
-- NINGUN `down.sql` ANTERIOR SE TOCA. Son fotos historicas de lo que habia cuando se escribieron;
-- esta migracion no amplia ningun enum preexistente --crea DOS enums NUEVOS--, asi que no hay
-- ninguna lista previa que ninguna de ellas tenga que aprender. Ese patron (recrear-con-lista) es
-- de las migraciones que AMPLIAN un enum ajeno, y esta no amplia ninguno.
--
-- QUE SE PIERDE AL REVERTIR, dicho en voz alta: TODO EL REGISTRO DE AUDITORIA. Cada fila de quien
-- borro que, quien aprobo que cierre y quien cambio que rol desaparece con la tabla, y no se puede
-- reconstruir desde ningun otro sitio -- es justo el agujero que la ficha vino a cerrar. Un
-- rollback de esta migracion no es una operacion inocua de esquema: es un borrado de evidencia.
-- Lo que NO se toca es el dinero: los movimientos de `wallet_movimiento`, los cierres y los pagos
-- viven en sus propias tablas y esta migracion nunca escribio en ellas.
--
-- AQUI NO HAY NI UN `UPDATE`, NI UN `DELETE` NI UN `INSERT` PARA "REPARAR" NADA.
DROP TABLE IF EXISTS "historial_accion";

DROP TYPE IF EXISTS "historial_accion_tipo";

DROP TYPE IF EXISTS "historial_accion_entidad";
