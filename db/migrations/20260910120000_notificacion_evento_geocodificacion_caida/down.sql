-- DOWN (ficha 401, T5) -- Postgres NO soporta `ALTER TYPE ... DROP VALUE`, asi que los DOS tipos
-- se RECREAN sin el valor nuevo. Patron LITERAL del down de la 333
-- (`20260829130000_notificacion_evento_gasto_fijo_cobro`), que a su vez copia el de la 262, la 253,
-- la 240, la 237, la 239, la 235 y la 157.
--
-- ⚠️ LA PREGUNTA OBLIGATORIA DE ESTE REPO AL ANADIR UN VALOR A UN ENUM -- "¿el down de la
-- migracion que CREO el enum recrea-con-lista o solo dropea?" -- HECHA Y RESPONDIDA, sobre los
-- CINCO downs que existen hoy para estos dos tipos:
--
--   · `20260727120000_notificacion/down.sql` (feature 146, la que CREO los dos enums): SOLO
--     DROPEA, porque alli se van tambien las tablas que los usan. NO recrea con lista.
--     => NO SE TOCA.
--   · `20260820210000_notificacion_evento_postulacion_recurso/down.sql` (253): recrea los DOS
--     tipos con los CUATRO de la 146 -- "los enums ANTES de la 253" --, que sigue siendo cierto.
--     => NO SE TOCA.
--   · `20260822140000_notificacion_evento_dia_reparto_corregido/down.sql` (262): recrea los DOS
--     con CINCO -- "los enums ANTES de la 262" --, que sigue siendo cierto. => NO SE TOCA.
--   · `20260823120000_notificacion_evento_bloqueo_cierre/down.sql` (271): recrea SOLO
--     `notificacion_evento` con SEIS, y no toca el otro porque su up tampoco lo toco. => NO SE TOCA.
--   · `20260829130000_notificacion_evento_gasto_fijo_cobro/down.sql` (333): recrea los DOS, con
--     OCHO eventos y SEIS entidades -- "los enums ANTES de la 333" --, que sigue siendo cierto.
--     => NO SE TOCA.
--   · `20260909130000_notificacion_evento_webhook_suscripcion/down.sql` (403, mergeada el
--     2026-09-10 en el PR #767): recrea los DOS, con NUEVE eventos y SIETE entidades -- "los enums
--     ANTES de la 403" --, que sigue siendo cierto. => NO SE TOCA.
--
-- Cada uno es una FOTO de su momento y todas siguen siendo ciertas. Editarlos seria la leccion de
-- "migracion editada en sitio = drift": lo anadido despues no llega NUNCA a la base donde aquella
-- ya corrio. Y la memoria hermana ("el `down.sql` borra los valores posteriores") es justo lo que
-- obliga a que ESTE down, y solo este, conozca la lista de HOY.
--
-- ⚠️ LA LISTA DE ABAJO SE REESCRIBIO CONTRA `db/schema.prisma` DE `origin/dev` **DESPUES DE QUE LA
-- 403 ENTRARA**, que es la regla de orden de design §3.3 ejecutada, no recordada.
--
-- Historia, porque explica por que esto se revisa dos veces y no una:
--   · Version del 2026-09-09: `origin/dev` @ 7a23c0f3 tenia NUEVE eventos y SIETE entidades, y la
--     403 -- que anade sus propios dos valores a estos MISMOS dos enums -- todavia NO estaba
--     mergeada. La lista era correcta ENTONCES.
--   · La 403 se mergeo el 2026-09-10 (PR #767, merge `9aba74cc`) y esa foto **quedo vieja**:
--     revertir esta migracion con la lista anterior habria BORRADO EN SILENCIO
--     `webhook_suscripcion_pausada` y `webhook_suscripcion_pausa`. Ese es exactamente el modo de
--     fallo que este repo ya sufrio.
--   · Version vigente: `origin/dev` @ 9aba74cc -- DIEZ eventos y OCHO entidades, con los dos de la
--     403 incluidos. Es lo que hay en `dev` justo ANTES de esta migracion, y es lo que se recrea.
--
-- REGLA, para quien venga detras: si otra ficha anade un valor a estos enums y entra en `dev`
-- ANTES que esta, hay que volver a reescribir estas dos listas. Se decide leyendo el arbol al
-- mergear, nunca de memoria.
--
-- El timestamp de esta carpeta (20260910120000) es posterior a toda migracion de enum ya aplicada
-- --incluidas las dos de la 403, 202609091200/1300--; si chocara, se crea una carpeta con timestamp
-- NUEVO y JAMAS se renumera una ya aplicada (deja una fila fantasma que `migrate status` no ve).
--
-- IRREVERSIBILIDAD PARCIAL: el `ADD VALUE` del up no se deshace con un `DROP VALUE` nativo;
-- recrear el enum con la lista previa es la unica forma. Este down es SEGURO solo si ninguna fila
-- usa los valores nuevos (ver precondicion).
--
-- ⚠️ PRECONDICION RUIDOSA: NINGUNA fila de "notificacion" con `evento = 'geocodificacion_caida'`
-- ni con `entidad_tipo = 'geocodificacion_caida_dia'`. Si quedara alguna, el `USING` del
-- `ALTER COLUMN` falla RUIDOSAMENTE al no poder castear ese valor al tipo recreado y el rollback
-- ABORTA. Es el comportamiento CORRECTO y es deliberado: son avisos de que el servicio de mapas
-- esta caido por configuracion NUESTRA, que ni el maestro ni los admins tienen por que haber leido
-- todavia -- el silencio de 19 horas del 2026-09-08 es exactamente lo que esta ficha existe para
-- romper. Primero se borran a mano y a sabiendas. AQUI NO HAY NI UN `DELETE` NI UN `UPDATE` PARA
-- "HACER SITIO".
--
-- INDICES -- verificado sobre `20260727120000_notificacion/migration.sql`. Las UNICAS columnas del
-- arbol que usan estos dos enums son `notificacion.evento` y `notificacion.entidad_tipo`, y los
-- dos indices que las mencionan (`notificacion_entidad_idx` y `notificacion_dedupe_key`) las llevan
-- como COLUMNA, no en un predicado comparado contra un literal del tipo viejo -- el unico caso que
-- `ALTER COLUMN ... TYPE` no sabe reconstruir solo. Que el `NULLS NOT DISTINCT` y el `WHERE`
-- parcial SOBREVIVAN a la reconstruccion NO SE SUPONE: lo mide
-- `tests/integration/db/notificacion-evento-geocodificacion-caida-migration.test.ts` contra
-- Postgres de verdad, igual que lo midieron la 253, la 262, la 271 y la 333.
--
-- Las listas de abajo son los enums ANTES de esta migracion.
ALTER TYPE "notificacion_evento" RENAME TO "notificacion_evento_old";
CREATE TYPE "notificacion_evento" AS ENUM (
  'orden_rechazada',
  'carga_masiva_terminada',
  'postulacion_mensajero_pendiente',
  'cierre_dia_por_aprobar',
  'postulacion_recurso_pendiente',
  'dia_reparto_corregido',
  'cierre_dia_vencido',
  'mensajero_bloqueado_por_cierres',
  'gasto_fijo_cobro_pendiente',
  'webhook_suscripcion_pausada'
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
  'postulacion_recurso',
  'orden_dia_reparto_cambio',
  'gasto_fijo_cobro_dia',
  'webhook_suscripcion_pausa'
);
ALTER TABLE "notificacion"
  ALTER COLUMN "entidad_tipo" TYPE "notificacion_entidad_tipo"
  USING ("entidad_tipo"::text::"notificacion_entidad_tipo");
DROP TYPE "notificacion_entidad_tipo_old";
