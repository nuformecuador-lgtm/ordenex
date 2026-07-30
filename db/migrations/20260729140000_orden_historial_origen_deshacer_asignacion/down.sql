-- DOWN (feature 149, design §4): Postgres NO soporta `ALTER TYPE ... DROP VALUE`, asi que el
-- tipo se RECREA sin `deshacer_asignacion`. Patron IDENTICO a
-- `20260724150000_orden_historial_origen_devolucion_rechazada/down.sql`.
--
-- IRREVERSIBILIDAD PARCIAL: el `ADD VALUE` del up no se puede deshacer con un DROP VALUE
-- nativo; la unica forma de "quitar" el valor es recrear el enum con la lista previa. Este
-- down es SEGURO solo si ninguna fila lo usa (ver precondicion).
--
-- Precondicion: NINGUNA fila de "orden_historial_estado" con origen_tipo = 'deshacer_asignacion'.
-- Si quedara alguna, el USING del ALTER COLUMN falla RUIDOSAMENTE al no poder castear ese valor
-- al tipo recreado y el rollback aborta: comportamiento CORRECTO — borrar el rastro de auditoria
-- de reversiones ya ejecutadas no es seguro; primero se borran/reasignan esas filas.
--
-- La UNICA columna que usa este enum es "orden_historial_estado"."origen_tipo" (su unico
-- consumidor). La lista de valores debe coincidir con el enum ANTES de esta migracion: los 24
-- valores vigentes (49 + carga_api 88 + los 2 de la 99 + los 2 de la 100 + cancelacion_api 106 +
-- los 2 de la 109 + recepcion_bodega_central 138 + devolucion_rechazada 139 + los 2 de la 154),
-- sin `deshacer_asignacion`.
--
-- INTEGRACION CON `dev` (2026-07-29): la 154 aterrizo `recoleccion_tienda` e `incidente` en
-- `20260729130000_orden_historial_origen_recoleccion_tienda_incidente` mientras la 149 iba en su
-- rama. Esta migracion se RENUMERO de `20260728120000` a `20260729140000` para quedar DESPUES de
-- ella (asi el orden del enum es el mismo en una base nueva y en una ya migrada), y esos dos
-- valores se añadieron a la lista de abajo. Omitirlos haria que este rollback MUTILARA el enum
-- de la 154.
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
  'incidente'
);
ALTER TABLE "orden_historial_estado"
  ALTER COLUMN "origen_tipo" TYPE "orden_historial_origen_tipo"
  USING ("origen_tipo"::text::"orden_historial_origen_tipo");
DROP TYPE "orden_historial_origen_tipo_old";
