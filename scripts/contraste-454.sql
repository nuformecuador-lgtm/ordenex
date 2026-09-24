-- =====================================================================================================
-- FICHA 454 — CONTRASTE HISTORICO (T3.1, design §14) + POBLACION LEGADA (T3.3)
-- =====================================================================================================
--
-- QUE ES. Sobre lo que YA OCURRIO (cierres aprobados, cortes, devoluciones, liberaciones, dinero) se
-- recalcula lo que habria hecho la logica NUEVA de la 454 —la de `feature/454-backend`— y se compara
-- con lo que la base dice que paso. Cada bloque devuelve UNA fila:
--
--     k | total_evaluado | diferencias | muestra_ids (hasta 10) | nota
--
-- `diferencias` tiene que ser 0 o estar explicada fila a fila en `progress/contraste_454.md`.
-- Las de dinero (K4*, K8*) sin explicar son un FALLO, no un matiz.
--
-- COMO SE CORRE.
--   · Produccion: pegar el archivo ENTERO en la consola SQL (MCP de Supabase `execute_sql`). Es UNA
--     sola sentencia `WITH … SELECT`: solo lectura, sin CTE que escriban, sin funciones volatiles.
--     Corre sobre el esquema de PRODUCCION DE HOY: no usa `orden_evento` ni nada de las migraciones
--     de la 454 (M1-M3), ni tablas de SF-001 (zona_sinpe, cierre_bodega_conciliacion,
--     asistente_uso_diario).
--   · Local: `node --env-file=.env ./node_modules/tsx/dist/cli.mjs scripts/contraste-454.ts`
--     (misma sentencia, en una transaccion READ ONLY).
--
-- PARAMETROS (CTE `params`, lo unico que se toca a mano):
--   desde            inicio de la poblacion (produccion se vacio el 2026-08-25).
--   umbral           REINTENTOS_MIN_INTENTOS (defecto 3, `lib/config/reintentos.ts`).
--   horas_not_found  HORAS_REINTENTO del SLA de devoluciones (defecto 24, `lib/config/devolucion-sla.ts`).
--   dias_wrong       DIAS_RECHAZO_AUTOMATICO (defecto 5).
--   Si produccion tiene esas variables de entorno con otro valor, cambiarlas aqui antes de correr.
--
-- EL «SIMULADOR» DE LA LOGICA NUEVA, en una frase por pieza (cada una citada del codigo de la rama):
--   · Gestion de CALLE (lo que en la 454 lleva evento `gestion_registrada`): en produccion no hay
--     eventos, asi que se usa el PROXY «no es sintetica»: ninguna fila de historial enlazada de las
--     cuatro familias sinteticas (`escalado_devuelta_sla`, `rechazo_tope_intentos`,
--     `reprogramacion_tienda`, `rechazo_tienda`) y un `motivo` distinto de los DOS literales del tope
--     (el anterior a la 455 y el vigente, `MOTIVO_RECHAZO_TOPE_INTENTOS`). La guardia `sinteticas-sin-evento-registro` fija que esos
--     son TODOS los productores sinteticos. El proxy se valida contra los eventos reales en local
--     (bloque P0 de `contraste-454.ts`, que en produccion no se puede correr).
--   · Aplicacion al aprobar (`CierresAdminRepository.resolverCierre`, bloque APLICACION DE
--     GESTIONES): cada gestion de calle vigente del cierre, SOLO si es la de calle vigente mas
--     reciente de su orden en el instante de la aprobacion (R57), con destino = `resultado`
--     (`ESTATUS_POR_RESULTADO` es la identidad desde la 454) y orden no borrada.
--   · Intentos (`whereIntentosVigentes`): resultado ∈ {rechazada, devuelta, reprogramada}, no anulada,
--     cierre aprobado, y (fila enlazada de visita real {gestion, gestion_tienda_ayuda} O gestion de
--     calle — la segunda via de la 454). Grano: cierre distinto.
--   · Pendiente (`gestion-pendiente.ts`): gestion de calle, no anulada, sin cierre o con cierre no
--     aprobado — evaluado EN EL INSTANTE del hecho que se contrasta.
--
-- Tiempos: todas las columnas son `timestamp` SIN zona que guardan UTC (Prisma). La fecha calendario
-- de Costa Rica se obtiene con `(ts AT TIME ZONE 'UTC') AT TIME ZONE 'America/Costa_Rica'`, que no
-- depende del `TimeZone` de la sesion.
--
-- AUTOCOMPROBACION. Cada tabla se lee UNA sola vez, en los CTE `src_*`, y cada uno termina en un
-- marcador `/*FIX:<nombre>*/`. `contraste-454.ts --autocomprobacion` inyecta ahi filas ficticias
-- (`UNION ALL SELECT …` con tipos explicitos) construidas para producir EXACTAMENTE una diferencia por bloque, y
-- comprueba que el bloque la cuenta. En esta consola los marcadores son comentarios y no hacen nada.
-- =====================================================================================================
WITH
params AS (
  SELECT '2026-08-25 00:00:00'::timestamp AS desde, -- @DESDE
         3   AS umbral,
         24  AS horas_not_found,
         5   AS dias_wrong,
         -- Motivo de las gestiones sinteticas del tope. FICHA 455: el texto cambio; las filas escritas
         -- antes conservan el VIEJO y las nuevas llevan el NUEVO (`CierresAdminRepository.
         -- MOTIVO_RECHAZO_TOPE_INTENTOS`), asi que se reconocen LOS DOS. `contraste-454.ts` comprueba
         -- al arrancar que el nuevo de aqui es identico a la constante.
         'rechazada al aprobar el cierre: sin gestionar y sin intentos de entrega disponibles'::text AS motivo_tope_viejo,
         'Devolución a origen por rechazo al aprobar el cierre: estaba en Novedad interna y sin intentos de entrega disponibles'::text AS motivo_tope_nuevo
),

-- ─── FUENTES (una lectura por tabla) ──────────────────────────────────────────────────────────────
src_cierre AS (
  SELECT cd.id, cd.mensajero_id, cd.estado::text AS estado, cd.created_at, cd.resuelto_at,
         cd.total_efectivo, cd.total_pago_mensajero, cd.total_ingreso_bodega_rechazos
    FROM cierre_dia cd /*FIX:cierre*/
),
src_gestion AS (
  SELECT go.id, go.orden_id, go.mensajero_id, go.resultado::text AS resultado, go.cierre_id,
         go.created_at, go.anulada_at, go.fecha_reprogramacion, go.causa_devolucion::text AS causa,
         go.monto_recibido, go.pago_mensajero, go.ingreso_bodega_rechazo, go.indemnizacion, go.motivo
    FROM gestion_orden go /*FIX:gestion*/
),
src_hist AS (
  SELECT h.id, h.orden_id, so.value AS origen, sd.value AS destino, h.origen_tipo::text AS origen_tipo,
         h.gestion_orden_id, h.created_at
    FROM orden_historial_estado h
    LEFT JOIN order_status so ON so.id = h.estatus_origen_id
    JOIN order_status sd ON sd.id = h.estatus_destino_id /*FIX:hist*/
),
src_orden AS (
  SELECT o.id, o.deleted_at FROM orden o /*FIX:orden*/
),
src_csg AS (
  SELECT s.cierre_id, s.orden_id, s.created_at FROM cierre_sin_gestion s /*FIX:csg*/
),
src_detail AS (
  SELECT d.cierre_id, d.orden_id, d.tienda_id, d.monto_cobrar, d.cobra_comision, d.es_central,
         d.es_zona_especial, d.tarifa_id, d.tarifa_valor_flete, d.tarifa_valor_flete_gam,
         d.tarifa_valor_flete_devuelto, d.tarifa_valor_flete_devuelto_gam, d.tarifa_comision_cod,
         d.tarifa_iva_flete, d.tarifa_iva_comision_cod, d.tarifa_especial, d.tarifa_especial_devuelta
    FROM cierre_detail d /*FIX:detail*/
),
src_wm AS (
  SELECT w.origen_id, w.tipo::text AS tipo, w.categoria::text AS categoria, w.monto
    FROM wallet_movimiento w WHERE w.origen_tipo = 'cierre_dia' /*FIX:wm*/
),
src_wtm AS (
  SELECT w.origen_id, w.tienda_id, w.tipo::text AS tipo, w.categoria::text AS categoria, w.monto
    FROM wallet_tienda_movimiento w WHERE w.origen_tipo = 'cierre_dia' /*FIX:wtm*/
),
src_pmm AS (
  SELECT w.origen_id, w.mensajero_id, w.tipo::text AS tipo, w.categoria::text AS categoria, w.monto
    FROM pago_mensajero_movimiento w WHERE w.origen_tipo = 'cierre_dia' /*FIX:pmm*/
),

-- ─── DERIVADOS COMUNES ────────────────────────────────────────────────────────────────────────────
sinteticas AS (
  SELECT DISTINCT h.gestion_orden_id AS gid
    FROM src_hist h
   WHERE h.gestion_orden_id IS NOT NULL
     AND h.origen_tipo IN ('escalado_devuelta_sla', 'rechazo_tope_intentos', 'reprogramacion_tienda', 'rechazo_tienda')
),
-- primera fila enlazada de VISITA REAL (ORIGEN_TIPOS_VISITA_REAL = gestion, gestion_tienda_ayuda)
visita AS (
  SELECT h.gestion_orden_id AS gid, min(h.created_at) AS primera
    FROM src_hist h
   WHERE h.gestion_orden_id IS NOT NULL AND h.origen_tipo IN ('gestion', 'gestion_tienda_ayuda')
   GROUP BY h.gestion_orden_id
),
-- la ultima transicion enlazada que fija el destino efectivo de la gestion (registro, anclaje o #69)
hist_ult AS (
  SELECT DISTINCT ON (h.gestion_orden_id) h.gestion_orden_id AS gid,
         CASE h.destino WHEN 'devolucion_por_confirmar' THEN 'novedad' ELSE h.destino END AS destino
    FROM src_hist h
   WHERE h.gestion_orden_id IS NOT NULL
     AND h.origen_tipo IN ('gestion', 'incidente', 'gestion_tienda_ayuda', 'anclaje_devolucion',
                           'correccion_resultado_gestion')
   ORDER BY h.gestion_orden_id, h.created_at DESC, h.id DESC
),
-- `calle` = el proxy del evento `gestion_registrada`; `visita_primera` = la sonda de visita real.
g AS (
  SELECT sg.*,
         (s.gid IS NULL AND sg.motivo IS DISTINCT FROM p.motivo_tope_viejo
                        AND sg.motivo IS DISTINCT FROM p.motivo_tope_nuevo) AS calle,
         v.primera AS visita_primera,
         hu.destino AS destino_real
    FROM src_gestion sg
    CROSS JOIN params p
    LEFT JOIN sinteticas s ON s.gid = sg.id
    LEFT JOIN visita v ON v.gid = sg.id
    LEFT JOIN hist_ult hu ON hu.gid = sg.id
),
-- subconjuntos del historial que se consultan por fila (rendimiento: no recorrer el historial entero)
hist_barridas AS (
  SELECT h.* FROM src_hist h WHERE h.orden_id IN (SELECT s.orden_id FROM src_csg s)
),
anclajes AS MATERIALIZED (
  SELECT h.orden_id, h.created_at FROM src_hist h WHERE h.origen_tipo = 'anclaje_devolucion'
),
c AS (SELECT * FROM src_cierre),
aprobados AS (
  SELECT c.* FROM c, params p WHERE c.estado = 'aprobado' AND c.resuelto_at >= p.desde
),

-- Gestiones que CUENTAN como intento en algun instante (resultado en lista, cierre aprobado). La
-- evaluacion «en el instante T» filtra ademas created_at <= T, vigente en T, cierre aprobado <= T y
-- (calle O visita real <= T). Todo por JOIN + GROUP BY: nada de subconsultas correlacionadas sobre CTE
-- materializados (medido: con ellas el contraste tardaba ~30 s con 2 000 ordenes sinteticas).
contables AS (
  SELECT gi.orden_id, gi.cierre_id, gi.created_at, gi.anulada_at, gi.calle, gi.visita_primera,
         ci.resuelto_at AS c_res
    FROM g gi JOIN c ci ON ci.id = gi.cierre_id
   WHERE gi.resultado IN ('devolucion_a_origen_por_rechazo', 'novedad', 'reprogramado') AND ci.estado = 'aprobado'
),

-- =====================================================================================================
-- K1 · APLICACION. Por gestion de calle vigente de un cierre aprobado: destino NUEVO (aplicacion al
-- aprobar, solo la mas reciente de su orden) vs destino REAL de su ultima transicion enlazada
-- (`devolucion_por_confirmar` se lee `devuelta`; el anclaje y la correccion #69 cuentan como la
-- transicion efectiva). Diferencias esperables: dos gestiones vivas, datos sin transicion.
-- =====================================================================================================
k1_pob AS (
  SELECT gg.id, gg.orden_id, gg.created_at, gg.resultado, gg.destino_real, a.resuelto_at, o.deleted_at
    FROM g gg
    JOIN aprobados a ON a.id = gg.cierre_id
    LEFT JOIN src_orden o ON o.id = gg.orden_id
   WHERE gg.calle AND gg.anulada_at IS NULL
),
-- R57: hay OTRA gestion de calle de la orden, vigente al aprobar, mas reciente que esta
k1_no_es_la_ultima AS (
  SELECT DISTINCT p.id
    FROM k1_pob p
    JOIN g g2 ON g2.orden_id = p.orden_id AND g2.calle AND g2.id <> p.id
             AND g2.created_at <= p.resuelto_at
             AND (g2.anulada_at IS NULL OR g2.anulada_at > p.resuelto_at)
             AND (g2.created_at, g2.id) > (p.created_at, p.id)
),
k1 AS (
  SELECT p.id,
         CASE WHEN (p.deleted_at IS NULL OR p.deleted_at > p.resuelto_at) AND n.id IS NULL
              THEN p.resultado END AS nuevo,
         p.destino_real AS real
    FROM k1_pob p LEFT JOIN k1_no_es_la_ultima n ON n.id = p.id
),

-- =====================================================================================================
-- K2 · INTENTOS. Por orden con gestiones en cierres aprobados del periodo: conteo con la 6.ª condicion
-- VIEJA (solo visita real enlazada) vs NUEVA (visita real O gestion de calle). Debe ser igual.
-- =====================================================================================================
k2_ordenes AS (
  SELECT DISTINCT gg.orden_id FROM g gg JOIN aprobados a ON a.id = gg.cierre_id
),
k2 AS (
  SELECT ko.orden_id AS id,
         count(DISTINCT k.cierre_id) FILTER (WHERE k.visita_primera IS NOT NULL) AS viejo,
         count(DISTINCT k.cierre_id) FILTER (WHERE k.calle OR k.visita_primera IS NOT NULL) AS nuevo
    FROM k2_ordenes ko
    LEFT JOIN contables k ON k.orden_id = ko.orden_id AND k.anulada_at IS NULL
   GROUP BY ko.orden_id
),

-- =====================================================================================================
-- K3 · TOPE (276). Por fila de `cierre_sin_gestion` de un cierre aprobado: decision recalculada con el
-- conteo NUEVO en el instante de esa aprobacion (tope / bodega / ninguna si la orden ya no estaba en
-- `sin_gestionar`) vs lo que ocurrio (`rechazo_tope_intentos` / `liberacion_sin_gestionar`).
-- =====================================================================================================
k3_pob AS (
  SELECT s.orden_id, a.id AS cierre_id, a.resuelto_at AS t
    FROM src_csg s JOIN aprobados a ON a.id = s.cierre_id
),
k3_estado AS (
  SELECT DISTINCT ON (p.orden_id, p.cierre_id) p.orden_id, p.cierre_id, h.destino
    FROM k3_pob p JOIN hist_barridas h ON h.orden_id = p.orden_id AND h.created_at < p.t
   ORDER BY p.orden_id, p.cierre_id, h.created_at DESC, h.id DESC
),
k3_intentos AS (
  SELECT p.orden_id, p.cierre_id, count(DISTINCT k.cierre_id) AS n
    FROM k3_pob p
    JOIN contables k ON k.orden_id = p.orden_id AND k.created_at <= p.t
                    AND (k.anulada_at IS NULL OR k.anulada_at > p.t) AND k.c_res <= p.t
                    AND (k.calle OR k.visita_primera <= p.t)
   GROUP BY p.orden_id, p.cierre_id
),
k3_real AS (
  SELECT DISTINCT ON (p.orden_id, p.cierre_id) p.orden_id, p.cierre_id,
         CASE h.origen_tipo WHEN 'rechazo_tope_intentos' THEN 'tope' ELSE 'bodega' END AS real
    FROM k3_pob p
    JOIN hist_barridas h ON h.orden_id = p.orden_id
                        AND h.origen_tipo IN ('rechazo_tope_intentos', 'liberacion_sin_gestionar')
                        AND h.created_at >= p.t - interval '1 minute'
                        AND h.created_at <= p.t + interval '10 minutes'
   ORDER BY p.orden_id, p.cierre_id, h.created_at
),
k3 AS (
  SELECT (p.orden_id || '@' || p.cierre_id) AS id, p.orden_id, p.cierre_id,
         CASE WHEN e.destino = 'novedad_interna'
              THEN CASE WHEN coalesce(i.n, 0) >= pr.umbral THEN 'tope' ELSE 'bodega' END
              ELSE 'ninguna' END AS nuevo,
         coalesce(r.real, 'ninguna') AS real
    FROM k3_pob p
    CROSS JOIN params pr
    LEFT JOIN k3_estado e ON e.orden_id = p.orden_id AND e.cierre_id = p.cierre_id
    LEFT JOIN k3_intentos i ON i.orden_id = p.orden_id AND i.cierre_id = p.cierre_id
    LEFT JOIN k3_real r ON r.orden_id = p.orden_id AND r.cierre_id = p.cierre_id
),

-- =====================================================================================================
-- K4 · RECHAZOS COBRADOS (dinero). El modelo no crea ni quita ningun cobro:
--   K4a  por cierre aprobado: SUM(ingreso_bodega_rechazo) = total_ingreso_bodega_rechazos, y ninguna
--        gestion no-`rechazada` con ingreso > 0.
--   K4b  gestiones SINTETICAS del tope: las que ocurrieron vs las que la logica nueva crearia (K3).
--   K4c  gestiones SINTETICAS del escalado SLA: las que ocurrieron vs las que el cron nuevo crearia (K7b).
-- =====================================================================================================
k4a_g AS (
  SELECT gi.cierre_id,
         sum(gi.ingreso_bodega_rechazo) AS suma,
         count(*) FILTER (WHERE gi.resultado = 'devolucion_a_origen_por_rechazo' AND gi.ingreso_bodega_rechazo > 0) AS rechazadas_cobradas,
         count(*) FILTER (WHERE gi.resultado <> 'devolucion_a_origen_por_rechazo' AND gi.ingreso_bodega_rechazo > 0) AS no_rechazadas_cobradas
    FROM g gi WHERE gi.cierre_id IS NOT NULL GROUP BY gi.cierre_id
),
k4a AS (
  SELECT a.id, a.total_ingreso_bodega_rechazos AS total_cierre,
         coalesce(x.suma, 0) AS suma_gestiones,
         coalesce(x.rechazadas_cobradas, 0) AS rechazadas_cobradas,
         coalesce(x.no_rechazadas_cobradas, 0) AS no_rechazadas_cobradas
    FROM aprobados a LEFT JOIN k4a_g x ON x.cierre_id = a.id
),

-- =====================================================================================================
-- K5 · CORTE NOCTURNO (D4).
--   K5a  por orden barrida (`cierre_sin_gestion`): ¿tenia en el instante del corte una gestion de calle
--        PENDIENTE (vigente, creada antes, sin cierre o con cierre no aprobado entonces)? La logica
--        nueva NO la habria barrido. Debe ser 0.
--   K5b  a la inversa: ordenes gestionadas (calle, por el mensajero del corte, en las 36 h previas) que
--        NO se barrieron. La logica nueva tampoco debe barrerlas: o su gestion estaba pendiente, o ya
--        se habia aplicado al aprobar su cierre. Diferencia = ni pendiente ni aplicable.
-- =====================================================================================================
cortes AS (
  SELECT s.cierre_id, min(s.created_at) AS t
    FROM src_csg s GROUP BY s.cierre_id
),
cortes_periodo AS (
  SELECT co.cierre_id, co.t, cc.mensajero_id
    FROM cortes co JOIN c cc ON cc.id = co.cierre_id, params p
   WHERE co.t >= p.desde
),
k5a_pendientes AS (
  SELECT DISTINCT s.cierre_id, s.orden_id
    FROM src_csg s
    JOIN g gi ON gi.orden_id = s.orden_id AND gi.calle AND gi.created_at < s.created_at
             AND (gi.anulada_at IS NULL OR gi.anulada_at > s.created_at)
    LEFT JOIN c ci ON ci.id = gi.cierre_id
   WHERE gi.cierre_id IS NULL OR ci.created_at > s.created_at
      OR NOT (ci.estado = 'aprobado' AND ci.resuelto_at <= s.created_at)
),
k5a AS (
  SELECT (s.orden_id || '@' || s.cierre_id) AS id, (kp.orden_id IS NOT NULL) AS pendiente
    FROM src_csg s
    CROSS JOIN params p
    LEFT JOIN k5a_pendientes kp ON kp.cierre_id = s.cierre_id AND kp.orden_id = s.orden_id
   WHERE s.created_at >= p.desde
),
k5b_pares AS (
  SELECT DISTINCT cp.cierre_id, cp.t, gi.orden_id
    FROM cortes_periodo cp
    JOIN g gi ON gi.mensajero_id = cp.mensajero_id AND gi.calle
             AND gi.created_at < cp.t AND gi.created_at >= cp.t - interval '36 hours'
             AND (gi.anulada_at IS NULL OR gi.anulada_at > cp.t)
    LEFT JOIN src_csg s ON s.cierre_id = cp.cierre_id AND s.orden_id = gi.orden_id
   WHERE s.orden_id IS NULL
),
-- H = la gestion de calle vigente mas reciente de la orden antes del corte
k5b_h AS (
  SELECT DISTINCT ON (pr.cierre_id, pr.orden_id)
         pr.cierre_id, pr.orden_id, pr.t, hh.id AS hid, hh.created_at AS h_created, hh.cierre_id AS h_cierre
    FROM k5b_pares pr
    JOIN g hh ON hh.orden_id = pr.orden_id AND hh.calle AND hh.created_at < pr.t
             AND (hh.anulada_at IS NULL OR hh.anulada_at > pr.t)
   ORDER BY pr.cierre_id, pr.orden_id, hh.created_at DESC, hh.id DESC
),
k5b_hc AS (
  SELECT x.*, ch.resuelto_at AS h_res,
         (x.h_cierre IS NULL OR ch.created_at > x.t
          OR NOT (ch.estado = 'aprobado' AND ch.resuelto_at <= x.t)) AS pendiente
    FROM k5b_h x LEFT JOIN c ch ON ch.id = x.h_cierre
),
-- H no pendiente y NO era la de calle vigente mas reciente cuando se aprobo su cierre → no se aplico
k5b_no_aplicada AS (
  SELECT DISTINCT x.cierre_id, x.orden_id
    FROM k5b_hc x
    JOIN g g3 ON g3.orden_id = x.orden_id AND g3.calle AND g3.id <> x.hid
             AND g3.created_at <= x.h_res
             AND (g3.anulada_at IS NULL OR g3.anulada_at > x.h_res)
             AND (g3.created_at, g3.id) > (x.h_created, x.hid)
   WHERE NOT x.pendiente
),
k5b AS (
  SELECT (x.orden_id || '@' || x.cierre_id) AS id,
         CASE WHEN x.pendiente THEN 'pendiente'
              WHEN na.orden_id IS NULL THEN 'aplicada'
              ELSE 'en_mano' END AS situacion
    FROM k5b_hc x
    LEFT JOIN k5b_no_aplicada na ON na.cierre_id = x.cierre_id AND na.orden_id = x.orden_id
),

-- =====================================================================================================
-- K6 · DEVOLUCION DE RECHAZADAS (139). Por cada `devolucion_rechazada`: ¿la seleccion NUEVA la habria
-- excluido? (su gestion `rechazada` vigente mas reciente en ese instante estaba en OTRO cierre aun no
-- aprobado — el M7 de la 271). Diferencias = esas, que el modelo nuevo devolveria mas tarde.
-- =====================================================================================================
eventos_reloj AS (
  SELECT h.id, h.orden_id, h.origen_tipo, h.created_at AS t
    FROM src_hist h, params p
   WHERE h.created_at >= p.desde
     AND h.origen_tipo IN ('devolucion_rechazada', 'liberacion_reprogramada',
                           'liberacion_devuelta_sla', 'escalado_devuelta_sla')
),
k6_g AS (
  SELECT DISTINCT ON (e.id) e.id,
         (gi.cierre_id IS NOT NULL AND ci.created_at <= e.t
          AND NOT (ci.estado = 'aprobado' AND ci.resuelto_at <= e.t)) AS excluida
    FROM eventos_reloj e
    JOIN g gi ON gi.orden_id = e.orden_id AND gi.resultado = 'devolucion_a_origen_por_rechazo' AND gi.created_at <= e.t
             AND (gi.anulada_at IS NULL OR gi.anulada_at > e.t)
    LEFT JOIN c ci ON ci.id = gi.cierre_id
   WHERE e.origen_tipo = 'devolucion_rechazada'
   ORDER BY e.id, gi.created_at DESC, gi.id DESC
),
k6 AS (
  SELECT e.id, x.excluida
    FROM eventos_reloj e LEFT JOIN k6_g x ON x.id = e.id
   WHERE e.origen_tipo = 'devolucion_rechazada'
),

-- =====================================================================================================
-- K7 · LIBERACIONES DEL RELOJ.
--   K7a  por `liberacion_reprogramada`: elegibilidad NUEVA en ese instante — gestion `reprogramada`
--        vigente mas reciente con fecha <= hoy CR, y (sintetica sin visita real) o (cierre aprobado).
--   K7b  por `liberacion_devuelta_sla` / `escalado_devuelta_sla`: el cron NUEVO en ese instante —
--        ancla = aprobacion del cierre de la `devuelta` de calle vigente mas reciente (la fila
--        `anclaje_devolucion` que escribe la aplicacion), intentos con el criterio nuevo, ventana
--        24 h / 5 d y tope. Diferencia = otra decision, o ancla que se mueve mas de 5 minutos.
-- =====================================================================================================
k7a_g AS (
  SELECT DISTINCT ON (e.id) e.id,
         (gi.fecha_reprogramacion IS NOT NULL
          AND gi.fecha_reprogramacion <= ((e.t AT TIME ZONE 'UTC') AT TIME ZONE 'America/Costa_Rica')::date
          AND ( (NOT gi.calle AND NOT coalesce(gi.visita_primera <= e.t, false))
                OR coalesce(ci.estado = 'aprobado' AND ci.resuelto_at <= e.t, false) )) AS elegible
    FROM eventos_reloj e
    JOIN g gi ON gi.orden_id = e.orden_id AND gi.resultado = 'reprogramado' AND gi.created_at <= e.t
             AND (gi.anulada_at IS NULL OR gi.anulada_at > e.t)
    LEFT JOIN c ci ON ci.id = gi.cierre_id
   WHERE e.origen_tipo = 'liberacion_reprogramada'
   ORDER BY e.id, gi.created_at DESC, gi.id DESC
),
k7a AS (
  SELECT e.id, x.elegible
    FROM eventos_reloj e LEFT JOIN k7a_g x ON x.id = e.id
   WHERE e.origen_tipo = 'liberacion_reprogramada'
),
k7b_ev AS (
  SELECT e.* FROM eventos_reloj e WHERE e.origen_tipo IN ('liberacion_devuelta_sla', 'escalado_devuelta_sla')
),
k7b_gd AS (
  SELECT DISTINCT ON (e.id) e.id, gi.id AS gid, gi.causa, gi.calle, gi.created_at AS g_created,
         CASE WHEN gi.calle AND cd.estado = 'aprobado' AND cd.resuelto_at <= e.t THEN cd.resuelto_at END AS ancla_nueva
    FROM k7b_ev e
    JOIN g gi ON gi.orden_id = e.orden_id AND gi.resultado = 'novedad' AND gi.created_at <= e.t
             AND (gi.anulada_at IS NULL OR gi.anulada_at > e.t)
    LEFT JOIN c cd ON cd.id = gi.cierre_id
   ORDER BY e.id, gi.created_at DESC, gi.id DESC
),
k7b_ancla AS (
  SELECT e.id, max(an.created_at) AS ancla
    FROM k7b_ev e JOIN anclajes an ON an.orden_id = e.orden_id AND an.created_at <= e.t
   GROUP BY e.id
),
k7b_intentos AS (
  SELECT e.id, count(DISTINCT k.cierre_id) AS n
    FROM k7b_ev e
    JOIN contables k ON k.orden_id = e.orden_id AND k.created_at <= e.t
                    AND (k.anulada_at IS NULL OR k.anulada_at > e.t) AND k.c_res <= e.t
                    AND (k.calle OR k.visita_primera <= e.t)
   GROUP BY e.id
),
k7b_base AS (
  SELECT e.id, e.orden_id, e.t,
         CASE e.origen_tipo WHEN 'escalado_devuelta_sla' THEN 'escalar' ELSE 'liberar' END AS real,
         gd.gid, gd.causa, gd.calle, gd.ancla_nueva,
         coalesce(an.ancla, gd.g_created) AS ancla_vieja,
         coalesce(it.n, 0) AS intentos
    FROM k7b_ev e
    LEFT JOIN k7b_gd gd ON gd.id = e.id
    LEFT JOIN k7b_ancla an ON an.id = e.id
    LEFT JOIN k7b_intentos it ON it.id = e.id
),
k7b AS (
  SELECT b.*,
         CASE
           WHEN b.gid IS NULL OR b.causa IS NULL OR b.ancla_nueva IS NULL THEN 'ninguna'
           WHEN b.causa <> 'not_found' AND b.intentos >= p.umbral THEN 'escalar'
           WHEN b.causa = 'not_found' AND b.t - b.ancla_nueva < make_interval(hours => p.horas_not_found) THEN 'ninguna'
           WHEN b.causa <> 'not_found' AND b.t - b.ancla_nueva < make_interval(days => p.dias_wrong) THEN 'ninguna'
           WHEN b.causa = 'not_found' AND b.intentos < p.umbral THEN 'liberar'
           ELSE 'escalar'
         END AS nuevo
    FROM k7b_base b, params p
),

-- =====================================================================================================
-- K8 · DINERO. Por cierre aprobado se RECALCULA desde `gestion_orden` + `cierre_detail` (lo unico que
-- leen los feeds; la 454 no cambia ni una de esas filas) lo que emite cada feed, y se compara con los
-- movimientos que la base tiene. Tolerancia 0,00.
--   K8a  caja 42: los 6 conceptos de ingreso (`derivarIngresoOrden`).
--   K8b  ledger por tienda 43: `cod_recaudado` + los 6 debitos espejo (supone
--        WALLET_TIENDA_DEBITA_FLETE_DEVOLUCION = true, el defecto).
--   K8c  caja COD 173: `ingreso_cod_recaudado` = suma de los `cod_recaudado` del cierre.
--   K8d  pago al mensajero 44: devengo = P, pago_efectivo = min(P, efectivo), egreso caja = P, y
--        P = SUM(gestion.pago_mensajero).
--   K8e  indemnizacion 158: egreso = SUM(indemnizacion) de los `incidente` del cierre.
-- =====================================================================================================
k8_gd AS (
  SELECT gi.cierre_id, gi.id AS gid, gi.resultado, gi.monto_recibido, d.tienda_id, d.tarifa_id,
         d.cobra_comision, coalesce(d.monto_cobrar, 0) AS monto_cobrar,
         (d.orden_id IS NULL) AS sin_detalle,
         CASE WHEN NOT d.es_zona_especial OR d.tarifa_especial IS NULL
              THEN CASE WHEN d.es_central THEN coalesce(d.tarifa_valor_flete_gam, 0) ELSE coalesce(d.tarifa_valor_flete, 0) END
              ELSE d.tarifa_especial END AS flete,
         CASE WHEN NOT d.es_zona_especial OR d.tarifa_especial_devuelta IS NULL
              THEN CASE WHEN d.es_central THEN coalesce(d.tarifa_valor_flete_devuelto_gam, 0) ELSE coalesce(d.tarifa_valor_flete_devuelto, 0) END
              ELSE d.tarifa_especial_devuelta END AS flete_dev,
         coalesce(d.tarifa_iva_flete, 0) AS iva_flete_pct,
         coalesce(d.tarifa_comision_cod, 0) AS comision_pct,
         coalesce(d.tarifa_iva_comision_cod, 0) AS iva_comision_pct
    FROM g gi
    JOIN aprobados a ON a.id = gi.cierre_id
    LEFT JOIN src_detail d ON d.cierre_id = gi.cierre_id AND d.orden_id = gi.orden_id
),
k8_conceptos AS (
  -- una fila por (gestion, concepto) con su aporte; `round(x, 2)` redondea la mitad hacia arriba
  -- en positivos, igual que `ROUND_HALF_UP`.
  SELECT x.cierre_id, x.tienda_id, v.concepto, v.aporte
    FROM k8_gd x
    CROSS JOIN LATERAL (
      SELECT round(x.monto_cobrar * x.comision_pct / 100, 2) AS comision
    ) cm
    CROSS JOIN LATERAL (VALUES
      ('ingreso_flete',                CASE WHEN x.tarifa_id IS NOT NULL AND x.resultado = 'entregado' THEN round(x.flete, 2) END),
      ('ingreso_iva_flete',            CASE WHEN x.tarifa_id IS NOT NULL AND x.resultado = 'entregado' THEN round(x.flete * x.iva_flete_pct / 100, 2) END),
      ('ingreso_comision_cod',         CASE WHEN x.tarifa_id IS NOT NULL AND x.resultado = 'entregado' AND x.cobra_comision THEN cm.comision END),
      ('ingreso_iva_comision_cod',     CASE WHEN x.tarifa_id IS NOT NULL AND x.resultado = 'entregado' AND x.cobra_comision THEN round(cm.comision * x.iva_comision_pct / 100, 2) END),
      ('ingreso_flete_devolucion',     CASE WHEN x.tarifa_id IS NOT NULL AND x.resultado = 'devolucion_a_origen_por_rechazo' THEN round(x.flete_dev, 2) END),
      ('ingreso_iva_flete_devolucion', CASE WHEN x.tarifa_id IS NOT NULL AND x.resultado = 'devolucion_a_origen_por_rechazo' THEN round(x.flete_dev * x.iva_flete_pct / 100, 2) END)
    ) AS v(concepto, aporte)
   WHERE v.aporte IS NOT NULL
),
k8a_esperado AS (
  SELECT cierre_id, concepto AS categoria, round(sum(aporte), 2) AS monto
    FROM k8_conceptos GROUP BY cierre_id, concepto HAVING round(sum(aporte), 2) > 0
),
k8a_emitido AS (
  SELECT w.origen_id AS cierre_id, w.categoria, sum(w.monto) AS monto
    FROM src_wm w JOIN aprobados a ON a.id = w.origen_id
   WHERE w.tipo = 'ingreso' AND w.categoria IN ('ingreso_flete', 'ingreso_iva_flete', 'ingreso_comision_cod',
         'ingreso_iva_comision_cod', 'ingreso_flete_devolucion', 'ingreso_iva_flete_devolucion')
   GROUP BY w.origen_id, w.categoria
),
k8a AS (
  SELECT a.id,
         coalesce((SELECT sum(monto) FROM k8a_esperado e WHERE e.cierre_id = a.id), 0) AS esperado,
         coalesce((SELECT sum(monto) FROM k8a_emitido e WHERE e.cierre_id = a.id), 0) AS emitido,
         (EXISTS (SELECT 1 FROM k8_gd x WHERE x.cierre_id = a.id AND x.sin_detalle)
          OR EXISTS (
            SELECT 1 FROM (SELECT * FROM k8a_esperado WHERE cierre_id = a.id) e
              FULL JOIN (SELECT * FROM k8a_emitido WHERE cierre_id = a.id) m ON m.categoria = e.categoria
             WHERE coalesce(e.monto, 0) <> coalesce(m.monto, 0))) AS difiere
    FROM aprobados a
),
k8b_esperado AS (
  SELECT x.cierre_id, x.tienda_id, 'cod_recaudado'::text AS categoria, round(sum(coalesce(x.monto_recibido, 0)), 2) AS monto
    FROM k8_gd x WHERE x.tienda_id IS NOT NULL GROUP BY x.cierre_id, x.tienda_id
  UNION ALL
  SELECT k.cierre_id, k.tienda_id, replace(k.concepto, 'ingreso_', ''), round(sum(k.aporte), 2)
    FROM k8_conceptos k GROUP BY k.cierre_id, k.tienda_id, k.concepto
),
k8b_emitido AS (
  SELECT w.origen_id AS cierre_id, w.tienda_id, w.categoria, sum(w.monto) AS monto
    FROM src_wtm w JOIN aprobados a ON a.id = w.origen_id
   GROUP BY w.origen_id, w.tienda_id, w.categoria
),
k8b AS (
  SELECT a.id,
         coalesce((SELECT sum(monto) FROM k8b_esperado e WHERE e.cierre_id = a.id), 0) AS esperado,
         coalesce((SELECT sum(monto) FROM k8b_emitido e WHERE e.cierre_id = a.id), 0) AS emitido,
         EXISTS (
           SELECT 1 FROM (SELECT * FROM k8b_esperado WHERE cierre_id = a.id AND monto > 0) e
             FULL JOIN (SELECT * FROM k8b_emitido WHERE cierre_id = a.id) m
               ON m.tienda_id = e.tienda_id AND m.categoria = e.categoria
            WHERE coalesce(e.monto, 0) <> coalesce(m.monto, 0)) AS difiere
    FROM aprobados a
),
k8c AS (
  SELECT a.id,
         coalesce((SELECT sum(w.monto) FROM src_wtm w WHERE w.origen_id = a.id AND w.tipo = 'credito'
                     AND w.categoria = 'cod_recaudado'), 0) AS esperado,
         coalesce((SELECT sum(w.monto) FROM src_wm w WHERE w.origen_id = a.id AND w.tipo = 'ingreso'
                     AND w.categoria = 'ingreso_cod_recaudado'), 0) AS emitido
    FROM aprobados a
),
k8d AS (
  SELECT a.id, a.total_pago_mensajero AS p,
         coalesce((SELECT sum(gi.pago_mensajero) FROM g gi WHERE gi.cierre_id = a.id), 0) AS suma_gestiones,
         coalesce((SELECT sum(w.monto) FROM src_pmm w WHERE w.origen_id = a.id AND w.categoria = 'pago_devengado'), 0) AS devengo,
         coalesce((SELECT sum(w.monto) FROM src_pmm w WHERE w.origen_id = a.id AND w.categoria = 'pago_efectivo'), 0) AS pago_efectivo,
         least(a.total_pago_mensajero, a.total_efectivo) AS pago_efectivo_esperado,
         coalesce((SELECT sum(w.monto) FROM src_wm w WHERE w.origen_id = a.id AND w.tipo = 'egreso'
                     AND w.categoria = 'egreso_pago_mensajero'), 0) AS egreso_caja
    FROM aprobados a
),
k8e AS (
  SELECT a.id,
         coalesce((SELECT sum(gi.indemnizacion) FROM g gi WHERE gi.cierre_id = a.id AND gi.resultado = 'incidente'), 0) AS esperado,
         coalesce((SELECT sum(w.monto) FROM src_wm w WHERE w.origen_id = a.id AND w.tipo = 'egreso'
                     AND w.categoria = 'egreso_indemnizacion'), 0) AS emitido
    FROM aprobados a
),

-- =====================================================================================================
-- T3.3 · POBLACION LEGADA. Gestiones vivas sin evento `gestion_registrada`, no anuladas, con cierre no
-- aprobado (o sin cierre). En PRODUCCION HOY no existe `orden_evento`: TODA gestion es legada, asi que
-- el filtro «sin evento» es vacuo y no se escribe (la variante local con el evento vive en
-- `contraste-454.ts`). Es la poblacion que, el dia del despliegue, seguira por la rama legada (DH).
-- =====================================================================================================
t33 AS (
  SELECT gi.id, gi.calle, gi.resultado
    FROM g gi LEFT JOIN c ci ON ci.id = gi.cierre_id
   WHERE gi.anulada_at IS NULL AND (gi.cierre_id IS NULL OR ci.estado <> 'aprobado')
)

-- ─── SALIDA: una fila por bloque ──────────────────────────────────────────────────────────────────
SELECT 'K1 aplicacion' AS k, count(*) AS total_evaluado,
       count(*) FILTER (WHERE nuevo IS DISTINCT FROM real) AS diferencias,
       (array_to_string((array_agg(id || ' nuevo=' || coalesce(nuevo, '-') || ' real=' || coalesce(real, '-') ORDER BY id)
          FILTER (WHERE nuevo IS DISTINCT FROM real))[1:10], ' ; ')) AS muestra_ids,
       format('sin aplicar por no ser la mas reciente: %s', count(*) FILTER (WHERE nuevo IS NULL)) AS nota
  FROM k1
UNION ALL
SELECT 'K2 intentos', count(*), count(*) FILTER (WHERE viejo <> nuevo),
       array_to_string((array_agg(id || ' viejo=' || viejo || ' nuevo=' || nuevo ORDER BY id) FILTER (WHERE viejo <> nuevo))[1:10], ' ; '),
       format('intentos totales viejo=%s nuevo=%s', coalesce(sum(viejo), 0), coalesce(sum(nuevo), 0))
  FROM k2
UNION ALL
SELECT 'K3 tope', count(*), count(*) FILTER (WHERE nuevo <> real),
       array_to_string((array_agg(id || ' nuevo=' || nuevo || ' real=' || real ORDER BY id) FILTER (WHERE nuevo <> real))[1:10], ' ; '),
       format('tope nuevo=%s real=%s; bodega nuevo=%s real=%s',
              count(*) FILTER (WHERE nuevo = 'tope'), count(*) FILTER (WHERE real = 'tope'),
              count(*) FILTER (WHERE nuevo = 'bodega'), count(*) FILTER (WHERE real = 'bodega'))
  FROM k3
UNION ALL
SELECT 'K4a rechazos cobrados (por cierre)', count(*),
       count(*) FILTER (WHERE suma_gestiones <> total_cierre OR no_rechazadas_cobradas > 0),
       array_to_string((array_agg(id || ' total=' || total_cierre || ' suma=' || suma_gestiones ORDER BY id)
          FILTER (WHERE suma_gestiones <> total_cierre OR no_rechazadas_cobradas > 0))[1:10], ' ; '),
       format('rechazadas cobradas=%s, suma ingreso_bodega_rechazo=%s', coalesce(sum(rechazadas_cobradas), 0), coalesce(sum(suma_gestiones), 0))
  FROM k4a
UNION ALL
SELECT 'K4b cobro por tope (sinteticas)', count(*), count(*) FILTER (WHERE (nuevo = 'tope') <> (real = 'tope')),
       array_to_string((array_agg(id ORDER BY id) FILTER (WHERE (nuevo = 'tope') <> (real = 'tope')))[1:10], ' ; '),
       format('sinteticas de tope que crearia la logica nueva=%s, creadas=%s, ingreso ya cobrado por las creadas=%s',
              count(*) FILTER (WHERE nuevo = 'tope'), count(*) FILTER (WHERE real = 'tope'),
              coalesce((SELECT sum(gi.ingreso_bodega_rechazo) FROM g gi
                         WHERE gi.motivo IN (SELECT motivo_tope_viejo FROM params
                                             UNION ALL SELECT motivo_tope_nuevo FROM params)
                           AND EXISTS (SELECT 1 FROM k3 x WHERE x.orden_id = gi.orden_id AND x.real = 'tope')), 0))
  FROM k3
UNION ALL
SELECT 'K4c cobro por escalado SLA (sinteticas)', count(*), count(*) FILTER (WHERE (nuevo = 'escalar') <> (real = 'escalar')),
       array_to_string((array_agg(id ORDER BY id) FILTER (WHERE (nuevo = 'escalar') <> (real = 'escalar')))[1:10], ' ; '),
       format('escalados que crearia la logica nueva=%s, ocurridos=%s', count(*) FILTER (WHERE nuevo = 'escalar'), count(*) FILTER (WHERE real = 'escalar'))
  FROM k7b
UNION ALL
SELECT 'K5a corte: barridas con gestion pendiente', count(*), count(*) FILTER (WHERE pendiente),
       array_to_string((array_agg(id ORDER BY id) FILTER (WHERE pendiente))[1:10], ' ; '), NULL
  FROM k5a
UNION ALL
SELECT 'K5b corte: gestionadas no barridas', count(*), count(*) FILTER (WHERE situacion = 'en_mano'),
       array_to_string((array_agg(id ORDER BY id) FILTER (WHERE situacion = 'en_mano'))[1:10], ' ; '),
       format('pendientes=%s aplicadas=%s', count(*) FILTER (WHERE situacion = 'pendiente'), count(*) FILTER (WHERE situacion = 'aplicada'))
  FROM k5b
UNION ALL
SELECT 'K6 devolucion 139', count(*), count(*) FILTER (WHERE excluida IS TRUE),
       array_to_string((array_agg(id ORDER BY id) FILTER (WHERE excluida IS TRUE))[1:10], ' ; '),
       format('sin gestion rechazada vigente: %s', count(*) FILTER (WHERE excluida IS NULL))
  FROM k6
UNION ALL
SELECT 'K7a liberacion reprogramadas', count(*), count(*) FILTER (WHERE elegible IS NOT TRUE),
       array_to_string((array_agg(id ORDER BY id) FILTER (WHERE elegible IS NOT TRUE))[1:10], ' ; '), NULL
  FROM k7a
UNION ALL
SELECT 'K7b SLA devoluciones', count(*),
       count(*) FILTER (WHERE nuevo <> real OR abs(extract(epoch FROM (ancla_nueva - ancla_vieja))) > 300),
       array_to_string((array_agg(id || ' nuevo=' || nuevo || ' real=' || real ORDER BY id)
          FILTER (WHERE nuevo <> real OR abs(extract(epoch FROM (ancla_nueva - ancla_vieja))) > 300))[1:10], ' ; '),
       format('ancla movida >5 min: %s', count(*) FILTER (WHERE abs(extract(epoch FROM (ancla_nueva - ancla_vieja))) > 300))
  FROM k7b
UNION ALL
SELECT 'K8a dinero caja ingresos (42)', count(*), count(*) FILTER (WHERE difiere),
       array_to_string((array_agg(id || ' esperado=' || esperado || ' emitido=' || emitido ORDER BY id) FILTER (WHERE difiere))[1:10], ' ; '),
       format('esperado=%s emitido=%s', coalesce(sum(esperado), 0), coalesce(sum(emitido), 0))
  FROM k8a
UNION ALL
SELECT 'K8b dinero ledger tienda (43)', count(*), count(*) FILTER (WHERE difiere),
       array_to_string((array_agg(id || ' esperado=' || esperado || ' emitido=' || emitido ORDER BY id) FILTER (WHERE difiere))[1:10], ' ; '),
       format('esperado=%s emitido=%s', coalesce(sum(esperado), 0), coalesce(sum(emitido), 0))
  FROM k8b
UNION ALL
SELECT 'K8c dinero caja COD (173)', count(*), count(*) FILTER (WHERE esperado <> emitido),
       array_to_string((array_agg(id || ' esperado=' || esperado || ' emitido=' || emitido ORDER BY id) FILTER (WHERE esperado <> emitido))[1:10], ' ; '),
       format('esperado=%s emitido=%s', coalesce(sum(esperado), 0), coalesce(sum(emitido), 0))
  FROM k8c
UNION ALL
SELECT 'K8d dinero pago mensajero (44)', count(*),
       count(*) FILTER (WHERE suma_gestiones <> p OR devengo <> p OR egreso_caja <> p OR pago_efectivo <> pago_efectivo_esperado),
       array_to_string((array_agg(id || ' P=' || p || ' gestiones=' || suma_gestiones || ' devengo=' || devengo
                                   || ' efectivo=' || pago_efectivo || '/' || pago_efectivo_esperado || ' caja=' || egreso_caja ORDER BY id)
          FILTER (WHERE suma_gestiones <> p OR devengo <> p OR egreso_caja <> p OR pago_efectivo <> pago_efectivo_esperado))[1:10], ' ; '),
       format('P total=%s devengado=%s', coalesce(sum(p), 0), coalesce(sum(devengo), 0))
  FROM k8d
UNION ALL
SELECT 'K8e dinero indemnizacion (158)', count(*), count(*) FILTER (WHERE esperado <> emitido),
       array_to_string((array_agg(id || ' esperado=' || esperado || ' emitido=' || emitido ORDER BY id) FILTER (WHERE esperado <> emitido))[1:10], ' ; '),
       format('esperado=%s emitido=%s', coalesce(sum(esperado), 0), coalesce(sum(emitido), 0))
  FROM k8e
UNION ALL
SELECT 'T3.3 poblacion legada viva', count(*), NULL,
       array_to_string((array_agg(id ORDER BY id))[1:10], ' ; '),
       format('de calle=%s sinteticas=%s; entregada=%s reprogramada=%s devuelta=%s rechazada=%s incidente=%s',
              count(*) FILTER (WHERE calle), count(*) FILTER (WHERE NOT calle),
              count(*) FILTER (WHERE resultado = 'entregado'), count(*) FILTER (WHERE resultado = 'reprogramado'),
              count(*) FILTER (WHERE resultado = 'novedad'), count(*) FILTER (WHERE resultado = 'devolucion_a_origen_por_rechazo'),
              count(*) FILTER (WHERE resultado = 'incidente'))
  FROM t33;
