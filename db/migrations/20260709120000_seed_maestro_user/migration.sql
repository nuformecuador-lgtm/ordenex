-- Seed idempotente de un usuario "maestro" para operar el sistema.
--
-- Nota: los catalogos (rol, tipo_identificacion) normalmente se siembran via
-- script (`pnpm run db:seed`, scripts/seed-catalogos.ts), no por migracion. Esta
-- migracion podria correr ANTES de ese script, por lo que asegura de forma
-- idempotente los prerequisitos de catalogo antes de insertar el usuario.
--
-- password_hash: bcrypt (coste 10, mismo factor que lib/utils/password.ts, para
-- que el login existente pueda verificarlo con verifyPassword). El texto plano
-- NUNCA se almacena; solo el hash.

-- Prerequisito de catalogo: rol 'maestro'
INSERT INTO "rol" ("id", "value")
VALUES (gen_random_uuid()::text, 'maestro'::rol_value)
ON CONFLICT ("value") DO NOTHING;

-- Prerequisito de catalogo: tipo_identificacion 'cedula'
INSERT INTO "tipo_identificacion" ("id", "value")
VALUES (gen_random_uuid()::text, 'cedula')
ON CONFLICT ("value") DO NOTHING;

-- Usuario maestro. Idempotente por email.
INSERT INTO "usuario" (
    "id",
    "nombre",
    "email",
    "telefono",
    "password_hash",
    "estado",
    "cedula",
    "tipo_identificacion_id",
    "rol_id",
    "created_at",
    "updated_at"
)
VALUES (
    gen_random_uuid()::text,
    'Maestro Ordenex',
    'admin@ordenex.test',
    '0999999999',
    '$2b$10$hchO6tPblC7UAqDTTWrDqecQ6sahEmQEOH1/SJgQxXZ229qV7f8Cy',
    'activo'::estado_usuario,
    '1700000001',
    (SELECT "id" FROM "tipo_identificacion" WHERE "value" = 'cedula'),
    (SELECT "id" FROM "rol" WHERE "value" = 'maestro'::rol_value),
    now(),
    now()
)
ON CONFLICT ("email") DO NOTHING;
