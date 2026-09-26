-- FICHA 461 (4 de 6 — hallazgos de la auditoria de la wallet, D3) — el valor de enum del historial
-- para ANULAR una correccion de caja.
--
--   historial_accion_tipo  + wallet_movimiento_manual_anulado   (R69; «mueve dinero»)
--
-- VA SOLA por el mismo motivo que la migracion 1 de esta ficha: Postgres prohibe USAR un valor de
-- enum en la transaccion que lo añade (55P04) y Prisma corre cada `migration.sql` en su propia
-- transaccion. La tabla de la anulacion y las claves de idempotencia van en la migracion 5
-- (`20260926120400_wallet_461_idempotencia_y_anulacion_correccion`); el backfill de fechas, en la 6.
--
-- ADITIVA: ni tablas, ni columnas, ni datos. `IF NOT EXISTS`: reaplicarla no falla.
-- DDL tomado de `prisma migrate diff --from-config-datasource --to-schema db/schema.prisma --script`
-- sobre el clon `ordenex_461`.

ALTER TYPE "historial_accion_tipo" ADD VALUE IF NOT EXISTS 'wallet_movimiento_manual_anulado';
