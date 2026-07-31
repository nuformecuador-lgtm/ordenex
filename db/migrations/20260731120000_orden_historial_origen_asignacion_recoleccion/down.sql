-- DOWN (feature 157, estado `recolectando`): Postgres NO soporta `ALTER TYPE ... DROP VALUE`,
-- asi que el tipo se RECREA sin `asignacion_recoleccion`. Patron IDENTICO a
-- `20260729140000_orden_historial_origen_deshacer_asignacion/down.sql`.
--
-- IRREVERSIBILIDAD PARCIAL: el `ADD VALUE` del up no se puede deshacer con un DROP VALUE
-- nativo; la unica forma de "quitar" el valor es recrear el enum con la lista previa. Este
-- down es SEGURO solo si ninguna fila lo usa (ver precondicion).
--
-- Precondicion: NINGUNA fila de "orden_historial_estado" con origen_tipo =
-- 'asignacion_recoleccion'. Si quedara alguna, el USING del ALTER COLUMN falla RUIDOSAMENTE al
-- no poder castear ese valor al tipo recreado y el rollback aborta: comportamiento CORRECTO —
-- borrar el rastro de auditoria de asignaciones ya ejecutadas no es seguro; primero se
-- borran/reasignan esas filas.
--
-- La UNICA columna que usa este enum es "orden_historial_estado"."origen_tipo". La lista de
-- abajo debe coincidir con el enum ANTES de esta migracion: los 25 valores vigentes (los 24 de
-- la 149 mas `deshacer_asignacion`), sin `asignacion_recoleccion`.
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
  'liberacion_sin_gestionar',
  'recepcion_bodega_central',
  'devolucion_rechazada',
  'recoleccion_tienda',
  'incidente',
  'deshacer_asignacion'
);
ALTER TABLE "orden_historial_estado"
  ALTER COLUMN "origen_tipo" TYPE "orden_historial_origen_tipo"
  USING ("origen_tipo"::text::"orden_historial_origen_tipo");
DROP TYPE "orden_historial_origen_tipo_old";
