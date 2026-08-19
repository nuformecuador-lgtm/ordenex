-- Nueva columna `orden.ayuda`: flag booleano opcional de solicitud de ayuda sobre la orden.
--
-- NOT NULL con DEFAULT false, mismo patron que `orden.prioridad` (feature 101/R11): un flag
-- ausente ES "false", no "desconocido", asi que la columna no se declara nullable. El DEFAULT
-- rellena las filas existentes en el propio ALTER, por lo que NO hace falta backfill.
ALTER TABLE "orden" ADD COLUMN "ayuda" BOOLEAN NOT NULL DEFAULT false;
