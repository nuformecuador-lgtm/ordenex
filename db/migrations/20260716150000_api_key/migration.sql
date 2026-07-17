-- Feature 81 (design §2): siembra el rol `apiKey` en el catalogo `rol` y crea la tabla
-- `api_key`. El `ALTER TYPE ... ADD VALUE 'apiKey'` vive en la migracion ANTERIOR
-- (20260716140000_rol_api_key) porque Postgres prohibe usar un valor de enum en la
-- misma transaccion que lo creo (55P04); aqui ya esta commiteado y es usable.
--
-- Migracion ADITIVA (R24): no altera tablas existentes.

-- [D1] El rol se siembra SIN ninguna fila en `rol_permiso`: fallo seguro por defecto.
-- Una API key no puede hacer NADA hasta que el humano le conceda permisos explicitos.
-- Idempotente por la unique constraint "rol_value_key" ("value"), patron
-- 20260711000000_seed_roles_catalogo.
INSERT INTO "rol" ("id", "value")
VALUES (gen_random_uuid()::text, 'apiKey'::rol_value)
ON CONFLICT ("value") DO NOTHING;

-- La key en claro NUNCA se persiste: solo `key_hash` (SHA-256 hex, R16) y el
-- `key_prefix` no secreto (R17). FKs ON DELETE RESTRICT: borrar el usuario dedicado o
-- al creador exige borrar antes la key (no se huerfana el rastro de R21).
CREATE TABLE "api_key" (
  "id" TEXT NOT NULL,
  "identificador" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "key_prefix" TEXT NOT NULL,
  "key_hash" TEXT NOT NULL,
  "usuario_id" TEXT NOT NULL,
  "created_by_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "api_key_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "api_key_usuario_id_fkey" FOREIGN KEY ("usuario_id")
    REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "api_key_created_by_id_fkey" FOREIGN KEY ("created_by_id")
    REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- R25: unicidad del hash. Es tambien el indice del lookup `WHERE key_hash = $1` que
-- usara el consumo de la key (feature 81a).
CREATE UNIQUE INDEX "api_key_key_hash_key" ON "api_key"("key_hash");

-- [D6]: 1:1 key <-> usuario dedicado. Se relaja a indice normal en 81b si aparece la
-- rotacion (drop + create index, sin migracion de datos).
CREATE UNIQUE INDEX "api_key_usuario_id_key" ON "api_key"("usuario_id");

-- Soporte del listado futuro por creador (81b).
CREATE INDEX "api_key_created_by_id_idx" ON "api_key"("created_by_id");

-- R23: RLS habilitada SIN policies (solo service role), patron premio_ranking /
-- wallet_movimiento. La autorizacion de negocio (solo maestro genera) vive en el
-- service (R2), no en la DB.
ALTER TABLE "api_key" ENABLE ROW LEVEL SECURITY;
