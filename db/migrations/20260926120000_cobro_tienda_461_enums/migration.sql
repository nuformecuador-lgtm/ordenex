-- FICHA 461 (1 de 3) — los valores de enum del cobro de Ordenex a una tienda y de su anulacion.
--
--   wallet_movimiento_categoria         + ingreso_cobro_tienda (propio, CARGO a una tienda)
--                                       + egreso_reverso_cobro_tienda (propio, REVERSO de un cargo)
--   wallet_tienda_movimiento_categoria  + cobro_tienda_anulado (credito)
--   wallet_origen_tipo                  + cobro_tienda (las filas del servicio: cargo, reverso, credito)
--                                       + cobro_tienda_completado (las lineas de caja del backfill)
--   historial_accion_tipo               + cobro_tienda_anulado
--
-- VA SOLA: Postgres prohibe USAR un valor de enum en la transaccion que lo añade (55P04) y Prisma
-- corre cada `migration.sql` en su propia transaccion. Los dos CHECK tipo<->categoria que NOMBRAN
-- estos valores y la tabla de anulacion van en la migracion 2
-- (`20260926120100_cobro_tienda_461_anulacion_y_checks`); el backfill de los cobros previos, en la 3.
--
-- ADITIVA: ni tablas, ni columnas, ni datos. `IF NOT EXISTS`: reaplicarla no falla.
-- DDL tomado de `prisma migrate diff --from-config-datasource --to-schema db/schema.prisma --script`
-- sobre el clon `ordenex_461` (P3006 impide `db:migrate:create`).

ALTER TYPE "wallet_movimiento_categoria" ADD VALUE IF NOT EXISTS 'ingreso_cobro_tienda';
ALTER TYPE "wallet_movimiento_categoria" ADD VALUE IF NOT EXISTS 'egreso_reverso_cobro_tienda';

ALTER TYPE "wallet_tienda_movimiento_categoria" ADD VALUE IF NOT EXISTS 'cobro_tienda_anulado';

ALTER TYPE "wallet_origen_tipo" ADD VALUE IF NOT EXISTS 'cobro_tienda';
ALTER TYPE "wallet_origen_tipo" ADD VALUE IF NOT EXISTS 'cobro_tienda_completado';

ALTER TYPE "historial_accion_tipo" ADD VALUE IF NOT EXISTS 'cobro_tienda_anulado';
