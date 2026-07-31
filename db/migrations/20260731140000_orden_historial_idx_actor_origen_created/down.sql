-- DOWN de la feature 167: revierte EXACTAMENTE lo que hace `migration.sql` — un solo indice.
-- `IF EXISTS` para que el rollback sea idempotente (se puede correr dos veces sin fallar).
--
-- Sin perdida de datos: un indice es una estructura derivada; las filas de
-- `orden_historial_estado` no se tocan. Tras el DOWN, «Recolectadas hoy» sigue devolviendo lo
-- mismo, solo que por seq scan.
--
-- NO hay valor de enum nuevo en esta migracion, asi que NO hay que tocar los `down.sql` previos
-- (la trampa que dejo escrita la 154 aplica solo a los `ADD VALUE`).
DROP INDEX IF EXISTS "orden_historial_actor_origen_created_idx";
