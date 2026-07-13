-- DOWN: revierte exactamente migration.sql de esta carpeta, en orden inverso (R3).
-- NO toca las policies RLS de cierre_dia / cierre_bodega.
--
-- Precondición (R3): NINGUNA fila de "cierre_dia" (ni de "cierre_bodega") debe estar
-- en estado 'vencido'. Postgres no soporta DROP VALUE de un enum, así que el tipo se
-- recrea sin 'vencido'; si existiera una fila 'vencido' el USING cast
-- ('vencido'::text::"cierre_estado") FALLA y el rollback aborta con un error claro
-- (correcto: revertir con dinero sin conciliar vivo no es seguro).

-- 2) Índice compuesto del bloqueo derivado (ya sin uso).
DROP INDEX IF EXISTS "cierre_dia_mensajero_id_estado_idx";

-- 1) Recrear el enum "cierre_estado" con los tres valores originales. `cierre_dia` y
-- `cierre_bodega` comparten el enum y ambos tienen DEFAULT 'solicitado': se suelta el
-- default, se cambia el tipo con USING, y se restaura el default.
-- El índice único parcial `cierre_bodega_zona_solicitado_uq` (feature 40) tiene el
-- predicado `estado = 'solicitado'`, cuyo literal queda ligado al tipo VIEJO durante el
-- cambio de tipo (Postgres intentaría `cierre_estado = cierre_estado_old` y falla). Se
-- suelta ANTES del cambio de tipo y se recrea DESPUÉS, idéntico a la feature 40.
DROP INDEX IF EXISTS "cierre_bodega_zona_solicitado_uq";

ALTER TABLE "cierre_dia" ALTER COLUMN "estado" DROP DEFAULT;
ALTER TABLE "cierre_bodega" ALTER COLUMN "estado" DROP DEFAULT;

ALTER TYPE "cierre_estado" RENAME TO "cierre_estado_old";
CREATE TYPE "cierre_estado" AS ENUM ('solicitado', 'aprobado', 'rechazado');

ALTER TABLE "cierre_dia" ALTER COLUMN "estado" TYPE "cierre_estado" USING ("estado"::text::"cierre_estado");
ALTER TABLE "cierre_bodega" ALTER COLUMN "estado" TYPE "cierre_estado" USING ("estado"::text::"cierre_estado");

ALTER TABLE "cierre_dia" ALTER COLUMN "estado" SET DEFAULT 'solicitado';
ALTER TABLE "cierre_bodega" ALTER COLUMN "estado" SET DEFAULT 'solicitado';

DROP TYPE "cierre_estado_old";

-- Recrea el índice único parcial de la feature 40 (R8/F1.4-g) con el nuevo tipo.
CREATE UNIQUE INDEX "cierre_bodega_zona_solicitado_uq"
  ON "cierre_bodega"("zona_id") WHERE "estado" = 'solicitado';
