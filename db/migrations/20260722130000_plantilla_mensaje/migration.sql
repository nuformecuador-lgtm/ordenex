-- Feature 107 (design §1.3): crea el enum `plantilla_estado` y la tabla
-- `plantilla_mensaje`. Migracion ADITIVA (R31): no altera ni borra tablas existentes.
--
-- El enum y la tabla se crean en la MISMA migracion sin usar ningun valor del enum en
-- un INSERT (a diferencia de 81/api_key): el DEFAULT 'pending' de la columna se resuelve
-- al insertar filas (runtime), no en el DDL, por lo que no hay riesgo de Postgres 55P04.

-- R23: enum nativo con EXACTAMENTE los cuatro valores. `pending`/`refused` quedan
-- reservados (sin productor en este alcance).
CREATE TYPE "plantilla_estado" AS ENUM ('activo', 'inactivo', 'pending', 'refused');

-- R12/R15/R27: `variables` es text[] con default '{}' (nunca null); `estado` nace
-- 'pending'; `deleted_at` nullable (NULL = vigente); FK a usuario ON DELETE SET NULL
-- para no huerfanar la plantilla si se borra el creador.
CREATE TABLE "plantilla_mensaje" (
  "id" TEXT NOT NULL,
  "nombre" TEXT NOT NULL,
  "cuerpo" TEXT NOT NULL,
  "variables" TEXT[] NOT NULL DEFAULT '{}',
  "estado" "plantilla_estado" NOT NULL DEFAULT 'pending',
  "created_by" TEXT,
  "deleted_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "plantilla_mensaje_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "plantilla_mensaje_created_by_fkey" FOREIGN KEY ("created_by")
    REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- R10: unicidad GLOBAL del nombre (incluye borradas; ver design §5 [D6]).
CREATE UNIQUE INDEX "plantilla_mensaje_nombre_key" ON "plantilla_mensaje"("nombre");

-- R6: orden determinista del listado; filtro por estado; R28: filtro de vigentes.
CREATE INDEX "plantilla_mensaje_created_at_idx" ON "plantilla_mensaje"("created_at");
CREATE INDEX "plantilla_mensaje_estado_idx" ON "plantilla_mensaje"("estado");
CREATE INDEX "plantilla_mensaje_deleted_at_idx" ON "plantilla_mensaje"("deleted_at");

-- R30: RLS habilitada SIN policies (solo service role), patron api_key/premio_ranking.
-- La autorizacion de negocio (solo maestro) vive en el service (R5), no en la DB.
ALTER TABLE "plantilla_mensaje" ENABLE ROW LEVEL SECURITY;
