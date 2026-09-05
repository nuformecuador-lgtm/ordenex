-- FICHA 374 — el catalogo geografico se administra desde la app.
--
-- QUE AÑADE. (1) `activo` en los tres niveles, para poder RETIRAR un nodo sin borrarlo; (2) la
-- unicidad por padre que hasta hoy no existia y que la administracion por pantalla necesita.
--
-- POR QUE `NOT NULL DEFAULT true` Y NO NULLABLE, a diferencia de `distrito.zona_especial`. Alli
-- `NULL` significa algo — «nadie lo decidio todavia»— y por eso la columna es tri-valuada
-- (`20260824180000_distrito_zona_especial`, lineas 12-21). Aqui NO significa nada: todo nodo del
-- catalogo esta hoy operativo, `true` es el dato VERDADERO para las 494+84+7 filas y no un relleno
-- de conveniencia. Dejarla nullable obligaria a que cada lectura escribiera `activo IS NOT FALSE`
-- para no perder filas, y la primera que lo olvidara vaciaria un desplegable en silencio.
--
-- LA CASCADA NO SE MATERIALIZA. Desactivar un canton NO escribe en sus distritos: la
-- disponibilidad efectiva se EVALUA al leer, como la conjuncion con los ascendientes
-- (`lib/repositories/_shared/geografia-activa.ts`). Materializarla romperia la reversibilidad —al
-- reactivar el canton no habria forma de saber que distritos estaban ya inactivos por su cuenta—.
-- Un distrito `activo = true` bajo un canton `activo = false` es un estado REPRESENTABLE y NO es
-- un bug: significa «el distrito esta bien; su canton se retiro». No hay nada que reparar con un
-- `updateMany` de limpieza.
--
-- SIN INDICE SOBRE `activo`, por el MISMO razonamiento que ya escribio
-- `20260824180000_distrito_zona_especial` (lineas 28-31): un booleano casi siempre `true` tiene
-- selectividad pesima y el planificador recorreria la tabla igual. Y aqui hay un argumento mas
-- fuerte: la tabla mas grande son 494 filas y las lecturas piden el catalogo ENTERO, no un
-- subconjunto. `gasto_fijo_plantilla` SI lleva `@@index([activa])` porque un CRON filtra por ella
-- sobre una tabla que crece; aqui no hay cron ni crecimiento.
--
-- LOS TRES UNIQUE. Hasta hoy no habia ninguno: lo dice la propia migracion de la DTA
-- (20260905175156, lineas 23-25), que por eso tuvo que ser idempotente con `WHERE NOT EXISTS` en
-- vez de `ON CONFLICT`. El alcance es POR PADRE y no global, porque los homonimos entre padres son
-- normales en la DTA: "Buenos Aires" es canton de Puntarenas y distrito de Palmares (Alajuela).
-- MEDIDO EN PRODUCCION el 2026-09-05: 0 duplicados en los tres niveles. MEDIDO EN LOCAL el
-- 2026-09-05 (7 / 84 / 494 filas): 0 duplicados tambien. En cualquier otra base hay que medirlo
-- ANTES con los tres `GROUP BY … HAVING count(*) > 1`.
--
-- LA RLS NO SE TOCA: `provincia`, `canton` y `distrito` ya la tienen habilitada desde
-- `20260709130000_ordenes_catalogos_geografia` (lineas 71-73). No hay tabla nueva que proteger y
-- una columna no cambia una politica.
ALTER TABLE "provincia" ADD COLUMN "activo" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "canton"    ADD COLUMN "activo" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "distrito"  ADD COLUMN "activo" BOOLEAN NOT NULL DEFAULT true;

CREATE UNIQUE INDEX "provincia_nombre_key"           ON "provincia" ("nombre");
CREATE UNIQUE INDEX "canton_provincia_id_nombre_key" ON "canton"    ("provincia_id", "nombre");
CREATE UNIQUE INDEX "distrito_canton_id_nombre_key"  ON "distrito"  ("canton_id", "nombre");
