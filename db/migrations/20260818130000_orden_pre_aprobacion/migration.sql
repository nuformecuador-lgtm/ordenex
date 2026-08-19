-- Nueva columna `orden.pre_aprobacion`: flag booleano opcional de pre-aprobacion de la orden.
--
-- NOT NULL con DEFAULT false, mismo patron que `orden.prioridad` (feature 101/R11) y que
-- `orden.ayuda`: un flag ausente ES "false", no "desconocido", asi que la columna no se
-- declara nullable. El DEFAULT rellena las filas existentes en el propio ALTER, por lo que
-- NO hace falta backfill.
ALTER TABLE "orden" ADD COLUMN "pre_aprobacion" BOOLEAN NOT NULL DEFAULT false;
