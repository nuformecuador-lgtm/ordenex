-- DOWN (ficha 373) — revierte EXACTAMENTE migration.sql: quita el valor `api_key_eliminada` del
-- enum `historial_accion_tipo`.
--
-- POR QUE ES UN `CREATE TYPE` Y NO UN `DROP VALUE`: Postgres NO soporta
-- `ALTER TYPE ... DROP VALUE`. La unica via es RECREAR el tipo con la lista PREVIA y recastear la
-- unica columna que lo usa. Patron IDENTICO a
-- `20260903150000_correccion_fecha_reprogramacion/down.sql`.
--
-- DE DONDE SALE LA LISTA DE 44, sin lugar a duda: son los 43 valores del `CREATE TYPE` de
-- `20260903150000_correccion_fecha_reprogramacion/down.sql` MAS
-- `gestion_fecha_reprogramacion_corregida`, que es justamente el valor que AQUELLA migracion
-- anadio y que su propio `down` no podia listar. `ADD VALUE` sin `BEFORE`/`AFTER` APENDE, asi que
-- ese es el `enumsortorder` real de la base — verificado contra `pg_enum` el 2026-09-04: 44 valores
-- en este mismo orden.
--
-- NINGUN `down.sql` ANTERIOR SE TOCA: son fotos historicas de lo que habia cuando se escribieron.
--
-- ⚠️ PRECONDICION: NINGUNA fila de "historial_accion" con accion = 'api_key_eliminada'. Si quedara
-- alguna, el `USING` del `ALTER COLUMN` falla RUIDOSAMENTE al no poder castear ese valor al tipo
-- recreado y el rollback ABORTA: comportamiento CORRECTO (R27) — borrar el rastro de keys ya
-- eliminadas no es seguro, y esas keys ya no existen en ninguna otra tabla, asi que esa fila es lo
-- UNICO que queda de ellas. Primero se decide que hacer con esas filas.
--
-- La UNICA columna que usa este enum es "historial_accion"."accion".
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
  -- anadido por la ficha 366, DESPUES del bloque de la 362 (asi lo apende `ADD VALUE`)
  'orden_zona_reconciliada',
  -- anadido por la ficha 371, despues del anterior
  'gestion_fecha_reprogramacion_corregida'
);
ALTER TABLE "historial_accion"
  ALTER COLUMN "accion" TYPE "historial_accion_tipo"
  USING ("accion"::text::"historial_accion_tipo");
DROP TYPE "historial_accion_tipo_old";
