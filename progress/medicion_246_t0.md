# Mediciones T0 de la feature 246 — 2026-08-20

> Corridas por el **leader** vía **MCP de Supabase, solo lectura**, contra producción, porque el
> subagente no tiene MCP. ⚠️ **Producción se usa hoy como entorno de PRUEBAS** (confirmado por el
> humano): estos números describen lo que el código hace, **no frecuencia operativa**.

## M6 — cuánto dinero pone en juego D7

| medida | valor |
| --- | --- |
| `premio_ranking` posición 1 | **₡5.000** |
| posiciones 2 y 3 | **NULL — sin configurar** |
| snapshots de ranking congelados (total) | **10** |
| filas de snapshot (total) | **3** |
| **filas CON podio** | **2** |
| **premio repartido, EN TODA LA HISTORIA** | **₡10.000** |

**₡10.000 en total** — dos podios de ₡5.000. Y el propio spec avisaba de cómo leer esto: **que las
posiciones 2 y 3 estén en `NULL` no significa que el premio no exista**, significa que **no están
configuradas**. Si algún día se configuran, el importe en juego se multiplica.

**Consecuencia para D7:** el cambio del denominador mueve, hoy, **una cantidad pequeña y de pruebas**.
Eso **no lo vuelve cosmético** —sigue decidiendo a quién se le paga— pero sí dice que **no hay una
urgencia de dinero** detrás, y que el riesgo del día del despliegue (el podio falso) es más caro que
el importe.

## M5 — cuánto se movería el denominador ⚠️ PROXY

**2 de 26** órdenes vivas con `asignado_at` se asignaron después de las 18:00 CR.

Es un **proxy** y hay que decirlo: la columna no existe todavía, así que esto **simula** cuántas
habrían llevado `fecha_reparto` distinta **si bodega hubiera usado el selector** — una conducta que
todavía no existe. Sirve para el orden de magnitud, **no para prometer un número**.

## M8 — el índice: **el `EXPLAIN` dice algo que el local no podía ver**

```
GroupAggregate  (cost=0.14..3.23 rows=1 width=45)
  Group Key: mensajero_asignado_id
  ->  Index Only Scan using orden_mensajero_asignado_id_asignado_at_idx on orden o
        Index Cond: ((mensajero_asignado_id IS NOT NULL)
                     AND (asignado_at >= …) AND (asignado_at < …))
```

**La consulta de HOY se sirve con un `Index Only Scan`** sobre un índice compuesto **que ya existe**
—`(mensajero_asignado_id, asignado_at)`—. Es el mejor plan posible: no toca el heap.

**Y ahí está el riesgo que ninguna de las dos mediciones anteriores veía:** el denominador nuevo
añade un `OR` sobre `fecha_reparto`, que **no está en ese índice**. Un `Index Only Scan` puede
degradarse a algo peor **no por falta de un índice nuevo, sino porque el que ya funcionaba deja de
cubrir la consulta**.

El `EXPLAIN` local del subagente probó que el predicado nuevo **es indexable** (`BitmapOr` sobre
`orden_fecha_reparto_idx`) pero que **con 67 filas el planificador prefiere `Seq Scan`** — y
producción tiene **141 órdenes vivas**, así que aquí pasaría lo mismo. **Ninguna de las dos bases
tiene volumen para que el plan de hoy prediga el de mañana.**

### Lo que esto deja decidido y lo que no

- **Decidido:** el predicado nuevo **es indexable**. No hay que rediseñarlo.
- **NO decidido por el volumen:** si el índice se crea. A esta escala el planificador no lo elegirá
  ni con índice ni sin él.
- **La pregunta que sí importa, y que el spec no había formulado:** no es «¿hace falta un índice
  nuevo?», es **«¿el `OR` rompe el `Index Only Scan` que hoy sirve esta consulta?»**. Esa se responde
  con un `EXPLAIN` de la consulta nueva **sobre una base con volumen**, y ninguna de las que tenemos
  lo tiene.

⏳ **Re-medir con volumen antes de confiar en cualquier plan.**
