-- Feature 101 (R1/R11/R12, design §1.2): columna `orden.prioridad` — flag booleano de
-- REASIGNACION prioritaria. Lo ENCIENDE el cron SLA (99) al liberar una devolucion vencida
-- a bodega, y lo APAGA la reasignacion a mensajero desde la bodega dueña (central/satelite).
-- El listado de reasignacion de la bodega ordena `prioridad DESC` primero y resalta la fila.
--
-- Migracion ADITIVA: una sola columna NOT NULL con DEFAULT constante en `orden`. En
-- Postgres >= 11 un ADD COLUMN con DEFAULT constante NO reescribe la tabla (relleno
-- meta-dato). NO hay tabla nueva -> NO hay RLS nueva; la RLS de `orden`
-- (migracion 20260709130100_ordenes, solo service-role) NO cambia (R12). Las ordenes
-- HISTORICAS quedan en `false` (sin backfill, R11: no se puede saber retroactivamente que
-- ventana `not_found` vencio en el pasado).

ALTER TABLE "orden" ADD COLUMN "prioridad" BOOLEAN NOT NULL DEFAULT false;
