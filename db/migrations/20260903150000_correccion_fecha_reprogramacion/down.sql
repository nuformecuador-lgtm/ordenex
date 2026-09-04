-- DOWN (ficha 371) — revierte EXACTAMENTE migration.sql, en ORDEN INVERSO: primero la tabla,
-- despues el valor del enum.
--
-- 1) `DROP TABLE` arrastra la PK (`gestion_fecha_reprogramacion_cambio_pkey`), los tres indices
--    (`..._orden_id_created_at_idx`, `..._gestion_id_created_at_idx`, `..._actor_usuario_id_idx`),
--    las tres FK (`..._gestion_id_fkey`, `..._orden_id_fkey`, `..._actor_usuario_id_fkey`), el
--    CHECK (`gestion_fecha_reprogramacion_cambio_fecha_distinta`) y la RLS.
--
--    ⚠️ DESTRUCTIVO Y SIN VUELTA, y se dice en voz alta: se lleva el rastro escrito —QUIEN corrigio
--    la fecha de que gestion, de que dia a que dia y POR QUE—. Es correcto para un down (devuelve
--    la base al estado de SU momento) y por eso queda escrito aqui.
--
-- 2) Postgres NO soporta `ALTER TYPE ... DROP VALUE`, asi que `historial_accion_tipo` se RECREA con
--    la lista PREVIA: los 42 valores del `CREATE TYPE` de `20260902120000_historial_accion` MAS
--    `orden_zona_reconciliada`, que la ficha 366 añadio al final (`ADD VALUE` sin `BEFORE`/`AFTER`
--    APENDE, asi que ese es el `enumsortorder` real de la base). Patron IDENTICO a
--    `20260903120000_historial_accion_orden_zona_reconciliada/down.sql`.
--
--    IRREVERSIBILIDAD PARCIAL: el `ADD VALUE` del up no se puede deshacer con un `DROP VALUE`
--    nativo. ESTE DOWN ES SEGURO SOLO SI NINGUNA FILA USA EL VALOR NUEVO (ver precondicion).
--
--    ⚠️ PRECONDICION: NINGUNA fila de "historial_accion" con
--    accion = 'gestion_fecha_reprogramacion_corregida'. Si quedara alguna, el `USING` del
--    `ALTER COLUMN` falla RUIDOSAMENTE al no poder castear ese valor al tipo recreado y el rollback
--    aborta: comportamiento CORRECTO — borrar el rastro de auditoria de correcciones ya ejecutadas
--    no es seguro; primero se decide que hacer con esas filas.
--
-- ⭑ ESTE DOWN SE EJECUTO, no solo se leyo (2026-09-03, patron de la ficha 366): las cinco
-- sentencias corrieron contra la base local DENTRO de una transaccion que se revirtio. Dentro de
-- ella la tabla dejo de existir, el enum quedo en los 43 valores de la lista previa EN SU ORDEN, y
-- la columna "historial_accion"."accion" siguio casteando sobre sus 56 filas reales; tras el
-- ROLLBACK la base quedo byte a byte como estaba. Leerlo no demuestra que corra.
--
--    NINGUN `down.sql` ANTERIOR SE TOCA: son fotos historicas de lo que habia cuando se escribieron.
--
--    La UNICA columna que usa este enum es "historial_accion"."accion".
DROP TABLE IF EXISTS "gestion_fecha_reprogramacion_cambio";

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
  'orden_zona_reconciliada'
);
ALTER TABLE "historial_accion"
  ALTER COLUMN "accion" TYPE "historial_accion_tipo"
  USING ("accion"::text::"historial_accion_tipo");
DROP TYPE "historial_accion_tipo_old";
