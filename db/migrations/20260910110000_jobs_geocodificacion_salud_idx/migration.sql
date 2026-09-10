-- FICHA 401 (T4, design §3.2) -- indice PARCIAL sobre `jobs` para las dos consultas nuevas de la
-- salud del geocodificador.
--
-- POR QUE HACE FALTA. Hoy `jobs` tiene EXACTAMENTE dos indices
-- (`20260717120000_jobs_cola/migration.sql:33,39`): `jobs_run_after_pending_idx` (parcial, sobre
-- `run_after` WHERE estado = 'pending') y el unico parcial de `dedupe_key`. NO hay indice por
-- `tipo`, ni por `estado`, ni por `updated_at`, y las filas de `jobs` NO SE PURGAN. Las dos
-- consultas de esta ficha —contar fallos con marcador dentro de una ventana, y elegir los N
-- `failed` mas antiguos para revivir— serian un escaneo secuencial sobre una tabla que solo crece:
-- el anti-patron que `docs/architecture.md` rechaza.
--
-- POR QUE PARCIAL Y NO PLENO. `geocodificacion` es UNO de nueve tipos de job. El indice cubre solo
-- sus filas, asi que no engorda las escrituras de los otros ocho —que comparten el mismo cron cada
-- minuto—. Es el mismo criterio (y el mismo estilo a mano) del `jobs_run_after_pending_idx` que ya
-- existe.
--
-- POR QUE `(estado, updated_at)` EN ESE ORDEN. Sirve a las DOS consultas con un solo indice:
--   - `contarFallosConfigDesde`: `estado IN ('pending','processing','failed') AND updated_at >= $1`
--   - `revivirFallosConfig`:     `estado = 'failed' ... ORDER BY updated_at ASC LIMIT $n`
-- El predicado por igualdad va primero y el rango/orden despues, que es lo que permite que la
-- segunda consulta se sirva del orden del indice sin ordenar en memoria.
--
-- `db/schema.prisma` NO CAMBIA por esta migracion: Prisma no expresa indices parciales (igual que
-- con `jobs_run_after_pending_idx`), asi que declararlo alli produciria drift, no lo evitaria.
--
-- ADITIVA: no crea tablas ni columnas, no toca RLS (`jobs` conserva la de la feature 90: habilitada
-- sin policies, solo service role) y no reescribe ni una fila.
CREATE INDEX IF NOT EXISTS "jobs_geocodificacion_estado_updated_idx"
  ON "jobs" ("estado", "updated_at")
  WHERE "tipo" = 'geocodificacion';
