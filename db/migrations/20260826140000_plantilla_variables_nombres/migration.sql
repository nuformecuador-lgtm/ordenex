-- Feature 282: snapshot `clave -> nombre legible` de las variables de una plantilla, tomado del
-- catalogo (`CAMPOS_PLANTILLA`) en el momento de guardar.
--
-- Migracion ADITIVA y SIN BACKFILL, deliberadamente:
--  * NOT NULL DEFAULT '{}'  -> la columna NUNCA es null; las filas anteriores a esta feature
--                              quedan en `{}` y la UI deriva el nombre del catalogo (R21).
--  * sin UPDATE de relleno  -> rellenar hoy con el catalogo actual falsificaria un snapshot que
--                              nunca se tomo y borraria la distincion "clave retirada del
--                              catalogo" vs "clave que nunca fue valida" (R16).
--  * sin indice ni RLS      -> es PRESENTACION: ningun camino de envio a Meta la lee. Las
--                              politicas de `plantilla_mensaje` no cambian y la columna hereda
--                              su alcance; el control de acceso real es el guard de rol.
ALTER TABLE "plantilla_mensaje"
  ADD COLUMN "variables_nombres" JSONB NOT NULL DEFAULT '{}';
