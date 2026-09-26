# 457 — Medición en producción (design §14, R78)

Solo lectura, por el MCP de Supabase. Producción todavía SIN la 459/461 (los catálogos M3/M4 de la
release salen de `dev`, no de aquí).

## ANTES (2026-09-25, tarde)

| Medida | Valor |
|---|---|
| M1 tiendas en contra | solo **Nuform**: **−5.511.224,88** (1.336 movimientos; el 2026-09-24 era −6.170.666,55, la diferencia es operación normal) |
| M2 Nuform por concepto | cod_recaudado +28.197.785,00 · cobro_manual −25.769.034,50 (203) · flete −4.276.400,00 · flete_devolucion −1.763.200,00 · comision_cod −986.923,68 · iva_flete −555.932,00 · iva_flete_devolucion −229.216,00 · iva_comision_cod −128.303,70 → cuadra al céntimo con M1 |
| M5 bucket `wallet-comprobantes` | **no existe** (lo crea el paso de la 459 el día de la release) |
| M7 `abono_tienda` | no existe · pagos a tienda en `liquidacion_pago`: 0 |
| M6 (conteo) | caja 1.347 filas · libro de tiendas 1.666 filas |

## DESPUÉS DEL DESPLIEGUE — pendiente
Esperado: M6 idéntico; M8 (C461-1) con R7 y R8 en 0,00; M3 25/16/14/63/24; RLS `t,t` en las dos tablas.

## SQL M8 para después del despliegue

**Por qué no la C461-1 literal (F1 del recorrido, `progress/recorrido_457.md`):** la C461-1
(`specs/461-…/design.md` §13) lista a mano las categorías de terceros y no conoce
`ingreso_abono_tienda` ni `egreso_reverso_abono_tienda`, así que las cuenta como «propio»: la ganancia
sube con cada pago de una tienda y `diferencia_r8` sale en −Σ pagos vigentes, aunque la app cuadre (la
tarjeta clasifica bien, `lib/utils/caja-tesoreria.ts` `NATURALEZA_POR_CATEGORIA`). La C457-1 es la
C461-1 con esas dos categorías en TERCEROS (design §4, DH1) y dos columnas informativas más (Σ pagos y
Σ anulados). Es la que manda `design.md` §14 M8. Solo lectura; se corre por el MCP de Supabase.

```sql
-- C457-1 — la caja con la formula de la 461 + las dos categorias de la 457 como TERCEROS.
--          Se espera diferencia_r8 = 0,00 y diferencia_r7 = 0,00, antes y despues.
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
                 'ingreso_cobro_tienda','egreso_reverso_cobro_tienda') AS es_cargo,
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

**Comprobada en un clon local (`ordenex_457c`, `TEMPLATE ordenex` + `prisma migrate deploy`,
2026-09-26)**, por las actions reales (`registrarCobroTiendaAction`, `registrarAbonoTiendaAction`,
`anularAbonoTiendaAction`) con la tienda Tania, el archivo de arriba ejecutado tal cual y la C461-1
literal derivada de él quitando SOLO esa línea (script de un solo uso, fuera del árbol):

| Paso | C461-1 literal: ganancia · de_tiendas · R8 | C457-1: ganancia · de_tiendas · suma_saldos · **R8** · R7 |
| --- | --- | --- |
| 0 base | 13.346.262,62 · 137.670,10 · 0,00 | 13.346.262,62 · 137.670,10 · 137.670,10 · **0,00** · 0,00 |
| 1 cobro de 147.670,10 (deja la tienda en −10.000) | 13.493.932,72 · −10.000,00 · 0,00 | 13.493.932,72 · −10.000,00 · −10.000,00 · **0,00** · 0,00 |
| 2 pago de la tienda, 4.000 (SINPE) | 13.497.932,72 · −10.000,00 · **−4.000,00** | 13.493.932,72 · −6.000,00 · −6.000,00 · **0,00** · 0,00 |
| 3 anulación de ese pago | 13.493.932,72 · −10.000,00 · 0,00 | 13.493.932,72 · −10.000,00 · −10.000,00 · **0,00** · 0,00 |
| 4 segundo pago vigente, 4.000 (efectivo) | 13.497.932,72 · −10.000,00 · **−4.000,00** | 13.493.932,72 · −6.000,00 · −6.000,00 · **0,00** · 0,00 |

Con la C457-1, cada pago mueve entro +4.000, cifra +4.000, de_tiendas +4.000, suma_saldos +4.000;
ganancia y capital no cambian. La literal solo «cuadra» cuando cada pago tiene su anulación (paso 3):
por eso una medición en producción con pagos vigentes saldría roja con ella.

**Qué hacer en producción tras desplegar:** correr la C457-1 (NO la C461-1) y anotar aquí sus cifras;
se espera `diferencia_r8 = 0,00` y `diferencia_r7 = 0,00`. Tras el primer pago real de Nuform, repetirla:
`pagos_de_tiendas` = el monto, de_tiendas y suma_saldos subidos en él, ganancia igual.
