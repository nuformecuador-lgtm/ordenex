-- FICHA 458-B (1 de 2) — los valores de enum de la ANULACION del cobro por rechazo aprobado y de la
-- anulacion con motivo de un egreso de caja (design §2.1).
--
--   wallet_movimiento_categoria         + egreso_reverso_flete_devolucion      (reverso del CARGO del flete por rechazo)
--                                       + egreso_reverso_iva_flete_devolucion  (reverso del CARGO de su IVA)
--   wallet_tienda_movimiento_categoria  + flete_devolucion_anulado             (credito espejo: le devuelve el flete a la tienda)
--                                       + iva_flete_devolucion_anulado         (credito espejo: le devuelve el IVA)
--   historial_accion_tipo               + cobro_rechazo_tienda_anulado         (mueve dinero)
--                                       + egreso_caja_anulado                  (mueve dinero; D13: el de la 461,
--                                         `wallet_movimiento_manual_anulado`, dice «corrección de caja» y no
--                                         sirve para un sueldo, un gasto o una indemnizacion)
--
-- VA SOLA: Postgres prohibe USAR un valor de enum en la transaccion que lo añade (55P04) y Prisma
-- corre cada `migration.sql` en su propia transaccion. Los dos CHECK tipo<->categoria que NOMBRAN
-- estos valores y las tablas laterales van en la migracion 2 (`20260928120100_wallet_458_tablas`).
--
-- ADITIVA (R89): ni tablas, ni columnas, ni datos. `IF NOT EXISTS`: reaplicarla no falla.
-- A mano: `db:migrate:create` falla con P3006 en este repo.

ALTER TYPE "wallet_movimiento_categoria" ADD VALUE IF NOT EXISTS 'egreso_reverso_flete_devolucion';
ALTER TYPE "wallet_movimiento_categoria" ADD VALUE IF NOT EXISTS 'egreso_reverso_iva_flete_devolucion';

ALTER TYPE "wallet_tienda_movimiento_categoria" ADD VALUE IF NOT EXISTS 'flete_devolucion_anulado';
ALTER TYPE "wallet_tienda_movimiento_categoria" ADD VALUE IF NOT EXISTS 'iva_flete_devolucion_anulado';

ALTER TYPE "historial_accion_tipo" ADD VALUE IF NOT EXISTS 'cobro_rechazo_tienda_anulado';
ALTER TYPE "historial_accion_tipo" ADD VALUE IF NOT EXISTS 'egreso_caja_anulado';
