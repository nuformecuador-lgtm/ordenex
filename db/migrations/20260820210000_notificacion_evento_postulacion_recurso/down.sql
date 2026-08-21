-- DOWN (feature 253, D6) — Postgres NO soporta `ALTER TYPE ... DROP VALUE`, asi que los DOS tipos
-- se RECREAN sin el valor nuevo. Patron IDENTICO al down de la 240
-- (`20260820190000_orden_historial_origen_rechazo_tienda`), que a su vez copia el de la 237, la
-- 239, la 235 y la 157.
--
-- ⚠️ LO QUE HAY QUE MIRAR ANTES DE ANADIR UN VALOR A UN ENUM EN ESTE REPO, y aqui esta mirado:
-- el `down.sql` de la migracion que CREO estos dos enums —`20260727120000_notificacion`, feature
-- 146— NO los recrea con lista; solo hace `DROP TYPE IF EXISTS`, porque alli tambien se van las
-- tablas que los usan. Es decir: los valores que esta migracion anade NO cambian nada de lo que
-- aquel down debe hacer, y aquel down NO se toca (es una foto historica). El unico down que tiene
-- que conocer la lista es ESTE.
--
-- IRREVERSIBILIDAD PARCIAL: el `ADD VALUE` del up no se deshace con un DROP VALUE nativo; la unica
-- forma de "quitar" un valor es recrear el enum con la lista previa. Este down es SEGURO solo si
-- ninguna fila lo usa (ver precondicion).
--
-- Precondicion: NINGUNA fila de "notificacion" con `evento = 'postulacion_recurso_pendiente'` ni
-- con `entidad_tipo = 'postulacion_recurso'`. Si quedara alguna, el USING del ALTER COLUMN falla
-- RUIDOSAMENTE al no poder castear ese valor al tipo recreado y el rollback ABORTA: comportamiento
-- CORRECTO. Esas filas son avisos que un administrador puede no haber leido todavia; borrarlas en
-- silencio apagaria la unica senal de que alguien ofrecio un vehiculo o una bodega. Primero se
-- borran a mano y a sabiendas.
--
-- INDICES — verificado sobre `20260727120000_notificacion/migration.sql`. Las UNICAS columnas del
-- arbol que usan estos dos enums son `notificacion.evento` y `notificacion.entidad_tipo`. Los
-- indices que las mencionan son:
--   - notificacion_entidad_idx   ("entidad_tipo", "entidad_id")            — btree pleno
--   - notificacion_dedupe_key    UNIQUE ("evento", "entidad_id", "destinatario_rol",
--                                "destinatario_usuario_id") NULLS NOT DISTINCT
--                                WHERE "entidad_id" IS NOT NULL           — parcial
-- En los dos, la columna del enum entra como COLUMNA del indice y NO en un predicado comparado
-- contra un literal del tipo viejo, que es el unico caso que `ALTER COLUMN ... TYPE` no sabe
-- reconstruir solo. Por eso ninguno se rehace a mano aqui. Que el `NULLS NOT DISTINCT` y el
-- `WHERE` parcial SOBREVIVAN a la reconstruccion no se supone: lo mide
-- `tests/integration/db/notificacion-evento-postulacion-recurso-migration.test.ts` contra Postgres
-- de verdad.
--
-- ROLLBACK ENCADENADO (condicion conocida, se documenta y no se "arregla"): el down de la 146
-- suelta los tipos enteros junto con sus tablas, asi que aplicarlo DESPUES de este deja la base
-- sin notificaciones en absoluto. Es el comportamiento esperado de una cadena de rollbacks: cada
-- down devuelve la base al estado de SU momento.
--
-- Las listas de abajo son los enums ANTES de esta migracion: los 4 valores de la 146 en cada uno.
ALTER TYPE "notificacion_evento" RENAME TO "notificacion_evento_old";
CREATE TYPE "notificacion_evento" AS ENUM (
  'orden_rechazada',
  'carga_masiva_terminada',
  'postulacion_mensajero_pendiente',
  'cierre_dia_por_aprobar'
);
ALTER TABLE "notificacion"
  ALTER COLUMN "evento" TYPE "notificacion_evento"
  USING ("evento"::text::"notificacion_evento");
DROP TYPE "notificacion_evento_old";

ALTER TYPE "notificacion_entidad_tipo" RENAME TO "notificacion_entidad_tipo_old";
CREATE TYPE "notificacion_entidad_tipo" AS ENUM ('orden', 'usuario', 'cierre_dia', 'carga');
ALTER TABLE "notificacion"
  ALTER COLUMN "entidad_tipo" TYPE "notificacion_entidad_tipo"
  USING ("entidad_tipo"::text::"notificacion_entidad_tipo");
DROP TYPE "notificacion_entidad_tipo_old";
