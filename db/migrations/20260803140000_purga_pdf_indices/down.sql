-- Feature 178 (T2, R26) — DOWN de `20260803140000_purga_pdf_indices`.
--
-- Revierte EXACTAMENTE lo que hace `migration.sql`: suelta los dos indices parciales y nada mas.
-- ORDEN INVERSO al del UP (primero `orden`, luego `carga`), por simetria estricta con el UP.
DROP INDEX "orden_purga_pendiente_idx";
DROP INDEX "carga_purga_pendiente_idx";
