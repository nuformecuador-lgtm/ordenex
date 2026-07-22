-- Feature 99 (T0, design §1.4/§2): dos valores NUEVOS del enum de origen del historial para
-- que la linea de tiempo distinga las transiciones del cron SLA de las devoluciones diferidas:
--   - `liberacion_devuelta_sla`: devuelta -> en_bodega/en_bodega_satelite (reintento, R15/R19)
--   - `escalado_devuelta_sla`:   devuelta -> rechazada                    (escalado,  R16/R17/R19)
-- Ambas con actor NULL (sistema/cron). El `escalado_*` enlaza la gestion sintetica `rechazada`
-- que dispara el ingreso de bodega por el snapshot de la 56 (Option A, design §3.4).
--
-- POR QUE VA SOLA (sin ningun uso del valor en la misma transaccion): Postgres NO permite USAR
-- un valor de enum recien añadido en la misma transaccion que lo añadio (error 55P04 "unsafe
-- use of new value of enum type"). Prisma Migrate corre cada migration.sql en una transaccion.
-- Aqui SOLO se añaden los valores; su primer uso ocurre en tiempo de aplicacion (el cron
-- `procesar-devueltas-sla`), en transacciones posteriores. Mismo precedente que
-- 20260716140000_rol_api_key y 20260717120000_orden_historial_origen_tipo_carga_api.
-- `IF NOT EXISTS` lo hace idempotente si se reintenta.
--
-- Aditiva: no altera ninguna tabla existente (sin RLS nueva; `orden_historial_estado`
-- conserva su RLS de la feature 49).
ALTER TYPE "orden_historial_origen_tipo" ADD VALUE IF NOT EXISTS 'liberacion_devuelta_sla';
ALTER TYPE "orden_historial_origen_tipo" ADD VALUE IF NOT EXISTS 'escalado_devuelta_sla';
