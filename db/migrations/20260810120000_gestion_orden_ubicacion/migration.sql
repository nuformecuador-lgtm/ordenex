-- Feature 193 (T A.3, R1/R2/R3/R4/R5) — la ubicacion del mensajero en cada gestion.
--
-- Que hace: crea el enum `gestion_ubicacion_ausencia` y anade TRES columnas NULLABLE a
-- `gestion_orden`. Nada mas.
--
-- ADITIVA Y NO BLOQUEANTE: `ADD COLUMN` nullable y sin DEFAULT no reescribe la tabla en
-- Postgres (solo toca el catalogo), asi que no hay ventana de bloqueo sobre una tabla que
-- crece con cada entrega. No renombra, no borra, no reordena.
--
-- ⛔ SIN UPDATE DE NINGUNA CLASE (R3). Las gestiones anteriores a esta feature quedan con las
-- tres columnas en NULL, a proposito: no existe coordenada cierta que asignarles y rellenarlas
-- con cualquier cosa —el centroide de la zona, la ubicacion de la bodega— produciria un dato
-- que parece medido y no lo es. Es el mismo criterio que dejo escrito la feature 73 para
-- `causa_devolucion`: el historico NO se backfillea.
--
-- ⛔ SIN CHECK de coherencia entre las tres columnas, y es deliberado (design §2). La regla
-- «(lat,lng,NULL) o (NULL,NULL,motivo)» (R6) vive en el BORDE, en zod, igual que la
-- obligatoriedad de `causa_devolucion` (73/F1.4-b) y `causa_incidente` (158). Dos motivos:
-- la tabla la escribe un unico repositorio, y un CHECK romperia justamente las filas
-- historicas que R3 manda dejar como estan.
--
-- La DENEGACION del permiso NO figura en el enum, y eso ES el mecanismo de R12: al no existir
-- el valor, una gestion denegada no se puede representar. Decision humana del 2026-08-10.
--
-- RLS: NO hay tabla nueva -> NO hay superficie RLS nueva. `gestion_orden` ya tiene RLS
-- habilitada sin policies (solo service role) y sigue exactamente igual. Esta migracion NO
-- toca RLS ni policies. Las columnas guardan geolocalizacion de una persona y heredan esa
-- postura (R7), igual que ruta_optimizada y geocode_cache.

-- 1) Por que una gestion no trae ubicacion. Lista CERRADA de fallos TECNICOS (R5).
CREATE TYPE "gestion_ubicacion_ausencia" AS ENUM (
  'timeout',
  'no_disponible',
  'no_soportado',
  'contexto_inseguro'
);

-- 2) Donde estaba el mensajero (R1/R2/R4). Decimal(10,7) = el tipo de la geolocalizacion
--    propia del repo (geocode_cache.latitud, ruta_optimizada.origen_lat), ~1 cm de
--    resolucion y sin error de representacion binaria.
ALTER TABLE "gestion_orden" ADD COLUMN "ubicacion_lat" DECIMAL(10,7);
ALTER TABLE "gestion_orden" ADD COLUMN "ubicacion_lng" DECIMAL(10,7);

-- 3) Y si no la trae, por que (R5/R6).
ALTER TABLE "gestion_orden" ADD COLUMN "ubicacion_ausencia" "gestion_ubicacion_ausencia";
