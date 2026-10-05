# Ficha 474 — Envíos automáticos por WhatsApp — bitácora de implementación (BACKEND)

## T0.1 — Arranque

- **SHA de partida:** `9a9e37a8` (`origin/dev`, «docs(474): spec aprobado con D1-D4»). Rama
  `feature/474-envios-automaticos-whatsapp` creada con `git checkout -B … origin/dev`;
  `git merge-base --is-ancestor 9a9e37a8 HEAD` → OK.
- **Base propia:** clon `ordenex_474` (`CREATE DATABASE ordenex_474 TEMPLATE ordenex`), `.env` del
  worktree copiado del principal cambiando SOLO el nombre de la base (gitignorado, sin imprimir la
  credencial). `prisma migrate status` → «Database schema is up to date!» antes de migrar.
- **`node_modules` propio** (`pnpm install --frozen-lockfile`, no junction): `prisma generate` de esta
  rama no pisa el cliente del árbol principal ni el de la 473.

### `job_tipo` en `origin/dev` @ 9a9e37a8 (11 valores, en orden)

`liberar_reprogramadas`, `geocodificacion`, `optimizacion_ruta`, `webhook_estado`,
`whatsapp_template_sync`, `whatsapp_chat_envio`, `analitica_rollup_diario`,
`analitica_invalidacion_cache`, `whatsapp_bienvenida`, `push_web`, `webhook_evento`.

### `NotificacionEvento` en `origin/dev` @ 9a9e37a8 (18 valores)

`orden_rechazada`, `carga_masiva_terminada`, `postulacion_mensajero_pendiente`,
`cierre_dia_por_aprobar`, `postulacion_recurso_pendiente`, `dia_reparto_corregido`,
`cierre_dia_vencido`, `mensajero_bloqueado_por_cierres`, `gasto_fijo_cobro_pendiente`,
`webhook_suscripcion_pausada`, `geocodificacion_caida`, `novedades_sin_gestionar`,
`devoluciones_represadas`, `cierre_dia_rechazado`, `reparto_manana`, `traspaso_ordenes_recibido`,
`traspaso_ordenes_cedido`, `reprogramadas_esperan_cierre`. Los mismos 18 de design §2.2: ningún
evento nuevo que declarar.

## F1 — Base de datos

| Migración | Qué |
| --- | --- |
| `20261005120000_job_tipo_whatsapp_envios` | 5 valores de `job_tipo`. `down.sql` recrea el tipo con los 11 de arriba (foto, índice parcial de la 401 incluido). |
| `20261005120100_whatsapp_envios` | 4 enums, 4 tablas, 2 columnas + 2 CHECKs en `plantilla_mensaje`, 9 índices parciales, CHECKs de forma, RLS sin policies. |
| `20261005120200_seed_whatsapp_envio_mantenimiento` | Siembra el job recurrente (próxima 09:30 UTC). `down.sql` borra las filas de ese tipo. |

Medido en `ordenex_474`:

- `prisma migrate deploy` de las tres → OK.
- `prisma migrate diff --from-config-datasource --to-schema db/schema.prisma` → «This is an empty migration».
- Los tres `down.sql` en orden inverso → OK; tras ellos `job_tipo` vuelve a los 11 valores, 0 tipos
  `whatsapp_e*`, 0 columnas nuevas en `plantilla_mensaje`, el índice parcial de la 401 existe.
- Re-deploy → OK y diff vacío otra vez.
- Siembra: 1 fila `pending` (`run_after 2026-10-06 09:30`, `dedupe_key whatsapp_envio_mantenimiento:2026-10-06`);
  re-ejecutar el `INSERT` a mano → sigue habiendo 1.
