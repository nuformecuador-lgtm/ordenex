-- DOWN (feature 237, familia `gestion_tienda_ayuda`): Postgres NO soporta
-- `ALTER TYPE ... DROP VALUE`, asi que el tipo se RECREA sin el valor nuevo. Patron IDENTICO al
-- down de la 235 (`20260819150000_orden_historial_origen_ayuda_tienda`), que a su vez copia el de
-- la 239 y el de la 157.
--
-- IRREVERSIBILIDAD PARCIAL: el `ADD VALUE` del up no se deshace con un DROP VALUE nativo; la unica
-- forma de "quitar" un valor es recrear el enum con la lista previa. Este down es SEGURO solo si
-- ninguna fila lo usa (ver precondicion).
--
-- Precondicion: NINGUNA fila de "orden_historial_estado" con origen_tipo = 'gestion_tienda_ayuda'.
-- Si quedara alguna, el USING del ALTER COLUMN falla RUIDOSAMENTE al no poder castear ese valor al
-- tipo recreado y el rollback ABORTA: comportamiento CORRECTO — esas filas son la UNICA evidencia
-- de que fue LA TIENDA, y no el mensajero, quien decidio un rechazo que se le cobro a ella misma
-- (hasta ₡1.000 por rechazo, medido en produccion el 2026-08-20). Borrar ese rastro en silencio
-- dejaria la gestion atribuida al mensajero sin que nadie pudiera demostrar lo contrario; primero
-- se borran o reasignan esas filas, a mano y a sabiendas.
--
-- INDICES — RE-VERIFICADO el 2026-08-20 sobre `db/migrations/*/migration.sql`, no citado de la
-- 235. La UNICA columna del arbol que usa este enum sigue siendo
-- "orden_historial_estado"."origen_tipo" (declarada en `20260713120000_orden_historial_estado`;
-- ninguna otra migracion crea otra). Sobre esa tabla hay TRES indices y los tres son btree PLENOS,
-- sin `WHERE`:
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
-- `anclaje_devolucion`, 239, con 26; el de `ayuda_tienda`, 235, con 27), asi que aplicarlos DESPUES
-- de esta migracion deja el enum sin los valores nuevos aunque este down no se haya corrido. Es el
-- comportamiento esperado de una cadena de rollbacks: cada down devuelve la base al estado de SU
-- momento.
--
-- La lista de abajo es el enum ANTES de esta migracion: los 29 valores vigentes (los 27 previos a
-- la 235 mas `solicitud_ayuda_tienda` y `rescate_ayuda_tienda`), sin `gestion_tienda_ayuda`.
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
  'anclaje_devolucion',
  'solicitud_ayuda_tienda',
  'rescate_ayuda_tienda'
);
ALTER TABLE "orden_historial_estado"
  ALTER COLUMN "origen_tipo" TYPE "orden_historial_origen_tipo"
  USING ("origen_tipo"::text::"orden_historial_origen_tipo");
DROP TYPE "orden_historial_origen_tipo_old";
