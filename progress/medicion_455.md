# 455 — T0.2 Medicion (solo lectura)

> 2026-09-24 · backend_dev · rama `feature/455-fase0` sobre `0bd66809` (dev con la 454 mergeada).
> **Produccion: PENDIENTE.** Este agente no tiene el MCP de Supabase (memoria «DATABASE_URL de prod es
> sensitive»). El SQL de abajo es de SOLO LECTURA y lo corre el leader por el MCP; aqui van los
> resultados de la base LOCAL, que sirven para validar que el SQL ejecuta y para anticipar hallazgos.
> Host local: `prisma migrate status` → `PostgreSQL database "ordenex" … at "localhost:5432"`,
> 209 migraciones, «Database schema is up to date!» (incluye M1-M3 de la 454).
> Ejecucion local: dentro de `SET TRANSACTION READ ONLY` (runner temporal, borrado).

## SQL para produccion (copiar tal cual; cada linea es una consulta)

```sql
-- (a) ordenes por cada uno de los 7 estados que la 455 renombra
SELECT os.value AS estado, count(*) FILTER (WHERE o.deleted_at IS NULL) AS vivas, count(*) AS total FROM orden o JOIN order_status os ON os.id = o.estatus_id WHERE os.value IN ('entregada','devuelta','reprogramada','por_recoger','rechazada','sin_gestionar','por_devolver') GROUP BY os.value ORDER BY os.value;
-- (a') gestiones y eventos (454) por resultado
SELECT 'gestion_orden' AS tabla, resultado::text AS resultado, count(*) AS total, count(*) FILTER (WHERE anulada_at IS NULL) AS vigentes FROM gestion_orden GROUP BY resultado UNION ALL SELECT 'orden_evento.resultado', resultado::text, count(*), NULL FROM orden_evento WHERE resultado IS NOT NULL GROUP BY resultado UNION ALL SELECT 'orden_evento.resultado_anterior', resultado_anterior::text, count(*), NULL FROM orden_evento WHERE resultado_anterior IS NOT NULL GROUP BY resultado_anterior ORDER BY 1, 2;
-- (b) toda FK a order_status (sacada de information_schema) y cuantas filas apuntan a en_fulfillment / pendiente
SELECT k.table_name, k.column_name, (xpath('/row/n/text()', query_to_xml(format('SELECT count(*) AS n FROM %I.%I WHERE %I IN (SELECT id FROM public.order_status WHERE value IN (%L, %L))', k.table_schema, k.table_name, k.column_name, 'en_fulfillment', 'pendiente'), false, true, '')))[1]::text::int AS filas_huerfanos FROM information_schema.referential_constraints rc JOIN information_schema.key_column_usage k ON k.constraint_name = rc.constraint_name AND k.constraint_schema = rc.constraint_schema JOIN information_schema.constraint_column_usage u ON u.constraint_name = rc.unique_constraint_name AND u.constraint_schema = rc.unique_constraint_schema WHERE u.table_schema = 'public' AND u.table_name = 'order_status' ORDER BY 1, 2;
-- (b') el catalogo tal cual
SELECT id, value FROM order_status ORDER BY value;
-- (c) barrido: toda columna text/varchar/json/jsonb de public con un codigo anterior como TOKEN (solo las que tienen filas)
SELECT * FROM (SELECT c.table_name, c.column_name, c.data_type, (xpath('/row/n/text()', query_to_xml(format('SELECT count(*) AS n FROM %I.%I WHERE %I::text ~ %L', c.table_schema, c.table_name, c.column_name, '(^|[^a-z_])(entregada|devuelta|reprogramada|por_recoger|rechazada|sin_gestionar|por_devolver)([^a-z_]|$)'), false, true, '')))[1]::text::int AS filas FROM information_schema.columns c JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE' WHERE c.table_schema = 'public' AND c.data_type IN ('text', 'character varying', 'json', 'jsonb') AND c.table_name <> '_prisma_migrations') s WHERE filas > 0 ORDER BY 4 DESC, 1, 2;
-- (d) audiencia del contrato (las lecturas GET por API key NO se registran en ninguna tabla: solo hay proxy de cargas)
SELECT count(*) FILTER (WHERE activa) AS webhooks_activos, count(*) AS webhooks_total FROM webhook_suscripcion;
SELECT count(DISTINCT k.id) AS keys_con_carga_30d, count(c.id) AS cargas_30d FROM api_key k JOIN carga c ON c.usuario_carga = k.usuario_id WHERE c.fecha_carga >= now() - interval '30 days';
SELECT estado::text AS estado_key, count(*) FROM api_key GROUP BY estado ORDER BY 1;
```

Nota de coste: (b) y (c) usan `query_to_xml` para contar por columna sin DDL ni funciones; son
barridos secuenciales. Produccion se vacio el 2026-08-25, el volumen es pequeño.

## Resultados en la base LOCAL (no son produccion)

| Bloque | Resultado local |
|---|---|
| (a) ordenes | `devuelta` 7 · `entregada` 18 · `por_devolver` 1 · `por_recoger` 6 · `rechazada` 1 · `reprogramada` 2 · `sin_gestionar` 5 (todas vivas) |
| (a') gestiones | `devuelta` 11 (10 vig.) · `entregada` 19 · `incidente` 4 (3) · `rechazada` 13 · `reprogramada` 16. `orden_evento.resultado`: devuelta 4, entregada 8, incidente 3, rechazada 7, reprogramada 4; `resultado_anterior`: entregada 1 |
| (b) FK a `order_status` | **5 columnas**: `analytics_daily.estatus_id` 0 · `cierre_sin_gestion.estatus_origen_id` 0 · `orden.estatus_id` 0 · `orden_historial_estado.estatus_destino_id` **47** · `orden_historial_estado.estatus_origen_id` **47** → en local M3 CONSERVARIA los dos huerfanos (R18) |
| (b') catalogo | 24 filas: los 20 vigentes + `ayuda_tienda`, `devolucion_por_confirmar` (454, conservados por historial) + `en_fulfillment`, `pendiente` |
| (c) barrido | `gestion_orden_evidencia.storage_path` 39 · `gestion_orden.evidencia_storage_path` 38 · `notificacion.descripcion` 20 · `order_status.value` 7 · `historial_accion.valor_anterior` 1 · `historial_accion.valor_nuevo` 1. **Ningun `jobs.payload`** (los jobs guardan ids) |
| (d) audiencia | 1 suscripcion de webhook activa (de 1) · 1 key con 2 cargas en 30 dias · keys: 1 activa, 1 inactiva |
| (e) nombre historico de `en_fulfillment` | **«En fulfillment»** (`git show c21a719f^:app/(app)/ordenes/_components/EstatusBadge.tsx:15`; `c21a719f` = «feat(155): retira … de la capa de presentacion»). Para `pendiente` no hay etiqueta en la historia de `EstatusBadge.tsx`; se mantiene «Pendiente» de design §1.1 |
| (f) `sin_gestionar` publicado por API | **NO**: `lib/analytics/publicacion-api-key.ts` lo EXCLUYE de `METRICAS_API_KEY` («sus granos son fecha|zona|mensajero: NO tiene grano tienda»). OJO: `ordenes_por_estado` SI se publica y agrupa por estado → revisar en T1.6/T1.8 si expone codigos |

### Hallazgos del barrido local (c) que el diseño no cubre

1. **Rutas de evidencias con el codigo del resultado**: `MisAsignacionesService.ts:695`
   (`prefijo: \`${input.resultado}-\``) y `GestionDesdeAyudaService.ts:230` (`ayuda-${input.resultado}-`)
   ponen el codigo del resultado en el nombre del objeto de Storage. Tras la 455 las evidencias nuevas
   llevaran el codigo vigente y las viejas el anterior. No es superficie visible; T1.4 debe confirmar
   que nadie PARSEA ese prefijo (en `lib/` no se encontro lector) y G1 (T1.10) debe tratar ese template.
2. `notificacion.descripcion`: textos ya emitidos (fuera de alcance por requirements).
3. `historial_accion.valor_*`: el snapshot de la 398 (R23, C16) — confirmado como unica fuente de
   codigos en texto con lector de pantalla.

## Resultados en PRODUCCIÓN (leader, MCP Supabase, solo lectura, 2026-09-24)

| Bloque | Producción |
|---|---|
| (a) órdenes | `entregada` 1745 · `devuelta` 65 · `reprogramada` 65 · `por_devolver` 61 · `rechazada` 46 · `por_recoger` 22 (18 vivas) · `sin_gestionar` 0 |
| (a') gestiones | `entregada` 1766 (1745 vig.) · `devuelta` 894 (888) · `rechazada` 744 (733) · `reprogramada` 707 (703) · `incidente` 1. `orden_evento` no existe en prod (la 454 no está desplegada). |
| (b) FK a `order_status` | las mismas 5 columnas; **0 filas** apuntan a `en_fulfillment` o `pendiente` en todas → **en prod M3 BORRA los dos huérfanos** (en local los conserva: 47 filas de historial) |
| (b') catálogo | 24 filas: 20 vigentes + `ayuda_tienda`, `devolucion_por_confirmar` (aún vivos en prod: la 454 no está desplegada) + `en_fulfillment`, `pendiente` |
| (c) barrido | `gestion_orden_evidencia.storage_path` 3821 · `gestion_orden.evidencia_storage_path` 3371 · `notificacion.descripcion` 2500 · `jobs.last_error` 136 · `order_status.value` 7 · `chat_mensaje.cuerpo` 1. Ningún JSON de vistas, jobs ni webhooks guarda códigos. |
| (d) audiencia | webhooks: **1 activa** (de 1) · API keys: **4 activas** · cargas por API key en 30 días: **0** (las lecturas GET no se registran) |

Lectura: el renombre de códigos rompe como mucho a **1 suscripción de webhook** y a quien lea por las 4 keys
activas; ninguna cargó órdenes en 30 días. Las rutas de evidencia y los textos ya emitidos (notificaciones,
chat, errores de jobs) llevan códigos viejos como texto histórico: fuera de alcance, no se reescriben.
