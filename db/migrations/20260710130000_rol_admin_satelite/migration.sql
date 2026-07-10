-- AlterEnum: añade el 5.º rol al catálogo (feature 19).
-- Postgres 15+ (Supabase) permite ADD VALUE dentro de la transaccion de Prisma Migrate
-- siempre que el nuevo valor NO se use en la misma transaccion (aqui solo se añade).
ALTER TYPE "rol_value" ADD VALUE IF NOT EXISTS 'adminSatelite';
