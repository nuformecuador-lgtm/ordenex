# Bitácora — feature 262 · corregir el día de reparto de una orden ya asignada

## B0.1 — M1 y M2 contra producción (2026-08-22, **04:27 hora CR**)

Corridas por el leader con el MCP de Supabase, **sólo lectura**. Los números se escriben; no se
resumen como «son pocas».

### M1 — órdenes con `fecha_reparto` posterior al día CR en curso, **sin acotar estado**

```sql
SELECT os.value AS estado, count(*)
FROM orden o JOIN order_status os ON os.id = o.estatus_id
WHERE o.fecha_reparto > (now() AT TIME ZONE 'America/Costa_Rica')::date
GROUP BY os.value;
```

**Resultado: 0 filas. Ninguna orden, en ningún estado.**

Esto **cierra la duda que el spec planteaba**: la M1 de la feature 261 midió 2 el 2026-08-21 pero
estaba acotada a `en_reparto`/`ayuda_tienda`, y `por_recoger` —el caso principal de esta ficha—
quedaba fuera. Medido ahora sin ningún filtro de estado: sigue siendo 0.

Por qué es 0 y no porque el riesgo no exista: las dos órdenes que M1 contó el 21 (guías 17496963 y
57998428) **llegaron a su día** y hoy tienen `fecha_reparto` = 2026-08-22.

### M2 — órdenes **con** mensajero y **sin** día

**Resultado: 35 órdenes.** Repartidas así:

| estado | órdenes |
| --- | --- |
| `entregada` | 17 |
| `devolviendo_a_tienda` | 5 |
| `incidente` | 3 |
| `en_bodega_central` | 3 |
| `reprogramada` | 2 |
| `devuelta_a_tienda` | 2 |
| `por_devolver_a_tienda` | 2 |
| `devuelta` | 1 |

⚠️ **35 parece un número grande, y por eso hay que mirar el desglose antes de re-abrir nada.**
**Ninguna de las 35 está en `por_recoger` ni en `en_reparto`**: todas están en estados donde el día
de reparto ya no decide nada —entregadas, en devolución o en bodega—. Son exactamente los estados
que **R6 excluye**. Es decir: no son órdenes que esta feature vaya a dejar sin corregir; son órdenes
a las que la corrección no les aplica.

**Conclusión: D3' NO se re-abre.** La condición del spec era «si M2 devuelve un número grande»,
entendido como órdenes que la operación necesitaría tocar y no podría. Esas son 0.

### M2b — comparación: con mensajero y **con** día

**9 órdenes**: `sin_gestionar` (4), `en_reparto` (2), `devolucion_por_confirmar` (1),
`entregada` (1), `reprogramada` (1).

Total con mensajero: **44** = 35 + 9. Los números cuadran.

### Límite de estas mediciones, dicho y no rodeado

Ahora mismo **no hay ninguna orden en `por_recoger` con mensajero asignado**, ni con día ni sin él.
O sea que el estado que esta ficha tiene como caso principal está hoy **vacío en producción**, y las
mediciones no pueden decir nada sobre él más allá de que no hay nada pendiente. El universo vivo es
pequeño (9 órdenes con día), así que estos números describen una operación en calma, no una carga
representativa. **B0.2 vuelve a medir M1 justo antes de desplegar**, que para eso está.
