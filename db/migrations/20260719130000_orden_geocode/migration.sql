-- Feature 91 (design §1.1/§1.2, R1/R2/R3): columnas de geocodificacion en `orden` +
-- tabla `geocode_cache`. Migracion ADITIVA: todas las columnas nullable y sin default,
-- ninguna fila existente cambia de valor.

-- R1: resultado del ULTIMO intento de geocodificacion de la orden. `geocode_precision`
-- guarda el `location_type` del proveedor (ROOFTOP | RANGE_INTERPOLATED |
-- GEOMETRIC_CENTER | APPROXIMATE) y `geocode_status` su `status` (OK | ZERO_RESULTS |
-- INVALID_REQUEST | SIN_DIRECCION). Ambos TEXT y NO enums nativos: son vocabulario opaco
-- de un tercero, ampliable sin avisar (design §1.1 y §8.4). DECIMAL(10,7) da ~1 cm de
-- resolucion y cubre el rango [-180, 180]. Sin indice: no existe consumidor todavia,
-- un indice sin lector es coste de escritura puro (design §1.1).
ALTER TABLE "orden"
  ADD COLUMN "latitud"           DECIMAL(10,7),
  ADD COLUMN "longitud"          DECIMAL(10,7),
  ADD COLUMN "geocoded_at"       TIMESTAMP(3),
  ADD COLUMN "geocode_precision" TEXT,
  ADD COLUMN "geocode_status"    TEXT;

-- R2: cache de direcciones ya resueltas. Evita re-pagar al proveedor por direcciones
-- repetidas (misma tienda, mismo edificio) y abarata los reintentos de la cola.
-- Retencion: PERMANENTE, sin TTL (gate F1.4-Q7). Los Terminos de Servicio de Google
-- permiten almacenar coordenadas geocodificadas de forma indefinida cuando se usan junto
-- a servicios de Google; el limite de 30 dias aplica a otro contenido.
-- Invalidacion: IMPLICITA — una direccion distinta produce una huella distinta.
-- La direccion en claro NO se persiste: solo su huella (`direccion_hash`), porque la
-- direccion es dato personal. Solo se cachean resultados SATISFACTORIOS (un ZERO_RESULTS
-- vive en `orden.geocode_status`, no aqui).
CREATE TABLE "geocode_cache" (
  "id"             TEXT NOT NULL,
  "direccion_hash" TEXT NOT NULL,
  "latitud"        DECIMAL(10,7) NOT NULL,
  "longitud"       DECIMAL(10,7) NOT NULL,
  "precision"      TEXT NOT NULL,
  "payload_crudo"  JSONB,
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "geocode_cache_pkey" PRIMARY KEY ("id")
);

-- R2: la huella es la clave de busqueda y debe ser UNICA (soporta el upsert por hash).
CREATE UNIQUE INDEX "geocode_cache_direccion_hash_key"
  ON "geocode_cache" ("direccion_hash");

-- R3: RLS habilitada SIN policies (solo service role), patron jobs / api_key /
-- wallet_movimiento. La cache guarda coordenadas: no es accesible desde el cliente.
ALTER TABLE "geocode_cache" ENABLE ROW LEVEL SECURITY;
