-- DOWN: revierte EXACTAMENTE migration.sql de esta carpeta, en orden inverso.
-- NO toca las policies RLS de `gestion_orden` (la migracion tampoco las tocó).
--
-- Precondicion (documentada): ninguna. A diferencia del down de
-- 20260714160000_gestion_orden_anulacion (que anadia un valor a un enum PREEXISTENTE y por
-- eso debia RECREAR el tipo con RENAME + CREATE + USING cast), aqui el enum es NUEVO y su
-- UNICA columna usuaria (`gestion_orden.causa_devolucion`) se suelta en este mismo archivo,
-- justo antes -> basta DROP TYPE, sin rodeo. Postgres no soporta DROP VALUE de un enum, pero
-- aqui no hace falta: se va el tipo entero.
--
-- Al soltar la columna se pierden las causas capturadas: es el reverso EXACTO de la
-- migracion (la feature deja de existir), igual que el down de la 67 pierde el rastro de las
-- anulaciones. El `motivo` (texto libre, compartido por reprogramar/devolucion/rechazo) NO se
-- toca: sigue intacto, porque la causa nunca vivio dentro de el (R12).

-- 2) Columna de la causa. Debe soltarse ANTES que el tipo: mientras exista, el tipo esta en
-- uso y el DROP TYPE fallaria.
ALTER TABLE "gestion_orden" DROP COLUMN IF EXISTS "causa_devolucion";

-- 1) Enum de la causa (ya sin ninguna columna usuaria tras el DROP COLUMN de arriba).
DROP TYPE IF EXISTS "gestion_causa_devolucion";
