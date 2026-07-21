-- Elimina el usuario maestro sembrado por `20260709120000_seed_maestro_user`.
--
-- Motivo: aquella migracion inserta 'admin@ordenex.test' con un hash bcrypt
-- HARDCODEADO en el repositorio, es decir una credencial de rol `maestro`
-- (privilegio total) conocida por cualquiera con acceso al codigo. Sirve para
-- desarrollo, pero es una puerta abierta en cualquier entorno desplegado.
--
-- No se puede corregir editando aquella migracion: Prisma valida el checksum de
-- las migraciones ya aplicadas y modificarla romperia toda base existente. Por
-- eso se neutraliza aqui, en una migracion nueva.
--
-- El bootstrap pasa a ser `pnpm db:seed:maestro` (scripts/seed-maestro.ts), que
-- toma la credencial de las env vars MAESTRO_EMAIL / MAESTRO_PASSWORD y por lo
-- tanto nunca la guarda en el repositorio.
--
-- Es idempotente: si el usuario ya no existe (p. ej. porque se roto a mano),
-- ambas sentencias son no-ops.

-- Paso 1 — Neutralizar. Se ejecuta siempre y NUNCA falla por claves foraneas.
-- El hash se reemplaza por un centinela que no es un hash bcrypt valido, asi
-- `verifyPassword` (bcrypt.compare) devuelve false para cualquier contrasena;
-- el estado 'inactivo' corta el acceso aunque algo intentara autenticar.
UPDATE "usuario"
SET "password_hash" = 'DISABLED-no-es-un-hash-bcrypt-valido',
    "estado" = 'inactivo'::estado_usuario,
    "updated_at" = now()
WHERE "email" = 'admin@ordenex.test';

-- Paso 2 — Borrar, solo si ninguna fila lo referencia. Las FKs hacia `usuario`
-- con ON DELETE RESTRICT harian fallar (y por lo tanto abortar el despliegue) un
-- DELETE incondicional en un entorno donde la cuenta ya opero. Si quedan
-- referencias, el paso 1 ya la dejo inutilizable.
DELETE FROM "usuario" u
WHERE u."email" = 'admin@ordenex.test'
  AND NOT EXISTS (SELECT 1 FROM "api_key"                   x WHERE x."usuario_id"     = u."id" OR x."created_by_id" = u."id")
  AND NOT EXISTS (SELECT 1 FROM "cierre_bodega"             x WHERE x."solicitado_por" = u."id" OR x."resuelto_por"   = u."id")
  AND NOT EXISTS (SELECT 1 FROM "cierre_detail"             x WHERE x."tienda_id"      = u."id")
  AND NOT EXISTS (SELECT 1 FROM "cierre_dia"                x WHERE x."mensajero_id"   = u."id" OR x."resuelto_por"   = u."id")
  AND NOT EXISTS (SELECT 1 FROM "email_otp_challenge"       x WHERE x."usuario_id"     = u."id")
  AND NOT EXISTS (SELECT 1 FROM "gestion_orden"             x WHERE x."mensajero_id"   = u."id" OR x."anulada_por"    = u."id")
  AND NOT EXISTS (SELECT 1 FROM "login_attempt"             x WHERE x."usuario_id"     = u."id")
  AND NOT EXISTS (SELECT 1 FROM "mensajero_documento"       x WHERE x."usuario_id"     = u."id")
  AND NOT EXISTS (SELECT 1 FROM "orden"                     x WHERE x."tienda_id"      = u."id" OR x."mensajero_sugerido_id" = u."id" OR x."mensajero_asignado_id" = u."id")
  AND NOT EXISTS (SELECT 1 FROM "orden_historial_estado"    x WHERE x."actor_usuario_id" = u."id")
  AND NOT EXISTS (SELECT 1 FROM "pago_mensajero_movimiento" x WHERE x."mensajero_id"   = u."id" OR x."registrado_por" = u."id")
  AND NOT EXISTS (SELECT 1 FROM "tarifas"                   x WHERE x."tienda_id"      = u."id")
  AND NOT EXISTS (SELECT 1 FROM "trusted_device"            x WHERE x."usuario_id"     = u."id")
  AND NOT EXISTS (SELECT 1 FROM "wallet_movimiento"         x WHERE x."registrado_por" = u."id")
  AND NOT EXISTS (SELECT 1 FROM "wallet_tienda_movimiento"  x WHERE x."tienda_id"      = u."id" OR x."registrado_por" = u."id");
