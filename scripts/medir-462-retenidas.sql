-- FICHA 462 (T1.7, design §9, R55) — reprogramadas de HOY retenidas por un cierre sin aprobar,
-- agrupadas por cierre. SOLO LECTURA: una sola sentencia `WITH … SELECT`, sin escrituras.
--
-- COMO SE USA. Se pega entera en la consola SQL (MCP de Supabase, contra produccion) o se corre con
-- `psql` en local. El «hoy» es la fecha calendario de COSTA RICA del instante de la corrida.
--
-- ⚠️ EXIGE LA 454 APLICADA (usa `orden_evento`). Para dimensionar la poblacion LEGADA antes de la
-- release (T5.1) se corre SOLO la Forma A: comentar el `UNION ALL SELECT * FROM forma_b` de abajo.
--
-- ES LA RE-EXPRESION EN SQL del mismo predicado que aplica `ReprogramadasRetenidasService`
-- (`lib/services/`): la Forma A es `!puedeLiberarse` sobre las candidatas del reloj (276), la Forma
-- B es la gestion PENDIENTE mas reciente de la 454 con resultado `reprogramado` y fecha vencida.
-- Vive FUERA de `lib/**` a proposito: alli la guardia 371 prohibe una segunda correlacion de «la
-- gestion reprogramada vigente» y la 454 prohibe leer `gestion_registrada` fuera de su modulo; aqui
-- se re-escriben para poder medirlas en produccion, y el test de integracion
-- (`tests/integration/db/462/reprogramadas-retenidas-sql-real.test.ts`) afirma que este archivo y el
-- servicio dan EL MISMO numero sobre la misma siembra.
--
-- Las familias de VISITA REAL se copian de `ORIGEN_TIPOS_VISITA_REAL` (`lib/types/orden-historial.ts`),
-- verificadas en el archivo real el 2026-09-25: 'gestion', 'gestion_tienda_ayuda'. Si esa lista
-- cambia, este archivo se reescribe con ella.
--
-- COMO LEER EL RESULTADO:
--   · `cierre_id IS NULL` es el grupo «sin cierre enviado», agrupado por mensajero asignado.
--   · `SUM(retenidas)` es el total del sistema; la fila de un cierre es lo que la marca de
--     `/cierres-admin` debe enseñar; la suma de `destino_tipo = 'bodega_central'` es la cifra que ven
--     maestro y admin (R6/R7). Compararlo con las pantallas es parte del recorrido (T5.3).
-- ⚠️ `hoy_cr` (corregido el 2026-09-25 en el cierre de la 461, medido en Postgres). La forma anterior,
-- `((now() AT TIME ZONE 'UTC') AT TIME ZONE 'America/Costa_Rica')::date`, NO da el dia de Costa Rica
-- porque `now()` es `timestamptz`: `timestamptz AT TIME ZONE 'UTC'` devuelve un `timestamp` SIN zona,
-- y `timestamp AT TIME ZONE 'America/Costa_Rica'` lo REINTERPRETA como hora de CR (devuelve un
-- `timestamptz` 6 h DESPUES del instante real); el `::date` final se evalua en la zona de la SESION.
-- Resultado: con sesion UTC (Supabase) decia MAÑANA de 18:00 a 06:00 UTC —de las 12:00 CR a la
-- medianoche CR—, y con la sesion local (UTC-5) de 23:00 a 06:00 UTC. Lo que se veia: el test
-- `reprogramadas-retenidas-sql-real` (R55) en rojo solo por la tarde (`expected 16 to be 13`: contaba
-- las siembras con fecha de MAÑANA) y verde por la mañana. `timestamptz AT TIME ZONE 'zona'` a secas
-- da el reloj local de esa zona y no depende de la sesion.
--
-- OJO: el patron doble SI es el correcto para las COLUMNAS, porque Prisma las guarda como `timestamp`
-- SIN zona con el valor en UTC: `(col AT TIME ZONE 'UTC') AT TIME ZONE 'America/Costa_Rica'` primero
-- las fija como UTC y luego las pasa al reloj de CR (asi va `solicitado_cr` mas abajo, y asi lo
-- documenta `scripts/contraste-454.sql`). Lo que cambia es el PUNTO DE PARTIDA: `now()` ya lleva zona.
-- Lo vigila `tests/integration/db/462/medir-462-hoy-cr.test.ts` (evalua ESTA expresion, leida del
-- archivo, cada 30 min durante 48 h y bajo tres zonas de sesion, contra el dia CR calculado en JS).
WITH params AS (
  SELECT (now() AT TIME ZONE 'America/Costa_Rica')::date AS hoy_cr
),
-- Forma A: orden en `reprogramado`, gestion reprogramada VIGENTE (la mas reciente NO anulada, como
-- `GESTION_REPROGRAMADA_VIGENTE`), nacida de visita real, con cierre no aprobado (= `!puedeLiberarse`).
a_vigente AS (
  SELECT DISTINCT ON (g.orden_id)
         g.orden_id, g.id AS gestion_id, g.cierre_id, g.fecha_reprogramacion
    FROM gestion_orden g
   WHERE g.resultado = 'reprogramado' AND g.anulada_at IS NULL
   ORDER BY g.orden_id, g.created_at DESC
),
forma_a AS (
  SELECT 'A'::text AS forma, o.id AS orden_id, o.zona_id, o.mensajero_asignado_id,
         v.gestion_id, v.cierre_id, v.fecha_reprogramacion
    FROM orden o
    JOIN order_status s ON s.id = o.estatus_id AND s.value = 'reprogramado'
    JOIN a_vigente v ON v.orden_id = o.id
    LEFT JOIN cierre_dia c ON c.id = v.cierre_id
   CROSS JOIN params p
   WHERE o.deleted_at IS NULL
     AND v.fecha_reprogramacion <= p.hoy_cr
     AND EXISTS (SELECT 1 FROM orden_historial_estado h
                  WHERE h.gestion_orden_id = v.gestion_id
                    AND h.origen_tipo IN ('gestion', 'gestion_tienda_ayuda'))
     AND (v.cierre_id IS NULL OR c.estado <> 'aprobado')
),
-- Forma B (454): orden en `en_reparto`, gestion PENDIENTE de confirmar mas reciente con resultado
-- `reprogramado` y fecha <= hoy. Mismas tres condiciones que `gestion-pendiente.ts`.
b_pendiente AS (
  SELECT DISTINCT ON (g.orden_id)
         g.orden_id, g.id AS gestion_id, g.cierre_id, g.resultado, g.fecha_reprogramacion
    FROM gestion_orden g
    LEFT JOIN cierre_dia c ON c.id = g.cierre_id
   WHERE g.anulada_at IS NULL
     AND EXISTS (SELECT 1 FROM orden_evento e
                  WHERE e.gestion_orden_id = g.id AND e.tipo = 'gestion_registrada')
     AND (g.cierre_id IS NULL OR c.estado <> 'aprobado')
   ORDER BY g.orden_id, g.created_at DESC, g.id DESC
),
forma_b AS (
  SELECT 'B'::text AS forma, o.id AS orden_id, o.zona_id, o.mensajero_asignado_id,
         b.gestion_id, b.cierre_id, b.fecha_reprogramacion
    FROM orden o
    JOIN order_status s ON s.id = o.estatus_id AND s.value = 'en_reparto'
    JOIN b_pendiente b ON b.orden_id = o.id
   CROSS JOIN params p
   WHERE o.deleted_at IS NULL
     AND b.resultado = 'reprogramado'
     AND b.fecha_reprogramacion <= p.hoy_cr
),
retenidas AS (SELECT * FROM forma_a UNION ALL SELECT * FROM forma_b)
SELECT r.cierre_id,
       c.estado::text                    AS estado,
       c.destino_tipo::text              AS destino_tipo,
       z.nombre                          AS bodega,
       u.nombre                          AS mensajero,
       (c.solicitado_at AT TIME ZONE 'UTC') AT TIME ZONE 'America/Costa_Rica' AS solicitado_cr,
       COUNT(*)                          AS retenidas,
       SUM((r.forma = 'A')::int)         AS forma_a,
       SUM((r.forma = 'B')::int)         AS forma_b,
       MIN(r.fecha_reprogramacion)       AS fecha_mas_antigua
  FROM retenidas r
  LEFT JOIN cierre_dia c ON c.id = r.cierre_id
  LEFT JOIN zona z ON z.id = c.destino_zona_id
  LEFT JOIN usuario u ON u.id = COALESCE(c.mensajero_id, r.mensajero_asignado_id)
 GROUP BY r.cierre_id, c.estado, c.destino_tipo, z.nombre, u.nombre, c.solicitado_at
 ORDER BY retenidas DESC, solicitado_cr ASC;
