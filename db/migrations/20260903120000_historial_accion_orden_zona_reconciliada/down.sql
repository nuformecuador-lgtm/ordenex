-- DOWN (ficha 366): Postgres NO soporta `ALTER TYPE ... DROP VALUE`, asi que el tipo
-- `historial_accion_tipo` se RECREA con la lista PREVIA — los 42 valores que tenia el
-- `CREATE TYPE` de `20260902120000_historial_accion/migration.sql`, en su mismo orden—, sin
-- `orden_zona_reconciliada`. Patron IDENTICO a
-- `20260731120000_orden_historial_origen_asignacion_recoleccion/down.sql` y a
-- `20260729140000_orden_historial_origen_deshacer_asignacion/down.sql`.
--
-- IRREVERSIBILIDAD PARCIAL: el `ADD VALUE` del up no se deshace con un DROP VALUE nativo; la
-- unica forma de "quitar" el valor es recrear el enum con la lista previa.
--
-- ⚠️ PRECONDICION: NINGUNA fila de "historial_accion" con accion = 'orden_zona_reconciliada'. Si
-- quedara alguna, el `USING` del `ALTER COLUMN` falla RUIDOSAMENTE al no poder castear ese valor
-- al tipo recreado y el rollback aborta: comportamiento CORRECTO — borrar el rastro de auditoria
-- de reconciliaciones ya ejecutadas no es seguro; primero se decide que hacer con esas filas.
--
-- NINGUN `down.sql` ANTERIOR SE TOCA: son fotos historicas de lo que habia cuando se escribieron.
-- El de `20260902120000_historial_accion` CREA el tipo entero y lo DROPEA entero, asi que no
-- tiene ninguna lista que aprender de esta migracion.
--
-- La UNICA columna que usa este enum es "historial_accion"."accion" (migracion 362, linea 163).
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
  'api_key_desactivada'
);
ALTER TABLE "historial_accion"
  ALTER COLUMN "accion" TYPE "historial_accion_tipo"
  USING ("accion"::text::"historial_accion_tipo");
DROP TYPE "historial_accion_tipo_old";
