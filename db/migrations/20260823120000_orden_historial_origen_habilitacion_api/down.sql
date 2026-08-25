-- DOWN (feature 266, familia `habilitacion_api`): Postgres NO soporta `ALTER TYPE ... DROP VALUE`,
-- asi que el tipo se RECREA sin el valor nuevo. Patron IDENTICO al down de la 240
-- (`20260820190000_orden_historial_origen_rechazo_tienda`), que a su vez copia el de la 237, el de
-- la 235, el de la 239 y el de la 157.
--
-- IRREVERSIBILIDAD PARCIAL: el `ADD VALUE` del up no se deshace con un DROP VALUE nativo; la unica
-- forma de "quitar" un valor es recrear el enum con la lista previa. Este down es SEGURO solo si
-- ninguna fila lo usa (ver precondicion).
--
-- Precondicion: NINGUNA fila de "orden_historial_estado" con origen_tipo = 'habilitacion_api'.
-- Si quedara alguna, el USING del ALTER COLUMN falla RUIDOSAMENTE al no poder castear ese valor al
-- tipo recreado y el rollback ABORTA: comportamiento CORRECTO y EXIGIDO por R30, no un defecto que
-- haya que suavizar con un `USING ... ELSE`. Esas filas son la UNICA evidencia de que una orden
-- volvio a `en_reparto` porque LO PIDIO EL INTEGRADOR por el canal por API key, y no porque el
-- mensajero pulsara «Recuperar» ni la tienda «Habilitar»: colapsarlas a otra familia dejaria las
-- tres vias indistinguibles, y `actor_usuario_id` no las separa (el usuario dedicado de la key ES
-- la tienda). Primero se borran o reasignan esas filas, a mano y a sabiendas.
--
-- INDICES — RE-VERIFICADO el 2026-08-23 sobre `db/migrations/*/migration.sql`, no citado de la 240.
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
-- `gestion_tienda_ayuda`, 237, con 29; el de `rechazo_tienda`, 240, con 30), asi que aplicarlos
-- DESPUES de esta migracion deja el enum sin los valores nuevos aunque este down no se haya
-- corrido. Es el comportamiento esperado de una cadena de rollbacks: cada down devuelve la base al
-- estado de SU momento.
--
-- La lista de abajo es el enum ANTES de esta migracion: los 31 valores vigentes (los 30 previos a
-- la 240 mas `rechazo_tienda`), sin `habilitacion_api`.
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
  'gestion_tienda_ayuda',
  'rechazo_tienda'
);
ALTER TABLE "orden_historial_estado"
  ALTER COLUMN "origen_tipo" TYPE "orden_historial_origen_tipo"
  USING ("origen_tipo"::text::"orden_historial_origen_tipo");
DROP TYPE "orden_historial_origen_tipo_old";
