-- Integracion WhatsApp: anade el 5.º valor al enum `job_tipo` — `whatsapp_template_sync`,
-- el job que REINTENTA contra Meta una operacion de plantilla (create/update/delete) que
-- fallo en linea (propagacion sincrona con fallback a cola, max 5 intentos).
--
-- POR QUE ESTA MIGRACION VA SOLA: Postgres NO permite USAR un valor de enum en la misma
-- transaccion que lo anadio (error 55P04). Prisma Migrate corre cada migration.sql en una
-- transaccion. Mismo criterio que 20260721120000_job_tipo_webhook_estado (feature 99).
--
-- Aditiva: no altera ninguna tabla existente.
ALTER TYPE "job_tipo" ADD VALUE IF NOT EXISTS 'whatsapp_template_sync';
