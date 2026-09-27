-- C458C-1 — la C457-1 de progress/contraste_457.md AMPLIADA con las categorias de la 458-B (Q458-3 de
-- design §14): los dos reversos de cargo del cobro por rechazo (`egreso_reverso_flete_devolucion`,
-- `egreso_reverso_iva_flete_devolucion`) entran en `es_cargo`, como el reverso del cobro de la 461.
-- Los creditos espejo de la tienda (`flete_devolucion_anulado`, `iva_flete_devolucion_anulado`) ya
-- entran en `suma_saldos` por su `tipo` (credito). Se espera diferencia_r8 = 0,00 y diferencia_r7 = 0,00.
-- Solo lectura.
WITH caja AS (
  SELECT categoria::text AS cat, tipo::text AS tipo, SUM(monto) AS total FROM wallet_movimiento GROUP BY 1, 2
), clas AS (
  SELECT cat, tipo, total,
         CASE WHEN cat IN ('ingreso_cod_recaudado','ingreso_reverso_pago_tienda','egreso_pago_tienda',
                           'egreso_pago_por_cuenta_tienda','ingreso_reverso_pago_por_cuenta_tienda',
                           'ingreso_abono_tienda','egreso_reverso_abono_tienda') THEN 'terceros'
              WHEN cat IN ('ingreso_aporte_capital','egreso_reverso_aporte_capital') THEN 'capital'
              ELSE 'propio' END AS dueno,
         cat IN ('ingreso_flete','ingreso_flete_devolucion','ingreso_comision_cod','ingreso_iva_flete',
                 'ingreso_iva_flete_devolucion','ingreso_iva_comision_cod',
                 'ingreso_cobro_tienda','egreso_reverso_cobro_tienda',
                 -- 458-B (Q458-3): los reversos de cargo del cobro por rechazo.
                 'egreso_reverso_flete_devolucion','egreso_reverso_iva_flete_devolucion') AS es_cargo,
         CASE WHEN tipo = 'ingreso' THEN total ELSE -total END AS con_signo
  FROM caja
), cifras AS (
  SELECT COALESCE(SUM(total) FILTER (WHERE tipo = 'ingreso' AND NOT es_cargo), 0) AS entro,
         COALESCE(SUM(total) FILTER (WHERE tipo = 'egreso'  AND NOT es_cargo), 0) AS salio,
         COALESCE(SUM(con_signo) FILTER (WHERE NOT es_cargo), 0)                  AS cifra,
         COALESCE(SUM(con_signo) FILTER (WHERE dueno = 'propio'), 0)              AS ganancia,
         COALESCE(SUM(con_signo) FILTER (WHERE dueno = 'terceros'), 0)
           - COALESCE(SUM(con_signo) FILTER (WHERE es_cargo), 0)                  AS de_tiendas,
         COALESCE(SUM(con_signo) FILTER (WHERE dueno = 'capital'), 0)             AS capital
  FROM clas
), tiendas AS (
  SELECT COALESCE(SUM(CASE WHEN tipo::text = 'credito' THEN monto ELSE -monto END), 0) AS suma_saldos
  FROM wallet_tienda_movimiento
)
SELECT c.*, t.suma_saldos,
       c.de_tiendas - t.suma_saldos                       AS diferencia_r8,
       c.cifra - (c.ganancia + c.de_tiendas + c.capital)  AS diferencia_r7
FROM cifras c CROSS JOIN tiendas t;
