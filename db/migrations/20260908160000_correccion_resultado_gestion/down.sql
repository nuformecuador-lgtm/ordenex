-- DOWN (ficha 398) — revierte EXACTAMENTE `migration.sql`: los DOS enums pierden el valor que
-- aquella migracion les añadio.
--
-- POR QUE ES UN `CREATE TYPE` Y NO UN `DROP VALUE`: Postgres NO soporta `ALTER TYPE … DROP VALUE`.
-- La unica via es RECREAR el tipo con la lista PREVIA y recastear la columna que lo usa. Patron
-- IDENTICO al de `20260908140100_wallet_tienda_check_cobro_manual/down.sql` (que revierte dos
-- enums a la vez) y al de `20260824120000_orden_historial_origen_rechazo_tope_intentos/down.sql`.
--
-- SE COMPROBO CUAL ES LA FORMA DEL `down` DE CADA ENUM TOCADO, no se supuso: los dos RECREAN-CON-
-- LISTA en todos sus downs previos. Los unicos que los dropean entero son los que tambien los
-- crean entero (`20260713120000_orden_historial_estado` y `20260902120000_historial_accion`).
--
-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- ⚠️ AVISO, Y NO ES TEORICO: ESTAS DOS LISTAS SON UNA FOTO DEL 2026-09-08.
-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- Un `down.sql` de enum recrea el tipo con la lista COMPLETA, asi que ejecutarlo sobre una base
-- que ya avanzo BORRA EN SILENCIO, SIN UN SOLO ERROR, los valores que se añadieron despues de
-- escribirse este archivo. MEDIDO EN ESTE REPO EL 2026-09-07: el `down.sql` de una rama ramificada
-- antes del merge de la 376 se llevo por delante `zona_central_cambiada` de la base local; el
-- sintoma fueron 7 tests rojos en 6 archivos ajenos, y ni un mensaje de Postgres.
--
-- ANTES DE CORRER ESTE ARCHIVO, MIDE LOS DOS CATALOGOS DE HOY:
--     SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
--      WHERE t.typname = 'orden_historial_origen_tipo' ORDER BY e.enumsortorder;
--     SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
--      WHERE t.typname = 'historial_accion_tipo' ORDER BY e.enumsortorder;
-- Si la primera devuelve algo que NO sea «los 33 de abajo mas `correccion_resultado_gestion`», o
-- la segunda algo que NO sea «los 51 de abajo mas `cierre_dia_gestion_corregida`», este `down.sql`
-- esta RANCIO y borrara lo que falte.
-- `tests/integration/db/correccion-resultado-gestion-migration.test.ts` no se fia de estas frases:
-- reconstruye el estado previo ejecutando las migraciones REALES anteriores —DESCUBIERTAS leyendo
-- `db/migrations`, no escritas a mano— y COMPARA valor a valor y en orden.
--
-- DE DONDE SALEN LAS LISTAS, sin lugar a duda:
--   · LOS 33 de `orden_historial_origen_tipo` = los 32 del `CREATE TYPE` de
--     `20260824120000_orden_historial_origen_rechazo_tope_intentos/down.sql` MAS
--     `'rechazo_tope_intentos'`, que es justamente el valor que AQUELLA migracion añadio y que su
--     propio `down` no podia listar. `ADD VALUE` sin `BEFORE`/`AFTER` APENDE, asi que ese es el
--     `enumsortorder` de una base migrada EN ORDEN DE CARPETA.
--   · LOS 51 de `historial_accion_tipo` = los 50 del `CREATE TYPE` de
--     `20260908140100_wallet_tienda_check_cobro_manual/down.sql` MAS `'cobro_tienda_registrado'`,
--     que es el valor que AQUELLA añadio. MEDIDO ademas contra la base local el 2026-09-08: 51
--     valores, en este mismo orden, con la consulta de arriba.
--
-- ⚠️ UNA DISCREPANCIA MEDIDA, Y SE DICE EN VOZ ALTA (2026-09-08). En la base LOCAL de desarrollo
-- de esta maquina, `orden_historial_origen_tipo` trae `rechazo_tope_intentos` ANTES que
-- `habilitacion_api` — al reves que la lista de abajo. No es un error de la lista: es que aqui
-- `20260824120000_…_rechazo_tope_intentos` se aplico el 2026-08-24 y `20260823120000_…_habilitacion_api`
-- el 2026-08-25 (medido en `_prisma_migrations.finished_at`), o sea FUERA del orden de carpeta. Una
-- base migrada en orden —produccion, o una base nueva— tiene el orden de abajo, que es ademas el
-- que declaran `db/schema.prisma` y `ORDEN_HISTORIAL_ORIGEN_TIPO_SEED`, y el que el `down.sql` de
-- la 276 dejo escrito. Correr este `down` sobre esta base local no PIERDE ningun valor: reordena
-- esos dos. Se documenta para que nadie lo lea como una lista rancia.
--
-- NINGUN `down.sql` ANTERIOR SE TOCA: son fotos historicas de lo que habia cuando se escribieron.
--
-- INDICES — RE-MEDIDO el 2026-09-08 contra la base (`pg_attribute` + `pg_indexes`), no citado:
--   · `historial_accion_tipo` lo usa EXACTAMENTE una columna: `historial_accion.accion`.
--   · `orden_historial_origen_tipo` lo usa EXACTAMENTE una: `orden_historial_estado.origen_tipo`.
-- Los cuatro indices de `orden_historial_estado` y los cuatro de `historial_accion` son btree
-- PLENOS, sin `WHERE`; solo `orden_historial_actor_origen_created_idx` menciona `origen_tipo`, y
-- como COLUMNA, no en un predicado. Por eso el `ALTER COLUMN … TYPE` los reconstruye SOLO y no hay
-- que rehacer ninguno a mano. El caso problematico —un indice PARCIAL cuyo `WHERE` compare contra
-- un literal del tipo viejo— no existe hoy.
--
-- ⚠️ PRECONDICIONES RUIDOSAS, una por enum:
--   · CERO filas de "orden_historial_estado" con `origen_tipo = 'correccion_resultado_gestion'`.
--   · CERO filas de "historial_accion" con `accion = 'cierre_dia_gestion_corregida'`.
-- Si quedara alguna, el `USING` del `ALTER COLUMN` falla RUIDOSAMENTE al no poder castear ese valor
-- al tipo recreado y el rollback ABORTA. Eso es lo CORRECTO: esas dos filas son lo unico que dice
-- QUIEN convirtio una entrega cobrada en un rechazo que no cobra y que ademas le paga 0.00 al
-- mensajero. Primero se decide que hacer con ellas, a mano y a sabiendas.

-- (1) `orden_historial_origen_tipo` vuelve a sus 33 valores previos.
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
  'rechazo_tienda',
  -- añadido por la ficha 266 (`20260823120000`), que lleva timestamp ANTERIOR a la 276 y por tanto
  -- se aplica ANTES en una base migrada en orden. Ver la discrepancia medida del aviso de arriba.
  'habilitacion_api',
  -- añadido por la ficha 276 (`20260824120000`). ES EL ULTIMO DE LA FOTO DEL 2026-09-08: si entre
  -- esa fecha y el dia en que se corra este `down` alguna ficha ampliara el enum, su valor NO esta
  -- en esta lista y se perderia en silencio. Ver el aviso de arriba.
  'rechazo_tope_intentos'
);

ALTER TABLE "orden_historial_estado"
  ALTER COLUMN "origen_tipo" TYPE "orden_historial_origen_tipo"
  USING ("origen_tipo"::text::"orden_historial_origen_tipo");

DROP TYPE "orden_historial_origen_tipo_old";

-- (2) `historial_accion_tipo` vuelve a sus 51 valores previos.
ALTER TYPE "historial_accion_tipo" RENAME TO "historial_accion_tipo_old";
CREATE TYPE "historial_accion_tipo" AS ENUM (
  -- mueve dinero (25)
  'cierre_dia_aprobado',
  'cierre_dia_rechazado',
  'cierre_dia_pagos_editados',
  'cierre_bodega_aprobado',
  'cierre_bodega_rechazado',
  'pago_mensajero_registrado',
  'pago_tienda_registrado',
  'pago_anulado',
  'reparto_mensajero_registrado',
  'reparto_anulado',
  'wallet_movimiento_manual_registrado',
  'egreso_administrativo_registrado',
  'egreso_administrativo_reversado',
  'tarifa_creada',
  'tarifa_actualizada',
  'incidente_aprobado',
  'incidente_rechazado',
  'cobro_gasto_fijo_aprobado',
  'cobro_gasto_fijo_rechazado',
  'cobro_rechazo_tienda_aprobado',
  'cobro_rechazo_tienda_rechazado',
  'premio_ranking_registrado',
  'premio_ranking_anulado',
  'orden_ubicacion_corregida',
  'usuario_fulfillment_cambiado',
  -- hace desaparecer algo (6)
  'orden_eliminada',
  'orden_recuperada',
  'tarifa_borrada',
  'zona_borrada',
  'vehiculo_borrado',
  'plantilla_eliminada',
  -- cambia quien puede hacer que (11)
  'usuario_creado',
  'usuario_rol_cambiado',
  'usuario_zona_cambiada',
  'usuario_estado_cambiado',
  'usuario_contrasena_restablecida',
  'postulacion_aprobada',
  'postulacion_rechazada',
  'api_key_generada',
  'api_key_rotada',
  'api_key_activada',
  'api_key_desactivada',
  -- añadido por la ficha 366, DESPUES del bloque de la 362 (asi lo apende `ADD VALUE`)
  'orden_zona_reconciliada',
  -- añadido por la ficha 371, despues del anterior
  'gestion_fecha_reprogramacion_corregida',
  -- añadido por la ficha 373, despues del anterior
  'api_key_eliminada',
  -- añadidos por la ficha 374, despues del anterior
  'nodo_geografico_desactivado',
  'nodo_geografico_activado',
  -- añadido por la ficha 375, despues de los anteriores
  'nodo_geografico_renombrado',
  -- añadido por la ficha 376, despues del anterior
  'zona_central_cambiada',
  -- añadido por la ficha 380, despues del anterior
  'zona_pago_mensajero_cambiado',
  -- añadido por la ficha 381, unas horas antes que esta. ES EL ULTIMO DE LA FOTO DEL 2026-09-08:
  -- si entre esa fecha y el dia en que se corra este `down` alguna ficha ampliara el enum, su valor
  -- NO esta en esta lista y se perderia en silencio. Ver el aviso de arriba.
  'cobro_tienda_registrado'
);

ALTER TABLE "historial_accion"
  ALTER COLUMN "accion" TYPE "historial_accion_tipo"
  USING ("accion"::text::"historial_accion_tipo");

DROP TYPE "historial_accion_tipo_old";
