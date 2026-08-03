-- DOWN de la feature 177 (T4, R39): revierte EXACTAMENTE las dos sentencias de
-- `migration.sql`, en ORDEN INVERSO (primero `carga`, luego `orden`), ni una mas.
--
-- Sin perdida de datos relevante: la columna es de la propia feature 177 y nace vacia (sin
-- backfill). Al revertir, cualquier ruta persistida despues del UP se pierde y el sistema
-- vuelve al estado anterior — regenerar el PDF (R38). Los objetos ya subidos quedan en el
-- bucket; no los borra esta migracion.
--
-- `download_url` NO se menciona aqui, igual que en el UP: sus valores previos (features
-- 136/141) siguen intactos antes, durante y despues del rollback.
--
-- NO hay valor de enum nuevo en esta migracion, asi que NO hay que tocar los `down.sql`
-- previos (la trampa que dejo escrita la 154 aplica solo a los `ADD VALUE`).
ALTER TABLE "carga" DROP COLUMN "download_storage_path";
ALTER TABLE "orden" DROP COLUMN "download_storage_path";
