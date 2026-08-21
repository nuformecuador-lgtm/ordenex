-- DOWN (feature 240, familia `rechazo_tienda`): Postgres NO soporta `ALTER TYPE ... DROP VALUE`,
-- asi que el tipo se RECREA sin el valor nuevo. Patron IDENTICO al down de la 237
-- (`20260820120000_orden_historial_origen_gestion_tienda_ayuda`), que a su vez copia el de la 235,
-- el de la 239 y el de la 157.
--
-- IRREVERSIBILIDAD PARCIAL: el `ADD VALUE` del up no se deshace con un DROP VALUE nativo; la unica
-- forma de "quitar" un valor es recrear el enum con la lista previa. Este down es SEGURO solo si
-- ninguna fila lo usa (ver precondicion).
--
-- Precondicion: NINGUNA fila de "orden_historial_estado" con origen_tipo = 'rechazo_tienda'.
-- Si quedara alguna, el USING del ALTER COLUMN falla RUIDOSAMENTE al no poder castear ese valor al
-- tipo recreado y el rollback ABORTA: comportamiento CORRECTO y exigido por R47. Esas filas son la
-- UNICA evidencia de QUIEN decidio un rechazo que se cobro —`actor_usuario_id` de la persona de la
-- tienda, enlazada a la gestion sintetica por `gestion_orden_id`— y ademas lo unico que distingue
-- «lo decidio la tienda» de «lo escalo el cron por plazo vencido», que es lo que separa la pestaña
-- de rechazos por plazo (102) de esta via. Borrar ese rastro en silencio dejaria un cobro sin
-- autor y un rechazo manual indistinguible de un vencimiento; primero se borran o reasignan esas
-- filas, a mano y a sabiendas.
--
-- INDICES — RE-VERIFICADO el 2026-08-20 sobre `db/migrations/*/migration.sql`, no citado de la 237.
-- La UNICA columna del arbol que usa este enum sigue siendo "orden_historial_estado"."origen_tipo"
-- (declarada en `20260713120000_orden_historial_estado`; ninguna otra migracion crea otra). Sobre
-- esa tabla hay TRES indices y los tres son btree PLENOS, sin `WHERE`:
--   - orden_historial_estado_orden_id_created_at_idx        (20260713120000)
--   - orden_historial_estado_orden_id_estatus_destino_id_idx (20260713120000)
--   - orden_historial_actor_origen_created_idx              (20260731140000, feature 167)
-- Solo el tercero menciona `origen_tipo`, y como columna del indice, no en un predicado. Por eso
-- `ALTER COLUMN ... TYPE` los reconstruye POR SI SOLO (reparsea la expresion original contra el
-- tipo nuevo) y NO hay que rehacer ninguno a mano. El caso problematico seria un indice PARCIAL
-- cuyo `WHERE` comparase `origen_tipo` con un literal del tipo viejo: no existe.
--
-- ROLLBACK ENCADENADO (condicion conocida, se documenta y no se "arregla"): los `down.sql` de
-- migraciones ANTERIORES de este mismo enum NO se tocan — son fotos historicas. Varios recrean el
-- tipo con LISTA CERRADA (el de `asignacion_recoleccion`, 157, con 25 valores; el de
-- `anclaje_devolucion`, 239, con 26; el de `ayuda_tienda`, 235, con 27; el de
-- `gestion_tienda_ayuda`, 237, con 29), asi que aplicarlos DESPUES de esta migracion deja el enum
-- sin los valores nuevos aunque este down no se haya corrido. Es el comportamiento esperado de una
-- cadena de rollbacks: cada down devuelve la base al estado de SU momento.
--
-- La lista de abajo es el enum ANTES de esta migracion: los 30 valores vigentes (los 29 previos a
-- la 237 mas `gestion_tienda_ayuda`), sin `rechazo_tienda`.
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
  'rescate_ayuda_tienda',
  'gestion_tienda_ayuda'
);
ALTER TABLE "orden_historial_estado"
  ALTER COLUMN "origen_tipo" TYPE "orden_historial_origen_tipo"
  USING ("origen_tipo"::text::"orden_historial_origen_tipo");
DROP TYPE "orden_historial_origen_tipo_old";
