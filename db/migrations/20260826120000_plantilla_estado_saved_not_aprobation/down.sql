-- DOWN: Postgres no permite DROP VALUE de un enum -> se recrea el tipo sin el valor nuevo.
-- Las filas que lo tuvieran se llevan a `pending`, que es lo que habrian sido antes de esta
-- migracion. No hay FK que lo impida: el enum solo lo usa `plantilla_mensaje.estado`.
UPDATE "plantilla_mensaje" SET "estado" = 'pending' WHERE "estado" = 'saved_not_aprobation';

ALTER TYPE "plantilla_estado" RENAME TO "plantilla_estado_old";
CREATE TYPE "plantilla_estado" AS ENUM ('activo', 'inactivo', 'pending', 'refused');
ALTER TABLE "plantilla_mensaje" ALTER COLUMN "estado" DROP DEFAULT;
ALTER TABLE "plantilla_mensaje"
  ALTER COLUMN "estado" TYPE "plantilla_estado" USING ("estado"::text::"plantilla_estado");
ALTER TABLE "plantilla_mensaje" ALTER COLUMN "estado" SET DEFAULT 'pending';
DROP TYPE "plantilla_estado_old";
