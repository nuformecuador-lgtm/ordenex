-- Feature 109 (T0.4, R3): agrega los DOS valores nuevos de origen del historial de estados,
-- para que la linea de tiempo distinga la transicion del CORTE (`en_reparto -> sin_gestionar`,
-- actor null/cron) y la LIBERACION al aprobar (`sin_gestionar -> en_bodega/en_bodega_satelite`,
-- actor admin) de cualquier otra transicion. Patron EXACTO de
-- `20260722130000_cancelacion_api_por_key/migration.sql`.
--
-- POR QUE VA SOLA (sin ningun uso de los valores en la misma transaccion): Postgres NO permite
-- USAR un valor de enum recien añadido en la misma transaccion que lo añadio (error 55P04
-- "unsafe use of new value of enum type"). Prisma Migrate corre cada migration.sql en una
-- transaccion. Aqui SOLO se añaden los valores; su primer uso ocurre en transacciones
-- posteriores (runtime: el corte diario y la aprobacion del cierre). `IF NOT EXISTS` los hace
-- idempotentes si se reintenta. Mismo precedente que la 99/100/106.
--
-- ADITIVA: no altera ninguna tabla existente (sin RLS nueva; `orden_historial_estado` conserva
-- su RLS de la feature 49). NO migra el enum `cierre_estado` (el modelo reusa sus 4 valores).
ALTER TYPE "orden_historial_origen_tipo" ADD VALUE IF NOT EXISTS 'corte_sin_gestionar';
ALTER TYPE "orden_historial_origen_tipo" ADD VALUE IF NOT EXISTS 'liberacion_sin_gestionar';
