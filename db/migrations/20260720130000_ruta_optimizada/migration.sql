-- Feature 92 (design §1.1, R26/R39): persistencia del ULTIMO orden optimizado valido de
-- cada mensajero. Migracion ADITIVA: dos tablas nuevas y un enum nuevo; ninguna tabla
-- existente cambia.
--
-- POR QUE DOS TABLAS Y NO UNA COLUMNA `secuencia_ruta` EN `orden` (design §9.B):
--  1. la secuencia es un atributo de LA RUTA DE UN MENSAJERO EN UN INSTANTE, no de la
--     orden: al reasignar la orden a otro mensajero la columna quedaria con una posicion
--     que ya no significa nada;
--  2. los metadatos que R27/R30 exigen (`calculada_at`, `estado`, `origen_fuente`,
--     `ultimo_error`) no caben en `orden` sin ensuciarla con 5 columnas de otro dominio
--     (ya lleva las 5 de la feature 91);
--  3. reemplazar la secuencia seria un UPDATE masivo sobre la tabla mas caliente del
--     sistema, en vez de un DELETE+INSERT sobre una tabla pequena y aislada.

-- Estado de la ruta (R27/R30). Enum NATIVO (patron `job_estado`): vocabulario PROPIO y
-- cerrado, a diferencia de `geocode_status`, que es vocabulario opaco de un tercero.
--  - `vigente`        : la ultima optimizacion termino en ok.
--  - `desactualizada` : el proveedor fallo y se CONSERVA el orden anterior (R27). Nunca
--                       se borra la secuencia previa ni se cae en silencio a createdAt.
CREATE TYPE "ruta_estado" AS ENUM ('vigente', 'desactualizada');

-- Cabecera: UNA fila por mensajero (indice unico sobre `mensajero_id`), con el origen
-- desde el que se calculo la ruta y la huella del conjunto (guarda de coste R36).
-- `origen_fuente` es TEXT y no enum: vocabulario propio pero de bajo valor semantico
-- (gps | ultima_conocida | centroide), no merece un ALTER TYPE por valor nuevo.
-- `ultimo_error` guarda un mensaje AGREGADO: NUNCA credencial, token, direccion ni
-- coordenadas (R14).
CREATE TABLE "ruta_optimizada" (
  "id"            TEXT NOT NULL,
  "mensajero_id"  TEXT NOT NULL,
  "estado"        "ruta_estado" NOT NULL DEFAULT 'vigente',
  "calculada_at"  TIMESTAMP(3),
  "origen_lat"    DECIMAL(10,7),
  "origen_lng"    DECIMAL(10,7),
  "origen_at"     TIMESTAMP(3),
  "origen_fuente" TEXT,
  "huella_set"    TEXT,
  "ultimo_error"  TEXT,
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ruta_optimizada_pkey" PRIMARY KEY ("id")
);

-- Una ruta VIGENTE por mensajero: el upsert de la cabecera es por `mensajero_id`.
CREATE UNIQUE INDEX "ruta_optimizada_mensajero_id_key"
  ON "ruta_optimizada" ("mensajero_id");

-- Detalle: una fila por parada posicionada. Los DOS indices unicos son los que hacen
-- IMPOSIBLE persistir una secuencia con posiciones repetidas o con la misma orden dos
-- veces (R26): la invariante la garantiza la DB, no solo el codigo.
CREATE TABLE "ruta_optimizada_parada" (
  "id"        TEXT NOT NULL,
  "ruta_id"   TEXT NOT NULL,
  "orden_id"  TEXT NOT NULL,
  "secuencia" INTEGER NOT NULL,

  CONSTRAINT "ruta_optimizada_parada_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ruta_optimizada_parada_ruta_id_orden_id_key"
  ON "ruta_optimizada_parada" ("ruta_id", "orden_id");
CREATE UNIQUE INDEX "ruta_optimizada_parada_ruta_id_secuencia_key"
  ON "ruta_optimizada_parada" ("ruta_id", "secuencia");
-- Lector: la lectura de "mis asignaciones" resuelve la posicion por `orden_id`.
CREATE INDEX "ruta_optimizada_parada_orden_id_idx"
  ON "ruta_optimizada_parada" ("orden_id");

-- FKs. `ON DELETE CASCADE` en ambas: una ruta sin mensajero o una parada sin ruta/orden
-- no significa nada; la secuencia se recalcula entera en cada optimizacion.
ALTER TABLE "ruta_optimizada"
  ADD CONSTRAINT "ruta_optimizada_mensajero_id_fkey"
  FOREIGN KEY ("mensajero_id") REFERENCES "usuario" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ruta_optimizada_parada"
  ADD CONSTRAINT "ruta_optimizada_parada_ruta_id_fkey"
  FOREIGN KEY ("ruta_id") REFERENCES "ruta_optimizada" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ruta_optimizada_parada"
  ADD CONSTRAINT "ruta_optimizada_parada_orden_id_fkey"
  FOREIGN KEY ("orden_id") REFERENCES "orden" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- R39: RLS habilitada SIN policies (solo service role), patron jobs / geocode_cache /
-- api_key. Ambas tablas guardan geolocalizacion de una persona: no son accesibles desde
-- el cliente bajo ninguna circunstancia.
ALTER TABLE "ruta_optimizada" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ruta_optimizada_parada" ENABLE ROW LEVEL SECURITY;
