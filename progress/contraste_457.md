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
