-- Feature 24: una sola tarifa por (zona, vehiculo) en tarifa_zona_mensajero.
-- NULLS NOT DISTINCT (PG15+) trata los vehiculo_id NULL como iguales entre si,
-- garantizando que exista A LO SUMO UNA tarifa por defecto (vehiculo_id NULL)
-- por zona. Con esto la resolucion "sin vehiculo -> tarifa por defecto de la
-- zona" es deterministica y no puede repetirse el mismo par (zona, vehiculo).
-- El nombre del indice coincide con el que Prisma espera para @@unique([zonaId, vehiculoId]).

-- CreateIndex
CREATE UNIQUE INDEX "tarifa_zona_mensajero_zona_id_vehiculo_id_key"
  ON "tarifa_zona_mensajero" ("zona_id", "vehiculo_id") NULLS NOT DISTINCT;
