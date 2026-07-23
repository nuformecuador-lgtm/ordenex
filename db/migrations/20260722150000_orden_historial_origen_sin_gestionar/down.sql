-- DOWN (T0.4, R3): Postgres NO soporta `ALTER TYPE ... DROP VALUE`, asi que el tipo se RECREA
-- sin `corte_sin_gestionar` ni `liberacion_sin_gestionar`. Patron IDENTICO a
-- `20260722130000_cancelacion_api_por_key/down.sql` (recrear el enum con la lista previa).
--
-- IRREVERSIBILIDAD PARCIAL: el `ADD VALUE` del up no se puede deshacer con un DROP VALUE nativo;
-- la unica forma de "quitar" los valores es recrear el enum con la lista previa. Este down es
-- SEGURO solo si ninguna fila los usa (ver precondicion).
--
-- Precondicion: NINGUNA fila de "orden_historial_estado" con origen_tipo IN
-- ('corte_sin_gestionar','liberacion_sin_gestionar'). Si quedara alguna, el USING del ALTER
-- COLUMN falla RUIDOSAMENTE al no poder castear ese valor al tipo recreado y el rollback aborta:
-- comportamiento CORRECTO — revertir borrando rastro de auditoria de cortes/liberaciones ya
-- ejecutados no es seguro; primero se borran/reasignan esas filas de historial.
--
-- La UNICA columna que usa este enum es "orden_historial_estado"."origen_tipo" (su unico
-- consumidor). La lista de valores debe coincidir con el enum ANTES de esta migracion: los 18
-- valores previos (49 + deshacer_gestion 67 + carga_api 88 + los 2 de la 99 + los 2 de la 100 +
-- cancelacion_api 106), sin los 2 de la 109.
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
  'cancelacion_api'
);
ALTER TABLE "orden_historial_estado"
  ALTER COLUMN "origen_tipo" TYPE "orden_historial_origen_tipo"
  USING ("origen_tipo"::text::"orden_historial_origen_tipo");
DROP TYPE "orden_historial_origen_tipo_old";
