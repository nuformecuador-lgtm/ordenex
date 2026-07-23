-- Feature 115 (design §1.2) + coordinacion 116: crea `orden_mensajero_meta` con AMBAS
-- columnas de una vez. `marcar_luego` (la USA la 115) y `nota` (nace aqui para la 116, que
-- NO crea migracion propia). Aditiva (R1): no altera ni borra tablas existentes.
CREATE TABLE "orden_mensajero_meta" (
  "id"           TEXT NOT NULL,
  "usuario_id"   TEXT NOT NULL,
  "orden_id"     TEXT NOT NULL,
  "marcar_luego" BOOLEAN NOT NULL DEFAULT false,   -- R1: 115
  "nota"         TEXT,                              -- R2: NULLABLE, nace aqui para 116
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"   TIMESTAMP(3) NOT NULL,

  CONSTRAINT "orden_mensajero_meta_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "orden_mensajero_meta_usuario_id_fkey" FOREIGN KEY ("usuario_id")
    REFERENCES "usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "orden_mensajero_meta_orden_id_fkey" FOREIGN KEY ("orden_id")
    REFERENCES "orden"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- R1/R7: unicidad de la pareja -> idempotencia del toggle (upsert).
CREATE UNIQUE INDEX "orden_mensajero_meta_usuario_id_orden_id_key"
  ON "orden_mensajero_meta"("usuario_id", "orden_id");

-- R17: leer todas las metas del mensajero al listar; segunda FK indexada.
CREATE INDEX "orden_mensajero_meta_usuario_id_idx" ON "orden_mensajero_meta"("usuario_id");
CREATE INDEX "orden_mensajero_meta_orden_id_idx"   ON "orden_mensajero_meta"("orden_id");

-- R3: RLS habilitada SIN policies (solo service role), patron api_key/plantilla_mensaje.
-- La autorizacion de negocio (cada mensajero solo su fila) vive en el service (R8/R12).
ALTER TABLE "orden_mensajero_meta" ENABLE ROW LEVEL SECURITY;
