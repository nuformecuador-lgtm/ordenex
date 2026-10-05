-- FICHA 474 (design §1.6, T1.1) -- anade CINCO valores al enum `job_tipo` para los envios
-- automaticos por WhatsApp:
--   whatsapp_envio_programado    payload { envioId, fechaCr, hora }: UNA ocurrencia a hora fija
--   whatsapp_envio_evento        payload { evento, referencia, notificacionId, datos }: UN aviso puenteado
--   whatsapp_envio_ejecucion     payload { ejecucionId }: ejecuta una ejecucion ya creada (evento)
--   whatsapp_envio_reintento     payload { entregaId }: reintenta una entrega con fallo transitorio
--   whatsapp_envio_mantenimiento payload {}: RECURRENTE diario 03:30 CR (purga de PDFs + cadenas rotas)
--
-- POR QUE ESTA MIGRACION VA SOLA: Postgres NO permite USAR un valor de enum en la misma transaccion
-- que lo anadio (error 55P04). Anadir varios en la misma transaccion SI se puede; lo prohibido es
-- usarlos. La siembra del job de mantenimiento vive en `20261005120200_seed_whatsapp_envio_mantenimiento`.
--
-- Aditiva: no altera ninguna tabla existente. `IF NOT EXISTS`: reaplicarla no falla.
ALTER TYPE "job_tipo" ADD VALUE IF NOT EXISTS 'whatsapp_envio_programado';
ALTER TYPE "job_tipo" ADD VALUE IF NOT EXISTS 'whatsapp_envio_evento';
ALTER TYPE "job_tipo" ADD VALUE IF NOT EXISTS 'whatsapp_envio_ejecucion';
ALTER TYPE "job_tipo" ADD VALUE IF NOT EXISTS 'whatsapp_envio_reintento';
ALTER TYPE "job_tipo" ADD VALUE IF NOT EXISTS 'whatsapp_envio_mantenimiento';
