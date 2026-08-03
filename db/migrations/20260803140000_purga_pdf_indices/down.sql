-- Feature 178 (T2, R26) — DOWN de `20260803140000_purga_pdf_indices`.
--
-- Revierte EXACTAMENTE lo que hace `migration.sql`: suelta los dos indices parciales y nada mas.
-- ORDEN INVERSO al del UP (primero `orden`, luego `carga`), por simetria estricta con el UP.
--
-- `IF EXISTS` en AMBAS sentencias para que el rollback sea idempotente (se puede correr dos veces
-- sin fallar), espejo exacto del `IF NOT EXISTS` del UP.
DROP INDEX IF EXISTS "orden_purga_pendiente_idx";
DROP INDEX IF EXISTS "carga_purga_pendiente_idx";
