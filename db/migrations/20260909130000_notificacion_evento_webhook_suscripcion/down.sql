-- DOWN (ficha 403, T2) -- Postgres NO soporta `ALTER TYPE ... DROP VALUE`, asi que los DOS tipos
-- se RECREAN sin el valor nuevo. Patron LITERAL del down de la 333
-- (`20260829130000_notificacion_evento_gasto_fijo_cobro`), que a su vez copia el de la 262, la
-- 253, la 240, la 237, la 239, la 235 y la 157.
--
-- ⚠️ LA PREGUNTA OBLIGATORIA DE ESTE REPO AL ANADIR UN VALOR A UN ENUM -- "¿el down de la
-- migracion que CREO el enum recrea-con-lista o solo dropea?" -- HECHA Y RESPONDIDA, sobre los
-- CINCO downs que existen hoy para estos dos tipos. Ninguno se toca: son FOTOS HISTORICAS del
-- estado de su propio momento, y editarlas seria drift (lo anadido despues no llega nunca a la
-- base donde aquella migracion ya corrio).
--
--   · `20260727120000_notificacion/down.sql` (feature 146, la que CREO los dos enums): SOLO
--     DROPEA (`DROP TYPE IF EXISTS "notificacion_entidad_tipo"` / `..."notificacion_evento"`),
--     porque alli se van tambien las tablas que los usan. NO recrea con lista. => NO SE TOCA.
--   · `20260820210000_notificacion_evento_postulacion_recurso/down.sql` (253): RECREA CON LISTA
--     los DOS tipos, con los CUATRO de la 146 en cada uno -- "los enums ANTES de la 253" --, que
--     sigue siendo cierto. => NO SE TOCA.
--   · `20260822140000_notificacion_evento_dia_reparto_corregido/down.sql` (262): RECREA CON LISTA
--     los DOS tipos, con CINCO valores en cada uno -- "los enums ANTES de la 262" --. => NO SE
--     TOCA.
--   · `20260823120000_notificacion_evento_bloqueo_cierre/down.sql` (271): RECREA CON LISTA SOLO
--     `notificacion_evento`, con SEIS valores, y NO toca `notificacion_entidad_tipo` porque su up
--     tampoco lo toco. => NO SE TOCA.
--   · `20260829130000_notificacion_evento_gasto_fijo_cobro/down.sql` (333): RECREA CON LISTA los
--     DOS tipos, con OCHO valores en `notificacion_evento` y SEIS en `notificacion_entidad_tipo`
--     -- "los enums ANTES de la 333" --, que sigue siendo cierto. => NO SE TOCA.
--
-- ⚠️ Y LA CONSECUENCIA QUE ESO TIENE, ESCRITA PARA QUIEN VENGA DETRAS: un down que recrea-con-
-- lista es una foto de SU rama. Aplicado sobre una base que ya avanzo, BORRA EN SILENCIO los
-- valores posteriores. Por eso el unico down que conoce la lista de HOY es ESTE, y por eso lista
-- NUEVE valores en `notificacion_evento` (los 4 de la 146 + el de la 253 + el de la 262 + los DOS
-- de la 271 + el de la 333) y SIETE en `notificacion_entidad_tipo` (los 4 de la 146 + el de la
-- 253 + el de la 262 + el de la 333).
--
-- IRREVERSIBILIDAD PARCIAL: el `ADD VALUE` del up no se deshace con un `DROP VALUE` nativo;
-- recrear el enum con la lista previa es la unica forma. Este down es SEGURO solo si ninguna fila
-- usa los valores nuevos (ver precondicion).
--
-- ⚠️ PRECONDICION RUIDOSA: NINGUNA fila de "notificacion" con
-- `evento = 'webhook_suscripcion_pausada'` ni con `entidad_tipo = 'webhook_suscripcion_pausa'`.
-- Si quedara alguna, el `USING` del `ALTER COLUMN` falla RUIDOSAMENTE al no poder castear ese
-- valor al tipo recreado y el rollback ABORTA. Es el comportamiento CORRECTO y es deliberado:
-- esas filas son el UNICO aviso de que un integrador lleva sin recibir eventos, que es
-- exactamente el silencio de cinco dias que esta ficha existe para romper. Borrarlas en silencio
-- reproduciria la enfermedad. Primero se borran a mano y a sabiendas. AQUI NO HAY NI UN `DELETE`
-- NI UN `UPDATE` PARA "HACER SITIO".
--
-- INDICES -- verificado sobre `20260727120000_notificacion/migration.sql`. Las UNICAS columnas del
-- arbol que usan estos dos enums son `notificacion.evento` y `notificacion.entidad_tipo`. Los
-- indices que las mencionan son:
--   - notificacion_entidad_idx   ("entidad_tipo", "entidad_id")            -- btree pleno
--   - notificacion_dedupe_key    UNIQUE ("evento", "entidad_id", "destinatario_rol",
--                                "destinatario_usuario_id") NULLS NOT DISTINCT
--                                WHERE "entidad_id" IS NOT NULL           -- parcial
-- En los dos, la columna del enum entra como COLUMNA del indice y NO en un predicado comparado
-- contra un literal del tipo viejo, que es el unico caso que `ALTER COLUMN ... TYPE` no sabe
-- reconstruir solo. Por eso ninguno se rehace a mano aqui. Que el `NULLS NOT DISTINCT` y el
-- `WHERE` parcial SOBREVIVAN a la reconstruccion NO SE SUPONE: lo mide
-- `tests/integration/db/notificacion-evento-webhook-suscripcion-migration.test.ts` contra
-- Postgres de verdad, igual que lo midieron la 253, la 262, la 271 y la 333.
--
-- ROLLBACK ENCADENADO (condicion conocida, se documenta y no se "arregla"): el down de la 146
-- suelta los tipos enteros junto con sus tablas, asi que aplicarlo DESPUES de este deja la base
-- sin notificaciones en absoluto. Es el comportamiento esperado de una cadena de rollbacks: cada
-- down devuelve la base al estado de SU momento.
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
  'gasto_fijo_cobro_pendiente'
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
  'gasto_fijo_cobro_dia'
);
ALTER TABLE "notificacion"
  ALTER COLUMN "entidad_tipo" TYPE "notificacion_entidad_tipo"
  USING ("entidad_tipo"::text::"notificacion_entidad_tipo");
DROP TYPE "notificacion_entidad_tipo_old";
