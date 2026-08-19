-- DOWN (feature 239, familia `anclaje_devolucion`): Postgres NO soporta
-- `ALTER TYPE ... DROP VALUE`, asi que el tipo se RECREA sin el valor nuevo. Patron IDENTICO a
-- `20260731120000_orden_historial_origen_asignacion_recoleccion/down.sql`.
--
-- IRREVERSIBILIDAD PARCIAL: el `ADD VALUE` del up no se deshace con un DROP VALUE nativo; la
-- unica forma de "quitar" el valor es recrear el enum con la lista previa. Este down es SEGURO
-- solo si ninguna fila lo usa (ver precondicion).
--
-- Precondicion: NINGUNA fila de "orden_historial_estado" con origen_tipo = 'anclaje_devolucion'.
-- Si quedara alguna, el USING del ALTER COLUMN falla RUIDOSAMENTE al no poder castear ese valor
-- al tipo recreado y el rollback aborta: comportamiento CORRECTO — borrar el rastro de que una
-- devolucion fue confirmada en bodega no es seguro (es el ancla del reloj de SLA y de lo que la
-- tienda ve); primero se borran/reasignan esas filas.
--
-- INDICES: la UNICA columna que usa este enum es "orden_historial_estado"."origen_tipo", y sobre
-- ella hay UN indice, `orden_historial_actor_origen_created_idx`
-- (actor_usuario_id, origen_tipo, created_at), creado por la feature 167. NO hay que rehacerlo a
-- mano y NO hay ningun indice PARCIAL cuyo predicado mencione el enum: `ALTER COLUMN ... TYPE`
-- reconstruye por si solo los indices que dependen de la columna (reparsea la expresion original
-- contra el tipo nuevo). Verificado sobre `db/migrations/*/migration.sql`: los tres indices de
-- `orden_historial_estado` son btree plenos, ninguno lleva `WHERE`.
--
-- ROLLBACK ENCADENADO (condicion conocida, se documenta y no se "arregla"): los `down.sql` de
-- migraciones ANTERIORES de este mismo enum NO se tocan — son fotos historicas. Varios de ellos
-- recrean el tipo con LISTA CERRADA (p. ej. el de `asignacion_recoleccion`, 157, con 25 valores),
-- asi que aplicarlos DESPUES de esta migracion deja el enum sin `anclaje_devolucion` aunque este
-- down no se haya corrido. Es el comportamiento esperado de una cadena de rollbacks: cada down
-- devuelve la base al estado de SU momento.
--
-- La lista de abajo es el enum ANTES de esta migracion: los 26 valores vigentes, sin
-- `anclaje_devolucion`.
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
  'deshacer_asignacion',
  'asignacion_recoleccion'
);
ALTER TABLE "orden_historial_estado"
  ALTER COLUMN "origen_tipo" TYPE "orden_historial_origen_tipo"
  USING ("origen_tipo"::text::"orden_historial_origen_tipo");
DROP TYPE "orden_historial_origen_tipo_old";
