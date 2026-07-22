-- DOWN (T0.2): Postgres NO soporta `ALTER TYPE ... DROP VALUE`, asi que el tipo se RECREA sin
-- `reprogramacion_tienda` ni `recuperacion_manual`. Patron identico a
-- 20260721120000_orden_historial_origen_tipo_sla_devuelta/down.sql y
-- 20260717120000_orden_historial_origen_tipo_carga_api/down.sql (recrear el enum).
--
-- Precondicion: NINGUNA fila de "orden_historial_estado" con
-- origen_tipo IN ('reprogramacion_tienda','recuperacion_manual'). Si quedara alguna, el USING del
-- ALTER COLUMN falla RUIDOSAMENTE al no poder castear ese valor al tipo recreado y el rollback
-- aborta: comportamiento CORRECTO — revertir borrando rastro de auditoria (y, en el caso de la
-- reprogramacion, el enlace a la gestion sintetica que sostiene el bloqueo/liberacion de la 46)
-- no es seguro; primero se borran/reasignan esas filas de historial.
--
-- La UNICA columna que usa este enum es "orden_historial_estado"."origen_tipo" (su unico
-- consumidor). La lista de valores debe coincidir con el enum ANTES de esta migracion: los 15
-- valores previos (49 + gestion_orden_anulacion 67 + carga_api 88 + los 2 de la 99), sin los dos
-- de la 100.
ALTER TYPE "orden_historial_origen_tipo" RENAME TO "orden_historial_origen_tipo_old";
CREATE TYPE "orden_historial_origen_tipo" AS ENUM (
  'carga_masiva',
  'creacion_manual',
  'generacion_guia',
  'asignacion_bodega',
  'ruteo_satelite',
  'recepcion_satelite',
  'asignacion_satelite',
  'recoleccion',
  'gestion',
  'liberacion_reprogramada',
  'ajuste_estado',
  'deshacer_gestion',
  'carga_api',
  'liberacion_devuelta_sla',
  'escalado_devuelta_sla'
);
ALTER TABLE "orden_historial_estado"
  ALTER COLUMN "origen_tipo" TYPE "orden_historial_origen_tipo"
  USING ("origen_tipo"::text::"orden_historial_origen_tipo");
DROP TYPE "orden_historial_origen_tipo_old";
