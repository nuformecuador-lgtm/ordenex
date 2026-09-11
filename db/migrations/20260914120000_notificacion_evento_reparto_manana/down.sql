-- DOWN (ficha 413, T2.3) -- Postgres NO soporta `ALTER TYPE ... DROP VALUE`, asi que los DOS
-- tipos se RECREAN sin los valores nuevos. Patron LITERAL del down de la 412
-- (`20260913120000_notificacion_evento_cierre_rechazado`), que a su vez copia el de la 409, la
-- 401, la 403, la 333, la 262, la 253, la 240, la 237, la 239, la 235 y la 157.
--
-- ⚠️⚠️ ESTE DOWN RETIPA **TRES** COLUMNAS, NO DOS. Hasta la 409 inclusive, `notificacion_evento`
-- lo usaba UNA sola columna (`notificacion.evento`). LA 410 ANADIO LA SEGUNDA:
-- `push_envio_dia.evento` (el cupo diario del canal de push), y su modelo lo deja escrito en
-- `db/schema.prisma` como una OBLIGACION para toda migracion posterior:
--
--   «A PARTIR DE AQUI, el `down.sql` de cualquier migracion POSTERIOR a la 410 que amplie
--    `notificacion_evento` tiene que retipar **las dos**.»
--
-- Recrear un enum obliga a reconstruir TODAS las columnas que lo usan ANTES del `DROP TYPE ...
-- _old`; si queda una, el `DROP TYPE` falla con `2BP01` («otros objetos dependen de el») y el
-- rollback ABORTA -- ruidosamente, que es el modo de fallo correcto.
--
-- (a) LA LISTA DE COLUMNAS NO SE SUPONE, SE ENUMERA. Consulta corrida contra la base local el
-- 2026-09-11, en solo lectura, ANTES de escribir esto:
--
--   SELECT c.table_name, c.column_name, c.udt_name
--     FROM information_schema.columns c
--    WHERE c.table_schema = 'public'
--      AND c.udt_name IN ('notificacion_evento','notificacion_entidad_tipo')
--    ORDER BY 3, 1, 2;
--
--   notificacion     | entidad_tipo | notificacion_entidad_tipo
--   notificacion     | evento       | notificacion_evento
--   push_envio_dia   | evento       | notificacion_evento      <-- LA QUE SE OLVIDA
--   TOTAL: 3
--
-- `push_envio_dia.evento` entra ademas en el indice unico `push_envio_dia_cupo`
-- (`usuario_id, evento, dia_cr`), que ES la regla «un push al dia por tipo»: el `ALTER COLUMN` lo
-- destruye y lo rehace, y que sobreviva NO SE SUPONE -- lo mide
-- `tests/integration/db/notificacion-evento-reparto-manana-migration.test.ts` contra Postgres.
--
-- ---------------------------------------------------------------------------------------------
-- (b) LA PREGUNTA OBLIGATORIA DE ESTE REPO AL ANADIR UN VALOR A UN ENUM -- el `down.sql` de las
-- migraciones ANTERIORES de estos enums, ¿recrea-con-lista o solo dropea? -- HECHA Y RESPONDIDA
-- sobre los **NUEVE** downs que existen hoy para estos dos tipos (eran ocho hasta que la 412
-- entro en `dev`). **NO SE TOCA NINGUNO**: cada uno es una FOTO de su momento y todas siguen
-- siendo ciertas. Editarlos seria la leccion de «migracion editada en sitio = drift»: lo anadido
-- despues no llega NUNCA a la base donde aquella ya corrio.
--
--   · `20260727120000_notificacion/down.sql` (146, la que CREO los dos enums): SOLO DROPEA -alli
--     se van tambien las tablas que los usan-. NO recrea con lista.            => NO SE TOCA.
--   · `20260820210000_notificacion_evento_postulacion_recurso/down.sql` (253): recrea los DOS,
--     con CUATRO eventos y CUATRO entidades.                                   => NO SE TOCA.
--   · `20260822140000_notificacion_evento_dia_reparto_corregido/down.sql` (262): recrea los DOS,
--     con CINCO y CINCO.                                                       => NO SE TOCA.
--   · `20260823120000_notificacion_evento_bloqueo_cierre/down.sql` (271): recrea SOLO
--     `notificacion_evento` con SEIS, y no toca el otro porque su up tampoco.  => NO SE TOCA.
--   · `20260829130000_notificacion_evento_gasto_fijo_cobro/down.sql` (333): recrea los DOS, con
--     OCHO eventos y SEIS entidades.                                           => NO SE TOCA.
--   · `20260909130000_notificacion_evento_webhook_suscripcion/down.sql` (403): recrea los DOS, con
--     NUEVE eventos y SIETE entidades.                                         => NO SE TOCA.
--   · `20260910120000_notificacion_evento_geocodificacion_caida/down.sql` (401): recrea los DOS,
--     con DIEZ eventos y OCHO entidades.                                       => NO SE TOCA.
--   · `20260911120000_notificacion_evento_avisos_agregados/down.sql` (409): recrea los DOS, con
--     ONCE eventos y NUEVE entidades.                                          => NO SE TOCA.
--   · `20260913120000_notificacion_evento_cierre_rechazado/down.sql` (412): recrea los DOS, con
--     TRECE eventos y ONCE entidades, y es el PRIMERO que retipa `push_envio_dia`.
--                                                                              => NO SE TOCA.
--
-- ⚠️ Y NO, EL DE LA 412 NO «LE FALTA» UN VALOR. Recrea con TRECE eventos porque esa es la foto de
-- `dev` justo ANTES de que ella anadiera el catorceavo (`cierre_dia_rechazado`). Es correcta.
--
-- De los nueve, SOLO el de la 412 retipa `push_envio_dia`, y eso tambien es correcto:
-- `db:rollback` va de la ultima migracion hacia atras, y esa tabla se crea en la 410
-- (20260912120000), DESPUES de las ocho primeras, asi que cuando les toca el turno ya no existe.
-- Las que SI la tienen delante son la 412 y ESTA, cuyos timestamps son posteriores al de la 410.
--
-- ---------------------------------------------------------------------------------------------
-- (c) LAS DOS LISTAS DE ABAJO SON LAS DE HOY, escritas LEYENDO `db/schema.prisma` de `origin/dev`,
-- NUNCA de memoria.
--
--   `origin/dev` @ 01d280ae10d20ac168af995bf64501fdb59c1100 (2026-09-11, al arrancar la ficha)
--   -> **CATORCE eventos y DOCE entidades**, con `cierre_dia_rechazado` / `cierre_dia_rechazo` de
--   la 412 YA DENTRO. Es lo que hay en `dev` justo ANTES de esta migracion, y es exactamente lo
--   que se recrea.
--
--   ⚠️ EL SPEC DE ESTA FICHA DECIA «13 eventos y 11 entidades» (design §10.2): era la foto del
--   2026-09-10, ANTES de que la 412 se mergeara. Se re-leyo contra el arbol y se corrigio aqui,
--   que es exactamente el motivo por el que T2.3 obliga a leerlo y no a recordarlo.
--
--   RE-COMPROBADO JUSTO ANTES DE ABRIR EL PR: ver la nota al pie de este archivo. El pre-vuelo
--   CADUCA -otra sesion empuja en paralelo-, y por eso se lee dos veces y no una.
--
-- REGLA, para quien venga detras: si otra ficha anade un valor a estos enums y entra en `dev`
-- ANTES que esta, hay que VOLVER A REESCRIBIR estas dos listas contra el arbol al mergear.
-- Revertir con una lista vieja BORRARIA EN SILENCIO el valor de la otra ficha -- le paso a la 401
-- con la 403 y esta escrito en su `down.sql`.
--
-- ⚠️ JAMAS RENUMERAR UNA CARPETA YA APLICADA: deja una fila fantasma que `migrate status` no ve.
-- El timestamp de esta carpeta (20260914120000) es posterior a toda migracion ya aplicada,
-- incluidas las dos de la 410 (20260912120000 y 20260912120100) y la de la 412 (20260913120000);
-- si chocara, se crea una carpeta con timestamp NUEVO.
--
-- IRREVERSIBILIDAD PARCIAL: el `ADD VALUE` del up no se deshace con un `DROP VALUE` nativo;
-- recrear el enum con la lista previa es la unica forma. Este down es SEGURO solo si ninguna fila
-- usa los valores nuevos (ver precondicion).
--
-- ⚠️ PRECONDICION RUIDOSA: NINGUNA fila de "notificacion" con `evento = 'reparto_manana'` ni con
-- `entidad_tipo = 'reparto_manana_dia'`, y NINGUNA de "push_envio_dia" con
-- `evento = 'reparto_manana'`. Si quedara alguna, el `USING` del `ALTER COLUMN` falla RUIDOSAMENTE
-- al no poder castear ese valor al tipo recreado y el rollback ABORTA. Es el comportamiento
-- CORRECTO y es deliberado: son avisos de trabajo pendiente que su destinatario puede no haber
-- leido todavia -- y este, ademas, le dice cuantos paquetes lleva mañana.
-- AQUI NO HAY NI UN `DELETE` NI UN `UPDATE` PARA HACER SITIO.
--
-- INDICES -- las columnas que usan estos dos enums estan en TRES indices:
-- `notificacion_entidad_idx` y `notificacion_dedupe_key` (sobre `notificacion`) y
-- `push_envio_dia_cupo` (sobre `push_envio_dia`). Los tres las llevan como COLUMNA, no en un
-- predicado comparado contra un literal del tipo viejo -- el unico caso que
-- `ALTER COLUMN ... TYPE` no sabe reconstruir solo. Que el `NULLS NOT DISTINCT` y el `WHERE`
-- parcial de `notificacion_dedupe_key` SOBREVIVAN a la reconstruccion NO SE SUPONE: lo mide
-- `tests/integration/db/notificacion-evento-reparto-manana-migration.test.ts` contra Postgres de
-- verdad, igual que lo midieron la 253, la 262, la 271, la 333, la 403, la 401, la 409 y la 412.
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
  'geocodificacion_caida',
  'novedades_sin_gestionar',
  'devoluciones_represadas',
  'cierre_dia_rechazado'
);
ALTER TABLE "notificacion"
  ALTER COLUMN "evento" TYPE "notificacion_evento"
  USING ("evento"::text::"notificacion_evento");
ALTER TABLE "push_envio_dia"
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
  'geocodificacion_caida_dia',
  'novedades_sin_gestionar_dia',
  'devoluciones_represadas_dia',
  'cierre_dia_rechazo'
);
ALTER TABLE "notificacion"
  ALTER COLUMN "entidad_tipo" TYPE "notificacion_entidad_tipo"
  USING ("entidad_tipo"::text::"notificacion_entidad_tipo");
DROP TYPE "notificacion_entidad_tipo_old";
