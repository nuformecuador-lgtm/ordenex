-- FICHA 454 (design §1.6, T1.24 · M3) -- BACKFILL Y RETIRO de `ayuda_tienda` y
-- `devolucion_por_confirmar`. Patron 155: rastro + backfill + retiro CONDICIONAL del catalogo.
--
-- QUE HACE. Con la 454 la gestion del mensajero no mueve la orden (queda `en_reparto` hasta que se
-- aprueba su cierre) y la ayuda a la tienda es un HECHO (`orden_evento`), no un estado. Las ordenes
-- que el codigo viejo dejo en esos dos estados se llevan al modelo nuevo SIN PERDER NADA:
--   1. RASTRO: una fila de historial por orden (tambien las borradas logicamente, R38), del estado de
--      hoy a `en_reparto`, familia `ajuste_estado`, actor NULL (sistema) y motivo literal que
--      identifica la migracion (el DOWN la reconoce por el).
--   2. AYUDA: por cada orden de `ayuda_tienda`, un `ayuda_solicitada` con el actor (y su rol) de su
--      ULTIMA fila `solicitud_ayuda_tienda`, en el MISMO instante que el rastro: la derivacion de
--      «ayuda abierta» exige que no haya transicion ESTRICTAMENTE posterior (design §4.1), asi que la
--      ayuda queda abierta.
--   3. REGISTRO: por cada orden de `devolucion_por_confirmar`, el `gestion_registrada` de su gestion
--      `devuelta` vigente MAS RECIENTE (actor = su mensajero, familia `gestion`, instante = el de la
--      gestion): queda PENDIENTE de confirmar y la aprobacion de su cierre la anclara.
--   4. BACKFILL de `orden.estatus_id` a `en_reparto` (solo esa columna).
--   5. RETIRO CONDICIONAL de los dos valores del catalogo: solo si NADA los referencia (`orden`, las
--      dos columnas de `orden_historial_estado`, `cierre_sin_gestion` y `analytics_daily` — esta
--      ultima no estaba en el design §1.6 y tiene FK RESTRICT a `order_status`: sin ella el `DELETE`
--      abortaria la migracion). El rastro del paso 1 referencia el estado de origen, asi que en
--      cualquier base con poblacion el retiro es no-op (produccion incluida).
--
-- FALLA RUIDOSAMENTE (R38, «no inventes»): una orden de `ayuda_tienda` sin fila de solicitud con
-- actor, o una de `devolucion_por_confirmar` sin gestion `devuelta` vigente o con ella en un cierre
-- YA APROBADO (no podria quedar pendiente), hacen `RAISE EXCEPTION` y la migracion no se aplica.
--
-- IDEMPOTENTE: una segunda pasada no encuentra ordenes en los dos estados y no escribe nada.
-- SIN webhooks, notificaciones ni jobs (R42): SQL puro, no pasa por `appendCambioEstado`.
--
-- UN SOLO BLOQUE `DO`: todo o nada, y ejecutable como UNA sentencia desde el test de integracion
-- (`tests/integration/db/454/retiro-estados-migration.test.ts`), que lo corre dentro de una
-- transaccion revertida con up → down → up.
--
-- EL TIMESTAMP SE ESCRIBE A MANO (P3006 en la shadow db de este repo). JAMAS RENUMERAR.

DO $$
DECLARE
  v_en_reparto text;
  v_ayuda      text;
  v_dpc        text;
  -- UTC explicito: las columnas son `timestamp` SIN zona y Prisma escribe UTC; `CURRENT_TIMESTAMP`
  -- a secas se convertiria con la zona de la SESION (medido: en la base local no es UTC).
  v_ahora      timestamp(3) := (clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3);
  v_faltan     integer;
BEGIN
  SELECT "id" INTO v_en_reparto FROM "order_status" WHERE "value" = 'en_reparto';
  SELECT "id" INTO v_ayuda      FROM "order_status" WHERE "value" = 'ayuda_tienda';
  SELECT "id" INTO v_dpc        FROM "order_status" WHERE "value" = 'devolucion_por_confirmar';
  IF v_en_reparto IS NULL THEN
    RAISE EXCEPTION 'migracion 454: falta `en_reparto` en el catalogo';
  END IF;

  -- (e) PRECONDICIONES: antes de escribir nada.
  SELECT count(*) INTO v_faltan
    FROM "orden" "o"
   WHERE v_ayuda IS NOT NULL AND "o"."estatus_id" = v_ayuda
     AND NOT EXISTS (
       SELECT 1 FROM "orden_historial_estado" "h"
         JOIN "usuario" "u" ON "u"."id" = "h"."actor_usuario_id"
        WHERE "h"."orden_id" = "o"."id" AND "h"."origen_tipo" = 'solicitud_ayuda_tienda'
     );
  IF v_faltan > 0 THEN
    RAISE EXCEPTION 'migracion 454: % orden(es) en ayuda_tienda sin fila de solicitud con actor', v_faltan;
  END IF;

  SELECT count(*) INTO v_faltan
    FROM "orden" "o"
   WHERE v_dpc IS NOT NULL AND "o"."estatus_id" = v_dpc
     AND NOT EXISTS (
       SELECT 1 FROM (
         SELECT "g"."cierre_id"
           FROM "gestion_orden" "g"
          WHERE "g"."orden_id" = "o"."id" AND "g"."resultado" = 'devuelta' AND "g"."anulada_at" IS NULL
          ORDER BY "g"."created_at" DESC, "g"."id" DESC
          LIMIT 1
       ) "ult"
       LEFT JOIN "cierre_dia" "c" ON "c"."id" = "ult"."cierre_id"
       WHERE "ult"."cierre_id" IS NULL OR "c"."estado" <> 'aprobado'
     );
  IF v_faltan > 0 THEN
    RAISE EXCEPTION 'migracion 454: % orden(es) en devolucion_por_confirmar sin gestion devuelta vigente pendiente', v_faltan;
  END IF;

  -- 1) RASTRO.
  INSERT INTO "orden_historial_estado"
         ("id", "orden_id", "estatus_origen_id", "estatus_destino_id", "actor_usuario_id",
          "origen_tipo", "motivo", "gestion_orden_id", "created_at")
  SELECT gen_random_uuid()::text, "o"."id", "o"."estatus_id", v_en_reparto, NULL,
         'ajuste_estado',
         CASE WHEN "o"."estatus_id" = v_ayuda
              THEN 'migracion 454: retiro de ayuda_tienda'
              ELSE 'migracion 454: retiro de devolucion_por_confirmar' END,
         NULL, v_ahora
    FROM "orden" "o"
   WHERE "o"."estatus_id" IN (v_ayuda, v_dpc);

  -- 2) AYUDA: el hecho `ayuda_solicitada`, con el actor de la ULTIMA solicitud.
  INSERT INTO "orden_evento"
         ("id", "orden_id", "tipo", "mensajero_id", "actor_usuario_id", "actor_rol", "motivo", "created_at")
  SELECT gen_random_uuid()::text, "o"."id", 'ayuda_solicitada', "o"."mensajero_asignado_id",
         "sol"."actor_usuario_id", "r"."value",
         'migracion 454: ayuda pedida el ' || to_char("sol"."created_at", 'YYYY-MM-DD HH24:MI:SS'),
         v_ahora
    FROM "orden" "o"
    JOIN LATERAL (
      SELECT "h"."actor_usuario_id", "h"."created_at"
        FROM "orden_historial_estado" "h"
       WHERE "h"."orden_id" = "o"."id" AND "h"."origen_tipo" = 'solicitud_ayuda_tienda'
         AND "h"."actor_usuario_id" IS NOT NULL
       ORDER BY "h"."created_at" DESC, "h"."id" DESC
       LIMIT 1
    ) "sol" ON TRUE
    JOIN "usuario" "u" ON "u"."id" = "sol"."actor_usuario_id"
    JOIN "rol" "r" ON "r"."id" = "u"."rol_id"
   WHERE v_ayuda IS NOT NULL AND "o"."estatus_id" = v_ayuda;

  -- 3) REGISTRO: la `devuelta` vigente mas reciente queda PENDIENTE de confirmar.
  INSERT INTO "orden_evento"
         ("id", "orden_id", "tipo", "gestion_orden_id", "familia_aplicacion", "resultado",
          "mensajero_id", "actor_usuario_id", "actor_rol", "motivo", "created_at")
  SELECT gen_random_uuid()::text, "o"."id", 'gestion_registrada', "g"."id", 'gestion', 'devuelta',
         "g"."mensajero_id", "g"."mensajero_id", 'mensajero', "g"."causa_devolucion"::text, "g"."created_at"
    FROM "orden" "o"
    JOIN LATERAL (
      SELECT "gg"."id", "gg"."mensajero_id", "gg"."causa_devolucion", "gg"."created_at"
        FROM "gestion_orden" "gg"
       WHERE "gg"."orden_id" = "o"."id" AND "gg"."resultado" = 'devuelta' AND "gg"."anulada_at" IS NULL
       ORDER BY "gg"."created_at" DESC, "gg"."id" DESC
       LIMIT 1
    ) "g" ON TRUE
   WHERE v_dpc IS NOT NULL AND "o"."estatus_id" = v_dpc
     AND NOT EXISTS (
       SELECT 1 FROM "orden_evento" "e"
        WHERE "e"."gestion_orden_id" = "g"."id" AND "e"."tipo" = 'gestion_registrada'
     );

  -- 4) BACKFILL (solo `estatus_id`; `updated_at` es de la aplicacion y no se toca).
  UPDATE "orden" SET "estatus_id" = v_en_reparto WHERE "estatus_id" IN (v_ayuda, v_dpc);

  -- 5) RETIRO CONDICIONAL del catalogo.
  DELETE FROM "order_status" "s"
   WHERE "s"."value" IN ('ayuda_tienda', 'devolucion_por_confirmar')
     AND NOT EXISTS (SELECT 1 FROM "orden" "o" WHERE "o"."estatus_id" = "s"."id")
     AND NOT EXISTS (SELECT 1 FROM "orden_historial_estado" "h"
                      WHERE "h"."estatus_origen_id" = "s"."id" OR "h"."estatus_destino_id" = "s"."id")
     AND NOT EXISTS (SELECT 1 FROM "cierre_sin_gestion" "c" WHERE "c"."estatus_origen_id" = "s"."id")
     AND NOT EXISTS (SELECT 1 FROM "analytics_daily" "a" WHERE "a"."estatus_id" = "s"."id");
END
$$;
