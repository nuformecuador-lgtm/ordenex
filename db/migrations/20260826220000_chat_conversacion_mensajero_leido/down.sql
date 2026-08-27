-- Revierte la marca de lectura del chat del mensajero.
--
-- REVERSIBLE SIN PERDIDA FUNCIONAL, con perdida de DATO asumida: al soltar la columna se
-- pierde hasta donde habia leido cada mensajero, y al volver a aplicar la migracion todos los
-- hilos arrancan en NULL (todo entrante vuelve a contar como no leido). No hay forma de
-- reconstruirlo: la lectura no deja rastro en ninguna otra tabla.
ALTER TABLE "chat_conversacion" DROP COLUMN IF EXISTS "mensajero_leido_at";
