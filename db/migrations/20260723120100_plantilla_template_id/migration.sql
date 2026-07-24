-- Integracion WhatsApp: enlaza cada `plantilla_mensaje` con su Message Template de Meta.
-- Migracion ADITIVA: dos columnas nullable, sin alterar datos existentes.
--
--  * template_id      = id del template en Meta. NULL = aun no propagada / no sincronizada.
--                       Marca (no NULL) que la plantilla esta enlazada con Meta -> "enviable".
--  * template_idioma  = code de idioma del template en Meta ("es", "es_CO"). Necesario para
--                       ENVIAR (Meta manda por name+language, no por id).
ALTER TABLE "plantilla_mensaje" ADD COLUMN "template_id" TEXT;
ALTER TABLE "plantilla_mensaje" ADD COLUMN "template_idioma" TEXT;
