# 457 — Medición en producción (leader, MCP Supabase, solo lectura, 2026-09-24)

| # | Resultado |
|---|---|
| M1 | Una sola tienda en contra: **Nuform, activa, saldo −6.170.666,55** (1.285 movimientos). |
| M2 | Nuform: `cod_recaudado` 152 filas ₡27.196.819,00 · `cobro_manual` **203 filas ₡25.769.034,50** · flete 4.114.400 · comision_cod 951.889,84 · flete_devolucion 1.658.000 · iva_flete 534.872 · iva_comision_cod 123.749,21 · iva_flete_devolucion 215.540. |
| M3 | Enums: `wallet_tienda_movimiento_categoria` 11 valores (…, `pago_tienda`, `ajuste_credito`, `ajuste_debito`, `cobro_manual`); `wallet_movimiento_categoria` 17 (último `ingreso_reverso_pago_tienda`); `wallet_origen_tipo` 8 (último `ranking_snapshot_fila`); `historial_accion_tipo` 52 (último `cierre_dia_gestion_corregida`); `historial_accion_entidad` 21 (último `wallet_tienda_movimiento`). |
| M4 | CHECK tienda: crédito ∈ {cod_recaudado, ajuste_credito}; débito ∈ {flete, flete_devolucion, comision_cod, iva_flete, iva_flete_devolucion, iva_comision_cod, pago_tienda, ajuste_debito, cobro_manual}. CHECK caja: ingreso ∈ {7 ingresos + ingreso_cod_recaudado + ingreso_reverso_pago_tienda}; egreso ∈ {pago_tienda, pago_mensajero, gasto, sueldo, ajuste, gasto_fijo, gasto_variable, indemnizacion}. |
| M5 | Buckets: `etiquetas-guia`, `gestion-evidencias`, `mensajero-docs`, todos privados, sin límite de tamaño ni MIME. **Ninguna migración crea buckets** (se crearon a mano). |
| M6 | Línea base caja: cod 29.059.224,00 · flete 4.372.000 · comision 1.017.074,04 · flete_dev 1.753.200 · iva_flete 568.360 · iva_comision 132.223,43 · iva_flete_dev 227.916 · egresos: sueldo 8.871.709 · pago_mensajero 3.439.700 · gasto_variable 165.000 · indemnizacion 1,00. Libro tienda: cobro_manual 203 / 25.769.034,50; cod 203 / 29.059.224,00. |
| M7 | `liquidacion_pago` hacia tiendas: **0** (nunca se ha registrado un pago a tienda en la app). `abono_tienda` no existe. |

## HALLAZGO DE DINERO (para decidir con el humano)

Los 203 `cobro_manual` de Nuform **no son cobros de Ordenex**: son pagos que Ordenex hizo **por cuenta de
Nuform** con su dinero de contra-entrega. Por la primera palabra de la descripción: 200 empiezan por «pago»
(₡24.904.801,30), 1 «abono» (453.000), 1 «compra» (400.000), 1 «facebook» (11.233,20). Los mayores:
«PAGO SALARIO DANIEL MARIN NUFORM» 1.000.000, «PAGO SALARIO RICARDO NUFORM» 1.000.000, «Pago importación
Jet Cargo» 943.400, «PAGO FACEBOOK» 825.391,80, «PAGO TIK TOK» 560.558,34. Del 2026-09-08 al 2026-09-23.

Consecuencias:
1. El **saldo de la tienda** es correcto: Nuform recibió en pagos por su cuenta ₡6,17 M más de lo que le
   correspondía, y por eso debe. La 457 sigue siendo la pieza correcta para que lo devuelva.
2. La **caja NO lo refleja**: `cobro_manual` no escribe en la caja (D1 de la 381), así que esos
   ₡25,77 M salieron físicamente sin ningún egreso. «Dinero en caja» y «De terceros» están inflados en esa
   cantidad, salvo que esos pagos se hicieran desde una cuenta que no es la caja (a confirmar con el humano).
3. Falta un tipo de movimiento: **«Pago por cuenta de una tienda»** (sale dinero de terceros de la caja,
   baja el saldo de la tienda, con beneficiario libre: «Facebook», «Jet Cargo»…). Va al catálogo de la 458.

## Decisión del humano sobre los 203 (2026-09-24)
«Salieron de la cuenta de Ordenex, y si no estoy mal todos para Nuform». Se aprueban los 203 para reclasificar
como «Pago por cuenta de una tienda» (Nuform) con su egreso de caja en la `fecha_movimiento` original. Lista:
`progress/459_reclasificacion_aprobada.csv` (solo id, fecha y monto; sacada de producción; 203 filas, 203 ids,
total 25.769.034,50, comprobado). Queda ANOTADO como a confirmar: los servicios tecnológicos (Vercel, OpenAI,
Atlassian, Incognition, Effisystems, Zadarma) podrían ser de Ordenex; si se confirma, se corrige con un movimiento
nuevo, sin borrar nada.
