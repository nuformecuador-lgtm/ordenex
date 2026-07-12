-- Seed idempotente del catalogo "rol" con TODOS los valores del enum RolValue
-- (schema.prisma). Hasta ahora solo 'maestro' se sembraba por migracion
-- (20260709120000_seed_maestro_user); esta migracion completa el catalogo con
-- los 5 valores del tipo "rol_value" para que la FK usuario.rol_id resuelva
-- cualquier rol sin depender del script scripts/seed-catalogos.ts.
--
-- Los literales coinciden con los del enum Postgres "rol_value":
--   maestro | admin | mensajero | 'Admin Tienda' (@map adminTienda) | adminSatelite
-- Idempotente por la unique constraint "rol_value_key" ("value").

INSERT INTO "rol" ("id", "value")
VALUES
    (gen_random_uuid()::text, 'maestro'::rol_value),
    (gen_random_uuid()::text, 'admin'::rol_value),
    (gen_random_uuid()::text, 'mensajero'::rol_value),
    (gen_random_uuid()::text, 'Admin Tienda'::rol_value),
    (gen_random_uuid()::text, 'adminSatelite'::rol_value)
ON CONFLICT ("value") DO NOTHING;
