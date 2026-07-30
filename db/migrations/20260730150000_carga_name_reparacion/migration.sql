-- REPARACION de `20260727120000_carga_orden_carga_id` — columna `carga.name` (141 R8/R9/R10).
--
-- Aquella migracion se modifico EN SITIO (commit ecd84fc3) para anadir `name` y su indice
-- unico, dando por hecho que no estaba aplicada en ninguna base. Si lo estaba: produccion
-- la habia aplicado en su version previa el 2026-07-27 14:53Z, cuando preview y produccion
-- aun compartian base. Prisma no reejecuta una migracion ya registrada, de modo que la
-- columna nunca llego a produccion y toda carga masiva moria con
-- "The column `name` of relation `carga` does not exist in the current database".
--
-- Por eso los dos statements son IDEMPOTENTES: en una base creada desde cero (QA, local
-- nuevo) la migracion 141 ya trae ambos objetos y esta reparacion es un no-op; en la base
-- que se quedo con la version vieja, los crea. El resultado final es identico en todas.
ALTER TABLE "carga" ADD COLUMN IF NOT EXISTS "name" TEXT;

-- R9/R10: unicidad del nombre POR USUARIO (nunca global). Postgres considera los NULL
-- distintos entre si, de modo que N lotes sin nombre del mismo usuario conviven sin colision.
CREATE UNIQUE INDEX IF NOT EXISTS "carga_usuario_carga_name_key" ON "carga"("usuario_carga", "name");
