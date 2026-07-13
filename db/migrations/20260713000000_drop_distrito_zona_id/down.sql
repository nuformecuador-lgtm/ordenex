-- Revierte 20260713000000_drop_distrito_zona_id: recrea la columna escalar
-- `distrito.zona_id` (nullable) con su indice de soporte y la FK RESTRICT hacia zona,
-- tal como la dejo 20260711120000_zonas_catalogo_global_pagos. Los datos previos NO se
-- recuperan (el drop es destructivo): la columna vuelve toda en NULL.
ALTER TABLE "distrito" ADD COLUMN "zona_id" TEXT;
CREATE INDEX "distrito_zona_id_idx" ON "distrito"("zona_id");
ALTER TABLE "distrito" ADD CONSTRAINT "distrito_zona_id_fkey"
  FOREIGN KEY ("zona_id") REFERENCES "zona"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
