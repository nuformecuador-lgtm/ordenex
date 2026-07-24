-- DOWN [D7]: Postgres NO soporta `ALTER TYPE ... DROP VALUE`, asi que el tipo se RECREA sin
-- `recepcion_bodega_central`. Patron identico a
-- 20260721130000_orden_historial_origen_tipo_resolver_novedad/down.sql y
-- 20260717120000_orden_historial_origen_tipo_carga_api/down.sql (recrear el enum).
--
-- Precondicion: NINGUNA fila de "orden_historial_estado" con
-- origen_tipo = 'recepcion_bodega_central'. Si quedara alguna, el USING del ALTER COLUMN falla
-- RUIDOSAMENTE al no poder castear ese valor al tipo recreado y el rollback aborta:
-- comportamiento CORRECTO — revertir borrando rastro de auditoria no es seguro; primero se
-- borran/reasignan esas filas de historial.
--
-- La UNICA columna que usa este enum es "orden_historial_estado"."origen_tipo" (su unico
-- consumidor). La lista de valores debe coincidir con el enum ANTES de esta migracion: los 20
-- valores vigentes (49 + carga_api 88 + los 2 de la 99 + los 2 de la 100 + cancelacion_api 106
-- + los 2 de la 109), sin `recepcion_bodega_central`.
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
  'escalado_devuelta_sla',
  'reprogramacion_tienda',
  'recuperacion_manual',
  'cancelacion_api',
  'corte_sin_gestionar',
  'liberacion_sin_gestionar'
);
ALTER TABLE "orden_historial_estado"
  ALTER COLUMN "origen_tipo" TYPE "orden_historial_origen_tipo"
  USING ("origen_tipo"::text::"orden_historial_origen_tipo");
DROP TYPE "orden_historial_origen_tipo_old";
