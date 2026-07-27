-- Feature 141 (R1-R11) — LOTE de carga masiva.
--
-- Crea la tabla `carga` (UNA fila por lote de carga masiva efectiva) y cuelga de
-- `orden` las dos columnas nuevas: `carga_id` (FK nullable al lote) y `download_url`.
-- Migracion ADITIVA: no toca `num_guia` (R11) ni hace backfill del historico (R8).
-- Sin `batch_url` ni `status` (D2/D3, R3).

-- R1/R2/R6/R7: la tabla del lote. `fecha_carga` es el dato de negocio (instante de la
-- carga); `created_at`/`updated_at` son la auditoria estandar del repo. `download_url`
-- nace NULL y ninguna ruta de esta feature la escribe (R29). `total_files` = tamano
-- TOTAL del lote (sesion: filas declaradas por el cliente; API: `ordenes.length`).
CREATE TABLE "carga" (
  "id"            TEXT NOT NULL,
  "fecha_carga"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "usuario_carga" TEXT NOT NULL,
  "download_url"  TEXT,
  "total_files"   INTEGER NOT NULL DEFAULT 0,
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "carga_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "carga_usuario_carga_fkey" FOREIGN KEY ("usuario_carga")
    REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "carga_usuario_carga_idx" ON "carga"("usuario_carga");
CREATE INDEX "carga_fecha_carga_idx"   ON "carga"("fecha_carga");

-- R9: RLS habilitada SIN policies (patron `orden_mensajero_meta` / `plantilla_mensaje` /
-- `api_key`): acceso solo por service role; la autorizacion de negocio vive en el service.
ALTER TABLE "carga" ENABLE ROW LEVEL SECURITY;

-- R4/R5/R8: columnas nuevas de `orden`, ambas NULLABLE y sin default -> las ordenes
-- historicas quedan con `carga_id IS NULL` (sin backfill, sin lotes retroactivos).
ALTER TABLE "orden" ADD COLUMN "carga_id" TEXT;
ALTER TABLE "orden" ADD COLUMN "download_url" TEXT;
CREATE INDEX "orden_carga_id_idx" ON "orden"("carga_id");
ALTER TABLE "orden" ADD CONSTRAINT "orden_carga_id_fkey" FOREIGN KEY ("carga_id")
  REFERENCES "carga"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
