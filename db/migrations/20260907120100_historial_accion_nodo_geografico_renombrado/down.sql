-- DOWN (ficha 375) — revierte EXACTAMENTE `migration.sql`: quita el valor
-- `nodo_geografico_renombrado` de `historial_accion_tipo`.
--
-- POR QUE ES UN `CREATE TYPE` Y NO UN `DROP VALUE`: Postgres NO soporta
-- `ALTER TYPE ... DROP VALUE`. La unica via es RECREAR el tipo con la lista PREVIA y recastear la
-- columna que lo usa. Patron IDENTICO al de
-- `20260906120100_historial_accion_nodo_geografico/down.sql`.
--
-- DE DONDE SALE LA LISTA, sin lugar a duda: LOS 47 = los 45 del `CREATE TYPE` de
-- `20260906120100_historial_accion_nodo_geografico/down.sql` MAS `'nodo_geografico_desactivado'` y
-- `'nodo_geografico_activado'`, que son justamente los dos valores que AQUELLA migracion añadio y
-- que su propio `down` no podia listar. `ADD VALUE` sin `BEFORE`/`AFTER` APENDE, asi que ese es el
-- `enumsortorder` real.
--
-- `historial_accion_entidad` NO SE TOCA: esta migracion no lo amplia. Sus 20 valores (17 originales
-- + los tres de la 374) se quedan como estan.
--
-- NINGUN `down.sql` ANTERIOR SE TOCA: son fotos historicas de lo que habia cuando se escribieron.
--
-- ⚠️ PRECONDICION RUIDOSA: NINGUNA fila de "historial_accion" con
-- `accion = 'nodo_geografico_renombrado'`. Si quedara alguna, el `USING` del `ALTER COLUMN` falla
-- RUIDOSAMENTE al no poder castear ese valor al tipo recreado y el rollback ABORTA. Eso es lo
-- CORRECTO: esa fila es lo unico que dice como se llamaba antes un distrito y quien lo cambio.
-- Primero se decide que hacer con esas filas.
--
-- La columna que usa este enum es exactamente una: "historial_accion"."accion".

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
  'api_key_eliminada',
  -- añadidos por la ficha 374, despues del anterior
  'nodo_geografico_desactivado',
  'nodo_geografico_activado'
);

ALTER TABLE "historial_accion"
  ALTER COLUMN "accion" TYPE "historial_accion_tipo"
  USING ("accion"::text::"historial_accion_tipo");

DROP TYPE "historial_accion_tipo_old";
