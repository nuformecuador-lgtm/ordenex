-- FICHA 459 (2 de 3) — el historial de acciones de los dos documentos nuevos (R53/R78).
--
--   historial_accion_tipo     + pago_por_cuenta_tienda_registrado, pago_por_cuenta_tienda_anulado,
--                               aporte_capital_registrado, aporte_capital_anulado (los cuatro
--                               «mueve dinero»)
--   historial_accion_entidad  + pago_por_cuenta_tienda, aporte_capital (1:1 con sus tablas)
--
-- ADITIVA y SOLA (55P04: ningun valor se usa en esta transaccion). `IF NOT EXISTS`.
-- El `down.sql` es DINAMICO (P12): lee `pg_enum` y quita solo estos seis valores.

ALTER TYPE "historial_accion_tipo" ADD VALUE IF NOT EXISTS 'pago_por_cuenta_tienda_registrado';
ALTER TYPE "historial_accion_tipo" ADD VALUE IF NOT EXISTS 'pago_por_cuenta_tienda_anulado';
ALTER TYPE "historial_accion_tipo" ADD VALUE IF NOT EXISTS 'aporte_capital_registrado';
ALTER TYPE "historial_accion_tipo" ADD VALUE IF NOT EXISTS 'aporte_capital_anulado';

ALTER TYPE "historial_accion_entidad" ADD VALUE IF NOT EXISTS 'pago_por_cuenta_tienda';
ALTER TYPE "historial_accion_entidad" ADD VALUE IF NOT EXISTS 'aporte_capital';
