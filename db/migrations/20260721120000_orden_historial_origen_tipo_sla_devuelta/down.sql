-- DOWN (T0): Postgres NO soporta `ALTER TYPE ... DROP VALUE`, asi que el tipo se RECREA sin
-- `liberacion_devuelta_sla` ni `escalado_devuelta_sla`. Patron identico a
-- 20260717120000_orden_historial_origen_tipo_carga_api/down.sql y
-- 20260716140000_rol_api_key/down.sql (recrear el enum).
--
-- Precondicion: NINGUNA fila de "orden_historial_estado" con
-- origen_tipo IN ('liberacion_devuelta_sla','escalado_devuelta_sla'). Si quedara alguna, el
-- USING del ALTER COLUMN falla RUIDOSAMENTE al no poder castear ese valor al tipo recreado y el
-- rollback aborta: comportamiento CORRECTO — revertir borrando rastro de auditoria (y, en el
-- caso del escalado, el enlace a la gestion sintetica que cobro el ingreso de bodega) no es
-- seguro; primero se borran/reasignan esas filas de historial.
--
-- La UNICA columna que usa este enum es "orden_historial_estado"."origen_tipo" (su unico
-- consumidor). La lista de valores debe coincidir con el enum ANTES de esta migracion: los 13
-- valores previos (49 + gestion_orden_anulacion 67 + carga_api 88), sin los dos de la 99.
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
  'carga_api'
);
ALTER TABLE "orden_historial_estado"
  ALTER COLUMN "origen_tipo" TYPE "orden_historial_origen_tipo"
  USING ("origen_tipo"::text::"orden_historial_origen_tipo");
DROP TYPE "orden_historial_origen_tipo_old";
