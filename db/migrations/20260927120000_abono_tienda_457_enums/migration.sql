-- FICHA 457 (1 de 2) — los valores de enum del PAGO DE UNA TIENDA A ORDENEX (`abono_tienda`) y de su
-- anulacion (design §3.3).
--
--   wallet_movimiento_categoria         + ingreso_abono_tienda (TERCEROS, EFECTIVO: entra dinero de la tienda)
--                                       + egreso_reverso_abono_tienda (terceros, efectivo: la anulacion lo devuelve)
--   wallet_tienda_movimiento_categoria  + abono_tienda (credito: el saldo de la tienda sube)
--                                       + abono_tienda_anulado (debito: vuelve a deber)
--   wallet_origen_tipo                  + abono_tienda (las cuatro filas de los dos libros; origen_id = id del documento)
--   historial_accion_tipo               + abono_tienda_registrado, abono_tienda_anulado (los dos «mueve dinero»)
--   historial_accion_entidad            + abono_tienda (1:1 con la tabla)
--
-- VA SOLA: Postgres prohibe USAR un valor de enum en la transaccion que lo añade (55P04) y Prisma
-- corre cada `migration.sql` en su propia transaccion. Las dos tablas y los dos CHECK tipo<->categoria
-- que NOMBRAN estos valores van en la migracion 2 (`20260927120100_abono_tienda_457_tablas_y_checks`).
--
-- ADITIVA: ni tablas, ni columnas, ni datos. `IF NOT EXISTS`: reaplicarla no falla.
-- DDL tomado de `prisma migrate diff --from-config-datasource --to-schema db/schema.prisma --script`
-- sobre el clon `ordenex_457` (P3006 impide `db:migrate:create`).

ALTER TYPE "wallet_movimiento_categoria" ADD VALUE IF NOT EXISTS 'ingreso_abono_tienda';
ALTER TYPE "wallet_movimiento_categoria" ADD VALUE IF NOT EXISTS 'egreso_reverso_abono_tienda';

ALTER TYPE "wallet_tienda_movimiento_categoria" ADD VALUE IF NOT EXISTS 'abono_tienda';
ALTER TYPE "wallet_tienda_movimiento_categoria" ADD VALUE IF NOT EXISTS 'abono_tienda_anulado';

ALTER TYPE "wallet_origen_tipo" ADD VALUE IF NOT EXISTS 'abono_tienda';

ALTER TYPE "historial_accion_tipo" ADD VALUE IF NOT EXISTS 'abono_tienda_registrado';
ALTER TYPE "historial_accion_tipo" ADD VALUE IF NOT EXISTS 'abono_tienda_anulado';

ALTER TYPE "historial_accion_entidad" ADD VALUE IF NOT EXISTS 'abono_tienda';
