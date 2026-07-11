-- Feature 17: (1) num_guia diferido via SEQUENCE dedicada (R1/R3/R6, decision 1);
-- (2) nuevo campo orden.mensajero_asignado_id, distinto del mensajero_sugerido_id
-- de la feature 15 (R7/R8, decision 4); (3) nuevo estado de catalogo
-- en_espera_aceptacion (R9/R10). "orden" ya tiene RLS habilitada desde
-- 20260709130100_ordenes; se conserva sin cambios, sin agregar policies (acceso
-- solo por service role, patron feature 6/15).

-- 1) num_guia: quitar DEFAULT y NOT NULL, conservar UNIQUE (permite multiples
-- NULL en Postgres). La secuencia orden_num_guia_seq (creada por el SERIAL de la
-- feature 6) se desliga del SERIAL con OWNED BY NONE para que sobreviva
-- independiente del ciclo de vida de la columna (R3); sigue siendo consumida via
-- nextval('orden_num_guia_seq') dentro de la transaccion de "Generar guia".
ALTER TABLE "orden" ALTER COLUMN "num_guia" DROP DEFAULT;
ALTER TABLE "orden" ALTER COLUMN "num_guia" DROP NOT NULL;
ALTER SEQUENCE "orden_num_guia_seq" OWNED BY NONE;

-- 2) mensajero_asignado_id (R7): FK nullable -> usuario, ON DELETE SET NULL,
-- con indice. Hermano de mensajero_sugerido_id (feature 15), trazabilidad
-- SUGERIDO (carga masiva) vs ASIGNADO (decision del maestro, esta feature).
ALTER TABLE "orden" ADD COLUMN "mensajero_asignado_id" TEXT;
CREATE INDEX "orden_mensajero_asignado_id_idx" ON "orden"("mensajero_asignado_id");
ALTER TABLE "orden" ADD CONSTRAINT "orden_mensajero_asignado_id_fkey"
  FOREIGN KEY ("mensajero_asignado_id") REFERENCES "usuario"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- 3) nuevo estado de catalogo en_espera_aceptacion (R9/R10), patron feature 15/28.
-- NOTA para el runner de migraciones: "ALTER TYPE ... ADD VALUE" no puede
-- ejecutarse dentro de una transaccion en versiones antiguas de Postgres; el
-- "IF NOT EXISTS" lo hace idempotente si se reintenta o si el runner separa esta
-- sentencia de una transaccion implicita.
ALTER TYPE "order_status_value" ADD VALUE IF NOT EXISTS 'en_espera_aceptacion';
INSERT INTO "order_status" ("id","value")
  VALUES (gen_random_uuid()::text,'en_espera_aceptacion')
  ON CONFLICT ("value") DO NOTHING;
