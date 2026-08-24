-- DOWN (feature 271, §3.2) — Postgres NO soporta `ALTER TYPE ... DROP VALUE`, asi que el tipo se
-- RECREA sin los valores nuevos. Patron IDENTICO al down de la 262
-- (`20260822140000_notificacion_evento_dia_reparto_corregido`), que a su vez copia el de la 253, la
-- 240, la 237, la 239, la 235 y la 157.
--
-- ⚠️ LA PREGUNTA OBLIGATORIA DE ESTE REPO AL ANADIR UN VALOR A UN ENUM —«¿el down de la migracion
-- que CREO el enum recrea-con-lista o solo dropea?»— HECHA Y RESPONDIDA, sobre los TRES downs que
-- existen hoy para `notificacion_evento`:
--
--   · `20260727120000_notificacion/down.sql` (feature 146, la que CREO el enum): SOLO DROPEA
--     (`DROP TYPE IF EXISTS ...`), porque alli se van tambien las tablas que lo usan. NO recrea con
--     lista. => NO SE TOCA: es una foto historica y los valores que anadimos no cambian nada de lo
--     que aquel down debe hacer.
--   · `20260820210000_notificacion_evento_postulacion_recurso/down.sql` (feature 253): RECREA CON
--     LISTA, y su lista son los CUATRO de la 146 —o sea «el enum ANTES de la 253»—, que sigue siendo
--     cierta. => NO SE TOCA.
--   · `20260822140000_notificacion_evento_dia_reparto_corregido/down.sql` (feature 262): RECREA CON
--     LISTA, y su lista son los CINCO anteriores a la 262 (los 4 de la 146 + el de la 253), que
--     sigue siendo cierta. => NO SE TOCA.
--
-- Renumerar o editar una migracion ya aplicada es la leccion de «migracion editada en sitio =
-- drift»: lo anadido despues no llega nunca a esa base.
--
-- ESTE es el unico down que tiene que conocer la lista de HOY, y por eso lista SEIS valores: los
-- CUATRO de la 146 + el de la 253 + el de la 262. Y NO TOCA `notificacion_entidad_tipo`, porque el
-- `up` tampoco lo toco.
--
-- IRREVERSIBILIDAD PARCIAL: el `ADD VALUE` del up no se deshace con un DROP VALUE nativo; recrear el
-- enum con la lista previa es la unica forma. Este down es SEGURO solo si ninguna fila usa los
-- valores nuevos (ver precondicion).
--
-- PRECONDICION RUIDOSA: NINGUNA fila de "notificacion" con `evento = 'cierre_dia_vencido'` ni con
-- `evento = 'mensajero_bloqueado_por_cierres'`. Si quedara alguna, el `USING` del `ALTER COLUMN`
-- falla RUIDOSAMENTE al no poder castear ese valor al tipo recreado y el rollback ABORTA. Es el
-- comportamiento CORRECTO y es deliberado: esas filas son avisos de BLOQUEO que un mensajero puede
-- no haber leido todavia, y borrarlas en silencio apagaria la unica senal de por que no puede
-- trabajar. Primero se borran a mano y a sabiendas. AQUI NO HAY NI UN `DELETE` NI UN `UPDATE` PARA
-- «HACER SITIO».
--
-- INDICES — verificado sobre `20260727120000_notificacion/migration.sql`. La UNICA columna del arbol
-- que usa este enum es `notificacion.evento`. Los indices que la mencionan son:
--   - notificacion_dedupe_key    UNIQUE ("evento", "entidad_id", "destinatario_rol",
--                                "destinatario_usuario_id") NULLS NOT DISTINCT
--                                WHERE "entidad_id" IS NOT NULL           — parcial
-- (`notificacion_entidad_idx` es sobre "entidad_tipo"/"entidad_id" y NO menciona `evento`.)
-- El enum entra como COLUMNA del indice y NO en un predicado comparado contra un literal del tipo
-- viejo, que es el unico caso que `ALTER COLUMN ... TYPE` no sabe reconstruir solo. Por eso no se
-- rehace a mano aqui. Que el `NULLS NOT DISTINCT` y el `WHERE` parcial SOBREVIVAN a la
-- reconstruccion NO SE SUPONE: lo mide
-- `tests/integration/db/notificacion-evento-bloqueo-cierre-migration.test.ts` contra Postgres de
-- verdad, igual que lo midieron la 253 y la 262.
--
-- ROLLBACK ENCADENADO (condicion conocida, se documenta y no se «arregla»): el down de la 146 suelta
-- el tipo entero junto con sus tablas, asi que aplicarlo DESPUES de este deja la base sin
-- notificaciones en absoluto. Es el comportamiento esperado de una cadena de rollbacks: cada down
-- devuelve la base al estado de SU momento.
--
-- La lista de abajo es el enum ANTES de esta migracion: los 4 de la 146 + el 1 de la 253 + el 1 de
-- la 262.
ALTER TYPE "notificacion_evento" RENAME TO "notificacion_evento_old";
CREATE TYPE "notificacion_evento" AS ENUM (
  'orden_rechazada',
  'carga_masiva_terminada',
  'postulacion_mensajero_pendiente',
  'cierre_dia_por_aprobar',
  'postulacion_recurso_pendiente',
  'dia_reparto_corregido'
);
ALTER TABLE "notificacion"
  ALTER COLUMN "evento" TYPE "notificacion_evento"
  USING ("evento"::text::"notificacion_evento");
DROP TYPE "notificacion_evento_old";
