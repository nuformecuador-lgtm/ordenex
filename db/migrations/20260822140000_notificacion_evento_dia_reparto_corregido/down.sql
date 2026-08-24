-- DOWN (feature 262, D7) — Postgres NO soporta `ALTER TYPE ... DROP VALUE`, asi que los DOS tipos
-- se RECREAN sin el valor nuevo. Patron IDENTICO al down de la 253
-- (`20260820210000_notificacion_evento_postulacion_recurso`), que a su vez copia el de la 240, la
-- 237, la 239, la 235 y la 157.
--
-- ⚠️ LA PREGUNTA OBLIGATORIA DE ESTE REPO AL ANADIR UN VALOR A UN ENUM —«¿el down de la migracion
-- que CREO el enum recrea-con-lista o solo dropea?»— HECHA Y RESPONDIDA, sobre los DOS downs que
-- existen para estos tipos:
--
--   · `20260727120000_notificacion/down.sql` (feature 146, la que CREO los enums): SOLO DROPEA
--     (`DROP TYPE IF EXISTS ...`), porque alli se van tambien las tablas que los usan. NO recrea con
--     lista. => NO SE TOCA: es una foto historica y el valor que anadimos no cambia nada de lo que
--     aquel down debe hacer.
--   · `20260820210000_notificacion_evento_postulacion_recurso/down.sql` (feature 253): RECREA CON
--     LISTA, y su lista son los CUATRO de la 146 — o sea «el enum ANTES de la 253», que sigue
--     siendo cierto. => NO SE TOCA. Renumerar o editar una migracion ya aplicada es la leccion de
--     «migracion editada en sitio = drift»: lo anadido despues no llega nunca a esa base.
--
-- ESTE es el unico down que tiene que conocer la lista de HOY, y por eso lista CINCO valores en
-- cada tipo: los cuatro de la 146 MAS el que anadio la 253.
--
-- IRREVERSIBILIDAD PARCIAL: el `ADD VALUE` del up no se deshace con un DROP VALUE nativo; recrear
-- el enum con la lista previa es la unica forma. Este down es SEGURO solo si ninguna fila usa el
-- valor nuevo (ver precondicion).
--
-- PRECONDICION RUIDOSA (R54): NINGUNA fila de "notificacion" con `evento = 'dia_reparto_corregido'`
-- ni con `entidad_tipo = 'orden_dia_reparto_cambio'`. Si quedara alguna, el `USING` del
-- `ALTER COLUMN` falla RUIDOSAMENTE al no poder castear ese valor al tipo recreado y el rollback
-- ABORTA. Es el comportamiento CORRECTO y es deliberado: esas filas son avisos que un mensajero
-- puede no haber leido todavia, y borrarlas en silencio apagaria la unica senal de que a uno de sus
-- paquetes le cambiaron el dia. Primero se borran a mano y a sabiendas. AQUI NO HAY NI UN `DELETE`
-- NI UN `UPDATE` PARA «HACER SITIO».
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
-- reconstruir solo. Por eso ninguno se rehace a mano aqui. Que el `NULLS NOT DISTINCT` y el `WHERE`
-- parcial SOBREVIVAN a la reconstruccion NO SE SUPONE: lo mide
-- `tests/integration/db/notificacion-evento-dia-reparto-corregido-migration.test.ts` contra
-- Postgres de verdad, igual que lo midio la 253.
--
-- ROLLBACK ENCADENADO (condicion conocida, se documenta y no se «arregla»): el down de la 146
-- suelta los tipos enteros junto con sus tablas, asi que aplicarlo DESPUES de este deja la base sin
-- notificaciones en absoluto. Es el comportamiento esperado de una cadena de rollbacks: cada down
-- devuelve la base al estado de SU momento.
--
-- Las listas de abajo son los enums ANTES de esta migracion: los 4 de la 146 + el 1 de la 253.
ALTER TYPE "notificacion_evento" RENAME TO "notificacion_evento_old";
CREATE TYPE "notificacion_evento" AS ENUM (
  'orden_rechazada',
  'carga_masiva_terminada',
  'postulacion_mensajero_pendiente',
  'cierre_dia_por_aprobar',
  'postulacion_recurso_pendiente'
);
ALTER TABLE "notificacion"
  ALTER COLUMN "evento" TYPE "notificacion_evento"
  USING ("evento"::text::"notificacion_evento");
DROP TYPE "notificacion_evento_old";

ALTER TYPE "notificacion_entidad_tipo" RENAME TO "notificacion_entidad_tipo_old";
CREATE TYPE "notificacion_entidad_tipo" AS ENUM (
  'orden',
  'usuario',
  'cierre_dia',
  'carga',
  'postulacion_recurso'
);
ALTER TABLE "notificacion"
  ALTER COLUMN "entidad_tipo" TYPE "notificacion_entidad_tipo"
  USING ("entidad_tipo"::text::"notificacion_entidad_tipo");
DROP TYPE "notificacion_entidad_tipo_old";
