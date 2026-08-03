-- Feature 123 (design §3.1) — rollup diario de analitica `analytics_daily`. Migracion
-- puramente ADITIVA (R41): no altera, renombra ni elimina ninguna tabla, columna, enum,
-- indice ni constraint preexistente, y no mueve una sola fila de negocio. Crea UNA tabla
-- nueva, sus 3 CHECK, sus 4 FK, sus 4 indices, sus 10 comentarios y su RLS. La tabla NACE
-- VACIA y se queda asi (R44): el job que la puebla es la feature 124 y el backfill la 125.
--
-- (1) POR QUE EL GRANO ES DE 6 COLUMNAS
--     `(fecha, zona_id, tienda_id, mensajero_id, estatus_id, causa_devolucion)` no es una
--     eleccion de esta feature: es la UNION de los `granos` que declaran las metricas con
--     `fuente.tipo = "rollup"` del catalogo de la feature 135 (`lib/analytics/metrics.ts`),
--     que por su invariante R5 son exactamente las de `clase: "snapshot"` (R2). La septima
--     dimension del catalogo, `metodo_pago`, se queda FUERA (R3): su unica consumidora
--     (`cod_recaudado`) es `clase: "live"` con fuente `snapshot_cierre` + ledger, asi que
--     la columna seria permanentemente NULL y meteria el rollup en el camino del dinero,
--     que es justo lo que prohibe R6 de la 135. `causa_devolucion` SI entra, porque
--     `motivos_devolucion` es una metrica `producida` cuya fuente es literalmente el
--     rollup: sin esa columna naceria inservible para ella.
--     El guard `tests/unit/analytics/analytics-daily-contrato.test.ts` (R45) congela esa
--     derivacion: si la 135 anade una metrica snapshot con un grano nuevo, se pone rojo.
--
-- (2) POR QUE `NULLS NOT DISTINCT` EN EL UNICO DEL GRANO (R14/R15, D6)
--     Dos columnas del grano son nullable y en ambas el NULL tiene significado de dominio:
--     `mensajero_id IS NULL` = cubo `sin_asignar` (D5/R30 de la 135, NUNCA "todos los
--     mensajeros") y `causa_devolucion IS NULL` = sin causa tipificada (R12). Con la
--     semantica UNIQUE por defecto de Postgres dos NULL no colisionan: el `ON CONFLICT`
--     del upsert de la 124 no encontraria con que chocar, insertaria una fila nueva en
--     cada pasada y el rollup se duplicaria SIN UN SOLO ERROR. `NULLS NOT DISTINCT`
--     (Postgres 15+) devuelve la unicidad al grano. No es una novedad aqui: ya lo usan
--     `20260711190000_tarifa_zona_mensajero_zona_vehiculo_unique` y
--     `20260727120000_notificacion` (`notificacion_dedupe_key`). Si el motor de destino no
--     lo soportara, esta sentencia FALLA en el apply y la migracion no se aplica a medias
--     (R15): preferimos el fallo ruidoso a un indice unico que no deduplica.
--
-- (3) POR QUE NO HAY DINERO (R5)
--     Ninguna columna monetaria y ninguna de coma flotante. Las 9 metricas `clase: "live"`
--     (8 financieras + `aging_por_estado`) NO se materializan aqui (R4): el dinero se lee
--     de ledgers y de cierres, nunca se recalcula desde ordenes (consigna de la 127). Si
--     algun dia entrara una medida monetaria seria de tipo numerico EXACTO de 12 digitos
--     con 2 decimales (el que usa el resto del repo para dinero), jamas un flotante.
--     Tampoco se guarda ninguna tasa, promedio ni porcentaje ya calculado (R17): un valor
--     no aditivo en una fila diaria se vuelve basura en cuanto alguien suma dos filas, y
--     el resultado es plausible, asi que nadie lo detecta. Se guardan numerador y
--     denominador (`seg_ciclo_acum`/`seg_ciclo_n`, `primer_intento_ok`/`entregas`) y la
--     division la hace la consulta, una sola vez, al final.
--
-- (4) POR QUE EXISTEN LOS TRES CHECK
--     Son invariantes ESTRUCTURALES, no reglas de negocio (esas viven en zod y en el
--     service, patron `cierre_dia` / `orden_incidente`). Precedente en el repo:
--     `notificacion_destinatario_xor` y `notificacion_lectura_marca_presente` (feature 146).
--     - `analytics_daily_pio_lte_entregas` (D1/R24/R25): `primer_intento_ok` no tiene
--       denominador propio; el suyo es `entregas` DEL MISMO GRANO. Con `pio <= ent` fila a
--       fila se cumple `SUMA(pio) <= SUMA(ent)` sobre CUALQUIER subconjunto de filas, asi
--       que la tasa derivada no puede pasar de 1 en ningun corte de la 126. Un job de la
--       124 mal escrito no puede persistir la fila mala: la transaccion falla.
--     - `analytics_daily_ciclo_coherente` (R22): nunca una fila con segundos acumulados y
--       denominador vacio, es decir, nunca un promedio sobre cero.
--     - `analytics_daily_medidas_no_negativas` (R26): las diez medidas son conteos.
--
-- Enums: NINGUNO nuevo. `gestion_causa_devolucion` ya existe desde
-- `20260715160000_gestion_orden_causa_devolucion`, asi que el `down.sql` no retira tipos y
-- es una sola sentencia.

-- 1) tabla: 6 columnas de grano + 10 medidas + id/created_at/updated_at = 19.
CREATE TABLE "analytics_daily" (
  "id" TEXT NOT NULL,
  "fecha" DATE NOT NULL,
  "zona_id" TEXT NOT NULL,
  "tienda_id" TEXT NOT NULL,
  "mensajero_id" TEXT,
  "estatus_id" TEXT NOT NULL,
  "causa_devolucion" "gestion_causa_devolucion",
  "ordenes_creadas" INTEGER NOT NULL DEFAULT 0,
  "ordenes_estado_stock" INTEGER NOT NULL DEFAULT 0,
  "entregas" INTEGER NOT NULL DEFAULT 0,
  "devoluciones" INTEGER NOT NULL DEFAULT 0,
  "rechazos" INTEGER NOT NULL DEFAULT 0,
  "reprogramaciones" INTEGER NOT NULL DEFAULT 0,
  "incidentes" INTEGER NOT NULL DEFAULT 0,
  "primer_intento_ok" INTEGER NOT NULL DEFAULT 0,
  "seg_ciclo_acum" BIGINT NOT NULL DEFAULT 0,
  "seg_ciclo_n" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "analytics_daily_pkey" PRIMARY KEY ("id")
);

-- 2) los tres CHECK estructurales (ver punto 4 de la cabecera).
ALTER TABLE "analytics_daily" ADD CONSTRAINT "analytics_daily_pio_lte_entregas"
  CHECK ("primer_intento_ok" <= "entregas");

ALTER TABLE "analytics_daily" ADD CONSTRAINT "analytics_daily_ciclo_coherente"
  CHECK ("seg_ciclo_n" > 0 OR "seg_ciclo_acum" = 0);

ALTER TABLE "analytics_daily" ADD CONSTRAINT "analytics_daily_medidas_no_negativas"
  CHECK (
    "ordenes_creadas" >= 0
    AND "ordenes_estado_stock" >= 0
    AND "entregas" >= 0
    AND "devoluciones" >= 0
    AND "rechazos" >= 0
    AND "reprogramaciones" >= 0
    AND "incidentes" >= 0
    AND "primer_intento_ok" >= 0
    AND "seg_ciclo_acum" >= 0
    AND "seg_ciclo_n" >= 0
  );

-- 3) integridad referencial (R37). ON DELETE RESTRICT a proposito: borrar una zona, una
-- tienda, un mensajero o un estatus que YA tiene historia agregada dejaria el rollup
-- mintiendo en silencio (CASCADE) o con coordenadas huerfanas (SET NULL, que ademas
-- colisionaria con el significado de NULL en `mensajero_id`). Que el borrado falle es la
-- respuesta correcta: el dato historico manda sobre la limpieza del catalogo.
-- `tienda_id` referencia `usuario`, NO una tabla `tienda`: en este esquema la tienda ES el
-- usuario con rol adminTienda (`orden.tienda_id` -> `usuario.id`).
-- La FK a `order_status` NO restringe los `value` admisibles (R36): el catalogo tolera la
-- fila huerfana documentada (`en_fulfillment`) porque aqui no hay CHECK ni lista cerrada.
ALTER TABLE "analytics_daily" ADD CONSTRAINT "analytics_daily_zona_id_fkey"
  FOREIGN KEY ("zona_id") REFERENCES "zona"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "analytics_daily" ADD CONSTRAINT "analytics_daily_tienda_id_fkey"
  FOREIGN KEY ("tienda_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "analytics_daily" ADD CONSTRAINT "analytics_daily_mensajero_id_fkey"
  FOREIGN KEY ("mensajero_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "analytics_daily" ADD CONSTRAINT "analytics_daily_estatus_id_fkey"
  FOREIGN KEY ("estatus_id") REFERENCES "order_status"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 4) indices: EXACTAMENTE cuatro (R39), cada uno con su consulta (design §5).
-- El unico del grano empieza por `fecha` porque es el unico predicado presente en el 100 %
-- de las consultas de la 126: como prefijo del unico sirve tambien el barrido por rango de
-- los dos roles de acceso total (maestro, admin) sin necesitar un indice suelto de `fecha`.
CREATE UNIQUE INDEX "analytics_daily_grano_key"
  ON "analytics_daily"("fecha", "zona_id", "tienda_id", "mensajero_id", "estatus_id", "causa_devolucion")
  NULLS NOT DISTINCT;

-- Los tres de recorte se corresponden UNO A UNO con los tres roles `acotado` del catalogo
-- (adminTienda, mensajero, adminSatelite). Igualdad antes que rango: al reves la igualdad
-- no permite seek en un B-tree compuesto. El de mensajero cubre ademas el cubo
-- `sin_asignar` (`IS NULL` es seekable en B-tree).
CREATE INDEX "analytics_daily_tienda_fecha_idx" ON "analytics_daily"("tienda_id", "fecha");
CREATE INDEX "analytics_daily_mensajero_fecha_idx" ON "analytics_daily"("mensajero_id", "fecha");
CREATE INDEX "analytics_daily_zona_fecha_idx" ON "analytics_daily"("zona_id", "fecha");

-- NINGUN indice suelto sobre `estatus_id` ni sobre `causa_devolucion` (R40): son columnas
-- de GROUP BY dentro de un conjunto ya recortado por fecha y dimension, no predicados de
-- filtrado. Un indice ahi seria peso de escritura y de vacuum sin lector.

-- 5) la semantica viaja CON el esquema, no solo con el spec (R30): 1 comentario de tabla y
-- 9 de columna, visibles desde cualquier cliente SQL y verificables por `pg_description`.
COMMENT ON TABLE "analytics_daily" IS
  'Rollup diario de analitica (feature 123). Grano: (fecha, zona_id, tienda_id, mensajero_id, estatus_id, causa_devolucion), unico con NULLS NOT DISTINCT. INVARIANTE DE INMUTABILIDAD HACIA ATRAS (R35): todo hecho se atribuye a la fecha en que ocurre, asi que el job diario (feature 124) SOLO escribe filas de la fecha que esta agregando y NUNCA reescribe filas de fechas anteriores. El unico escritor autorizado a recomputar fechas pasadas es el backfill (feature 125), invocado deliberadamente sobre un rango explicito. Tabla DERIVADA y reconstruible: no es fuente de verdad de nada.';

COMMENT ON COLUMN "analytics_daily"."zona_id" IS
  'Zona DE LA ORDEN (orden.zona_id), congelada; jamas la zona del usuario que gestiono, que puede diferir (D9/R34 de la feature 135; R31).';

COMMENT ON COLUMN "analytics_daily"."tienda_id" IS
  'Tienda DE LA ORDEN (orden.tienda_id); en este esquema la tienda ES el usuario con rol adminTienda, por eso la FK apunta a usuario (R31).';

COMMENT ON COLUMN "analytics_daily"."mensajero_id" IS
  'NULL significa EXACTAMENTE "orden sin mensajero asignado" (cubo sin_asignar, D5/R30 de la feature 135); NUNCA significa "todos los mensajeros" ni "la dimension no aplica". En las medidas de orden sale de orden.mensajero_asignado_id (nullable); en las de gestion sale de gestion_orden.mensajero_id, que es NOT NULL y por tanto nunca produce el cubo sin asignar (R11/R32).';

COMMENT ON COLUMN "analytics_daily"."estatus_id" IS
  'Estado de la orden EN EL CORTE DEL DIA de la fila, no el estado actual (R33). Sin lista cerrada de values: la tabla tolera el estatus huerfano documentado del catalogo (R36).';

COMMENT ON COLUMN "analytics_daily"."causa_devolucion" IS
  'NULL significa "la fila no tiene causa de devolucion tipificada" (R12). Solo se informa en las filas de devolucion; en una fila con devoluciones = 0 la columna es irrelevante y no se agrupa por ella.';

COMMENT ON COLUMN "analytics_daily"."ordenes_estado_stock" IS
  'STOCK al corte del dia: cuantas ordenes habia en ese estatus al cerrar el dia (R28). NO SUMAR POR FECHA: es aditiva en las demas dimensiones del grano pero NO a lo largo de fecha, porque sumarla entre fechas cuenta la misma orden una vez por cada dia que estuvo viva y el resultado es un numero plausible que nadie detecta. Para una fecha unica si se agrega. NO CONFUNDIR con ordenes_creadas, que es un FLUJO (ordenes nacidas ese dia, metrica propia e independiente del catalogo de la feature 135) y esa SI es aditiva a lo largo de fecha (R27). La metrica sin_gestionar se deriva de aqui filtrando por el estatus_id de ese value (R19), y por eso no tiene columna propia.';

COMMENT ON COLUMN "analytics_daily"."primer_intento_ok" IS
  'Conteo entero (numerador), nunca un porcentaje (R23). Su universo es un SUBCONJUNTO del de entregas de la MISMA fila: toda gestion contada aqui es una gestion vigente de resultado entregada con las mismas seis coordenadas de grano, contada tambien en entregas (D1/R24). El CHECK analytics_daily_pio_lte_entregas lo impone, de modo que la tasa derivada no puede pasar de 1 en ninguna agregacion (R25).';

COMMENT ON COLUMN "analytics_daily"."seg_ciclo_acum" IS
  'Numerador del tiempo de ciclo: SUMA de segundos entre la creacion de la orden y su evento terminal. BIGINT y no INTEGER a proposito (R21): con INTEGER unas 828 ordenes de 30 dias de ciclo desbordan una sola celda. Una orden aporta en la fecha de su EVENTO TERMINAL (D4/R34), nunca en la de su creacion; de ahi sale la inmutabilidad hacia atras de R35. Nunca se guarda el promedio (R17/R20): se divide entre seg_ciclo_n en la consulta.';

COMMENT ON COLUMN "analytics_daily"."seg_ciclo_n" IS
  'Denominador del tiempo de ciclo: numero de ordenes que aportaron a seg_ciclo_acum en esta fila (R20). Atado a SU numerador: no es un denominador generico y ninguna otra medida debe usarlo. El CHECK analytics_daily_ciclo_coherente garantiza que si vale 0 entonces seg_ciclo_acum vale 0 (R22).';

-- 6) RLS habilitada SIN policies (solo service role, R38), patron orden / gestion_orden /
-- notificacion: este repo NO usa Supabase Auth (sesion propia, sin auth.uid()), asi que el
-- recorte por rol lo aplica la 122 con un predicado unico en el repositorio, no con
-- policies.
ALTER TABLE "analytics_daily" ENABLE ROW LEVEL SECURITY;
