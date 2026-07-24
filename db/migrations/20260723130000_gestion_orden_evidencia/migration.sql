-- Feature 119 (R1/R2/R3/R4): evidencias 1..N de una gestion. Tabla nueva ADITIVA que se
-- vuelve la fuente de verdad del CONJUNTO de fotos; la columna unica preexistente
-- (gestion_orden.evidencia_storage_path/_content_type) se conserva como PORTADA (indice 0)
-- por retro-compat (design §2). Patron "tabla nueva sin tocar columnas/policies previas"
-- (precedente 20260714160000_gestion_orden_anulacion).

-- 1) Tabla 1:N de evidencias de gestion (R1/R2).
CREATE TABLE "gestion_orden_evidencia" (
  "id"           TEXT NOT NULL,
  "gestion_id"   TEXT NOT NULL,
  "storage_path" TEXT NOT NULL,
  "content_type" TEXT NOT NULL,
  "indice"       INTEGER NOT NULL,
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "gestion_orden_evidencia_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "gestion_orden_evidencia_gestion_id_indice_key"
  ON "gestion_orden_evidencia" ("gestion_id", "indice");           -- R2
CREATE INDEX "gestion_orden_evidencia_gestion_id_idx"
  ON "gestion_orden_evidencia" ("gestion_id");

ALTER TABLE "gestion_orden_evidencia" ADD CONSTRAINT "gestion_orden_evidencia_gestion_id_fkey"
  FOREIGN KEY ("gestion_id") REFERENCES "gestion_orden"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 2) RLS habilitada sin policies (solo service role, patron gestion_orden). (R4)
ALTER TABLE "gestion_orden_evidencia" ENABLE ROW LEVEL SECURITY;

-- 3) Backfill (R3): cada gestion con evidencia actual -> UNA fila indice 0.
--    COALESCE cubre el caso raro path-sin-content_type (Pregunta abierta 4).
INSERT INTO "gestion_orden_evidencia" ("id", "gestion_id", "storage_path", "content_type", "indice", "created_at")
SELECT gen_random_uuid(), "id", "evidencia_storage_path",
       COALESCE("evidencia_content_type", 'image/jpeg'), 0, "created_at"
FROM "gestion_orden"
WHERE "evidencia_storage_path" IS NOT NULL;
