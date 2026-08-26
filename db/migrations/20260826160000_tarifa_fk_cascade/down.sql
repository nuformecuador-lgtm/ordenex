-- Revierte ambas FKs de `tarifas` a ON DELETE RESTRICT.
--
-- OJO al reaplicar este down: si ya se borro una zona (o una tienda) apoyandose en
-- la cascada, sus tarifas se fueron con ella y NO vuelven. El down restaura la
-- REGLA, no las filas.

ALTER TABLE "tarifas" DROP CONSTRAINT IF EXISTS "tarifas_zona_id_fkey";
ALTER TABLE "tarifas" ADD CONSTRAINT "tarifas_zona_id_fkey"
  FOREIGN KEY ("zona_id") REFERENCES "zona"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "tarifas" DROP CONSTRAINT IF EXISTS "tarifas_tienda_id_fkey";
ALTER TABLE "tarifas" ADD CONSTRAINT "tarifas_tienda_id_fkey"
  FOREIGN KEY ("tienda_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
