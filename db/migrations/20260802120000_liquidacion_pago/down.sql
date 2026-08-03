-- DOWN (R64) — revierte EXACTAMENTE migration.sql, en ORDEN INVERSO.
--
-- 1) Las dos tablas nuevas, primero `liquidacion_anulacion` porque su FK `pago_id` apunta a
--    `liquidacion_pago`: al reves, el DROP fallaria. `DROP TABLE` arrastra su PK, su UNIQUE
--    (`pago_id`), sus FK y su RLS; el de `liquidacion_pago` arrastra ademas el UNIQUE de
--    `clave_idempotencia`, los 3 indices, las 4 FK y los 3 CHECK (beneficiario XOR, cierre sii
--    mensajero, monto > 0).
-- 2) Los DOS `DROP CONSTRAINT` de los libros: los CHECK tipo<->categoria son lo unico que esta
--    migracion anadio a tablas PREEXISTENTES, y quitarlos las devuelve exactamente al estado
--    anterior (no se reescribio ni una fila).
--
-- NO toca ningun enum, porque la migracion no creo ninguno ni anadio ningun valor a los
-- existentes (§2.1). Ese es justo el motivo por el que ningun down.sql previo se ha tocado.
DROP TABLE IF EXISTS "liquidacion_anulacion";
DROP TABLE IF EXISTS "liquidacion_pago";

ALTER TABLE "pago_mensajero_movimiento" DROP CONSTRAINT IF EXISTS "pago_mensajero_movimiento_tipo_categoria_check";
ALTER TABLE "wallet_tienda_movimiento" DROP CONSTRAINT IF EXISTS "wallet_tienda_movimiento_tipo_categoria_check";
