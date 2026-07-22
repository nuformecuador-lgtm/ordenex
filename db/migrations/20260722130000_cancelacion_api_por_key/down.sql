-- DOWN (T4): Postgres NO soporta `ALTER TYPE ... DROP VALUE`, asi que el tipo se RECREA sin
-- `cancelacion_api`. Patron identico a
-- 20260721130000_orden_historial_origen_tipo_resolver_novedad/down.sql y
-- 20260717120000_orden_historial_origen_tipo_carga_api/down.sql (recrear el enum).
--
-- IRREVERSIBILIDAD PARCIAL: el `ADD VALUE` del up no se puede deshacer con un DROP VALUE
-- nativo; la unica forma de "quitar" el valor es recrear el enum con la lista previa. Este
-- down es SEGURO solo si ninguna fila lo usa (ver precondicion).
--
-- Precondicion: NINGUNA fila de "orden_historial_estado" con origen_tipo = 'cancelacion_api'.
-- Si quedara alguna, el USING del ALTER COLUMN falla RUIDOSAMENTE al no poder castear ese
-- valor al tipo recreado y el rollback aborta: comportamiento CORRECTO — revertir borrando
-- rastro de auditoria de cancelaciones ya ejecutadas no es seguro; primero se borran/reasignan
-- esas filas de historial.
--
-- La UNICA columna que usa este enum es "orden_historial_estado"."origen_tipo" (su unico
-- consumidor). La lista de valores debe coincidir con el enum ANTES de esta migracion: los 17
-- valores previos (49 + deshacer_gestion 67 + carga_api 88 + los 2 de la 99 + los 2 de la 100),
-- sin `cancelacion_api`.
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
  'recuperacion_manual'
);
ALTER TABLE "orden_historial_estado"
  ALTER COLUMN "origen_tipo" TYPE "orden_historial_origen_tipo"
  USING ("origen_tipo"::text::"orden_historial_origen_tipo");
DROP TYPE "orden_historial_origen_tipo_old";
