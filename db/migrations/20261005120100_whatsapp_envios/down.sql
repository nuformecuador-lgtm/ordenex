-- DOWN de la ficha 474 (T1.2): revierte EXACTAMENTE `migration.sql`.
--
-- LO QUE SE PIERDE, DECLARADO: todos los envios configurados, sus destinatarios, el historial de
-- ejecuciones y entregas, y la marca «de informe» / «lleva documento» de las plantillas. Los PDFs
-- del bucket `whatsapp-envios` NO los borra SQL: quedan huerfanos en Storage (borrarlos a mano si
-- se revierte en un entorno con datos).
--
-- Orden: tablas hijas antes que padres (las FK caen con su tabla), luego los enums, luego las
-- columnas y CHECKs de `plantilla_mensaje`. Los indices parciales caen con su tabla.
DROP TABLE IF EXISTS "whatsapp_envio_entrega";
DROP TABLE IF EXISTS "whatsapp_envio_ejecucion";
DROP TABLE IF EXISTS "whatsapp_envio_destinatario";
DROP TABLE IF EXISTS "whatsapp_envio";

DROP TYPE IF EXISTS "whatsapp_entrega_estado";
DROP TYPE IF EXISTS "whatsapp_ejecucion_estado";
DROP TYPE IF EXISTS "whatsapp_envio_origen";
DROP TYPE IF EXISTS "whatsapp_envio_disparo";

ALTER TABLE "plantilla_mensaje" DROP CONSTRAINT IF EXISTS "plantilla_mensaje_tienda_sin_informe_check";
ALTER TABLE "plantilla_mensaje" DROP CONSTRAINT IF EXISTS "plantilla_mensaje_documento_requiere_informe_check";
ALTER TABLE "plantilla_mensaje" DROP COLUMN IF EXISTS "lleva_documento";
ALTER TABLE "plantilla_mensaje" DROP COLUMN IF EXISTS "informe_clave";
