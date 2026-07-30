-- DOWN de `20260728230000_chat_mensaje_error_meta` — revierte EXACTAMENTE lo que hace su
-- `migration.sql`, en orden inverso: primero el indice parcial, despues las tres columnas.
--
-- ESCRITO AL PORTAR EL HOTFIX A `dev` (2026-07-29), no cuando nacio la migracion. El hotfix se
-- mergeo DIRECTO a `prod` (PRs #182/#184/#185) sin `down.sql`, contra la regla del repo
-- (`./init.sh` avisa de migraciones sin down). La migracion YA ESTA APLICADA en produccion:
-- este archivo no la modifica ni la re-aplica, solo la hace reversible.
--
-- PERDIDA DE DATOS ACEPTADA Y DECLARADA: soltar las tres columnas pierde el motivo de los
-- salientes ya fallidos. No hay respaldo posible dentro de la propia migracion —el dato solo
-- vive en esas columnas— y es informacion de DIAGNOSTICO, no de negocio: no alimenta cobros,
-- ni cierres, ni el historial de la orden, y el motivo se puede volver a consultar en el panel
-- de Meta. Se declara aqui, en la cabecera, siguiendo el patron del `down.sql` de
-- `20260728120000_drop_orden_mensajero_sugerido`.
--
-- `IF EXISTS` en el indice y en las tres columnas: el UP es aditivo y ya corrio en produccion,
-- pero una base que nunca lo recibio (una dev recien sembrada, CI) debe poder correr este DOWN
-- sin reventar. Nota del patron del repo: `ADD CONSTRAINT` no admite `IF NOT EXISTS` en
-- Postgres, pero aqui no se crea ninguna constraint, asi que el DOWN es idempotente de verdad.

-- 1. El indice parcial primero: cuelga de `error_codigo`, asi que tiene que morir antes que la
--    columna. (Postgres lo soltaria en cascada con la columna, pero el orden inverso explicito
--    es lo que hace auditable el archivo contra su UP.)
DROP INDEX IF EXISTS "chat_mensaje_error_codigo_idx";

-- 2. Las tres columnas, en orden inverso al del UP.
ALTER TABLE "chat_mensaje"
  DROP COLUMN IF EXISTS "error_detalle",
  DROP COLUMN IF EXISTS "error_titulo",
  DROP COLUMN IF EXISTS "error_codigo";
