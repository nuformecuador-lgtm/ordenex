# Feature 318 — T0: volumen real de las dos tablas del chat

> Medición del **2026-08-28**, hecha por el BACKEND_DEV como parte del bloque 1.
> Este archivo es la materia prima de T0; el leader lo consolida en `progress/impl_318.md`.

## Dónde se midió, y qué NO es

- **Base:** `postgresql://localhost:5432/ordenex` (`DATABASE_URL` de `.env`),
  PostgreSQL 16.1, `current_database() = ordenex`, `inet_server_addr() = ::1/128`.
- **Método:** cliente `pg` (`node_modules/.pnpm/pg@8.22.0`) desde un script `.mjs`
  efímero en la raíz del repo, borrado tras la corrida. Cuatro consultas, sin escrituras.
- **LÍMITE DECLARADO, no descubierto:** esto es la base **LOCAL de desarrollo**, con datos
  sembrados. La base de la que vive el producto está en **Supabase** y `.env` **no** trae
  su connection string (`DIRECT_URL` está vacía), así que **estos cuatro números no son el
  volumen de producción** y no se deben citar como tal. Lo que sí sostienen es la decisión
  (b) de T0 —dimensionar los datos de prueba de T3.2— y la comprobación de que la consulta
  del listado devuelve lo que se espera sobre datos reales.

## Los cuatro números

| # | Qué | Valor |
| --- | --- | --- |
| 1 | Filas de `chat_conversacion` | **7** |
| 2 | Filas de `chat_mensaje` | **41** |
| 3 | Grupos `(orden_id, mensajero_id)` — la UNIDAD del hilo (R42) | **5** |
| 4 | Grupos que fusionan **más de un teléfono** (R43) | **2** |

Contexto adicional medido en la misma pasada (no pedido por T0, útil para T3.2 y para el
tamaño de página): mensajes por grupo **máx. 14**, **media 8,20**.

## SQL exacto usado

```sql
-- 1
SELECT count(*)::int AS n FROM chat_conversacion;

-- 2
SELECT count(*)::int AS n FROM chat_mensaje;

-- 3
SELECT count(*)::int AS n
FROM (SELECT orden_id, mensajero_id
      FROM chat_conversacion
      GROUP BY orden_id, mensajero_id) g;

-- 4
SELECT count(*)::int AS n
FROM (SELECT orden_id, mensajero_id
      FROM chat_conversacion
      GROUP BY orden_id, mensajero_id
      HAVING count(DISTINCT telefono_e164) > 1) g;

-- contexto: mensajes por grupo
SELECT max(t)::int AS max_msgs, round(avg(t), 2) AS avg_msgs
FROM (SELECT sum(x.n) AS t
      FROM chat_conversacion c
      CROSS JOIN LATERAL (SELECT count(*) n FROM chat_mensaje m WHERE m.conversacion_id = c.id) x
      GROUP BY c.orden_id, c.mensajero_id) g;
```

## Qué decide, y qué NO

- **(a) Tamaño de página del listado (`limite`, R13).** Con 5 grupos en local no hay señal
  para mover el default de **25** que fija `design.md` §2.2. Se **mantiene 25 / máx 50**:
  el número no se toca por una medición que no es la del volumen real, y el diseño ya acota
  el coste por la vía que sí depende de nosotros (cero mensajes en la respuesta, R41).
- **(b) La fusión de teléfonos NO es un caso raro:** **2 de 5 grupos (40 %)** fusionan más
  de un teléfono en esta base. Los datos de prueba de T3.2 deben tratar la fusión como el
  caso NORMAL, no como una frontera exótica — el `GROUP BY (orden_id, mensajero_id)` y el
  desempate por `id` (R20/R42) se ejercitan en cuanto hay datos.
- **NO decide si se migra.** A6 está descartada por decisión humana (P2) y R27 lo prohíbe.
  Esta medición es para saber con qué números se vive, nada más.
