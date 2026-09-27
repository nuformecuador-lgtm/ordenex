-- DOWN de M3 (ficha 454, design §1.6; R41): devuelve la base al modelo en el que la gestion MUEVE la
-- orden al registrarse y la ayuda es el estado `ayuda_tienda`. Va ANTES que el down de M2 (que suelta
-- `orden_evento`): este LEE esa tabla. `scripts/db-rollback.ts` revierte de la ultima hacia atras.
--
-- ORDEN (el del design, con UN cambio declarado: el catalogo se repone PRIMERO, porque el paso de
-- las pendientes necesita los ids de los dos valores):
--   1. Repone `ayuda_tienda` y `devolucion_por_confirmar` en el catalogo si faltan.
--   a. Borra los hechos que la PROPIA M3 escribio y que el modelo viejo no tiene: los
--      `ayuda_solicitada` con su motivo literal, y el `gestion_registrada` de las pendientes que ya
--      tienen su fila de historial enlazada (las `devuelta` que M3 saco de `devolucion_por_confirmar`:
--      el paso 2 las devuelve alli). Sin esto, un up → down → up chocaria con el unico parcial
--      `orden_evento_gestion_registrada_uq`.
--   0. Las gestiones PENDIENTES del modelo nuevo (evento de registro, sin fila de historial enlazada,
--      no anuladas, cierre sin aprobar) se APLICAN como las aplicaba el codigo viejo: la orden
--      `en_reparto` pasa al destino viejo de su resultado (`devuelta` -> `devolucion_por_confirmar`, el
--      resto identidad) con una fila de historial de la familia del evento, su actor y la gestion
--      enlazada. Y cada ayuda ABIERTA registrada por el codigo nuevo vuelve a `ayuda_tienda` con su
--      fila `solicitud_ayuda_tienda`. Sin esto el codigo viejo las veria gestionables y el corte las
--      barreria (R41).
--   2. Devuelve a su origen las ordenes que el rastro de M3 marco y a las que NO les paso nada
--      despues (ninguna otra fila de historial ni ningun hecho de `orden_evento` en o despues del
--      rastro, una vez borrados los de la propia M3).
--   3. Borra el rastro de M3 (por su motivo literal).
--
-- PERDIDA DECLARADA (design §1.6): los eventos de anulacion/correccion y las ayudas ya rescatadas no
-- tienen equivalente en el modelo viejo; desaparecen con el down de M2.
--
-- UN SOLO BLOQUE `DO`, como el up.

DO $$
DECLARE
  v_en_reparto text;
  v_ayuda      text;
  v_dpc        text;
  -- UTC explicito: las columnas son `timestamp` SIN zona y Prisma escribe UTC; `CURRENT_TIMESTAMP`
  -- a secas se convertiria con la zona de la SESION (medido: en la base local no es UTC).
  v_ahora      timestamp(3) := (clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3);
BEGIN
  -- 1) CATALOGO.
  INSERT INTO "order_status" ("id", "value")
  SELECT gen_random_uuid()::text, 'ayuda_tienda'
   WHERE NOT EXISTS (SELECT 1 FROM "order_status" WHERE "value" = 'ayuda_tienda');
  INSERT INTO "order_status" ("id", "value")
  SELECT gen_random_uuid()::text, 'devolucion_por_confirmar'
   WHERE NOT EXISTS (SELECT 1 FROM "order_status" WHERE "value" = 'devolucion_por_confirmar');

  SELECT "id" INTO v_en_reparto FROM "order_status" WHERE "value" = 'en_reparto';
  SELECT "id" INTO v_ayuda      FROM "order_status" WHERE "value" = 'ayuda_tienda';
  SELECT "id" INTO v_dpc        FROM "order_status" WHERE "value" = 'devolucion_por_confirmar';

  -- a) LOS HECHOS QUE ESCRIBIO M3.
  DELETE FROM "orden_evento"
   WHERE "tipo" = 'ayuda_solicitada' AND "motivo" LIKE 'migracion 454: ayuda pedida el %';
  DELETE FROM "orden_evento" "e"
   WHERE "e"."tipo" = 'gestion_registrada'
     AND EXISTS (SELECT 1 FROM "orden_historial_estado" "h" WHERE "h"."gestion_orden_id" = "e"."gestion_orden_id")
     AND EXISTS (
       SELECT 1 FROM "gestion_orden" "g"
         LEFT JOIN "cierre_dia" "c" ON "c"."id" = "g"."cierre_id"
        WHERE "g"."id" = "e"."gestion_orden_id" AND "g"."anulada_at" IS NULL
          AND ("g"."cierre_id" IS NULL OR "c"."estado" <> 'aprobado')
     );

  -- 0) LAS PENDIENTES DEL MODELO NUEVO, aplicadas como el modelo viejo (una por orden: R4).
  WITH "pend" AS (
    SELECT DISTINCT ON ("g"."orden_id")
           "g"."orden_id", "g"."id" AS "gestion_id", "g"."resultado", "e"."familia_aplicacion",
           "e"."actor_usuario_id"
      FROM "gestion_orden" "g"
      JOIN "orden_evento" "e" ON "e"."gestion_orden_id" = "g"."id" AND "e"."tipo" = 'gestion_registrada'
      JOIN "orden" "o" ON "o"."id" = "g"."orden_id" AND "o"."estatus_id" = v_en_reparto
      LEFT JOIN "cierre_dia" "c" ON "c"."id" = "g"."cierre_id"
     WHERE "g"."anulada_at" IS NULL
       AND ("g"."cierre_id" IS NULL OR "c"."estado" <> 'aprobado')
       AND NOT EXISTS (SELECT 1 FROM "orden_historial_estado" "h" WHERE "h"."gestion_orden_id" = "g"."id")
     ORDER BY "g"."orden_id", "g"."created_at" DESC, "g"."id" DESC
  ), "destino" AS (
    SELECT "p".*, "s"."id" AS "destino_id"
      FROM "pend" "p"
      JOIN "order_status" "s"
        ON "s"."value" = CASE WHEN "p"."resultado" = 'devuelta' THEN 'devolucion_por_confirmar'
                              ELSE "p"."resultado"::text END
  ), "historial" AS (
    INSERT INTO "orden_historial_estado"
           ("id", "orden_id", "estatus_origen_id", "estatus_destino_id", "actor_usuario_id",
            "origen_tipo", "motivo", "gestion_orden_id", "created_at")
    SELECT gen_random_uuid()::text, "d"."orden_id", v_en_reparto, "d"."destino_id", "d"."actor_usuario_id",
           "d"."familia_aplicacion", NULL, "d"."gestion_id", v_ahora
      FROM "destino" "d"
    RETURNING "orden_id", "estatus_destino_id"
  )
  UPDATE "orden" "o" SET "estatus_id" = "hi"."estatus_destino_id"
    FROM "historial" "hi"
   WHERE "o"."id" = "hi"."orden_id" AND "o"."estatus_id" = v_en_reparto;

  --    Y las AYUDAS ABIERTAS que registro el codigo nuevo (la misma derivacion que
  --    `lib/repositories/ayuda-abierta.ts`, escrita aqui porque una migracion no importa TypeScript).
  WITH "abiertas" AS (
    SELECT "o"."id" AS "orden_id", "ult"."actor_usuario_id"
      FROM "orden" "o"
      JOIN LATERAL (
        SELECT "e"."tipo", "e"."created_at", "e"."actor_usuario_id"
          FROM "orden_evento" "e"
         WHERE "e"."orden_id" = "o"."id"
           AND "e"."tipo" IN ('ayuda_solicitada', 'ayuda_rescatada', 'ayuda_habilitada_api')
         ORDER BY "e"."created_at" DESC, "e"."id" DESC
         LIMIT 1
      ) "ult" ON TRUE
     WHERE "o"."estatus_id" = v_en_reparto
       AND "ult"."tipo" = 'ayuda_solicitada'
       AND NOT EXISTS (SELECT 1 FROM "orden_historial_estado" "h"
                        WHERE "h"."orden_id" = "o"."id" AND "h"."created_at" > "ult"."created_at")
  ), "historial" AS (
    INSERT INTO "orden_historial_estado"
           ("id", "orden_id", "estatus_origen_id", "estatus_destino_id", "actor_usuario_id",
            "origen_tipo", "motivo", "gestion_orden_id", "created_at")
    SELECT gen_random_uuid()::text, "a"."orden_id", v_en_reparto, v_ayuda, "a"."actor_usuario_id",
           'solicitud_ayuda_tienda', NULL, NULL, v_ahora
      FROM "abiertas" "a"
    RETURNING "orden_id"
  )
  UPDATE "orden" "o" SET "estatus_id" = v_ayuda
    FROM "historial" "hi"
   WHERE "o"."id" = "hi"."orden_id" AND "o"."estatus_id" = v_en_reparto;

  -- 2) LAS QUE MARCO EL RASTRO Y SIGUEN INTACTAS vuelven a su origen.
  UPDATE "orden" "o" SET "estatus_id" = "r"."estatus_origen_id"
    FROM "orden_historial_estado" "r"
   WHERE "r"."orden_id" = "o"."id"
     AND "r"."origen_tipo" = 'ajuste_estado'
     AND "r"."actor_usuario_id" IS NULL
     AND "r"."motivo" IN ('migracion 454: retiro de ayuda_tienda', 'migracion 454: retiro de devolucion_por_confirmar')
     AND "o"."estatus_id" = v_en_reparto
     AND NOT EXISTS (SELECT 1 FROM "orden_historial_estado" "h2"
                      WHERE "h2"."orden_id" = "o"."id" AND "h2"."id" <> "r"."id"
                        AND "h2"."created_at" >= "r"."created_at")
     -- Ni un HECHO despues del rastro: una ayuda migrada y luego rescatada, o una `devuelta`
     -- migrada y luego deshecha, no escriben historial en el modelo nuevo y NO deben volver.
     AND NOT EXISTS (SELECT 1 FROM "orden_evento" "e2"
                      WHERE "e2"."orden_id" = "o"."id" AND "e2"."created_at" >= "r"."created_at");

  -- 3) EL RASTRO.
  DELETE FROM "orden_historial_estado"
   WHERE "origen_tipo" = 'ajuste_estado'
     AND "actor_usuario_id" IS NULL
     AND "motivo" IN ('migracion 454: retiro de ayuda_tienda', 'migracion 454: retiro de devolucion_por_confirmar');
END
$$;
