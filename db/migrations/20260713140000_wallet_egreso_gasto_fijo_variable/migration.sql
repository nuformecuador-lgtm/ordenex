-- Feature 45 (R21): extiende el enum `wallet_movimiento_categoria` de forma ADITIVA con
-- los dos conceptos de egreso administrativo que faltan:
--   egreso_gasto_fijo     -> gasto fijo (lo EMITE el cron mensual, no el form manual)
--   egreso_gasto_variable -> gasto variable (registro manual del maestro)
-- `egreso_sueldo` YA existe (reservado en la 42) -> se reutiliza para sueldos (manual).
--
-- Patron "enum-existente" (feature 41 `cierre_estado_vencido`, features 17/30/36):
-- ALTER TYPE ... ADD VALUE no puede correr en la misma transaccion que USE el valor;
-- aqui NADIE lo usa en esta migracion (solo se anaden), asi que es seguro. El
-- IF NOT EXISTS lo hace idempotente si se reintenta.
-- Migracion ADITIVA: no altera filas ni valores existentes; no toca RLS ni indices.
ALTER TYPE "wallet_movimiento_categoria" ADD VALUE IF NOT EXISTS 'egreso_gasto_fijo';
ALTER TYPE "wallet_movimiento_categoria" ADD VALUE IF NOT EXISTS 'egreso_gasto_variable';
