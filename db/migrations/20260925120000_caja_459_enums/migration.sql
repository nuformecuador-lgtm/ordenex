-- FICHA 459 (1 de 3) — los valores de enum de la caja, del libro de la tienda y del origen.
--
--   wallet_movimiento_categoria         + egreso_pago_por_cuenta_tienda (terceros, efectivo)
--                                       + ingreso_reverso_pago_por_cuenta_tienda (terceros, efectivo)
--                                       + ingreso_aporte_capital (capital, efectivo)
--                                       + egreso_reverso_aporte_capital (capital, efectivo)
--   wallet_tienda_movimiento_categoria  + pago_por_cuenta (debito)
--                                       + pago_por_cuenta_anulado (credito)
--   wallet_origen_tipo                  + pago_por_cuenta_tienda, aporte_capital,
--                                         cobro_manual_reclasificado
--
-- VA SOLA: Postgres prohibe USAR un valor de enum en la transaccion que lo añade (55P04) y Prisma
-- corre cada `migration.sql` en su propia transaccion. Los dos CHECK tipo<->categoria que NOMBRAN
-- estos valores se amplian en la migracion 3 (`20260925120200_pago_por_cuenta_y_capital`).
--
-- ADITIVA: ni tablas, ni columnas, ni datos. `IF NOT EXISTS`: reaplicarla no falla.
-- DDL tomado de `prisma migrate diff` (P3006 impide `db:migrate:create`).

ALTER TYPE "wallet_movimiento_categoria" ADD VALUE IF NOT EXISTS 'egreso_pago_por_cuenta_tienda';
ALTER TYPE "wallet_movimiento_categoria" ADD VALUE IF NOT EXISTS 'ingreso_reverso_pago_por_cuenta_tienda';
ALTER TYPE "wallet_movimiento_categoria" ADD VALUE IF NOT EXISTS 'ingreso_aporte_capital';
ALTER TYPE "wallet_movimiento_categoria" ADD VALUE IF NOT EXISTS 'egreso_reverso_aporte_capital';

ALTER TYPE "wallet_tienda_movimiento_categoria" ADD VALUE IF NOT EXISTS 'pago_por_cuenta';
ALTER TYPE "wallet_tienda_movimiento_categoria" ADD VALUE IF NOT EXISTS 'pago_por_cuenta_anulado';

ALTER TYPE "wallet_origen_tipo" ADD VALUE IF NOT EXISTS 'pago_por_cuenta_tienda';
ALTER TYPE "wallet_origen_tipo" ADD VALUE IF NOT EXISTS 'aporte_capital';
ALTER TYPE "wallet_origen_tipo" ADD VALUE IF NOT EXISTS 'cobro_manual_reclasificado';
