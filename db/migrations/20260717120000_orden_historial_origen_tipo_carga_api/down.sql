-- DOWN [D7]: Postgres NO soporta `ALTER TYPE ... DROP VALUE`, asi que el tipo se RECREA
-- sin `carga_api`. Patron identico al de 20260716140000_rol_api_key/down.sql (recrear el
-- enum) y al de 20260710130000_rol_admin_satelite/down.sql.
--
-- Precondicion: ninguna fila de "orden_historial_estado" con origen_tipo='carga_api' (si
-- quedara alguna, el USING del ALTER COLUMN falla RUIDOSAMENTE al no poder castear ese
-- valor al tipo recreado, y el rollback aborta: comportamiento correcto — primero se
-- borran/reasignan esas filas de historial).
--
-- La UNICA columna que usa este enum es "orden_historial_estado"."origen_tipo" (verificado
-- contra el schema: es su unico consumidor). La lista de valores debe coincidir con el enum
-- ANTES de esta migracion (los 12 valores de la 49 + gestion_orden_anulacion, sin carga_api).
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
  'deshacer_gestion'
);
ALTER TABLE "orden_historial_estado"
  ALTER COLUMN "origen_tipo" TYPE "orden_historial_origen_tipo"
  USING ("origen_tipo"::text::"orden_historial_origen_tipo");
DROP TYPE "orden_historial_origen_tipo_old";
