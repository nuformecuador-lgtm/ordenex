-- DOWN: revierte el enlace de `plantilla_mensaje` con su Message Template de Meta.
-- La migracion UP fue ADITIVA (dos columnas nullable), asi que el rollback es un DROP simple:
-- ninguna fila preexistente dependia de ellas y ningun otro objeto las referencia (no hay
-- indices, FKs ni constraints sobre estas columnas).
--
-- Perdida de datos ACEPTADA y deliberada: se pierde el vinculo con Meta (`template_id`) y el
-- idioma del template (`template_idioma`). Es inherente a revertir la feature que los introdujo;
-- re-aplicar la UP los deja en NULL y la sincronizacion con Meta vuelve a poblarlos.
ALTER TABLE "plantilla_mensaje" DROP COLUMN "template_idioma";
ALTER TABLE "plantilla_mensaje" DROP COLUMN "template_id";
