# Ficha 468 — medición T1 en producción (2026-10-02, solo lectura por el MCP de Supabase)

| Qué | Movimientos | Cuadran | Total libro | Total gestiones |
| --- | --- | --- | --- | --- |
| Caja `ingreso_cod_recaudado` vs Σ `gestion_orden.monto_recibido` del cierre | 206 | 206 | 39.506.131,00 | 39.506.131,00 |
| Caja `egreso_pago_mensajero` vs Σ `gestion_orden.pago_mensajero` | 207 | 207 | 4.576.100,00 | 4.576.100,00 |
| Caja `egreso_indemnizacion` vs Σ `gestion_orden.indemnizacion` | 1 | 1 | 1,00 | 1,00 |
| Mensajero `pago_devengado` vs Σ `gestion_orden.pago_mensajero` (design §9.2 consulta 1) | 208 | 208 | 4.604.100,00 | 4.604.100,00 |
| Tienda `cod_recaudado` vs Σ `monto_recibido` por `cierre_detail.tienda_id` (§9.2 consulta 2) | 329 | 329 | 39.815.939,00 | 39.815.939,00 |

Cierres de mensajero sin gestiones: 0. Los seis conceptos del feed (flete, IVA, comisión) se miden tras desplegar (T16).
