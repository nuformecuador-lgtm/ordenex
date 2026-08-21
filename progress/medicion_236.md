# Medición contra producción para la feature 236 — 2026-08-19

> Hecha por el **leader** vía **MCP de Supabase, solo lectura**, antes de escribir el spec, para que
> las decisiones abiertas se firmen con números delante y no con supuestos.

## 1 · La población de `/novedades` hoy

| estatus | órdenes vivas |
| --- | --- |
| `en_bodega_central` | 56 |
| `recolectando` | 35 |
| `en_ruta_bodega_satelite` | 17 |
| `entregada` | 16 |
| `devolviendo_a_tienda` | 5 |
| `en_bodega_satelite` | 4 |
| `incidente` | 4 |
| `reprogramada` · `por_devolver_a_tienda` · `rechazada` · `devuelta_a_tienda` | 1 cada uno |
| **`devuelta`** | **0** |
| **`ayuda_tienda`** | **0** |

**141 órdenes vivas, en 11 estatus.** Los dos ceros que importan **no son de un universo vacío**:

- **`devuelta` = 0** → la pestaña «En devolución» está **vacía hoy en producción**. Tiene sentido:
  desde la **239**, una orden no entra en `devuelta` al gestionar, sino **al aprobar el cierre**, y
  el ancla es reciente.
- **`ayuda_tienda` = 0** → esperable: la **235** se mergeó hoy en `dev` y **no está desplegada**.
  Producción sale de `prod`.

## 2 · El hilo de notas nunca se ha usado en producción

| medida | valor |
| --- | --- |
| notas de orden vivas | **0** |
| órdenes con al menos una nota viva | **0** |

**Cero, con 141 órdenes vivas detrás.** La feature 227 (hilo de notas entre tienda y mensajero) está
desplegada y **nadie ha escrito una sola nota**.

## 3 · Qué le dice esto a la 236

1. **El defecto que la 236 arregla es PROSPECTIVO, no una pérdida en curso.** «La nota se escribe y
   nadie la lee» es cierto **por construcción**, pero hoy no hay ninguna nota perdida: la ayuda no se
   puede pedir en producción todavía. **La 236 no rescata datos; impide que se pierdan desde el
   primer día en que la 235 salga.** Eso no la hace menos urgente —sigue siendo la condición para
   desplegar la 235 sin dejar a la tienda a ciegas— pero sí cambia el argumento: no hay que
   backfillear nada ni recuperar nada.
2. **La pestaña nueva nace vacía**, y eso hay que diseñarlo. El estado vacío de la tercera pestaña se
   va a ver **el día uno y durante un tiempo**, así que no es un caso marginal: es el primer estado
   que la tienda va a conocer. Lo mismo vale para el hilo vacío dentro de la card.
3. **Ojo con medir el éxito por uso.** Que hoy haya 0 notas no significa que la conversación no haga
   falta: significa que **hasta ahora no había ningún flujo que la exigiera**, y la solicitud de
   ayuda de la 235 es el primero que hace la nota **obligatoria**. El primer dato real llegará con el
   despliegue.

⏳ **Esta foto caduca.** Se toma antes de que la 235 llegue a producción; en cuanto llegue, los dos
ceros dejan de serlo. **Re-medir antes de desplegar la 236**, no antes de mergearla.

## 4 · Las consultas, para poder repetirlas

```sql
-- Población por estatus (el denominador que hace no-vacuos los ceros)
SELECT s."value", count(*) FROM "orden" o
  JOIN "order_status" s ON s."id" = o."estatus_id"
 WHERE o."deleted_at" IS NULL GROUP BY s."value" ORDER BY count(*) DESC;

-- El hilo de notas
SELECT count(*) AS notas_vivas FROM "orden_nota" WHERE "deleted_at" IS NULL;
SELECT count(DISTINCT "orden_id") AS ordenes_con_nota FROM "orden_nota" WHERE "deleted_at" IS NULL;
```
