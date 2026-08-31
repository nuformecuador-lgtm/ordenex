-- DOWN (ficha 333, A2) -- revierte EXACTAMENTE `migration.sql`, en el orden inverso al que lo
-- escribio y con las dependencias respetadas.
--
--   1. `DROP TABLE gasto_fijo_cobro` -- arrastra sus cinco indices
--      (`gasto_fijo_cobro_origen_uq`, `gasto_fijo_cobro_movimiento_uq`,
--      `gasto_fijo_cobro_estado_generado_el_idx`, `gasto_fijo_cobro_plantilla_id_idx`,
--      `gasto_fijo_cobro_decidido_por_idx`), sus cuatro CHECK, sus tres FK y la configuracion de
--      RLS. Va PRIMERO: mientras la tabla exista, el tipo del enum tiene una columna que depende
--      de el y el `DROP TYPE` fallaria.
--   2. `DROP TYPE gasto_fijo_cobro_estado` -- el tipo se CREO entero en el up, asi que aqui se
--      suelta entero. No hay `ALTER TYPE ... DROP VALUE` de por medio y no aplica nada de la
--      leccion de los enums ampliados: eso es del down de la migracion SIGUIENTE.
--   3. `ALTER TABLE gasto_fijo_plantilla DROP COLUMN requiere_aprobacion` -- deshace la unica
--      alteracion sobre una tabla preexistente.
--
-- QUE SE PIERDE AL REVERTIR, dicho en voz alta: los cobros -- pendientes, aprobados, rechazados
-- y cancelados -- desaparecen con la tabla. Los MOVIMIENTOS que un cobro aprobado escribio en
-- `wallet_movimiento` NO se tocan: el libro es inmutable y esta migracion nunca escribio en el.
-- Esa asimetria es correcta y es el motivo de que el `DROP TABLE` sea seguro: lo que se va es la
-- INTENCION de cobrar, no el dinero contabilizado.
--
-- AQUI NO HAY NI UN `UPDATE` NI UN `INSERT` PARA "REPARAR" NADA.
DROP TABLE IF EXISTS "gasto_fijo_cobro";

DROP TYPE IF EXISTS "gasto_fijo_cobro_estado";

ALTER TABLE "gasto_fijo_plantilla" DROP COLUMN IF EXISTS "requiere_aprobacion";
