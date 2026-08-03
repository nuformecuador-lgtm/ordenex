-- Feature 173 (T A.1, R49/R50) — la caja principal pasa a modo TESORERIA: el libro
-- `wallet_movimiento` gana los DOS conceptos de dinero de TERCEROS, el que solo PASA por la
-- caja (design §2.1):
--   1) `ingreso_cod_recaudado`: el contra-entrega recaudado ENTRA al aprobar el cierre del dia.
--   2) `ingreso_reverso_pago_tienda`: anular un pago a una tienda DEVUELVE el dinero a la caja.
--
-- Por que son DOS y no uno (design §2.1 / §10-C): el reflejo era reusar `ingreso_ajuste` para
-- el reverso, que es lo que ya hace `reversarEgreso`. Seria un error caro: `ingreso_ajuste` es
-- de naturaleza PROPIA, asi que anular un pago a una tienda AUMENTARIA la ganancia de Ordenex
-- por el monto anulado. Con un valor propio, la anulacion devuelve el dinero a la caja y NO
-- roza la ganancia (R26).
--
-- `egreso_pago_tienda` YA existe (reservado desde la 42) y no necesita migracion: solo pasa a
-- tener emisor (tanda C).
--
-- Patron "enum-existente" (features 41/45/67/158): `ALTER TYPE ... ADD VALUE` no puede correr
-- en la misma transaccion que USE el valor; aqui NADIE lo usa (solo se anaden), asi que es
-- seguro. El `IF NOT EXISTS` lo hace idempotente si se reintenta.
--
-- ADITIVA: no renombra, no reordena y no borra ningun valor previo del enum, no altera filas
-- existentes (sin INSERT/UPDATE/DELETE) y no toca indices en el UP.
--
-- RLS: NO hay tabla nueva -> NO hay superficie RLS nueva. `wallet_movimiento` ya tiene RLS
-- habilitada sin policies (solo service role) desde 20260712160000 y sigue exactamente igual.
-- Esta migracion NO toca RLS ni policies (precedente identico: 20260730120000).

-- 1) El contra-entrega recaudado, como INGRESO de terceros de la caja principal (R11).
ALTER TYPE "wallet_movimiento_categoria" ADD VALUE IF NOT EXISTS 'ingreso_cod_recaudado';

-- 2) El reverso del pago a tienda, como INGRESO de terceros (R24/R26). NUNCA `ingreso_ajuste`.
ALTER TYPE "wallet_movimiento_categoria" ADD VALUE IF NOT EXISTS 'ingreso_reverso_pago_tienda';
