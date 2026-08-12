-- DOWN (R49) — revierte EXACTAMENTE `migration.sql`, en ORDEN INVERSO.
--
-- EL ORDEN NO ES COSMETICO. Primero se suelta la COLUMNA de `liquidacion_pago` y despues la
-- tabla: `reparto_id` tiene una FK hacia `liquidacion_reparto`, asi que al reves el
-- `DROP TABLE` fallaria por la dependencia. `CASCADE` no se usa a proposito — si algun dia
-- existiera una dependencia no prevista, lo correcto es que el rollback FALLE y no que arrastre
-- en silencio un objeto ajeno.
--
-- 1) `ALTER TABLE liquidacion_pago DROP COLUMN reparto_id` arrastra consigo TODO lo que el UP
--    anadio a esa tabla preexistente: la columna, su FK (`liquidacion_pago_reparto_id_fkey`) y
--    su indice (`liquidacion_pago_reparto_id_idx`). Nada mas se toco de ella: ni una fila
--    reescrita, ni un indice ajeno, ni una restriccion ajena. Revertir NO pierde ningun pago:
--    los que colgaban de un reparto siguen siendo pagos completos contra su cierre; lo que se
--    pierde es la AGRUPACION, que es justo lo que esta migracion aporto.
-- 2) `DROP TABLE liquidacion_reparto` arrastra su PK, el UNIQUE de `clave_idempotencia`, el
--    indice `(mensajero_id, created_at DESC)`, las dos FK a `usuario`, el CHECK de
--    `monto_total > 0` y la configuracion de RLS.
--
-- SIN `DROP TYPE` ni `CREATE TYPE`: la migracion no creo ningun enum ni anadio ningun valor a
-- los existentes. Ese es el motivo por el que ningun `down.sql` previo se ha tocado.
-- SIN `UPDATE` ni `DELETE`: el UP fue aditivo puro y el rollback tambien lo es.
ALTER TABLE "liquidacion_pago" DROP COLUMN IF EXISTS "reparto_id";

DROP TABLE IF EXISTS "liquidacion_reparto";
