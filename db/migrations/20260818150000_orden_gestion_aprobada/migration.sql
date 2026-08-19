-- RENOMBRA `orden.pre_aprobacion` -> `orden.gestion_aprobada`.
--
-- Solo cambia el NOMBRE: tipo, NOT NULL y DEFAULT false se conservan, y `RENAME COLUMN`
-- preserva los valores existentes fila por fila. NO hay perdida de datos ni backfill.
--
-- Se hace en una migracion APARTE en vez de reescribir `20260818130000_orden_pre_aprobacion`
-- porque aquella pudo haberse aplicado ya en algun entorno: reescribir una migracion aplicada
-- deja el historial de Prisma divergido de la base. Aplicadas en orden, la 130000 crea la
-- columna y esta la renombra; en una base virgen el resultado es identico.
ALTER TABLE "orden" RENAME COLUMN "pre_aprobacion" TO "gestion_aprobada";
