-- Feature 92 (seguimiento del design §5, anotado en OptimizacionRutaService.trazar) — el
-- TRAZADO de la ruta pasa a persistirse.
--
-- Que hace: anade CUATRO columnas NULLABLE a `ruta_optimizada`. Nada mas.
--
-- POR QUE. Hasta ahora la polilinea viajaba solo en el resultado de la Server Action y vivia
-- en estado de cliente. Eso dejaba dos agujeros: (1) la guarda R36 corta cuando el conjunto
-- de paradas y el origen no cambiaron, y al no llamar al proveedor el mapa se quedaba sin
-- linea; (2) un F5 la perdia entera. La polilinea es funcion de (secuencia + origen), que es
-- EXACTAMENTE lo que hashea `huella_set`: la clave de cache ya estaba persistida en esta
-- misma fila, faltaba el valor.
--
-- ADITIVA Y NO BLOQUEANTE: `ADD COLUMN` nullable y sin DEFAULT no reescribe la tabla en
-- Postgres (solo toca el catalogo). No renombra, no borra, no reordena.
--
-- ⛔ SIN BACKFILL. Las rutas existentes quedan con las cuatro columnas en NULL, que es el
-- estado correcto: no hay polilinea que asignarles y no se puede reconstruir sin volver a
-- pagar una llamada a Routes por mensajero. Se rellenan solas en la siguiente sincronizacion.
--
-- ⛔ SIN CHECK de coherencia entre las cuatro. La invariante «o estan las cuatro o no esta
-- ninguna» la garantiza el repositorio, que las escribe y las limpia SIEMPRE juntas y en la
-- misma transaccion que la secuencia. Un CHECK aqui solo romperia las filas historicas que
-- el parrafo anterior manda dejar en NULL.
--
-- PII (R14): la polilinea ES la geometria que recorre los domicilios de entrega, o sea DATO
-- PERSONAL. No añade superficie nueva —las coordenadas de las paradas ya viven en esta base
-- desde la 91— pero hereda su misma postura: `ruta_optimizada` ya tiene RLS habilitada SIN
-- policies (solo service role) y esta migracion NO la toca. Igual que `gestion_orden` y
-- `geocode_cache`. Y no se loguea NUNCA.
--
-- RLS: NO hay tabla nueva -> NO hay superficie RLS nueva.

-- Polilinea codificada de Google (formato `encodedPolyline`), lista para pintar. TEXT porque
-- no tiene tope util: crece con el numero de vertices, y una ruta de 25 paradas por calles
-- ronda los pocos KB.
ALTER TABLE "ruta_optimizada" ADD COLUMN "trazado_polilinea" TEXT;

-- Metros del recorrido. NULL si el proveedor no lo devolvio.
ALTER TABLE "ruta_optimizada" ADD COLUMN "trazado_distancia_m" INTEGER;

-- Segundos de viaje. Siempre NULL cuando `trazado_fuente = 'local'`: sin calles no hay
-- tiempo que estimar, y una cifra inventada acabaria mostrandose al mensajero como real.
ALTER TABLE "ruta_optimizada" ADD COLUMN "trazado_duracion_s" INTEGER;

-- De donde salio el dibujo: 'routes' (geometria real por calles) o 'local' (rectas entre
-- paradas). TEXT y no enum, mismo criterio que `origen_fuente`: el vocabulario es nuestro y
-- la columna la escribe un unico repositorio.
--
-- NO ES DECORATIVO. Cambia lo que la linea SIGNIFICA —la UI pinta punteado el trazado
-- local— y ademas decide si la fila sirve de cache: un trazado 'local' es el resultado de que
-- Google estuviera caido, y cachearlo congelaria lineas rectas hasta que cambien las paradas.
-- El service solo persiste 'routes' por ese motivo.
ALTER TABLE "ruta_optimizada" ADD COLUMN "trazado_fuente" TEXT;
