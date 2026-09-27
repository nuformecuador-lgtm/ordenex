# 458 — Medición en producción (design §14)

Solo lectura, por el MCP de Supabase. Producción todavía sin la 458.

## ANTES (2026-09-26)

| Consulta | Resultado | Esperado |
|---|---|---|
| Q458-1: cobros por rechazo aprobados | **35**, flete + IVA **95.824,00**; los 35 tienen línea de caja y débito en la tienda | 35 / 95.824,00 ✓ |
| Q458-2: reversos de gasto sin motivo (se pintarán «motivo no registrado») | **0** | informativo |
| Q458-4: grupos del mismo instante con más de 20 filas | **0** | 0 ✓ |

Aviso: design §13 dice que el bucket `wallet-comprobantes` «ya existe desde la 459». **Es falso**: no existe ni en preview ni en prod (M5 de `contraste_457.md`). Se crea el día de la release (docs/release.md).

## DESPUÉS DEL DESPLIEGUE — pendiente
Q458-3 = la C457-1 (`progress/contraste_457.md`) con `es_cargo` ampliado a `egreso_reverso_flete_devolucion` y `egreso_reverso_iva_flete_devolucion`. Se espera R7 = R8 = 0,00 y la cifra principal igual a la de antes.

Se corre dos veces: **ANTES** (día de la release, paso A9 de `docs/release.md`; sin la 458-B en producción no hay
filas de los dos reversos y debe dar lo mismo que la C457-1) y **DESPUÉS** (paso C6). Anotar aquí las dos filas
completas (entro, salio, cifra, ganancia, de_tiendas, capital, suma_saldos, diferencia_r8, diferencia_r7).

## SQL Q458-3

Es la C457-1 de `progress/contraste_457.md` («SQL M8») **completa**, con **una sola** línea distinta: la lista
de `es_cargo` gana los dos reversos de cargo del cobro por rechazo de la 458-B
(`egreso_reverso_flete_devolucion`, `egreso_reverso_iva_flete_devolucion`), igual que el reverso del cobro de la
461 ya estaba. Los créditos espejo en el libro de la tienda (`flete_devolucion_anulado`,
`iva_flete_devolucion_anulado`) no necesitan nada: entran en `suma_saldos` por su `tipo` (`credito`).

**Ya ejecutada en clones:** su gemela sin las cuatro columnas informativas,
`progress/recorrido_458-C/c458c-1.sql`, dio `diferencia_r7 = diferencia_r8 = 0,00` en las 27 medidas del
recorrido de la 458-C (con la aprobación y la anulación de un cobro por rechazo de flete 1.800 + IVA 234:
ganancia −2.034, De las tiendas +2.034, cifra sin cambio), en el cierre de la 458-C, en la 458-D y en la 458-E
(`progress/recorrido_458-*/recorrido.md`). Solo lectura; se corre por el MCP de Supabase.

```sql
-- Q458-3 — la C457-1 con es_cargo ampliado a los dos reversos de cargo del cobro por rechazo (458-B).
--          Se espera diferencia_r8 = 0,00 y diferencia_r7 = 0,00, antes y despues, y la cifra igual
--          a la de la C457-1.
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
         COALESCE(SUM(con_signo) FILTER (WHERE dueno = 'capital'), 0)             AS capital,
         COALESCE(SUM(total) FILTER (WHERE cat = 'ingreso_cobro_tienda'), 0)      AS cobros_en_caja,
         COALESCE(SUM(total) FILTER (WHERE cat = 'egreso_reverso_cobro_tienda'), 0) AS cobros_anulados,
         COALESCE(SUM(total) FILTER (WHERE cat = 'ingreso_abono_tienda'), 0)      AS pagos_de_tiendas,
         COALESCE(SUM(total) FILTER (WHERE cat = 'egreso_reverso_abono_tienda'), 0) AS pagos_de_tiendas_anulados
  FROM clas
), tiendas AS (
  SELECT COALESCE(SUM(CASE WHEN tipo::text = 'credito' THEN monto ELSE -monto END), 0) AS suma_saldos
  FROM wallet_tienda_movimiento
)
SELECT c.*, t.suma_saldos,
       c.de_tiendas - t.suma_saldos                       AS diferencia_r8,   -- se espera 0,00, SIN excepcion
       c.cifra - (c.ganancia + c.de_tiendas + c.capital)  AS diferencia_r7    -- se espera 0,00
FROM cifras c CROSS JOIN tiendas t;
```

**Qué mirar además, tras la primera anulación real de un cobro por rechazo:** la ganancia baja lo anulado
(flete + IVA), `de_tiendas` y `suma_saldos` suben lo mismo, la cifra no cambia, y R7 = R8 = 0,00.
