-- DOWN (ficha 374) — revierte EXACTAMENTE `migration.sql`: quita los DOS valores de
-- `historial_accion_tipo` (`nodo_geografico_desactivado`, `nodo_geografico_activado`) y los TRES
-- de `historial_accion_entidad` (`provincia`, `canton`, `distrito`).
--
-- POR QUE ES UN `CREATE TYPE` Y NO UN `DROP VALUE`: Postgres NO soporta
-- `ALTER TYPE ... DROP VALUE`. La unica via es RECREAR el tipo con la lista PREVIA y recastear las
-- columnas que lo usan. Patron IDENTICO al de
-- `20260904120000_historial_accion_api_key_eliminada/down.sql`.
--
-- DE DONDE SALEN LAS DOS LISTAS, sin lugar a duda:
--
--   * LOS 45 DE `historial_accion_tipo` = los 44 del `CREATE TYPE` de
--     `20260904120000_historial_accion_api_key_eliminada/down.sql` MAS `'api_key_eliminada'`, que
--     es justamente el valor que AQUELLA migracion añadio y que su propio `down` no podia listar.
--     `ADD VALUE` sin `BEFORE`/`AFTER` APENDE, asi que ese es el `enumsortorder` real.
--
--   * LOS 17 DE `historial_accion_entidad` = los del `CREATE TYPE` original de
--     `20260902120000_historial_accion/migration.sql` (lineas 136-154), TAL CUAL: ninguna
--     migracion lo habia ampliado desde entonces, asi que no hay nada que sumarle. Esta ficha es
--     su PRIMERA ampliacion.
--
-- NINGUN `down.sql` ANTERIOR SE TOCA: son fotos historicas de lo que habia cuando se escribieron.
--
-- ⚠️ PRECONDICION RUIDOSA: NINGUNA fila de "historial_accion" con
-- `accion IN ('nodo_geografico_desactivado','nodo_geografico_activado')` ni con
-- `entidad_tipo IN ('provincia','canton','distrito')`. Si quedara alguna, el `USING` del
-- `ALTER COLUMN` falla RUIDOSAMENTE al no poder castear ese valor al tipo recreado y el rollback
-- ABORTA. Eso es lo CORRECTO (R57): borrar el rastro de quien retiro un distrito no es seguro, y
-- esa fila es lo unico que dice quien lo decidio. Primero se decide que hacer con esas filas.
--
-- Las columnas que usan estos enums son exactamente dos: "historial_accion"."accion" y
-- "historial_accion"."entidad_tipo".

ALTER TYPE "historial_accion_tipo" RENAME TO "historial_accion_tipo_old";
CREATE TYPE "historial_accion_tipo" AS ENUM (
  -- mueve dinero (25)
  'cierre_dia_aprobado',
  'cierre_dia_rechazado',
  'cierre_dia_pagos_editados',
  'cierre_bodega_aprobado',
  'cierre_bodega_rechazado',
  'pago_mensajero_registrado',
  'pago_tienda_registrado',
  'pago_anulado',
  'reparto_mensajero_registrado',
  'reparto_anulado',
  'wallet_movimiento_manual_registrado',
  'egreso_administrativo_registrado',
  'egreso_administrativo_reversado',
  'tarifa_creada',
  'tarifa_actualizada',
  'incidente_aprobado',
  'incidente_rechazado',
  'cobro_gasto_fijo_aprobado',
  'cobro_gasto_fijo_rechazado',
  'cobro_rechazo_tienda_aprobado',
  'cobro_rechazo_tienda_rechazado',
  'premio_ranking_registrado',
  'premio_ranking_anulado',
  'orden_ubicacion_corregida',
  'usuario_fulfillment_cambiado',
  -- hace desaparecer algo (6)
  'orden_eliminada',
  'orden_recuperada',
  'tarifa_borrada',
  'zona_borrada',
  'vehiculo_borrado',
  'plantilla_eliminada',
  -- cambia quien puede hacer que (11)
  'usuario_creado',
  'usuario_rol_cambiado',
  'usuario_zona_cambiada',
  'usuario_estado_cambiado',
  'usuario_contrasena_restablecida',
  'postulacion_aprobada',
  'postulacion_rechazada',
  'api_key_generada',
  'api_key_rotada',
  'api_key_activada',
  'api_key_desactivada',
  -- añadido por la ficha 366, DESPUES del bloque de la 362 (asi lo apende `ADD VALUE`)
  'orden_zona_reconciliada',
  -- añadido por la ficha 371, despues del anterior
  'gestion_fecha_reprogramacion_corregida',
  -- añadido por la ficha 373, despues del anterior
  'api_key_eliminada'
);

ALTER TYPE "historial_accion_entidad" RENAME TO "historial_accion_entidad_old";
CREATE TYPE "historial_accion_entidad" AS ENUM (
  'orden',
  'usuario',
  'tarifa',
  'zona',
  'vehiculo',
  'plantilla_mensaje',
  'cierre_dia',
  'cierre_bodega',
  'gestion_orden',
  'liquidacion_pago',
  'liquidacion_reparto',
  'wallet_movimiento',
  'orden_incidente',
  'gasto_fijo_cobro',
  'rechazo_tienda_cobro',
  'ranking_snapshot_fila',
  'api_key'
);

ALTER TABLE "historial_accion"
  ALTER COLUMN "accion" TYPE "historial_accion_tipo"
  USING ("accion"::text::"historial_accion_tipo");
ALTER TABLE "historial_accion"
  ALTER COLUMN "entidad_tipo" TYPE "historial_accion_entidad"
  USING ("entidad_tipo"::text::"historial_accion_entidad");

DROP TYPE "historial_accion_tipo_old";
DROP TYPE "historial_accion_entidad_old";
