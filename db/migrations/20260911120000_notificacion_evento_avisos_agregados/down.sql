-- DOWN (ficha 409, T2.3) -- Postgres NO soporta `ALTER TYPE ... DROP VALUE`, asi que los DOS
-- tipos se RECREAN sin los valores nuevos. Patron LITERAL del down de la 401
-- (`20260910120000_notificacion_evento_geocodificacion_caida`), que a su vez copia el de la 403, la
-- 333, la 262, la 253, la 240, la 237, la 239, la 235 y la 157.
--
-- ⚠️ LA PREGUNTA OBLIGATORIA DE ESTE REPO AL ANADIR UN VALOR A UN ENUM -- «¿el `down.sql` de las
-- migraciones ANTERIORES de estos enums recrea-con-lista o solo dropea?» -- HECHA Y RESPONDIDA
-- sobre los SIETE downs que existen hoy para estos dos tipos. NO SE TOCA NINGUNO: cada uno es una
-- FOTO de su momento y todas siguen siendo ciertas. Editarlos seria la leccion de «migracion
-- editada en sitio = drift»: lo anadido despues no llega NUNCA a la base donde aquella ya corrio.
--
--   · `20260727120000_notificacion/down.sql` (146, la que CREO los dos enums): SOLO DROPEA -alli
--     se van tambien las tablas que los usan-. NO recrea con lista.            => NO SE TOCA.
--   · `20260820210000_notificacion_evento_postulacion_recurso/down.sql` (253): recrea los DOS con
--     los CUATRO de la 146 -- «los enums ANTES de la 253» --, cierto.          => NO SE TOCA.
--   · `20260822140000_notificacion_evento_dia_reparto_corregido/down.sql` (262): recrea los DOS con
--     CINCO -- «los enums ANTES de la 262» --, cierto.                         => NO SE TOCA.
--   · `20260823120000_notificacion_evento_bloqueo_cierre/down.sql` (271): recrea SOLO
--     `notificacion_evento` con SEIS, y no toca el otro porque su up tampoco.  => NO SE TOCA.
--   · `20260829130000_notificacion_evento_gasto_fijo_cobro/down.sql` (333): recrea los DOS, con
--     OCHO eventos y SEIS entidades -- «los enums ANTES de la 333» --, cierto. => NO SE TOCA.
--   · `20260909130000_notificacion_evento_webhook_suscripcion/down.sql` (403): recrea los DOS, con
--     NUEVE eventos y SIETE entidades -- «antes de la 403» --, cierto.         => NO SE TOCA.
--   · `20260910120000_notificacion_evento_geocodificacion_caida/down.sql` (401): recrea los DOS,
--     con DIEZ eventos y OCHO entidades -- «antes de la 401» --, cierto.       => NO SE TOCA.
--
-- ⚠️ LA MITAD HERMANA, y es la que este `down.sql` -y solo este- tiene que conocer: LA LISTA DE
-- ABAJO ES LA DE HOY, escrita LEYENDO `db/schema.prisma` de `origin/dev`, NUNCA de memoria.
--
--   `origin/dev` @ aff769d888a0c893e48be6bd7c3144a97ec87c20 (2026-09-10) -> ONCE eventos y NUEVE
--   entidades, con los dos de la 403 y los dos de la 401 ya dentro. Es lo que hay en `dev` justo
--   ANTES de esta migracion, y es exactamente lo que se recrea.
--
--   RE-COMPROBADO el 2026-09-10, mas tarde el mismo dia: `dev` SE HABIA MOVIDO a
--   `2d790a13e691409e4ba2eaaaea65d4f333de8b7e`, y por eso se volvio a leer -el pre-vuelo caduca-.
--   Los DOS enums siguen EXACTAMENTE igual alli (once eventos, nueve entidades, mismos nombres y
--   mismo orden), asi que estas dos listas siguen siendo correctas y NO se tocan. La comprobacion
--   se repite igual justo antes de abrir el PR.
--
-- REGLA, para quien venga detras: si otra ficha anade un valor a estos enums y entra en `dev`
-- ANTES que esta, hay que VOLVER A REESCRIBIR estas dos listas contra el arbol al mergear.
-- Revertir con una lista vieja BORRARIA EN SILENCIO el valor de la otra ficha -- le paso a la 401
-- con la 403 y esta escrito en su `down.sql`.
--
-- ⚠️ JAMAS RENUMERAR UNA CARPETA YA APLICADA: deja una fila fantasma que `migrate status` no ve.
-- El timestamp de esta carpeta (20260911120000) es posterior a toda migracion de enum ya aplicada
-- --incluida la de la 401, 20260910120000--; si chocara, se crea una carpeta con timestamp NUEVO.
--
-- IRREVERSIBILIDAD PARCIAL: el `ADD VALUE` del up no se deshace con un `DROP VALUE` nativo;
-- recrear el enum con la lista previa es la unica forma. Este down es SEGURO solo si ninguna fila
-- usa los valores nuevos (ver precondicion).
--
-- ⚠️ PRECONDICION RUIDOSA: NINGUNA fila de "notificacion" con `evento` en
-- ('novedades_sin_gestionar','devoluciones_represadas') ni con `entidad_tipo` en
-- ('novedades_sin_gestionar_dia','devoluciones_represadas_dia'). Si quedara alguna, el `USING` del
-- `ALTER COLUMN` falla RUIDOSAMENTE al no poder castear ese valor al tipo recreado y el rollback
-- ABORTA. Es el comportamiento CORRECTO y es deliberado: son avisos de trabajo pendiente que su
-- destinatario puede no haber leido todavia. Primero se borran a mano y a sabiendas.
-- AQUI NO HAY NI UN `DELETE` NI UN `UPDATE` PARA «HACER SITIO».
--
-- INDICES -- verificado sobre `20260727120000_notificacion/migration.sql`. Las UNICAS columnas del
-- arbol que usan estos dos enums son `notificacion.evento` y `notificacion.entidad_tipo`, y los
-- dos indices que las mencionan (`notificacion_entidad_idx` y `notificacion_dedupe_key`) las
-- llevan como COLUMNA, no en un predicado comparado contra un literal del tipo viejo -- el unico
-- caso que `ALTER COLUMN ... TYPE` no sabe reconstruir solo. Que el `NULLS NOT DISTINCT` y el
-- `WHERE` parcial SOBREVIVAN a la reconstruccion NO SE SUPONE: lo mide
-- `tests/integration/db/notificacion-evento-avisos-agregados-migration.test.ts` contra Postgres de
-- verdad, igual que lo midieron la 253, la 262, la 271, la 333, la 403 y la 401.
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
  'webhook_suscripcion_pausada',
  'geocodificacion_caida'
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
  'webhook_suscripcion_pausa',
  'geocodificacion_caida_dia'
);
ALTER TABLE "notificacion"
  ALTER COLUMN "entidad_tipo" TYPE "notificacion_entidad_tipo"
  USING ("entidad_tipo"::text::"notificacion_entidad_tipo");
DROP TYPE "notificacion_entidad_tipo_old";
