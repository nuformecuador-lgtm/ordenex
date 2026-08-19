-- DOWN (feature 235, familias `solicitud_ayuda_tienda` y `rescate_ayuda_tienda`): Postgres NO
-- soporta `ALTER TYPE ... DROP VALUE`, asi que el tipo se RECREA sin los valores nuevos. Patron
-- IDENTICO al down de la 239 (`20260819110000_orden_historial_origen_anclaje_devolucion`), que a
-- su vez copia el de la 157.
--
-- IRREVERSIBILIDAD PARCIAL: el `ADD VALUE` del up no se deshace con un DROP VALUE nativo; la unica
-- forma de "quitar" un valor es recrear el enum con la lista previa. Este down es SEGURO solo si
-- ninguna fila lo usa (ver precondicion).
--
-- Precondicion: NINGUNA fila de "orden_historial_estado" con origen_tipo = 'solicitud_ayuda_tienda'
-- ni 'rescate_ayuda_tienda'. Si quedara alguna, el USING del ALTER COLUMN falla RUIDOSAMENTE al no
-- poder castear ese valor al tipo recreado y el rollback ABORTA: comportamiento CORRECTO — borrar
-- el rastro de que un mensajero pidio auxilio en la calle no es seguro; primero se borran o
-- reasignan esas filas, a mano y a sabiendas.
--
-- INDICES — RE-VERIFICADO el 2026-08-19 sobre `db/migrations/*/migration.sql`, no citado de la
-- 239. La UNICA columna del arbol que usa este enum sigue siendo
-- "orden_historial_estado"."origen_tipo" (declarada en `20260713120000_orden_historial_estado`,
-- linea 36; ninguna otra migracion crea otra). Sobre esa tabla hay TRES indices y los tres son
-- btree PLENOS, sin `WHERE`:
--   - orden_historial_estado_orden_id_created_at_idx        (20260713120000)
--   - orden_historial_estado_orden_id_estatus_destino_id_idx(20260713120000)
--   - orden_historial_actor_origen_created_idx              (20260731140000, feature 167)
-- Solo el tercero menciona `origen_tipo`, y como columna del indice, no en un predicado. Por eso
-- `ALTER COLUMN ... TYPE` los reconstruye POR SI SOLO (reparsea la expresion original contra el
-- tipo nuevo) y NO hay que rehacer ninguno a mano. El caso problematico seria un indice PARCIAL
-- cuyo `WHERE` comparase `origen_tipo` con un literal del tipo viejo: no existe.
--
-- ROLLBACK ENCADENADO (condicion conocida, se documenta y no se "arregla"): los `down.sql` de
-- migraciones ANTERIORES de este mismo enum NO se tocan — son fotos historicas. Varios recrean el
-- tipo con LISTA CERRADA (el de `asignacion_recoleccion`, 157, con 25 valores; el de
-- `anclaje_devolucion`, 239, con 26), asi que aplicarlos DESPUES de esta migracion deja el enum
-- sin los dos valores nuevos aunque este down no se haya corrido. Es el comportamiento esperado de
-- una cadena de rollbacks: cada down devuelve la base al estado de SU momento.
--
-- La lista de abajo es el enum ANTES de esta migracion: los 27 valores vigentes, sin
-- `solicitud_ayuda_tienda` ni `rescate_ayuda_tienda`.
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
  'asignacion_recoleccion',
  'anclaje_devolucion'
);
ALTER TABLE "orden_historial_estado"
  ALTER COLUMN "origen_tipo" TYPE "orden_historial_origen_tipo"
  USING ("origen_tipo"::text::"orden_historial_origen_tipo");
DROP TYPE "orden_historial_origen_tipo_old";
